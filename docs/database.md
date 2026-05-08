# Schema do Banco de Dados

Banco: **PostgreSQL 16**
ORM: **Prisma 5**
Schema: `prisma/schema.prisma`

## Diagrama de entidades

```
User
 ├── WalletAccount (1:N)
 ├── RefreshToken (1:N)          ← auth (a implementar)
 ├── DepositIntent (1:N)
 ├── WithdrawalIntent (1:N)
 ├── TransactionRecord (1:N)
 ├── PortfolioSnapshot (1:N)
 └── ApiAuditLog (1:N)

VaultCatalog
 ├── DepositIntent (1:N)
 ├── WithdrawalIntent (1:N)
 └── PortfolioSnapshot (1:N)

DepositIntent
 └── TransactionRecord (1:1, opcional)

WithdrawalIntent
 └── TransactionRecord (1:1, opcional)
```

## Entidades

### User
Usuário autenticado do app.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK |
| email | String unique | E-mail do usuário |
| name | String? | Nome exibido |
| avatarUrl | String? | URL do avatar (social login) |
| googleId | String? unique | ID do Google OAuth |
| appleId | String? unique | ID do Apple Sign-In |
| createdAt | DateTime | Data de criação |
| updatedAt | DateTime | Última atualização |

### WalletAccount
Carteira Stellar vinculada ao usuário.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| stellarAddress | String | Endereço público Stellar |
| label | String? | Apelido da carteira |
| isActive | Boolean | Se a carteira está ativa |
| createdAt | DateTime | Data de criação |

Constraint: `(userId, stellarAddress)` único — um usuário não pode vincular a mesma carteira duas vezes.

### VaultCatalog
Cache local dos vaults disponíveis no DeFindex.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK interno |
| defindexVaultId | String unique | Endereço do vault no DeFindex |
| name | String | Nome do vault |
| assetSymbol | String | Símbolo do ativo (ex: USDC) |
| description | String? | Descrição opcional |
| apy | Decimal(10,4)? | APY atual (%) |
| tvl | Decimal(30,8)? | Total Value Locked |
| metadata | Json? | Dados extras |
| isActive | Boolean | Se o vault está disponível |
| lastSyncedAt | DateTime? | Última sincronização de APY |

### DepositIntent
Representa uma intenção de depósito e seu ciclo de vida.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK |
| idempotencyKey | String unique | Chave de idempotência do cliente |
| userId | String | FK → User |
| walletAccountId | String | FK → WalletAccount |
| vaultId | String | FK → VaultCatalog |
| amount | Decimal(30,8) | Valor a depositar |
| assetSymbol | String | Símbolo do ativo |
| status | IntentStatus | Status atual (ver enum abaixo) |
| unsignedXdr | Text? | XDR gerado pelo SDK (não assinado) |
| signedXdr | Text? | XDR assinado pelo cliente |
| errorMessage | String? | Mensagem de erro se FAILED |
| expiresAt | DateTime | Expiração da intent (24h) |

**Atenção**: `unsignedXdr` e `signedXdr` são campos sensíveis. Nunca os inclua em logs ou respostas de listagem.

### WithdrawalIntent
Mesma estrutura do DepositIntent, com `shareAmount` ao invés de `amount`.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| shareAmount | Decimal(30,8) | Quantidade de dfTokens a sacar |

### TransactionRecord
Registro imutável da transação on-chain resultante de uma intent.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| intentType | IntentType | DEPOSIT ou WITHDRAWAL |
| depositIntentId | String? unique | FK → DepositIntent |
| withdrawalIntentId | String? unique | FK → WithdrawalIntent |
| txHash | String? unique | Hash da transação Stellar |
| status | TransactionStatus | PENDING / CONFIRMED / FAILED |
| blockchainResponse | Json? | Resposta raw do Stellar |
| confirmedAt | DateTime? | Data de confirmação on-chain |

### PortfolioSnapshot
Snapshot point-in-time do saldo de um usuário em um vault.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK |
| userId | String | FK → User |
| vaultId | String | FK → VaultCatalog |
| balanceAmount | Decimal(30,8) | Saldo em dfTokens |
| balanceUsd | Decimal(20,4)? | Equivalente em USD |
| capturedAt | DateTime | Momento do snapshot |

### ApiAuditLog
Log imutável de operações sensíveis (a ser populado pela fase de auth e hardening).

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | String (cuid) | PK |
| userId | String? | FK → User (nullable para ops pré-auth) |
| action | String | Nome da ação (ex: DEPOSIT_CREATED) |
| metadata | Json? | Contexto da operação |
| ipAddress | String? | IP do cliente |
| createdAt | DateTime | Timestamp imutável |

### RefreshToken
Token de refresh para autenticação JWT (implementação futura).

| Campo | Tipo | Descrição |
|-------|------|-----------|
| tokenHash | String unique | Hash SHA-256 do token (nunca o token raw) |
| expiresAt | DateTime | Data de expiração |
| revokedAt | DateTime? | Data de revogação (logout) |

## Enums

### IntentStatus
Ciclo de vida de uma intent (depósito ou saque):

```
CREATED → XDR_GENERATED → SIGNED_XDR_RECEIVED → SUBMITTED → CONFIRMED
                                                           └→ FAILED
```

| Valor | Descrição |
|-------|-----------|
| CREATED | Intent criada, aguardando geração do XDR |
| XDR_GENERATED | XDR não assinado gerado e retornado ao cliente |
| SIGNED_XDR_RECEIVED | XDR assinado recebido do cliente |
| SUBMITTED | Transação submetida ao Stellar |
| CONFIRMED | Confirmada on-chain |
| FAILED | Falhou em qualquer etapa |

### TransactionStatus
| Valor | Descrição |
|-------|-----------|
| PENDING | Submetida, aguardando confirmação |
| CONFIRMED | Confirmada on-chain |
| FAILED | Rejeitada pela rede |

### IntentType
| Valor | Descrição |
|-------|-----------|
| DEPOSIT | Operação de depósito |
| WITHDRAWAL | Operação de saque |

## Índices

| Tabela | Índice | Finalidade |
|--------|--------|-----------|
| deposit_intents | (userId, status) | Listar intents por usuário/status |
| deposit_intents | (status, expiresAt) | Job de expiração |
| withdrawal_intents | (userId, status) | Listar intents por usuário/status |
| withdrawal_intents | (status, expiresAt) | Job de expiração |
| transaction_records | userId | Histórico por usuário |
| transaction_records | txHash | Busca por hash |
| transaction_records | status | Reconciliação |

## Migrations

As migrations ficam em `prisma/migrations/`. Para criar uma nova:

```bash
npx prisma migrate dev --name descricao-da-mudanca
```

Para ambientes de produção:

```bash
npx prisma migrate deploy
```
