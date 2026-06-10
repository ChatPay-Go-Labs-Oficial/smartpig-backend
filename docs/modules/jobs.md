# Módulo: Jobs

**Localização:** `src/jobs/`

## Responsabilidade

Executa tarefas periódicas em background usando `@nestjs/schedule` (baseado em node-cron). Não expõe endpoints HTTP.

## Jobs disponíveis

### ReconciliationJob
**Arquivo:** `reconciliation.job.ts`
**Frequência:** A cada 1 minuto (`EVERY_MINUTE`)

Reconcilia transações que foram submetidas mas ainda estão como `PENDING`. Para cada `TransactionRecord` pendente:
1. Recupera o `signedXdr` da intent vinculada
2. Re-envia ao DeFindex via `submitSignedTransaction`
3. Se confirmado: atualiza `TransactionRecord.status → CONFIRMED` e `Intent.status → CONFIRMED`

> Trata até 50 transações por execução para evitar sobrecarga.

---

### ApySyncJob
**Arquivo:** `apy-sync.job.ts`
**Frequência:** A cada 10 minutos, começando no minuto 5 (`0 5/10 * * * *`)

O deslocamento de cinco minutos evita que este job dispute o rate limit com o
`VaultSyncJob`, executado nos minutos 0 e 30.

Para cada vault ativo no banco:
1. Chama `DefindexService.getVaultInfo()` — uma única chamada que retorna APY e TVL
2. Atualiza `VaultCatalog.apy`, `VaultCatalog.tvl` e `VaultCatalog.lastSyncedAt`

> Usa `getVaultInfo()` em vez de `getVaultApy()` para obter APY e TVL em uma única chamada, garantindo dados consistentes inclusive para vaults criados pelo SmartPig que ainda não aparecem no endpoint `discover`.

Erros por vault são logados mas não interrompem o ciclo dos demais vaults.

---

### PortfolioSnapshotJob
**Arquivo:** `portfolio-snapshot.job.ts`
**Frequência:** Diariamente às 00:05 UTC (`5 0 * * *`)

Para cada wallet ativa × vault ativo:
1. Consulta saldo via `DefindexService.getVaultBalance()`
2. Se `dfTokens > 0`: persiste `PortfolioSnapshot`

Snapshots com saldo zero não são persistidos para economizar espaço.

---

### VaultSyncJob
**Arquivo:** `vault-sync.job.ts`
**Frequência:** A cada 30 minutos (`0 */30 * * * *`)

Chama `DefindexService.discoverVaults()` (endpoint `GET /vault/discover`) e faz upsert no `VaultCatalog` para cada vault retornado:
- **Novo vault**: cria registro com endereço, APY e TVL
- **Vault existente**: atualiza APY, TVL e `lastSyncedAt`

Isso garante que novos vaults deployados no DeFindex apareçam automaticamente no SmartPig sem intervenção manual.

---

### ExpiredIntentsJob
**Arquivo:** `expired-intents.job.ts`
**Frequência:** A cada hora (`EVERY_HOUR`)

Executa duas operações:

1. **Expiração**: marca como `FAILED` todas as intents com status `CREATED` ou `XDR_GENERATED` cujo `expiresAt` já passou
2. **Purga**: deleta intents `FAILED` com mais de 30 dias **sem** `TransactionRecord` vinculado (intents com transação são mantidas para auditoria)

---

## Configuração do ScheduleModule

O `ScheduleModule.forRoot()` é importado dentro do `JobsModule`. Ele inicializa o scheduler do node-cron quando o módulo é carregado.

## Logs

Todos os jobs usam o `Logger` do NestJS com o nome do job como contexto:

```
[ReconciliationJob] Reconciling 3 pending transaction(s)...
[ApySyncJob] APY sync complete: 2/2 updated
[PortfolioSnapshotJob] Portfolio snapshot complete: 5 record(s) created
[ExpiredIntentsJob] Expired 1 intent(s) (deposits: 1, withdrawals: 0)
```

## Escalabilidade

Para ambientes com múltiplas instâncias do backend (horizontal scaling), os jobs atuais podem executar em paralelo em cada instância. Para evitar execução duplicada em multi-instância, considere na fase de hardening:
- Usar Redis com lock distribuído (ex: `redlock`)
- Ou mover jobs para um worker separado com fila Bull/BullMQ
