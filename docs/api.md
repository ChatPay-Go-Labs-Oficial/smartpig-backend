# Referência da API REST

Base URL: `http://localhost:3000` (dev) | configurável via `PORT`

> **Nota**: Autenticação JWT ainda não está implementada. Os endpoints que futuramente exigirão JWT estão marcados com 🔒. Por enquanto, `userId` deve ser enviado no body/query.

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

## Health

### `GET /health`
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

#### `POST /webhooks/blindpay`
Recebe notificações do BlindPay sobre status de pagamentos. **Endpoint público**, mas verificado com assinatura HMAC-SHA256 (`blindpay-signature` header).

Atualiza automaticamente os status de `OnrampTransaction` e `OfframpTransaction`.

| Evento BlindPay | Novo status interno |
|---|---|
| `payin.completed` | `COMPLETED` |
| `payin.failed` | `FAILED` |
| `payin.refunded` | `REFUNDED` |
| `payout.completed` | `COMPLETED` |
| `payout.failed` | `FAILED` |
