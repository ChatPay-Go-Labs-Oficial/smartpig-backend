# Arquitetura do SmartPig Backend

## Visão geral

O SmartPig Backend é uma API REST construída em **NestJS** que serve como camada de orquestração entre o app mobile React Native e o protocolo DeFi [DeFindex](https://defindex.io) na rede Stellar.

```
┌──────────────────────────────────────────────────────┐
│                  React Native App                    │
│  (autenticação, assinatura de XDR, interface mobile) │
└─────────────────────┬────────────────────────────────┘
                      │ HTTPS / REST + JWT
┌─────────────────────▼────────────────────────────────┐
│               SmartPig Backend (NestJS)              │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │  Vaults  │  │ Deposits │  │    Withdrawals     │ │
│  └──────────┘  └──────────┘  └────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │          DefindexModule (SDK wrapper)            │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────────────────────────┐ │
│  │  JobsModule │  │  Common (filters, interceptors)  │ │
│  └─────────────┘  └──────────────────────────────────┘ │
└──────┬──────────────────────────┬───────────────────┘
       │                          │
┌──────▼──────┐          ┌────────▼────────┐
│  PostgreSQL │          │  DeFindex SDK   │
│  (Prisma 5) │          │  (@defindex/sdk)│
└─────────────┘          └────────┬────────┘
                                  │
                         ┌────────▼────────┐
                         │ Stellar Network │
                         └─────────────────┘
```

## Por que o backend fica entre o app e o DeFindex?

1. **Segurança da API Key** — `DEFINDEX_API_KEY` nunca é exposta ao cliente mobile
2. **Orquestração de estado** — o backend mantém o ciclo de vida das intents (CREATED → CONFIRMED) no banco
3. **Idempotência** — evita operações duplicadas em caso de retry do cliente
4. **Auditoria** — todas as operações sensíveis são registradas centralmente
5. **Rate limiting e validação** — camada única para proteger o protocolo

## Padrões de projeto utilizados

### Module Pattern (NestJS)
Cada domínio é encapsulado em um módulo coeso com suas responsabilidades bem definidas. Módulos declaram o que exportam e importam explicitamente.

### Repository Pattern (via PrismaService)
`PrismaService` é o único ponto de acesso ao banco. Nenhuma outra camada instancia `PrismaClient` diretamente.

### Service Layer Pattern
A lógica de negócio fica exclusivamente nos serviços (`*.service.ts`). Controllers são finos — apenas recebem a requisição, delegam ao serviço e retornam a resposta.

### Orchestrator Pattern
`DefindexOrchestrator` coordena fluxos multi-step que envolvem tanto o banco de dados quanto chamadas externas ao SDK. Isso evita que services de negócio (Deposits, Withdrawals) conheçam os detalhes internos do SDK.

### DTO Pattern
Todos os dados de entrada são validados via `class-validator` em DTOs tipados. O `ValidationPipe` global rejeita automaticamente campos não declarados (`forbidNonWhitelisted: true`).

### Retry com Exponential Backoff
Todas as chamadas ao SDK do DeFindex passam por um wrapper de retry (3 tentativas, backoff exponencial: 100ms → 400ms → 1600ms).

## Camadas da aplicação

```
HTTP Request
     │
     ▼
Controller          ← HTTP layer: routing, parsing, response shape
     │
     ▼
Service             ← Business logic: validation, orchestration, DB state
     │
     ├──▶ PrismaService    ← Database access (PostgreSQL)
     │
     └──▶ DefindexOrchestrator  ← Multi-step DeFindex flows
               │
               └──▶ DefindexService  ← SDK wrapper with retry
                         │
                         └──▶ @defindex/sdk  ← External protocol
```

## Estrutura de pastas

```
src/
├── app.module.ts          # Módulo raiz
├── main.ts                # Bootstrap (pipes, filters, interceptors globais)
│
├── config/                # ConfigModule com validação Joi
│   ├── config.module.ts
│   └── env.schema.ts
│
├── infra/
│   └── prisma/            # PrismaModule global
│       ├── prisma.module.ts
│       └── prisma.service.ts
│
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts   # Respostas de erro padronizadas
│   └── interceptors/
│       └── logging.interceptor.ts     # Log de req/res
│
├── defindex/              # Integração com DeFindex SDK
│   ├── defindex.config.ts
│   ├── defindex.service.ts
│   ├── defindex.mapper.ts
│   ├── defindex.orchestrator.ts
│   ├── defindex.module.ts
│   ├── dto/defindex.dto.ts
│   └── errors/defindex.errors.ts
│
├── vaults/                # Consulta de vaults (read-only)
│   ├── vaults.controller.ts
│   ├── vaults.service.ts
│   └── vaults.module.ts
│
├── deposits/              # Fluxo de depósito
│   ├── deposits.controller.ts
│   ├── deposits.service.ts
│   ├── deposits.module.ts
│   └── dto/
│       ├── create-deposit.dto.ts
│       └── submit-signed-xdr.dto.ts
│
├── withdrawals/           # Fluxo de saque
│   ├── withdrawals.controller.ts
│   ├── withdrawals.service.ts
│   ├── withdrawals.module.ts
│   └── dto/
│       ├── create-withdrawal.dto.ts
│       └── submit-signed-xdr.dto.ts
│
└── jobs/                  # Background jobs (cron)
    ├── jobs.module.ts
    ├── reconciliation.job.ts
    ├── apy-sync.job.ts
    ├── portfolio-snapshot.job.ts
    └── expired-intents.job.ts
```

## Decisões técnicas

### SDK vs REST direto
Utilizamos o SDK oficial `@defindex/sdk` ao invés de chamar a API REST diretamente porque:
- Tipagem completa em TypeScript
- Abstrações sobre geração de XDR
- Manutenibilidade: mudanças no protocolo refletem apenas no SDK
- Documentação oficial recomenda SDK para projetos TypeScript

### Prisma 5 (não Prisma 7)
O Prisma 7 introduziu um modelo de adapter obrigatório (`PrismaPg`) incompatível com o padrão NestJS de `extends PrismaClient`. Usamos Prisma 5 que mantém total compatibilidade.

### Auth deferida
A autenticação via Google/Apple → JWT está planejada mas não implementada ainda. Os endpoints atualmente recebem `userId` diretamente no body. Ao implementar auth, esse campo será substituído pelo usuário extraído do JWT.

### Sem Redis por enquanto
O cache de APY é in-memory (`Map` no `VaultsService`). Redis será introduzido quando a fase de hardening for implementada.
