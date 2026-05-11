# Módulo: Vaults

**Localização:** `src/vaults/`

## Responsabilidade

Expõe endpoints de consulta (read-only) de vaults DeFi. Combina dados do banco local (`VaultCatalog`) com informações ao vivo do DeFindex.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/vaults` | Lista vaults ativos do banco |
| GET | `/vaults/:id` | Detalhes + info live do DeFindex |
| GET | `/vaults/:id/apy` | APY live com cache |
| GET | `/vaults/:id/balance` | Saldo do usuário no vault |
| POST | `/vaults/sync` | Dispara manualmente o VaultSyncJob |

Ver detalhes em [api.md](../api.md#vaults).

## Estratégia de cache de APY

O serviço mantém um cache in-memory (`Map`) com TTL de 5 minutos por vault. Se a chamada ao DeFindex falhar:
- Retorna o APY armazenado no banco (campo `apy` de `VaultCatalog`)
- Inclui `stale: true` na resposta para indicar dado desatualizado

O `ApySyncJob` mantém o banco atualizado de 10 em 10 minutos como fonte de fallback.

## Adicionando vaults

Vaults são **descobertos e sincronizados automaticamente** pelo `VaultSyncJob` a cada 30 minutos:

1. O job chama `DefindexService.discoverVaults()` → `GET /vault/discover` na API DeFindex
2. Para cada vault retornado, faz upsert no `VaultCatalog` (cria ou atualiza APY/TVL)
3. Novos vaults deployados no protocolo aparecem no app sem intervenção manual

Enquanto o banco ainda estiver vazio (primeira execução), é possível popular manualmente:

```bash
# Seed manual (enquanto o job não rodou)
npx prisma db seed
```

O campo `defindexVaultId` é o endereço público do contrato do vault na rede Stellar.

## Dependências

- `PrismaService` — dados do banco (global via PrismaModule)
- `DefindexService` — dados live do protocolo
