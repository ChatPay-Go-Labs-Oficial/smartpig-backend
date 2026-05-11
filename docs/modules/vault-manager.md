# Módulo: Vault Manager

**Localização:** `src/vault-manager/`

## Responsabilidade

Permite que o SmartPig atue como **operador de vaults DeFindex** — criando e gerenciando seus próprios vaults na rede Stellar. Orquestra o fluxo de criação: geração de XDR não assinado → recebimento do XDR assinado → submissão on-chain → registro automático no `VaultCatalog`.

## Modelo de negócio

Ao criar um vault, o SmartPig configura:
- **`vaultFeeBps`**: taxa de gestão em basis points (ex: 25 = 0.25% ao ano sobre TVL)
- **`feeReceiver`**: carteira do SmartPig que recebe as taxas automaticamente do protocolo

Usuários que depositam no vault SmartPig contribuem para o TVL e recebem dfTokens como prova de participação. O rendimento vem das estratégias DeFi configuradas (ex: Blend Protocol).

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/vault-manager/vaults` | Cria novo vault — retorna XDR não assinado |
| POST | `/vault-manager/vaults/:id/submit` | Submete XDR assinado |
| GET | `/vault-manager/vaults` | Lista vaults gerenciados do usuário |
| GET | `/vault-manager/vaults/:id` | Detalhes de um vault gerenciado |

Ver detalhes em [api.md](../api.md#vault-manager).

## Fluxo de criação

```
Operador                   Backend                       DeFindex / Stellar
   │                          │                                │
   │ POST /vault-manager/vaults│                               │
   │ { name, assets, roles... }│                               │
   │─────────────────────────▶│                               │
   │                          │ POST /factory/create-vault-auto-invest
   │                          │──────────────────────────────▶│
   │                          │◀──────────────────────────────│
   │                          │  { xdr, predictedVaultAddress }
   │                          │                               │
   │                          │ Persiste ManagedVault          │
   │                          │ status: PENDING_SIGNATURE      │
   │◀─────────────────────────│                               │
   │  { id, unsignedXdr, predictedVaultAddress }              │
   │                          │                               │
   │  [assina XDR no Stellar   │                               │
   │   Laboratory ou carteira] │                               │
   │                          │                               │
   │ POST /vault-manager/vaults/:id/submit                    │
   │ { signedXdr }             │                               │
   │─────────────────────────▶│                               │
   │                          │ Submete XDR na rede           │
   │                          │──────────────────────────────▶│
   │                          │◀──────────────────────────────│
   │                          │  { txHash, success }          │
   │                          │                               │
   │                          │ Upsert VaultCatalog           │
   │                          │ status: CONFIRMED             │
   │◀─────────────────────────│                               │
   │  { txHash, vaultAddress, status: CONFIRMED }             │
```

## Estado persistido: ManagedVault

O módulo persiste o modelo `ManagedVault` no banco. Após confirmação, cria automaticamente um registro em `VaultCatalog` com `assetSymbol` extraído dos assets configurados no DTO.

### Status flow

```
PENDING_SIGNATURE → SUBMITTED → CONFIRMED
                             └→ FAILED
```

## Endereços de contratos (testnet)

| Recurso | Endereço |
|---------|---------|
| Factory | `CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32` |
| XLM wrapped | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| XLM Blend Strategy | `CDVLOSPJPQOTB6ZCWO5VSGTOLGMKTXSFWYTUP572GTPNOWX4F76X3HPM` |
| USDC (Blend) | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |
| USDC Blend Strategy | `CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY` |

> Endereços de mainnet são diferentes. Sempre use os endereços correspondentes ao `DEFINDEX_NETWORK` configurado.

## Dependências

- `PrismaService` — persiste `ManagedVault` e upserta `VaultCatalog`
- `DefindexService` — chama `POST /factory/create-vault-auto-invest` e submete XDR
- `DefindexModule` — importado pelo `VaultManagerModule`
