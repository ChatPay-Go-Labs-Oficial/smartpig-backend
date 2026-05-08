# Fluxos de Operação

## Fluxo de Depósito

```
App Mobile                  Backend (NestJS)              DeFindex / Stellar
     │                            │                              │
     │ POST /deposits             │                              │
     │ {idempotencyKey, vaultId,  │                              │
     │  walletAccountId, amount}  │                              │
     │──────────────────────────▶│                              │
     │                            │ 1. Verifica idempotencyKey   │
     │                            │ 2. Valida vault (ativo)      │
     │                            │ 3. Valida wallet (do usuário)│
     │                            │ 4. Cria DepositIntent        │
     │                            │    status: CREATED           │
     │                            │                              │
     │                            │ sdk.depositToVault(...)      │
     │                            │─────────────────────────────▶│
     │                            │◀─────────────────────────────│
     │                            │    { xdr: "AAAA..." }        │
     │                            │                              │
     │                            │ 5. Persiste unsignedXdr      │
     │                            │    status: XDR_GENERATED     │
     │◀──────────────────────────│                              │
     │  { id, unsignedXdr, ... }  │                              │
     │                            │                              │
     │  [usuário assina o XDR    │                              │
     │   com sua wallet]          │                              │
     │                            │                              │
     │ POST /deposits/:id/signed-xdr                            │
     │ { signedXdr: "AAAA..." }   │                              │
     │──────────────────────────▶│                              │
     │                            │ 6. Valida status e expiração │
     │                            │ 7. Persiste signedXdr        │
     │                            │    status: SIGNED_XDR_RECEIVED
     │                            │                              │
     │                            │ sdk.sendTransaction(xdr)     │
     │                            │─────────────────────────────▶│
     │                            │◀─────────────────────────────│
     │                            │   { txHash, success }        │
     │                            │                              │
     │                            │ 8. status: SUBMITTED         │
     │                            │ 9. Cria TransactionRecord    │
     │◀──────────────────────────│                              │
     │  { txHash, status }        │                              │
     │                            │                              │
     │                  [ReconciliationJob - 1 min]             │
     │                            │ 10. Verifica confirmação     │
     │                            │ 11. status: CONFIRMED        │
```

### Regras de negócio do depósito

- **Idempotência**: mesma `idempotencyKey` retorna a intent existente sem reprocessar
- **TTL**: a intent expira em 24h; o job `ExpiredIntentsJob` a marca como FAILED
- **Falha no XDR**: se o SDK falhar ao gerar o XDR, a intent é marcada como FAILED imediatamente
- **Double-submit**: endpoints rejeitam intent já SUBMITTED ou CONFIRMED (HTTP 409)
- **Intent expirada**: rejeita envio de signedXdr após `expiresAt` (HTTP 400)

---

## Fluxo de Saque

Idêntico ao depósito, com diferenças:

- Endpoint: `POST /withdrawals` com campo `shareAmount` (dfTokens) em vez de `amount`
- SDK usa `sdk.withdrawShares(vaultAddress, { shares: shareAmount, ... })`
- Sem `assetSymbol` (o símbolo é derivado do vault)

---

## Fluxo de Autenticação *(a implementar — Fase 3)*

```
App Mobile                  Backend                   Google / Apple
     │                          │                           │
     │  [Login com Google]       │                           │
     │──────────────────────────────────────────────────────▶│
     │◀──────────────────────────────────────────────────────│
     │  idToken do Google        │                           │
     │                          │                           │
     │ POST /auth/google         │                           │
     │ { idToken }               │                           │
     │─────────────────────────▶│                           │
     │                          │ Verifica idToken           │
     │                          │ (google-auth-library)      │
     │                          │ Upsert User no banco       │
     │                          │ Gera accessToken (15min)   │
     │                          │ Gera refreshToken (30dias) │
     │◀─────────────────────────│                           │
     │  { accessToken,          │                           │
     │    refreshToken }         │                           │
     │                          │                           │
     │ GET /vaults               │                           │
     │ Authorization: Bearer ... │                           │
     │─────────────────────────▶│                           │
     │                          │ JwtAuthGuard valida token  │
     │◀─────────────────────────│                           │
```

### Regras de autenticação

- Access token: JWT, 15 minutos, assínado com `JWT_ACCESS_SECRET`
- Refresh token: opaque, 30 dias, armazenado como hash no banco
- Logout revoga o refresh token imediatamente
- Rotação de refresh token: ao usar `/auth/refresh`, o token antigo é invalidado

---

## Fluxo dos Jobs em Background

```
Tempo
  │
  ├── :00 (todo minuto)
  │    └── ReconciliationJob
  │         ├── Busca TransactionRecord com status PENDING
  │         ├── Re-envia signedXdr para verificar confirmação
  │         └── Se confirmado: atualiza TransactionRecord + Intent → CONFIRMED
  │
  ├── :00/:10/:20/... (a cada 10 min)
  │    └── ApySyncJob
  │         ├── Lista todos os vaults ativos
  │         └── Atualiza apy + lastSyncedAt para cada vault
  │
  ├── 00:05 UTC (diário)
  │    └── PortfolioSnapshotJob
  │         ├── Lista todas as wallets ativas
  │         ├── Para cada wallet × vault: consulta saldo no DeFindex
  │         └── Persiste PortfolioSnapshot se saldo > 0
  │
  └── :00 (todo hora)
       └── ExpiredIntentsJob
            ├── Marca como FAILED intents CREATED/XDR_GENERATED expiradas
            └── Purga intents FAILED sem transação vinculada com > 30 dias
```
