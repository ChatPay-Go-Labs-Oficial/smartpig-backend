# PigFi Backend — Documentação

Bem-vindo à documentação técnica do backend do **PigFi**, um app de finanças pessoais com integração a vaults DeFi via [DeFindex](https://defindex.io).

## Índice

| Documento | Descrição |
|-----------|-----------|
| [docs/architecture.md](./docs/architecture.md) | Visão geral da arquitetura, camadas e padrões de projeto |
| [docs/database.md](./docs/database.md) | Schema do banco de dados, entidades e relacionamentos |
| [docs/api.md](./docs/api.md) | Referência completa dos endpoints REST |
| [docs/flows.md](./docs/flows.md) | Fluxos de operação: login, depósito, saque e jobs |
| [docs/deployment.md](./docs/deployment.md) | Deploy no Railway, migrações e procedimento de baseline |
| [docs/modules/config.md](./docs/modules/config.md) | Módulo de configuração e variáveis de ambiente |
| [docs/modules/infra.md](./docs/modules/infra.md) | Infraestrutura: PrismaModule |
| [docs/modules/defindex.md](./docs/modules/defindex.md) | Integração com o SDK do DeFindex |
| [docs/modules/vaults.md](./docs/modules/vaults.md) | Consulta de vaults, APY e saldo |
| [docs/modules/vault-manager.md](./docs/modules/vault-manager.md) | Criação e gestão de vaults próprios do SmartPig |
| [docs/modules/deposits.md](./docs/modules/deposits.md) | Criação e processamento de depósitos |
| [docs/modules/withdrawals.md](./docs/modules/withdrawals.md) | Criação e processamento de saques |
| [docs/modules/gifts.md](./docs/modules/gifts.md) | Presentes em USDC via claimable balance Stellar |
| [docs/modules/jobs.md](./docs/modules/jobs.md) | Jobs em background (reconciliação, APY, snapshots, vault sync, gifts) |
| [docs/modules/ramp.md](./docs/modules/ramp.md) | On/Off Ramp via BlindPay (BRL ↔ USDC) |
| [docs/modules/etherfuse-ramp.md](./docs/modules/etherfuse-ramp.md) | On/Off Ramp via Etherfuse (MXN ↔ USDC/CETES) |

## Visão rápida

```
React Native App
      │
      │ HTTPS/REST (Bearer access token do Privy)
      ▼
NestJS Backend (SmartPig API)
      │
      ├── PostgreSQL (Prisma 5)
      └── DeFindex                 ← SDK + REST direto (híbrido)
           ├── @defindex/sdk        ← operações principais (XDR, info, balance)
           └── REST API direta      ← endpoints não cobertos pelo SDK (discover, strategies)
                     │
                     └── Stellar Network
```

O backend atua como intermediário seguro entre o app mobile e o protocolo DeFindex:
- Nunca armazena chave privada do usuário
- Gera XDRs não assinados e retorna ao app para assinatura
- Recebe XDRs assinados e submete ao Stellar via SDK

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20+ |
| Framework | NestJS 11 |
| ORM | Prisma 5 |
| Banco de dados | PostgreSQL 16 |
| Blockchain | Stellar (via DeFindex SDK) |
| Agendamento | @nestjs/schedule (node-cron) |
| Validação | class-validator + class-transformer |
| Configuração | @nestjs/config + Joi |
| Autenticação | Privy (`@privy-io/node`) — Bearer token verificado por guard global |
| On/Off Ramp | BlindPay (BRL/PIX) e Etherfuse (MXN/SPEI) |

## Comandos principais

```bash
npm run start:dev    # desenvolvimento (watch mode)
npm run build        # compilar para dist/
npm test             # testes unitários
npm run test:e2e     # testes end-to-end
npm run lint         # eslint --fix
npm run format       # prettier --write

# Migrações
npm run migrate:deploy               # aplicar migrações pendentes (produção)
npm run start:migrate                # migrar + iniciar app (somente após baseline)

npx prisma migrate dev --name <nome> # nova migration (desenvolvimento)
npx prisma generate                  # regenerar cliente Prisma
npx prisma db seed                   # popular banco com dados iniciais
```

> **Atenção:** Consulte [docs/deployment.md](./docs/deployment.md) antes do primeiro deploy em um banco de dados existente (procedimento de baseline).
