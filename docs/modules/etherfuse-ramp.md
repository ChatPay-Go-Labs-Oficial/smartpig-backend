# Módulo: Etherfuse Ramp

Localização: `src/etherfuse/`, `src/etherfuse-ramp/`

## Visão geral

O módulo `etherfuse-ramp` integra o SmartPig ao [Etherfuse FX API](https://docs.etherfuse.com) para permitir operações de on/off-ramp no mercado mexicano:

- **On-ramp**: Converter MXN (via SPEI/CLABE) em USDC ou CETES na rede Stellar
- **Off-ramp**: Converter USDC/CETES na rede Stellar em MXN (via SPEI, depositado em conta CLABE)

Este módulo coexiste com o módulo `ramp` (BlindPay — mercado brasileiro BRL/PIX). Cada provedor serve um mercado diferente.

---

## Arquitetura

```
src/
├── etherfuse/
│   ├── etherfuse.module.ts        NestJS module (exporta EtherfuseService)
│   ├── etherfuse.service.ts       HTTP client para a API REST Etherfuse
│   ├── etherfuse.errors.ts        Mapeamento de erros Etherfuse → HttpException
│   └── dto/
│       └── etherfuse.dto.ts       Tipos das requests/responses da API
│
└── etherfuse-ramp/
    ├── etherfuse-ramp.module.ts        Importa EtherfuseModule
    ├── etherfuse-ramp.service.ts       Lógica de orquestração
    ├── etherfuse-ramp.controller.ts    Rotas HTTP + webhook handler
    ├── etherfuse-ramp.service.spec.ts  Testes unitários (14 casos)
    └── dto/
        └── etherfuse-ramp.dto.ts       DTOs de entrada (class-validator)
```

---

## Entidades Prisma (novas)

| Model | Descrição |
|---|---|
| `EtherfuseCustomer` | Vincula usuário SmartPig ↔ child org Etherfuse; armazena status KYC |
| `EtherfuseBankAccount` | Conta bancária CLABE registrada no Etherfuse |
| `EtherfuseOrder` | Ordem de on/off-ramp com XDR Stellar para offramp |

### Enums novos

```
EtherfuseKycStatus:  NOT_STARTED | PROPOSED | APPROVED | APPROVED_CHAIN_DEPLOYING | REJECTED
EtherfuseOrderDirection: ONRAMP | OFFRAMP
EtherfuseOrderStatus: CREATED | PENDING_SIGNATURE | PROCESSING | COMPLETED | FAILED | REFUNDED
```

---

## Modelo de Cliente (Child Organization)

O Etherfuse usa um modelo de **child organizations**: para cada usuário SmartPig, criamos uma organização filha sob a conta Etherfuse do SmartPig. Isso garante isolamento de dados e conformidade KYC por cliente.

```
SmartPig (Parent Org — conta business Etherfuse)
├── EtherfuseCustomer para User A  →  child org ef-org-xxx (KYC: APPROVED)
├── EtherfuseCustomer para User B  →  child org ef-org-yyy (KYC: PROPOSED)
└── ...
```

O usuário final **nunca cria uma conta no Etherfuse**. Tudo é feito pelo SmartPig em nome dele, usando a API Key da conta business. Para o usuário, a experiência é 100% white-label dentro do SmartPig.

---

## Jornada Completa: Novo Usuário → Investimento em Vault

Este é o fluxo end-to-end de um usuário que acessa o SmartPig pela primeira vez e quer investir em um vault via onramp.

### Visão geral

```
[Usuário] ──► Cadastro no SmartPig
           ──► KYC (feito uma vez)
           ──► Aguarda aprovação (minutos/horas)
           ──► Onramp: MXN → USDC via transferência bancária
           ──► Aguarda tokens chegarem na carteira Stellar
           ──► Deposita tokens no vault (DeFindex)
           ──► 🎉 Investindo
```

---

### Passo a passo detalhado

#### 1. Cadastro no SmartPig (Auth)

O usuário cria sua conta no SmartPig (Google/Apple Sign-In) e vincula sua carteira Stellar.

#### 2. Onboarding KYC — feito uma única vez

```
App                        Backend                     Etherfuse
 │                             │                            │
 │─ POST /etherfuse/onboarding/organization ──────────────► │ cria child org
 │                             │◄── { etherfuseOrgId } ─────│
 │                             │                            │
 │─ POST /etherfuse/onboarding/kyc ────────────────────────► │ envia dados pessoais
 │  { nome, endereço, CURP,    │                            │ (CURP, RFC, endereço...)
 │    RFC, telefone, email }   │                            │
 │                             │                            │
 │─ POST /etherfuse/onboarding/kyc/documents (3x) ─────────► │ selfie + RG frente + RG verso
 │                             │                            │
 │─ POST /etherfuse/onboarding/agreements/esign ───────────► │ aceita assinatura eletrônica
 │─ POST /etherfuse/onboarding/agreements/terms ───────────► │ aceita termos
 │─ POST /etherfuse/onboarding/agreements/customer ────────► │ aceita acordo
 │                             │                            │
 │─ POST /etherfuse/onboarding/bank-account ───────────────► │ registra CLABE
 │  { clabe, CURP, RFC, ... }  │                            │
 │                             │                            │
 │                             │◄── webhook: kyc_updated ───│ KYC aprovado ✅
 │                             │◄── webhook: bank_account   │ CLABE compliance ✅
 │◄── push notification ───────│                            │
```

> A aprovação do KYC pode levar minutos ou horas. O backend atualiza o status via webhook e pode notificar o mobile via push.

#### 3. Onramp: MXN → USDC

```
App                        Backend                     Etherfuse
 │                             │                            │
 │─ POST /etherfuse/quote ─────────────────────────────────► │
 │  { direction: "onramp",     │                            │
 │    sourceAsset: "MXN",      │                            │
 │    targetAsset: "USDC",     │                            │
 │    sourceAmount: 500,       │                            │
 │    walletAddress: "G..." }  │                            │
 │◄── { quoteId, destAmount,   │◄───────────────────────────│
 │      rate, fees, expiresAt }│     (válido 2 minutos)     │
 │                             │                            │
 │─ POST /etherfuse/onramp ────────────────────────────────► │ cria ordem
 │  { quoteId, bankAccountId,  │                            │
 │    walletAddress }          │                            │
 │◄── { id, depositInstructions: { clabe, referencia } }    │
 │                             │                            │
 │  [Usuário faz transferência SPEI/CLABE no app do banco]  │
 │                             │                            │
 │                             │◄── webhook: order_updated──│ status: funded
 │                             │◄── webhook: order_updated──│ status: completed
 │◄── push: "USDC chegou!" ────│                            │
 │                             │           [USDC enviado para carteira Stellar do usuário]
```

#### 4. Investimento no Vault (DeFindex)

```
App                        Backend                     DeFindex
 │                             │                            │
 │─ POST /vaults/:id/deposit ──────────────────────────────► │
 │  { amount, walletAddress }  │                            │
 │                             │◄── unsigned deposit XDR ───│
 │◄── { unsignedXdr } ─────────│                            │
 │                             │                            │
 │  [Usuário assina XDR com carteira Stellar]               │
 │                             │                            │
 │─ POST /vaults/:id/deposit/submit ───────────────────────► │
 │  { signedXdr }              │                            │
 │                             │──── submete XDR ──────────► │
 │◄── { txHash, shares }───────│◄── confirmação ────────────│
 │                             │                            │
 │           🎉 Usuário está investindo no vault            │
```

---

### Resumo de estados que o app precisa gerenciar

| Estado | O que mostrar ao usuário |
|---|---|
| KYC `NOT_STARTED` | Botão "Completar verificação" |
| KYC `PROPOSED` | "Verificação em análise..." |
| KYC `APPROVED` + banco `isCompliant: false` | "Aguardando aprovação da conta bancária..." |
| KYC `APPROVED` + banco `isCompliant: true` | Habilitado para onramp ✅ |
| Ordem `PROCESSING` | "Aguardando sua transferência..." |
| Ordem `COMPLETED` | "USDC recebido! Pronto para investir." |

---

## Fluxo de Setup do Usuário (uma vez)

Antes de criar ordens, o usuário precisa concluir o onboarding KYC:

```
1. POST /etherfuse/onboarding/organization   — Criar child org
2. POST /etherfuse/onboarding/kyc            — Enviar dados de identidade
3. POST /etherfuse/onboarding/kyc/documents  — Upload selfie + documento (multipart)
4. POST /etherfuse/onboarding/agreements/esign      — Aceitar assinatura eletrônica
5. POST /etherfuse/onboarding/agreements/terms      — Aceitar termos e condições
6. POST /etherfuse/onboarding/agreements/customer   — Aceitar acordo de cliente
7. POST /etherfuse/onboarding/bank-account   — Registrar conta CLABE

Aguardar webhook kyc_updated (approved: true)
Aguardar webhook bank_account_updated (compliant: true)
```

> **Nota:** Para contas de pessoa física mexicana, os campos CURP (18 chars) e RFC (13 chars) são obrigatórios no KYC.

---

## Fluxo de On-ramp (MXN → Stellar)

```
[Mobile] ──POST /etherfuse/quote──► [Backend]
                                      ├─ getQuote() ──► Etherfuse API
                                      └─► retorna { quoteId, destinationAmount, expiresAt }
                                                           (válido 2 minutos)

[Mobile] ──POST /etherfuse/onramp──► [Backend]
                                      ├─ createOrder() ─► Etherfuse API
                                      ├─ Salva EtherfuseOrder (PROCESSING)
                                      └─► retorna { id, depositInstructions }
                                                           (instruções SPEI)

[Usuário] ── transferência SPEI ──► [Banco mexicano]
                                      │
                                      ▼
[Etherfuse] ─── webhook order_updated ──► POST /webhooks/etherfuse
                                      ├─ verifica assinatura X-Signature (JCS + HMAC-SHA256)
                                      ├─ handleOrderUpdated()
                                      └─ EtherfuseOrder.status = COMPLETED

[Etherfuse] ──── USDC/CETES ────────► Carteira Stellar do usuário
```

---

## Fluxo de Off-ramp (Stellar → MXN)

```
[Mobile] ──POST /etherfuse/quote──► [Backend]  (direction: offramp)

[Mobile] ──POST /etherfuse/offramp──► [Backend]
                                       ├─ createOrder() ─► Etherfuse API
                                       ├─ Etherfuse retorna: burnTransaction (XDR)
                                       ├─ Salva EtherfuseOrder (PENDING_SIGNATURE)
                                       └─► retorna { id, unsignedBurnXdr, status }

[Mobile] ── assina XDR com carteira Stellar do usuário

[Mobile] ──POST /etherfuse/offramp/:id/submit──► [Backend]
                                       ├─ Salva signedBurnXdr
                                       └─ EtherfuseOrder.status = PROCESSING
                                       (mobile submete XDR assinado diretamente à Stellar)

[Etherfuse] ─── webhook order_updated ──► POST /webhooks/etherfuse
                                       ├─ handleOrderUpdated()
                                       └─ EtherfuseOrder.status = COMPLETED

[Etherfuse] ──── MXN via SPEI ──────► CLABE do usuário
```

---

## Endpoints

### Onboarding

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/etherfuse/onboarding/organization` | Criar child org |
| `GET` | `/etherfuse/onboarding/organization` | Consultar dados do cliente |
| `POST` | `/etherfuse/onboarding/kyc` | Enviar dados de identidade |
| `POST` | `/etherfuse/onboarding/kyc/documents` | Upload selfie/documento (multipart) |
| `POST` | `/etherfuse/onboarding/kyc/status` | Consultar status KYC |
| `POST` | `/etherfuse/onboarding/agreements/esign` | Aceitar assinatura eletrônica |
| `POST` | `/etherfuse/onboarding/agreements/terms` | Aceitar T&C |
| `POST` | `/etherfuse/onboarding/agreements/customer` | Aceitar acordo de cliente |
| `POST` | `/etherfuse/onboarding/bank-account` | Registrar conta CLABE |
| `GET` | `/etherfuse/onboarding/bank-accounts` | Listar contas registradas |

### Operações

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/etherfuse/quote` | Obter cotação (onramp ou offramp) |
| `POST` | `/etherfuse/onramp` | Criar ordem de on-ramp |
| `POST` | `/etherfuse/offramp` | Criar ordem de off-ramp (retorna XDR) |
| `POST` | `/etherfuse/offramp/:id/submit` | Enviar XDR assinado |
| `GET` | `/etherfuse/orders/:id` | Consultar ordem |

### Webhook

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/webhooks/etherfuse` | Receber eventos Etherfuse |

---

## Verificação de Webhook

O Etherfuse assina cada entrega com:
- **Canonicalização**: RFC 8785 JCS (JSON com chaves ordenadas, sem espaços extras) — pacote `canonicalize`
- **HMAC-SHA256** sobre o payload canonicalizado, usando a chave decodificada em base64
- **Header**: `X-Signature: sha256={hex}`

O segredo (`ETHERFUSE_WEBHOOK_SECRET`) é retornado **apenas uma vez** ao criar o webhook via `POST /ramp/webhook` na API Etherfuse. Armazene-o de forma segura.

Eventos tratados:
| Evento | Handler |
|---|---|
| `order_updated` | Atualiza `EtherfuseOrder.status` |
| `kyc_updated` | Atualiza `EtherfuseCustomer.kycStatus` |
| `bank_account_updated` | Atualiza `EtherfuseBankAccount.isCompliant` |

---

## Status das Ordens

```
CREATED → PENDING_SIGNATURE (offramp: aguardando XDR assinado)
        → PROCESSING        (ordem em andamento)
        → COMPLETED         (finalizada com sucesso)
        → FAILED            (falhou)
        → REFUNDED          (reembolsada)
```

---

## Autenticação Etherfuse

O Etherfuse **não usa prefixo Bearer** — a API key é enviada diretamente:

```
Authorization: {api_key}
```

---

## Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `ETHERFUSE_API_KEY` | API key (sem prefixo Bearer) |
| `ETHERFUSE_BASE_URL` | Sandbox: `https://api.sand.etherfuse.com` \| Produção: `https://api.etherfuse.com` |
| `ETHERFUSE_WEBHOOK_SECRET` | Segredo HMAC base64 para verificar webhooks |

---

## Requisitos de KYC para México (pessoa física)

| Campo | Obrigatório | Formato |
|---|---|---|
| `name.givenName` | Sim | string |
| `name.familyName` | Sim | string |
| `email` | Sim | email |
| `phoneNumber` | Sim | +52XXXXXXXXXX |
| `occupation` | Sim | string |
| `address` | Sim | objeto (street, city, region, postalCode, country) |
| `idNumbers[CURP]` | Sim (MX) | 18 caracteres |
| `idNumbers[RFC]` | Sim (MX) | 13 caracteres |
| `dateOfBirth` | Não | YYYY-MM-DD |

Para banco (CLABE pessoal):

| Campo | Formato |
|---|---|
| `clabe` | 18 dígitos (não pode começar com 646 - STP) |
| `curp` | 18 caracteres |
| `rfc` | 13 caracteres |
| `birthDate` | YYYYMMDD |
| `birthCountryIsoCode` | ISO 3166-1 alpha-2 (ex: `MX`) |
