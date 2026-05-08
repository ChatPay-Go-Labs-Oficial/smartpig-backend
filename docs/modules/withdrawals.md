# Módulo: Withdrawals

**Localização:** `src/withdrawals/`

## Responsabilidade

Gerencia o ciclo de vida completo de um saque: criação da intent com quantidade de shares (dfTokens), geração de XDR, recebimento do XDR assinado e submissão à rede Stellar.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/withdrawals` | Cria intent + gera XDR não assinado |
| POST | `/withdrawals/:id/signed-xdr` | Recebe XDR assinado e submete ao Stellar |
| GET | `/withdrawals/:id` | Status da intent |
| GET | `/withdrawals?userId=...` | Histórico de saques do usuário |

Ver detalhes em [api.md](../api.md#withdrawals) e o fluxo em [flows.md](../flows.md#fluxo-de-saque).

## Diferença em relação ao depósito

| Aspecto | Deposit | Withdrawal |
|---------|---------|------------|
| Campo de valor | `amount` (valor do ativo) | `shareAmount` (dfTokens) |
| SDK method | `depositToVault` | `withdrawShares` |
| `assetSymbol` | Obrigatório no body | Não necessário |

## Ciclo de vida da WithdrawalIntent

Idêntico ao `DepositIntent`:

```
CREATED → XDR_GENERATED → SIGNED_XDR_RECEIVED → SUBMITTED → CONFIRMED
                                                          └─→ FAILED
```

## Idempotência e validações

Mesmas regras do módulo de Deposits (ver [deposits.md](./deposits.md)).

## Campos sensíveis

- `unsignedXdr` e `signedXdr` nunca aparecem em listagens
- `unsignedXdr` é retornado apenas na resposta de criação

## Dependências

- `PrismaService` — persistência da intent
- `DefindexOrchestrator` — geração de XDR + submissão on-chain
