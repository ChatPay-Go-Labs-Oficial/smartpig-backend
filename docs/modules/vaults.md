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

Ver detalhes em [api.md](../api.md#vaults).

## Estratégia de cache de APY

O serviço mantém um cache in-memory (`Map`) com TTL de 5 minutos por vault. Se a chamada ao DeFindex falhar:
- Retorna o APY armazenado no banco (campo `apy` de `VaultCatalog`)
- Inclui `stale: true` na resposta para indicar dado desatualizado

O `ApySyncJob` mantém o banco atualizado de 10 em 10 minutos como fonte de fallback.

## Adicionando vaults

Atualmente, vaults são gerenciados via seed ou diretamente no banco. O campo `defindexVaultId` deve ser o endereço público do vault na rede Stellar.

```bash
# Popular com vaults de exemplo
npx prisma db seed
```

## Dependências

- `PrismaService` — dados do banco (global via PrismaModule)
- `DefindexService` — dados live do protocolo
