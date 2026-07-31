# Referência da API REST

Base URL: `http://localhost:3000` (dev) | configurável via `PORT`

> **Autenticação via Privy**: todas as rotas são protegidas por padrão pelo `PrivyAuthGuard` (guard global). O app envia `Authorization: Bearer {privyAccessToken}` nas chamadas marcadas com 🔒. Rotas marcadas com 🌐 são públicas (`@Public()`).
>
> O `userId` interno (cuid do `User`) continua sendo enviado no body/query das rotas de negócio — o guard valida a identidade Privy, mas os serviços resolvem o usuário pelo `userId` recebido.
>
> Rotas públicas: `GET /health`, `POST /auth/wallet`, `POST /webhooks/blindpay`.

Documentação interativa (Swagger): **`GET /api/docs`**.

## Formato de resposta

### Sucesso
A resposta é o objeto retornado diretamente pelo serviço. Não há envelope padrão.

### Erro
Todos os erros seguem o formato abaixo (via `HttpExceptionFilter`):

```json
{
  "statusCode": 400,
  "message": "Descrição do erro",
  "error": "Bad Request",
  "timestamp": "2026-05-08T14:00:00.000Z",
  "path": "/deposits"
}
```

---

## Auth

### `POST /auth/wallet` 🌐
Registra ou faz login de um usuário. Público, mas **aceita** um Bearer token do Privy:

- **Sem token** — cria/recupera o `User` pela `stellarAddress` enviada no body.
- **Com token Privy** — o backend consulta as carteiras Stellar vinculadas àquele usuário no Privy e vincula essas ao `User`, ignorando divergências do body.

Um Bearer inválido retorna 401 mesmo sendo rota pública.

**Body:**
```json
{
  "stellarAddress": "GABC...XYZ",
  "label": "Minha carteira principal"
}
```

**Resposta 200:**
```json
{
  "user": {
    "id": "clx...",
    "name": null,
    "email": null,
    "avatarUrl": null,
    "createdAt": "2026-05-14T10:00:00.000Z"
  },
  "wallet": {
    "id": "clx...",
    "stellarAddress": "GABC...XYZ",
    "label": "Minha carteira principal",
    "isActive": true
  },
  "isNewUser": true,
  "needsActivation": true
}
```

> **`isNewUser`**: `true` na primeira vez que aquela `stellarAddress` é vista. O `userId` retornado deve ser persistido no app e enviado nas chamadas seguintes.
>
> **`needsActivation`**: `true` quando a conta Stellar ainda não existe on-chain (ou não tem as trustlines abertas). Nesse caso o app deve chamar `POST /wallets/activate` antes de qualquer operação com USDC.

---

## Users

### `GET /users/:id` 🔒
Retorna o perfil do usuário.

**Resposta 200:**
```json
{
  "id": "clx...",
  "name": "João Silva",
  "email": "joao@example.com",
  "avatarUrl": null,
  "createdAt": "2026-05-14T10:00:00.000Z",
  "updatedAt": "2026-05-14T10:00:00.000Z"
}
```

---

### `PATCH /users/:id` 🔒
Atualiza nome, email ou avatar do usuário.

**Body (todos os campos opcionais):**
```json
{
  "name": "João Silva",
  "email": "joao@example.com",
  "avatarUrl": "https://..."
}
```

**Erros:**
- `404` — usuário não encontrado
- `409` — email já em uso por outro usuário

---

### `DELETE /users/:id` 🔒
Remove a conta permanentemente. Todos os dados relacionados são deletados em cascade (wallets, intents, transações).

**Resposta 200:**
```json
{ "id": "clx...", "deleted": true }
```

---

## Wallets

### `GET /wallets?userId=...` 🔒
Lista todas as wallets ativas de um usuário.

**Resposta 200:**
```json
[
  {
    "id": "clx...",
    "userId": "clx...",
    "stellarAddress": "GABC...",
    "label": "Carteira principal",
    "isActive": true,
    "createdAt": "2026-05-14T10:00:00.000Z"
  }
]
```

---

### `POST /wallets` 🔒
Adiciona uma nova wallet Stellar ao usuário. Se a carteira já existia mas estava desativada, ela é reativada.

**Body:**
```json
{
  "userId": "clx...",
  "stellarAddress": "GABC...XYZ",
  "label": "Carteira secundária"
}
```

**Erros:**
- `404` — usuário não encontrado
- `409` — wallet já ativa para esse usuário

---

### `GET /wallets/:id` 🔒
Retorna detalhes de uma wallet específica.

---

### `DELETE /wallets/:id` 🔒
Desativa uma wallet (soft delete — não é removida do banco).

**Resposta 200:**
```json
{ "id": "clx...", "isActive": false }
```

---

### `POST /wallets/activate` 🔒
Gera o XDR de **ativação patrocinada** da conta Stellar. A transação cria a conta on-chain (`CreateAccount`), patrocina as reservas via `BeginSponsoringFutureReserves`, abre a trustline de USDC (e a de TESOURO, quando configurada para a rede ativa) e encerra o patrocínio. O XDR já vem **pré-assinado pela conta tesouraria** (`TREASURY_STELLAR_SECRET`) — o usuário só adiciona a própria assinatura.

**Body:**
```json
{
  "userId": "clx...",
  "walletAccountId": "clx...",
  "stellarAddress": "GABC...XYZ"
}
```

**Resposta 201:** `{ "unsignedXdr": "AAAAAgAAAAB..." }`

**Erros:** `400` (tesouraria não configurada) · `404` (wallet não encontrada) · `409` (wallet já ativada)

---

### `POST /wallets/activate/submit` 🔒
Submete o XDR de ativação com as duas assinaturas (tesouraria + usuário). Marca a wallet como ativada em caso de sucesso.

**Body:** `{ "walletAccountId": "clx...", "signedXdr": "AAAA..." }`

**Resposta 201:** `{ "success": true, "txHash": "abc123..." }`

> O estado da ativação fica em `WalletAccount.activationStatus` (`NOT_STARTED → PENDING_SIGNATURE → SUBMITTING → ACTIVATED | FAILED`).

---

### `POST /wallets/trustline/xdr` 🔒
Gera um XDR não assinado com uma operação `ChangeTrust` para o ativo USDC da rede ativa. Use quando a conta já existe e só falta a trustline (o fluxo de ativação já inclui essa etapa).

**Body:** `{ "stellarAddress": "GABC...XYZ" }`

**Resposta 201:** `{ "unsignedXdr": "AAAA...", "asset": "USDC:issuer..." }`

---

### `POST /wallets/trustline/submit` 🔒
Submete o `ChangeTrust` assinado à rede Stellar.

**Body:** `{ "stellarAddress": "GABC...XYZ", "signedXdr": "AAAA..." }`

**Resposta 201:** `{ "hash": "abc123..." }`

---

### `GET /wallets/:address/balance` 🔒
Saldos da conta Stellar direto do Horizon (todos os ativos com saldo diferente de zero).

**Parâmetros:** `address` — chave pública Stellar (`G...`)

**Resposta 200:**
```json
{ "balances": [{ "asset": "USDC:issuer...", "balance": "1.99" }] }
```

---

### `GET /health` 🌐
Verifica se a API está no ar.

**Resposta 200:**
```json
{ "status": "ok" }
```

---

## Vaults

> **Vaults são descobertos automaticamente** pelo `VaultSyncJob` a cada 30 minutos via `GET /vault/discover` na API DeFindex. Não é necessário seed manual em operação normal.

### `GET /vaults`
Lista todos os vaults ativos (dados do banco local).

**Resposta 200:**
```json
[
  {
    "id": "clx...",
    "defindexVaultId": "GVAULT...",
    "name": "USDC Yield Vault",
    "assetSymbol": "USDC",
    "description": "Vault de rendimento em USDC",
    "apy": "5.2500",
    "tvl": null,
    "lastSyncedAt": "2026-05-08T10:00:00.000Z"
  }
]
```

---

### `GET /vaults/:id`
Retorna detalhes de um vault + informações live do DeFindex (se disponível).

**Parâmetros:**
- `id` — ID interno do vault (não o endereço Stellar)

**Resposta 200:**
```json
{
  "id": "clx...",
  "defindexVaultId": "GVAULT...",
  "name": "USDC Yield Vault",
  "apy": "5.2500",
  "liveInfo": {
    "defindexVaultId": "GVAULT...",
    "name": "USDC Yield Vault",
    "symbol": "dfUSDC",
    "apy": 5.25,
    "assets": [{ "address": "GUSDC...", "strategies": [] }]
  }
}
```

---

### `GET /vaults/:id/apy`
APY live do vault (cache em memória de 5 minutos, fallback para valor do banco).

**Resposta 200:**
```json
{
  "vaultId": "clx...",
  "apy": 5.25,
  "cached": false
}
```

---

### `POST /vaults/sync`
Dispara manualmente a sincronização de vaults (equivalente ao `VaultSyncJob`). Útil para forçar re-sync sem esperar o cron de 30 minutos.

**Resposta 200:**
```json
{ "upserted": 9, "total": 9 }
```

---

### `GET /vaults/:id/balance?walletAddress=G...`
Saldo do usuário em um vault específico.

**Query params:**
- `walletAddress` *(obrigatório)* — endereço público Stellar

**Resposta 200:**
```json
{
  "vaultId": "clx...",
  "walletAddress": "GABC...",
  "dfTokens": 100.5,
  "underlyingBalance": [100.123456]
}
```

---

## Deposits

### `POST /deposits` 🔒
Cria uma intenção de depósito e gera um XDR não assinado.

**Body:**
```json
{
  "idempotencyKey": "unique-client-key-123",
  "userId": "clx...",
  "walletAccountId": "clx...",
  "vaultId": "clx...",
  "amount": "100.50",
  "assetSymbol": "USDC"
}
```

**Resposta 201:**
```json
{
  "id": "clx...",
  "idempotencyKey": "unique-client-key-123",
  "status": "XDR_GENERATED",
  "amount": "100.50000000",
  "assetSymbol": "USDC",
  "unsignedXdr": "AAAAAgAAAA...",
  "expiresAt": "2026-05-09T14:00:00.000Z"
}
```

> **Idempotência**: enviar a mesma `idempotencyKey` retorna a intent existente sem criar uma nova.

---

### `POST /deposits/:id/signed-xdr` 🔒
Envia o XDR assinado pelo cliente para broadcast na rede Stellar.

**Body:**
```json
{
  "signedXdr": "AAAAAgAAAA...assinado..."
}
```

**Resposta 201:**
```json
{
  "id": "clx...",
  "txHash": "abc123...",
  "status": "SUBMITTED"
}
```

**Erros:**
- `400` — intent sem XDR, expirada, ou em estado FAILED
- `409` — intent já submetida ou confirmada

---

### `GET /deposits/:id` 🔒
Status atual de uma intent de depósito.

**Resposta 200:**
```json
{
  "id": "clx...",
  "status": "CONFIRMED",
  "amount": "100.50000000",
  "assetSymbol": "USDC",
  "vaultId": "clx...",
  "createdAt": "2026-05-08T14:00:00.000Z"
}
```

---

### `GET /deposits?userId=...` 🔒
Lista todas as intents de depósito de um usuário.

**Query params:**
- `userId` *(obrigatório)* — será substituído por extração do JWT

**Resposta 200:** array de intents (sem XDR fields)

---

## Withdrawals

### `POST /withdrawals` 🔒
Cria uma intenção de saque e gera um XDR não assinado.

**Body:**
```json
{
  "idempotencyKey": "unique-client-key-456",
  "userId": "clx...",
  "walletAccountId": "clx...",
  "vaultId": "clx...",
  "shareAmount": "50.00000000"
}
```

**Resposta 201:**
```json
{
  "id": "clx...",
  "status": "XDR_GENERATED",
  "shareAmount": "50.00000000",
  "unsignedXdr": "AAAAAgAAAA...",
  "expiresAt": "2026-05-09T14:00:00.000Z"
}
```

---

### `POST /withdrawals/:id/signed-xdr` 🔒
Envia o XDR assinado pelo cliente para broadcast.

**Body / Resposta:** idênticos ao endpoint de depósito.

---

### `GET /withdrawals/:id` 🔒
Status atual de uma intent de saque.

---

### `GET /withdrawals?userId=...` 🔒
Lista todas as intents de saque de um usuário.

---

---

## Gifts

> Presentes em USDC entregues via **claimable balance** nativa da Stellar. O backend nunca custodia os fundos: o remetente cria a claimable balance e o agente de claim resgata e paga o destinatário em uma única transação atômica.
> Ver [modules/gifts.md](./modules/gifts.md).

### `POST /gifts` 🔒
Cria o gift intent e devolve o código de compartilhamento, o endereço do agente de claim e o memo que o app deve anexar à transação de funding.

**Body:**
```json
{
  "idempotencyKey": "uuid-v4",
  "userId": "clx...",
  "walletAccountId": "clx...",
  "amount": "50.00"
}
```

**Resposta 201:**
```json
{
  "id": "clx...",
  "code": "p3XoZ0uKfL9qA2xYw1vRbg",
  "senderUserId": "clx...",
  "amount": "50.00",
  "assetSymbol": "USDC",
  "status": "CREATED",
  "memo": "gift:1a2b3c4d5e6f7a8b",
  "claimAgentAddress": "GABC...XYZ",
  "expiresAt": "2026-07-28T00:00:00.000Z"
}
```

**Erros:** `400` (valor fora de `GIFT_MIN_USD`/`GIFT_MAX_USD`) · `403` (conta sem permissão de presentear) · `404` (wallet não encontrada) · `409` (limite de presentes pendentes) · `503` (agente de claim não configurado)

> `idempotencyKey` repetida devolve o gift existente, igual ao módulo de depósitos.

---

### `GET /gifts?userId=...` 🔒
Lista os presentes enviados e recebidos pelo usuário.

---

### `GET /gifts/eligibility?userId=...` 🔒
Indica se o usuário pode presentear: `{ "canGift": true }`. Enquanto `GIFT_ALLOWED_EMAILS` estiver preenchida, só os e-mails da lista podem; vazia/ausente libera para todos.

---

### `GET /gifts/:code` 🔒
Preview do presente. Retorna apenas dados não sensíveis — nada de IDs internos, endereços ou `balanceId`.

**Resposta 200:**
```json
{
  "amount": "50.00",
  "assetSymbol": "USDC",
  "status": "FUNDED",
  "expiresAt": "2026-07-28T00:00:00.000Z",
  "senderName": "Maria"
}
```

---

### `POST /gifts/:code/claim` 🔒
Resgata a claimable balance e paga a carteira do destinatário em uma transação atômica. Só contas criadas **depois** do presente qualificam.

**Body:** `{ "userId": "clx...", "walletAccountId": "clx...", "stellarAddress": "GABC..." }`

**Resposta 201:** `{ "id": "clx...", "status": "CLAIMED", "claimTxHash": "abc123...", "amount": "50.00" }`

**Erros:** `403` (presente próprio ou conta mais antiga que o presente) · `404` (presente, usuário ou wallet não encontrados) · `409` (presente não resgatável no estado atual) · `410` (expirado) · `503` (falha on-chain — seguro repetir)

---

## Vault Manager

> Endpoints para SmartPig criar e gerenciar seus próprios vaults no protocolo DeFindex.
> Requer que o usuário assine o XDR gerado com sua carteira Stellar e o submeta de volta.

### `POST /vault-manager/vaults` 🔒
Cria um novo vault DeFindex gerenciado pelo SmartPig. Gera um XDR não assinado que deve ser assinado pelo operador (via Stellar Laboratory ou carteira).

**Body:**
```json
{
  "userId": "clx...",
  "callerAddress": "GADS4...",
  "name": "SmartPig XLM Vault",
  "symbol": "SPXLM",
  "vaultFeeBps": 25,
  "upgradable": true,
  "roles": {
    "manager": "GADS4...",
    "emergencyManager": "GADS4...",
    "feeReceiver": "GADS4...",
    "rebalanceManager": "GADS4..."
  },
  "assets": [{
    "address": "CDLZFC3...",
    "symbol": "XLM",
    "amount": 100000000,
    "strategies": [{
      "address": "CDVLOSP...",
      "name": "xlm_blend_autocompound",
      "amount": 100000000
    }]
  }]
}
```

> **Nota sobre `amount`**: valores em unidades mínimas da rede (stroops para XLM: `10 XLM = 100000000`).
> **`vaultFeeBps`**: taxa de gestão em basis points (25 = 0.25% ao ano sobre o TVL).
> **`feeReceiver`**: carteira do SmartPig que recebe as taxas de gestão.

**Resposta 201:**
```json
{
  "id": "clx...",
  "name": "SmartPig XLM Vault",
  "symbol": "SPXLM",
  "status": "PENDING_SIGNATURE",
  "unsignedXdr": "AAAAAgAAAA...",
  "predictedVaultAddress": "CDDU2F..."
}
```

---

### `POST /vault-manager/vaults/:id/submit` 🔒
Submete o XDR assinado pelo operador para broadcast na rede Stellar. Ao confirmar, o vault é registrado automaticamente no `VaultCatalog`.

**Body:**
```json
{ "signedXdr": "AAAAAgAAAA...assinado..." }
```

**Resposta 200:**
```json
{
  "id": "clx...",
  "txHash": "cb0e820b...",
  "vaultAddress": "CDDU2F...",
  "status": "CONFIRMED"
}
```

**Erros:**
- `404` — ManagedVault não encontrado
- `400` — Vault já submetido ou em estado inválido

---

### `GET /vault-manager/vaults?userId=...` 🔒
Lista todos os vaults gerenciados criados por um usuário.

**Query params:**
- `userId` *(obrigatório)* — será substituído por extração do JWT

**Resposta 200:** array de `ManagedVault` com dados do `VaultCatalog` vinculado (APY, TVL).

---

### `GET /vault-manager/vaults/:id` 🔒
Detalhes de um vault gerenciado específico, incluindo status e o `VaultCatalog` vinculado.

---

## Códigos de status HTTP utilizados

| Código | Situação |
|--------|---------|
| 200 | Sucesso em GET |
| 201 | Recurso criado (POST) |
| 400 | Bad Request (validação, estado inválido) |
| 404 | Recurso não encontrado |
| 409 | Conflito (operação duplicada) |
| 422 | Entidade não processável |
| 500 | Erro interno |

---

## On/Off Ramp (BlindPay)

> Integração com BlindPay para converter entre BRL (via PIX) e USDC (rede Stellar).
> Cada usuário precisa ter um Receiver cadastrado antes de usar on-ramp/off-ramp.

### Setup do usuário

#### `POST /ramp/receiver` 🔒
Cria um Receiver BlindPay para o usuário (uma vez por usuário).

**Body:**
```json
{
  "userId": "clx...",
  "name": "João da Silva",
  "taxId": "123.456.789-00"
}
```

**Resposta 201:** objeto `BlindPayReceiver` com `id`, `blindpayReceiverId`, `name`.

---

#### `GET /ramp/receiver` 🔒
Retorna o receiver do usuário com suas contas bancárias e carteiras blockchain registradas.

**Body:** `{ "userId": "clx..." }`

---

#### `POST /ramp/receiver/bank-accounts` 🔒
Adiciona uma chave PIX ao receiver do usuário.

**Body:**
```json
{
  "userId": "clx...",
  "pixKeyType": "cpf",
  "pixKey": "12345678900"
}
```

**`pixKeyType`:** `cpf` | `cnpj` | `phone` | `email` | `random`

---

#### `GET /ramp/receiver/bank-accounts` 🔒
Lista as contas bancárias (chaves PIX) do receiver do usuário.

**Body:** `{ "userId": "clx..." }`

---

#### `POST /ramp/receiver/wallets` 🔒
Registra o endereço Stellar do usuário no BlindPay (necessário para on-ramp).

**Body:**
```json
{
  "userId": "clx...",
  "stellarAddress": "GABC..."
}
```

---

### On-ramp (BRL → USDC)

**Fluxo:**
1. `POST /ramp/onramp/quote` → obter cotação
2. `POST /ramp/onramp` → criar on-ramp (retorna código PIX)
3. Usuário paga o PIX no app bancário
4. BlindPay envia USDC para a carteira Stellar do usuário automaticamente
5. Webhook atualiza status para `COMPLETED`

#### `POST /ramp/onramp/quote` 🔒
Cotação de on-ramp (quanto USDC receberá por X BRL).

**Body:**
```json
{
  "userId": "clx...",
  "blockchainWalletId": "bw_...",
  "amountBrl": 5000
}
```

> `amountBrl` em centavos (R$50.00 = `5000`)

**Resposta 200:** objeto com `payin_amount` (micro-USDC), `exchange_rate`, `fee`, `expires_at`.

---

#### `POST /ramp/onramp` 🔒
Inicia o on-ramp. Retorna código PIX para pagamento.

**Body:** igual ao de quote.

**Resposta 201:**
```json
{
  "id": "clx...",
  "status": "AWAITING_PAYMENT",
  "amountBrl": "5000.00",
  "amountUsdc": "5000000.000000",
  "pixCode": "00020101...",
  "createdAt": "2026-05-12T14:00:00.000Z"
}
```

> Em instâncias de desenvolvimento do BlindPay, o pagamento é simulado automaticamente em 30 segundos.

---

#### `GET /ramp/onramp/:id` 🔒
Status de uma transação de on-ramp.

**Body:** `{ "userId": "clx..." }`

**Status possíveis:** `PENDING` | `AWAITING_PAYMENT` | `PROCESSING` | `COMPLETED` | `FAILED` | `REFUNDED`

---

### Off-ramp (USDC → BRL)

**Fluxo:**
1. `POST /ramp/offramp/quote` → obter cotação
2. `POST /ramp/offramp` → criar off-ramp (retorna XDR de delegação não assinado)
3. Usuário assina o XDR com a carteira Stellar (delega USDC ao BlindPay)
4. `POST /ramp/offramp/:id/submit` → enviar hash da delegação assinada
5. BlindPay transfere BRL via PIX para a conta do usuário
6. Webhook atualiza status para `COMPLETED`

#### `POST /ramp/offramp/quote` 🔒
Cotação de off-ramp (quanto BRL receberá por X USDC).

**Body:**
```json
{
  "userId": "clx...",
  "bankAccountId": "clx...",
  "amountUsdc": 1000000,
  "coverFees": false
}
```

> `amountUsdc` em micro-USDC (1 USDC = `1000000`)

**Resposta 200:** objeto com `payout_amount` (centavos BRL), `exchange_rate`, `fee`, `expires_at`.

---

#### `POST /ramp/offramp` 🔒
Inicia o off-ramp. Retorna XDR não assinado para delegação.

**Body:**
```json
{
  "userId": "clx...",
  "bankAccountId": "clx...",
  "senderWalletAddress": "GABC...",
  "amountUsdc": 1000000,
  "coverFees": false
}
```

**Resposta 201:**
```json
{
  "id": "clx...",
  "status": "DELEGATION_NEEDED",
  "amountUsdc": "1000000.000000",
  "amountBrl": "50000.00",
  "unsignedDelegationXdr": "AAAAAgAAAA..."
}
```

> O usuário deve assinar o `unsignedDelegationXdr` com sua carteira Stellar e enviar o hash resultante para `/submit`.

---

#### `POST /ramp/offramp/:id/submit` 🔒
Envia o hash da transação de delegação assinada.

**Body:**
```json
{
  "userId": "clx...",
  "signedDelegationHash": "abc123def..."
}
```

**Resposta 200:** objeto `OfframpTransaction` com `status: "PROCESSING"`.

---

#### `GET /ramp/offramp/:id` 🔒
Status de uma transação de off-ramp.

**Body:** `{ "userId": "clx..." }`

---

### Webhooks

#### `POST /webhooks/blindpay` 🌐
Recebe notificações do BlindPay sobre status de pagamentos. Endpoint público (`@Public()`), verificado pelo esquema **Svix** — headers `svix-id`, `svix-timestamp` e `svix-signature`, HMAC-SHA256 sobre `{svix-id}.{svix-timestamp}.{rawBody}` com a parte após o `_` do `BLINDPAY_WEBHOOK_SECRET` decodificada em base64, com janela de tolerância de 5 minutos.

> Não existe header `blindpay-signature` — não troque essa verificação por um HMAC genérico. Se `BLINDPAY_WEBHOOK_SECRET` não estiver configurado, a verificação é pulada (desenvolvimento).

O tipo do evento vem no campo `webhook_event` do body. Atualiza automaticamente os status de `OnrampTransaction` e `OfframpTransaction`.

| Evento BlindPay | Novo status interno |
|---|---|
| `payin.completed` | `COMPLETED` |
| `payin.failed` | `FAILED` |
| `payin.refunded` | `REFUNDED` |
| `payout.completed` | `COMPLETED` |
| `payout.failed` | `FAILED` |

---

### Rotas auxiliares do ramp BlindPay

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/ramp/tos` 🔒 | Aceite dos termos de serviço da instância BlindPay |
| `POST` | `/ramp/upload` 🔒 | Upload de documento (KYC) para o BlindPay |
| `POST` | `/ramp/offramp/:id/delegation` 🔒 | Regenera o XDR de delegação de um off-ramp existente |
| `POST` | `/ramp/onramp/:id/sync` 🔒 | Busca o status do payin direto no BlindPay e atualiza o banco |
| `POST` | `/ramp/offramp/:id/sync` 🔒 | Idem para payout |

> Os endpoints `/sync` existem para ambientes sem webhook configurado ou para reconciliação manual.

---

## On/Off Ramp (Etherfuse)

Integração para o mercado mexicano (MXN via SPEI/CLABE ↔ USDC/CETES), com onboarding KYC próprio via child organizations. A referência completa de rotas, o fluxo de KYC e a verificação de webhook estão em [modules/etherfuse-ramp.md](./modules/etherfuse-ramp.md).

Além das rotas descritas lá, existem hoje: `POST /etherfuse/onboarding/presigned-url`, `POST /etherfuse/onboarding/bank-account/pix`, `POST /etherfuse/onboarding/bank-accounts/sync`, `GET /etherfuse/assets`, `POST /etherfuse/offramp/:id/refresh-xdr`, `POST /etherfuse/orders/:id/sync` e `POST /etherfuse/sandbox/onramp/:id/simulate-payment` (só em ambiente de teste).
