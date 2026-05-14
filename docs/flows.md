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

## Fluxo de Autenticação (Wallet Login)

```
App Mobile                  Backend (NestJS)
     │                            │
     │  [Usuário abre o app]      │
     │  Lê stellarAddress         │
     │  da carteira local         │
     │                            │
     │ POST /auth/wallet           │
     │ { stellarAddress, label }   │
     │──────────────────────────▶│
     │                            │ 1. Busca WalletAccount pela stellarAddress
     │                            │ 2a. Se existe → retorna User associado
     │                            │ 2b. Se não existe → cria User + WalletAccount
     │◀──────────────────────────│
     │  { user, wallet,           │
     │    isNewUser }             │
     │                            │
     │  [App persiste userId      │
     │   localmente]              │
     │                            │
     │ GET /vaults                │
     │ (sem auth header)          │
     │──────────────────────────▶│
     │◀──────────────────────────│
     │  [lista de vaults]         │
```

### Regras do wallet login

- Nenhuma senha ou token é gerado — a identidade é a `stellarAddress`
- A mesma `stellarAddress` sempre retorna o mesmo `userId`
- `isNewUser: true` apenas na primeira chamada com aquela carteira
- Se a wallet estava desativada, ela é reativada automaticamente

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
  │         ├── Lista todos os vaults ativos no banco
  │         └── Atualiza apy + lastSyncedAt para cada vault via SDK
  │
  ├── :00/:30 (a cada 30 min)
  │    └── VaultSyncJob
  │         ├── Chama GET /vault/discover na API DeFindex
  │         ├── Para cada vault retornado:
  │         │    ├── Se novo: cria VaultCatalog (endereço, APY, TVL)
  │         │    └── Se existente: atualiza APY, TVL, lastSyncedAt
  │         └── Novos vaults aparecem automaticamente no SmartPig
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
