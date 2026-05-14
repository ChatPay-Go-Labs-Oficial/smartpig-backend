# SmartPig Backend — Documentação

Bem-vindo à documentação técnica do backend do **SmartPig**, um app de finanças pessoais com integração a vaults DeFi via [DeFindex](https://defindex.io).

## Índice

| Documento | Descrição |
|-----------|-----------|
| [architecture.md](./architecture.md) | Visão geral da arquitetura, camadas e padrões de projeto |
| [database.md](./database.md) | Schema do banco de dados, entidades e relacionamentos |
| [api.md](./api.md) | Referência completa dos endpoints REST |
| [flows.md](./flows.md) | Fluxos de operação: wallet login, depósito, saque e jobs |
| [deployment.md](./deployment.md) | Deploy no Railway, migrações e procedimento de baseline |
| [modules/config.md](./modules/config.md) | Módulo de configuração e variáveis de ambiente |
| [modules/infra.md](./modules/infra.md) | Infraestrutura: PrismaModule |
| [modules/defindex.md](./modules/defindex.md) | Integração com o SDK do DeFindex |
| [modules/vaults.md](./modules/vaults.md) | Consulta de vaults, APY e saldo |
| [modules/deposits.md](./modules/deposits.md) | Criação e processamento de depósitos |
| [modules/withdrawals.md](./modules/withdrawals.md) | Criação e processamento de saques |
| [modules/jobs.md](./modules/jobs.md) | Jobs em background (reconciliação, APY, snapshots, vault sync) |
| [modules/ramp.md](./modules/ramp.md) | On/Off Ramp via BlindPay (BRL ↔ USDC) |

## Visão rápida

```
React Native App
      │
      │ HTTPS/REST (wallet login)
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

# Migrações
npm run migrate:deploy               # aplicar migrações pendentes (produção)
npm run start:migrate                # migrar + iniciar app (somente após baseline)

npx prisma migrate dev --name <nome> # nova migration (desenvolvimento)
npx prisma generate                  # regenerar cliente Prisma
npx prisma db seed                   # popular banco com dados iniciais
```

> **Atenção:** Consulte [docs/deployment.md](./docs/deployment.md) antes do primeiro deploy em um banco de dados existente (procedimento de baseline).
