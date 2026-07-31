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

## Fluxo de Autenticação (Privy + ativação da conta)

```
App Mobile                  Backend (NestJS)              Privy / Stellar
     │                            │                            │
     │  [login no SDK do Privy]   │                            │
     │◀────── accessToken ────────────────────────────────────│
     │                            │                            │
     │ POST /auth/wallet          │                            │
     │ Authorization: Bearer ...  │                            │
     │ { stellarAddress, label }  │                            │
     │──────────────────────────▶│                            │
     │                            │ 1. PrivyAuthGuard valida o token
     │                            │ 2. Busca as wallets Stellar no Privy
     │                            │───────────────────────────▶│
     │                            │◀───────────────────────────│
     │                            │ 3. Upsert User + WalletAccount
     │◀──────────────────────────│                            │
     │  { user, wallet,           │                            │
     │    isNewUser,              │                            │
     │    needsActivation }       │                            │
     │                            │                            │
     │  [se needsActivation]      │                            │
     │ POST /wallets/activate     │                            │
     │──────────────────────────▶│ monta CreateAccount +      │
     │                            │ sponsor + trustlines,      │
     │                            │ assina com a tesouraria    │
     │◀─── { unsignedXdr } ───────│                            │
     │                            │                            │
     │  [usuário assina o XDR]    │                            │
     │ POST /wallets/activate/submit                           │
     │──────────────────────────▶│──── submete ──────────────▶│
     │◀─── { success, txHash } ───│                            │
     │                            │                            │
     │ GET /vaults                │                            │
     │ Authorization: Bearer ...  │                            │
     │──────────────────────────▶│                            │
     │◀──────────────────────────│                            │
     │  [lista de vaults]         │                            │
```

### Regras da autenticação

- O `PrivyAuthGuard` é um `APP_GUARD` global: **toda rota exige `Authorization: Bearer {privyAccessToken}`**, exceto as marcadas com `@Public()` (`GET /health`, `POST /auth/wallet`, `POST /webhooks/blindpay`)
- `POST /auth/wallet` é público, mas se receber um Bearer válido usa as carteiras Stellar vinculadas no Privy em vez da `stellarAddress` do body; um Bearer inválido retorna 401 mesmo assim
- A mesma `stellarAddress` sempre retorna o mesmo `userId` — `stellarAddress` é `@unique` em `WalletAccount`
- `isNewUser: true` apenas na primeira chamada com aquela carteira
- `needsActivation: true` quando a conta Stellar ainda não existe on-chain ou não tem as trustlines. A ativação é **patrocinada pela tesouraria** (`TREASURY_STELLAR_SECRET`), então o usuário não precisa ter XLM para começar
- O progresso da ativação fica em `WalletAccount.activationStatus`: `NOT_STARTED → PENDING_SIGNATURE → SUBMITTING → ACTIVATED | FAILED`
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
  ├── :00 (todo minuto)
  │    └── GiftReconciliationJob
  │         ├── Procura na rede tx cujo memo casa com um Gift CREATED
  │         ├── Extrai o balanceId da claimable balance
  │         └── Gift → FUNDED
  │
  └── :00 (todo hora)
       ├── ExpiredIntentsJob
       │    ├── Marca como FAILED intents CREATED/XDR_GENERATED expiradas
       │    └── Purga intents FAILED sem transação vinculada com > 30 dias
       │
       └── GiftExpiryJob
            ├── Gifts CREATED/FUNDED vencidos → EXPIRED
            └── Detecta resgate do remetente on-chain → REFUNDED
```

---

## Fluxo de Presente (Gift)

```
Remetente                   Backend                        Stellar
    │                          │                              │
    │ POST /gifts              │                              │
    │────────────────────────▶│ cria Gift (CREATED)          │
    │◀── code, memo,           │                              │
    │    claimAgentAddress ────│                              │
    │                          │                              │
    │ [assina createClaimableBalance com 2 claimants:         │
    │  claimAgent até expiresAt, remetente depois]            │
    │──────────────────────────────────────────────────────▶│
    │                          │                              │
    │           [GiftReconciliationJob - 1 min]               │
    │                          │◀── acha o memo ──────────────│
    │                          │ Gift → FUNDED                │
    │                          │                              │
    │ [compartilha o code]     │                              │
                               │                              │
Destinatário (conta nova)      │                              │
    │ POST /gifts/:code/claim  │                              │
    │────────────────────────▶│ lock FUNDED → CLAIMING       │
    │                          │ 1 tx atômica:                │
    │                          │ claimClaimableBalance +      │
    │                          │ payment ao destinatário      │
    │                          │─────────────────────────────▶│
    │◀── { status: CLAIMED } ──│ Gift → CLAIMED               │
```

Regras: só contas criadas **depois** do gift podem resgatar; o backend nunca custodia os fundos entre transações; se a tx on-chain falhar, o gift volta para `FUNDED` e pode ser tentado de novo; após `expiresAt` o próprio remetente resgata de volta (refund trustless, sem job de payout).
