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
