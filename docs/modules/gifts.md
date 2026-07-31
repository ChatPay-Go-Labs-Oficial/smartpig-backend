# Módulo: Gifts

**Localização:** `src/gifts/` — `gifts.controller.ts`, `gifts.service.ts`, `gift-stellar.service.ts`, `dto/`
**Jobs:** `src/jobs/gift-reconciliation.job.ts` (a cada minuto) e `src/jobs/gift-expiry.job.ts` (a cada hora)
**Status:** implementado (commit `74edb86`); spec original aprovada em 2026-07-21.
**Contraparte mobile:** plano em `smartpig-app/.claude/plans/gifting.plan.md`.

## Responsabilidade

Gerencia o ciclo de vida de um presente ("Dê um cofrinho de dólar"): criação do gift intent, reconciliação do funding on-chain (claimable balance), resgate atômico para o destinatário e acompanhamento de expiração/refund.

## Decisões de arquitetura

1. **Custódia via Claimable Balance nativa Stellar** — sem Soroban, sem hot wallet com float:
   - O remetente assina no app uma `createClaimableBalance` (USDC) com **2 claimants**:
     - `claimAgent` (conta do backend): predicate `BeforeAbsoluteTime(expiresAt)` — pode resgatar até expirar;
     - remetente: predicate `Not(BeforeAbsoluteTime(expiresAt))` — refund trustless após expirar.
   - O backend **nunca** segura fundos entre transações: o claim é 1 tx atômica com 2 operações (`claimClaimableBalance` + `payment` → destinatário).
2. **Elegibilidade:** presente é **só para contas novas** — claim aceito apenas se `recipient.createdAt > gift.createdAt`.
3. **Distribuição do código:** o app compartilha a URL da Play Store com `referrer=utm_source%3Dgift%26gift_code%3D{code}`; o backend não participa da distribuição, apenas valida o code.
4. **Refund:** não há job de payout de refund — o próprio remetente resgata após `expiresAt` (assinado no app). O backend apenas marca `EXPIRED` e pode notificar.

## Endpoints

Todas as rotas exigem `Authorization: Bearer {privyAccessToken}` — nenhuma delas usa `@Public()`, então o `PrivyAuthGuard` global se aplica.

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/gifts` | Cria gift intent; retorna code + dados p/ montar a tx no app (403 se o email não estiver em `GIFT_ALLOWED_EMAILS`) |
| GET | `/gifts/eligibility?userId=` | `{ canGift }` — gate de founders enquanto o rollout for restrito |
| GET | `/gifts/:code` | Preview do presente (valor, remetente, status) — só campos não sensíveis |
| POST | `/gifts/:code/claim` | Resgata para o usuário autenticado (valida elegibilidade) |
| GET | `/gifts?userId=...` | Enviados/recebidos do usuário (histórico) |

> A spec previa `GET /gifts/:code` público para o preview antes do login. Na implementação atual ele exige Bearer — se o app precisar mostrar o preview a quem ainda não entrou, essa rota precisa receber `@Public()`.

### POST /gifts

Request:
```json
{
  "idempotencyKey": "uuid-v4",
  "userId": "cuid",
  "walletAccountId": "cuid",
  "amount": "50.00"
}
```

Response:
```json
{
  "id": "cuid",
  "code": "b64url-128bits",
  "claimAgentAddress": "GABC...",
  "memo": "gift:{shortId}",
  "expiresAt": "2026-07-28T00:00:00Z",
  "status": "CREATED"
}
```

Validações:
1. `idempotencyKey` única (retry devolve a intent existente — padrão do módulo deposits)
2. `walletAccountId` pertence ao `userId` e está ativa
3. `amount` dentro dos limites (`GIFT_MIN_USD` / `GIFT_MAX_USD` — sugerido 1–100, via config)
4. Limite de presentes pendentes por usuário (sugerido: 5) — anti-abuso

### POST /gifts/:code/claim

Request: `{ "userId": "cuid", "walletAccountId": "cuid", "stellarAddress": "G..." }`

| Condição | Resultado |
|---|---|
| code inexistente | 404 |
| status ≠ `FUNDED` | 409 Conflict (mensagem por estado: já resgatado / expirado / aguardando funding) |
| `recipient.createdAt <= gift.createdAt` | 403 — "presente válido apenas para contas novas" |
| destinatário == remetente | 403 |
| `expiresAt` no passado | 410 Gone (marca `EXPIRED`) |
| ok | resgata: tx atômica claim+payment; `CLAIMED` |

Claim é **one-shot**: transição `FUNDED → CLAIMING` sob lock transacional (Prisma `$transaction` + update condicional por status) antes de submeter a tx on-chain; falha on-chain reverte para `FUNDED` com `errorMessage`.

## Modelo Prisma (implementado)

> Diferença em relação à proposta original: `memo` é `@unique` — é a chave que a reconciliação usa para casar a transação de funding com o gift.

```prisma
enum GiftStatus {
  CREATED    // intent criada, aguardando funding on-chain
  FUNDED     // claimable balance detectada (balanceId preenchido)
  CLAIMING   // lock de resgate em andamento
  CLAIMED    // pago ao destinatário
  EXPIRED    // passou de expiresAt sem claim
  REFUNDED   // remetente resgatou de volta (detectado por reconciliação)
}

model Gift {
  id               String     @id @default(cuid())
  idempotencyKey   String     @unique
  code             String     @unique          // >=128 bits, b64url
  senderUserId     String
  senderWalletId   String
  recipientUserId  String?                     // preenchido no claim
  amount           Decimal    @db.Decimal(30, 8)
  assetSymbol      String     @default("USDC")
  status           GiftStatus @default(CREATED)
  balanceId        String?                     // claimable balance id (da reconciliação)
  fundingTxHash    String?
  claimTxHash      String?
  memo             String
  errorMessage     String?
  expiresAt        DateTime
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  sender     User          @relation("giftsSent", fields: [senderUserId], references: [id])
  recipient  User?         @relation("giftsReceived", fields: [recipientUserId], references: [id])

  @@index([senderUserId, status])
  @@index([status, expiresAt])
  @@map("gifts")
}
```

## Ciclo de vida

```
CREATED ──(reconciliação vê memo)──► FUNDED ──(claim ok)──► CLAIMING ──► CLAIMED
   │                                   │                        └─(falha tx)─► FUNDED
   └─(expiresAt sem funding)► EXPIRED  └─(expiresAt)─► EXPIRED ──(remetente resgata)──► REFUNDED
```

## Jobs (`src/jobs/`)

| Job | Arquivo | Frequência | Função |
|---|---|---|---|
| `GiftReconciliationJob` | `gift-reconciliation.job.ts` | a cada minuto | Varre a rede procurando tx com o `memo` de gifts `CREATED`; extrai `balanceId` do resultado da tx; marca `FUNDED` |
| `GiftExpiryJob` | `gift-expiry.job.ts` | a cada hora | `FUNDED/CREATED` com `expiresAt` no passado → `EXPIRED`; detecta claim do remetente on-chain → `REFUNDED` |

## Conta claimAgent

- Conta Stellar clássica dedicada, chave em KMS/secret manager — **não** reutilizar contas existentes.
- Setup one-time: trustline USDC + XLM para fees.
- Exposição: só consegue resgatar claimable balances **pendentes** dentro da janela de validade (sem float acumulado).

## Segurança

- `code`: ≥128 bits de entropia (`crypto.randomBytes(16)` → base64url); nunca sequencial.
- Rate limit em `GET /gifts/:code` e `POST /gifts/:code/claim` (o padrão global do projeto + limite específico por IP).
- `GET /gifts/:code` público retorna somente `{ amount, senderName, status }` — nada de IDs internos, endereços ou balanceId.
- Claim exige Bearer + one-shot por lock transacional.
- Auditoria via `ApiAuditLog` (padrão existente).

## Dependências

- `PrismaService` — persistência
- `stellar-sdk` (já usado) — montagem da tx atômica claim+payment e parsing do `balanceId`
- Config: `GIFT_MIN_USD`, `GIFT_MAX_USD`, `GIFT_EXPIRY_DAYS` (sugerido 7), `GIFT_MAX_PENDING_PER_USER`, `GIFT_CLAIM_AGENT_SECRET` (KMS)
- `GIFT_ALLOWED_EMAILS`: lista de emails (separados por vírgula) autorizados a presentear durante o rollout restrito a founders; **vazia/ausente = liberado para todos** (o rollout geral é apagar a env)
