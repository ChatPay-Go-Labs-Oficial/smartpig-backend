# Módulo: Ramp (On/Off Ramp via BlindPay)

Localização: `src/ramp/`, `src/blindpay/`

## Visão geral

O módulo `ramp` orquestra a integração com o [BlindPay](https://www.blindpay.com) para permitir que usuários do SmartPig façam:

- **On-ramp**: Converter BRL (via PIX) em USDC na rede Stellar
- **Off-ramp**: Converter USDC na rede Stellar em BRL (via PIX)

O `BlindPayModule` é um wrapper HTTP da API REST do BlindPay. O `RampModule` usa o `BlindPayService` para orquestrar os fluxos e persistir o estado no banco.

---

## Arquitetura

```
src/
├── blindpay/
│   ├── blindpay.module.ts        NestJS module (exporta BlindPayService)
│   ├── blindpay.service.ts       HTTP client para a API BlindPay
│   ├── blindpay.errors.ts        Mapeamento de erros BlindPay → HttpException
│   └── dto/
│       └── blindpay.dto.ts       Tipos das requests/responses BlindPay
│
└── ramp/
    ├── ramp.module.ts            Importa BlindPayModule
    ├── ramp.service.ts           Lógica de orquestração
    ├── ramp.controller.ts        Rotas HTTP + webhook handler
    ├── ramp.service.spec.ts      Testes unitários
    └── dto/
        └── ramp.dto.ts           DTOs de entrada (class-validator)
```

---

## Entidades BlindPay

| Entidade | ID Prefix | Descrição |
|---|---|---|
| Receiver | `re_` | Pessoa que recebe dinheiro; link com banco + wallet |
| Bank Account | `ba_` | Conta bancária do receiver (chave PIX) |
| Blockchain Wallet | `bw_` | Carteira blockchain registrada no BlindPay |
| Payout Quote | `qu_` | Cotação USDC → BRL (válida 5 min) |
| Payin Quote | `pq_` | Cotação BRL → USDC (válida 5 min) |
| Payout | `po_` | Operação de off-ramp (USDC → PIX) |
| Payin | `pi_` | Operação de on-ramp (PIX → USDC) |

---

## Fluxo de On-ramp (BRL → USDC)

```
[Mobile] ──POST /ramp/onramp──► [Backend]
                                    │
                                    ├─ createPayinQuote() ──► BlindPay API
                                    ├─ createPayinStellar() ─► BlindPay API
                                    │   returns: pix_code
                                    ├─ Salva OnrampTransaction (AWAITING_PAYMENT)
                                    └─► retorna { id, pixCode, status }

[Mobile] ── usuário paga PIX ──► [Banco do usuário]
                                    │
                              30s (dev) / até 5min (prod)
                                    │
[BlindPay] ─── webhook ──────────► POST /webhooks/blindpay
                                    │
                                    ├─ Verifica HMAC signature
                                    ├─ handlePayinWebhook()
                                    └─ OnrampTransaction.status = COMPLETED

[BlindPay] ──── USDC ────────────► Stellar wallet do usuário
```

---

## Fluxo de Off-ramp (USDC → BRL)

```
[Mobile] ──POST /ramp/offramp──► [Backend]
                                    │
                                    ├─ createPayoutQuote() ──► BlindPay API
                                    ├─ prepareStellarDelegation() ─► BlindPay API
                                    │   returns: unsigned XDR
                                    ├─ Salva OfframpTransaction (DELEGATION_NEEDED)
                                    └─► retorna { id, unsignedDelegationXdr, status }

[Mobile] ──── assina XDR ────────► Stellar wallet do usuário
         ──POST /ramp/offramp/:id/submit──► [Backend]
                                    │
                                    ├─ createPayoutStellar() ─► BlindPay API
                                    │   (com signed delegation hash)
                                    ├─ OfframpTransaction.status = PROCESSING
                                    └─► retorna transação atualizada

[BlindPay] ─── webhook ──────────► POST /webhooks/blindpay
                                    │
                                    ├─ handlePayoutWebhook()
                                    └─ OfframpTransaction.status = COMPLETED

[BlindPay] ──── BRL via PIX ─────► Conta bancária do usuário
```

---

## Status das Transações

```
enum RampStatus {
  PENDING            // Criada, ainda não processada
  AWAITING_PAYMENT   // On-ramp: aguardando pagamento PIX
  PROCESSING         // Em processamento pelo BlindPay
  DELEGATION_NEEDED  // Off-ramp: aguardando XDR assinado do usuário
  COMPLETED          // Finalizada com sucesso
  FAILED             // Falhou
  REFUNDED           // Reembolsada (somente on-ramp)
}
```

---

## Setup do usuário (uma vez)

Antes de fazer on/off-ramp, o usuário precisa:

1. `POST /ramp/receiver` — Criar receiver BlindPay
2. `POST /ramp/receiver/bank-accounts` — Adicionar chave PIX
3. `POST /ramp/receiver/wallets` — Registrar carteira Stellar (para on-ramp)

---

## Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `BLINDPAY_API_KEY` | Bearer token de autenticação |
| `BLINDPAY_INSTANCE_ID` | ID da instância BlindPay (`in_...`) |
| `BLINDPAY_BASE_URL` | Base URL (default: `https://api.blindpay.com`) |
| `BLINDPAY_WEBHOOK_SECRET` | Segredo HMAC para verificar webhooks |

---

## Rede Stellar

O módulo detecta automaticamente a rede Stellar baseado em `DEFINDEX_NETWORK`:

- `testnet` → usa `stellar_testnet`
- `mainnet` → usa `stellar`

---

## Webhook

O endpoint `POST /webhooks/blindpay` é **público** (sem JWT), mas verifica a assinatura HMAC-SHA256 enviada pelo BlindPay no header `blindpay-signature`.

Se `BLINDPAY_WEBHOOK_SECRET` não estiver configurado, a verificação é ignorada (útil em desenvolvimento).

---

## Unidades monetárias

| Moeda | Unidade no sistema | Exemplo |
|---|---|---|
| BRL | Centavos (integer) | R$50.00 = `5000` |
| USDC | Micro-USDC (integer) | 1 USDC = `1000000` |

> Conforme documentação BlindPay: *"we do not accept float values for request_amount"*
