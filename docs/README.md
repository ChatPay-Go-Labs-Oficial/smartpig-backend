# SmartPig Backend — Documentação

Bem-vindo à documentação técnica do backend do **SmartPig**, um app de finanças pessoais com integração a vaults DeFi via [DeFindex](https://defindex.io).

## Índice

| Documento | Descrição |
|-----------|-----------|
| [architecture.md](./architecture.md) | Visão geral da arquitetura, camadas e padrões de projeto |
| [database.md](./database.md) | Schema do banco de dados, entidades e relacionamentos |
| [api.md](./api.md) | Referência completa dos endpoints REST |
| [flows.md](./flows.md) | Fluxos de operação: depósito, saque e autenticação |
| [modules/config.md](./modules/config.md) | Módulo de configuração e variáveis de ambiente |
| [modules/infra.md](./modules/infra.md) | Infraestrutura: PrismaModule |
| [modules/defindex.md](./modules/defindex.md) | Integração com o SDK do DeFindex |
| [modules/vaults.md](./modules/vaults.md) | Consulta de vaults, APY e saldo |
| [modules/deposits.md](./modules/deposits.md) | Criação e processamento de depósitos |
| [modules/withdrawals.md](./modules/withdrawals.md) | Criação e processamento de saques |
| [modules/jobs.md](./modules/jobs.md) | Jobs em background (reconciliação, APY, snapshots, vault sync) |

## Visão rápida

```
React Native App
      │
      │ HTTPS/REST (JWT)
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

## Comandos principais

```bash
npm run start:dev    # desenvolvimento (watch mode)
npm run build        # compilar para dist/
npm test             # testes unitários
npm run test:e2e     # testes end-to-end
npm run lint         # eslint --fix
npm run format       # prettier --write

npx prisma migrate dev --name <nome>   # nova migration
npx prisma generate                    # regenerar cliente Prisma
npx prisma db seed                     # popular banco com dados iniciais
```
