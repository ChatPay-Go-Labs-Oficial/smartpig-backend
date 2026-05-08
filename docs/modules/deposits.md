# Módulo: Deposits

**Localização:** `src/deposits/`

## Responsabilidade

Gerencia o ciclo de vida completo de um depósito: criação da intent, geração de XDR, recebimento do XDR assinado e submissão à rede Stellar.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/deposits` | Cria intent + gera XDR não assinado |
| POST | `/deposits/:id/signed-xdr` | Recebe XDR assinado e submete ao Stellar |
| GET | `/deposits/:id` | Status da intent |
| GET | `/deposits?userId=...` | Histórico de depósitos do usuário |

Ver detalhes em [api.md](../api.md#deposits) e o fluxo completo em [flows.md](../flows.md#fluxo-de-depósito).

## Ciclo de vida da DepositIntent

```
CREATED → XDR_GENERATED → SIGNED_XDR_RECEIVED → SUBMITTED → CONFIRMED
                                                          └─→ FAILED
```

## Idempotência

A `idempotencyKey` deve ser gerada pelo cliente mobile (ex: UUID v4) e enviada em toda criação de depósito. Se a mesma chave for enviada novamente (ex: retry após timeout de rede), o backend retorna a intent existente sem reprocessar.

## Validações em `POST /deposits`

1. `idempotencyKey` não pode estar em uso por outra intent
2. `vaultId` deve existir e estar ativo
3. `walletAccountId` deve pertencer ao `userId` informado e estar ativo

## Validações em `POST /deposits/:id/signed-xdr`

| Status atual | Resultado |
|-------------|-----------|
| `CONFIRMED` | HTTP 409 Conflict |
| `SUBMITTED` | HTTP 409 Conflict |
| `FAILED` | HTTP 400 Bad Request |
| `CREATED` | HTTP 400 (XDR ainda não gerado) |
| `expiresAt` no passado | HTTP 400 Bad Request |
| `XDR_GENERATED` | ✅ Prossegue |

## Campos sensíveis

- `unsignedXdr` e `signedXdr` **nunca** são incluídos nas respostas de listagem (`GET /deposits`)
- São retornados apenas na resposta de criação (`POST /deposits`) para que o cliente possa assinar

## Dependências

- `PrismaService` — persistência da intent
- `DefindexOrchestrator` — geração de XDR + submissão on-chain
