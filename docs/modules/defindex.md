# Módulo: DeFindex

**Localização:** `src/defindex/`

## Responsabilidade

Encapsula toda a comunicação com o protocolo DeFindex via SDK oficial (`@defindex/sdk`). Nenhum outro módulo deve chamar o SDK diretamente.

## Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `defindex.config.ts` | Instancia o `DefindexSDK` com `apiKey`, `baseUrl` e `timeout` das env vars |
| `defindex.service.ts` | Wrapper do SDK com retry automático e mapeamento de erros |
| `defindex.mapper.ts` | Converte respostas do SDK em DTOs internos |
| `defindex.orchestrator.ts` | Coordena fluxos multi-step (gerar XDR + atualizar DB) |
| `dto/defindex.dto.ts` | Interfaces TypeScript dos dados de entrada/saída do SDK |
| `errors/defindex.errors.ts` | Mapeia erros Axios em exceções NestJS tipadas |

## DefindexService

Ponto central de chamadas ao SDK. Todos os métodos:
1. Executam com retry automático (3 tentativas, backoff exponencial)
2. Mapeiam erros do SDK para exceções NestJS via `mapDefindexError`

| Método | Descrição |
|--------|-----------|
| `healthCheck()` | Verifica disponibilidade do DeFindex |
| `discoverVaults(network?)` | Lista todos os vaults via `GET /vault/discover` (não coberto pelo SDK) |
| `getStrategies(network?)` | Lista todas as estratégias via `GET /strategies` (não coberto pelo SDK) |
| `getVaultInfo(vaultAddress)` | Info completa do vault (nome, símbolo, APY, assets) |
| `getVaultBalance(vaultAddress, userAddress)` | Saldo do usuário em dfTokens e underlying |
| `getVaultApy(vaultAddress)` | APY atual do vault |
| `generateDepositXdr(params)` | Gera XDR não assinado para depósito |
| `generateWithdrawXdr(params)` | Gera XDR não assinado para saque |
| `submitSignedTransaction(params)` | Envia XDR assinado ao Stellar |

> **Nota:** `discoverVaults` e `getStrategies` usam chamadas HTTP diretas (axios) pois o SDK v0.3.0 não expõe esses endpoints. O mesmo header `Authorization: Bearer {DEFINDEX_API_KEY}` é utilizado.

## Retry policy

```
Tentativa 1: imediata
Tentativa 2: aguarda 100ms
Tentativa 3: aguarda 400ms
(máx 3 tentativas, backoff base 100ms × 4^(n-1))
```

## DefindexOrchestrator

Coordena operações que envolvem **tanto o banco de dados quanto o SDK**. Os serviços de negócio (Deposits, Withdrawals) delegam fluxos multi-step ao Orchestrator.

| Método | Descrição |
|--------|-----------|
| `buildDepositXdr(intentId)` | Lê intent do DB → chama SDK → persiste XDR → atualiza status |
| `buildWithdrawXdr(intentId)` | Idem para saque |
| `submitDeposit(intentId, signedXdr)` | Persiste signedXdr → submete via SDK → cria TransactionRecord |
| `submitWithdrawal(intentId, signedXdr)` | Idem para saque |

## Mapeamento de erros

| Erro original | Exceção NestJS |
|---------------|----------------|
| HTTP 400/422 (Axios) | `BadRequestException` |
| HTTP 401/403 (Axios) | `UnauthorizedException` |
| HTTP 404 (Axios) | `NotFoundException` |
| HTTP 429 (Axios) | `HttpException(429)` |
| HTTP 5xx (Axios) | `ServiceUnavailableException` |
| Timeout / ECONNREFUSED | `ServiceUnavailableException` |
| Desconhecido | `InternalServerErrorException` |

## Importante: o que o SDK exporta em runtime

A versão `@defindex/sdk@0.3.0` exporta em runtime:
- `DefindexSDK` — classe principal
- `SupportedNetworks` — enum (`testnet`, `mainnet`)
- `VaultMethods`, `HttpClient`

**Não são exportados em runtime** (apenas nos `.d.ts`): `DefindexSDKError`, `isApiError`. O mapeamento de erros usa `isAxiosError` como alternativa.

## Segurança

- `DEFINDEX_API_KEY` é lida exclusivamente de variável de ambiente
- Nunca é incluída em logs, respostas de erro, ou enviada ao cliente mobile
- Todas as chamadas ao SDK passam por `DefindexService` — nunca chamadas diretas em controllers
