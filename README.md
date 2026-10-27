# PigFi Backend — Documentação

Bem-vindo à documentação técnica do backend do **PigFi**, um app de finanças pessoais com modos Lite/Pro, aprendizado financeiro, progressão por XP e integração a vaults DeFi via [DeFindex](https://defindex.io).

## Índice

| Documento | Descrição |
|-----------|-----------|
| [docs/architecture.md](./docs/architecture.md) | Visão geral da arquitetura, camadas e padrões de projeto |
| [docs/database.md](./docs/database.md) | Schema do banco de dados, entidades e relacionamentos |
| [docs/api.md](./docs/api.md) | Referência completa dos endpoints REST |
| [docs/flows.md](./docs/flows.md) | Fluxos de operação: login, depósito, saque e jobs |
| [docs/frontend-integration.md](./docs/frontend-integration.md) | Guia de integração do app: multi-vault, disclosure de risco e conversão |
| [docs/integracao-learning-experience.md](./docs/integracao-learning-experience.md) | Guia da integração mobile/backend para aprendizado, XP e elegibilidade |
| [docs/deployment.md](./docs/deployment.md) | Deploy no Railway, migrações e procedimento de baseline |
| [docs/modules/config.md](./docs/modules/config.md) | Módulo de configuração e variáveis de ambiente |
| [docs/modules/infra.md](./docs/modules/infra.md) | Infraestrutura: PrismaModule |
| [docs/modules/defindex.md](./docs/modules/defindex.md) | Integração com o SDK do DeFindex |
| [docs/modules/vaults.md](./docs/modules/vaults.md) | Consulta de vaults, APY e saldo |
| [docs/modules/learning.md](./docs/modules/learning.md) | PigFi Experience: trilha, XP, modos Lite/Pro e elegibilidade de vaults |
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

## Aprendizado e experiência

O modo de experiência é sincronizado no backend para acompanhar o usuário entre sessões e dispositivos. Novos usuários começam em **Lite**; usuários legados com modo não definido são tratados como **Pro**.

- **Catálogo educacional:** cinco lições (M1–M5), com 28 telas explicativas, 30 perguntas intercaladas, cinco reflexões opcionais, boas-vindas e glossário. A apresentação adapta títulos e vocabulário ao modo Lite/Pro.
- **Progresso:** registro das respostas, tentativas e último passo visualizado para retomar o aprendizado. As alternativas são validadas no backend e o gabarito não é enviado ao mobile. Conteúdo desatualizado retorna `409 LEARNING_CONTENT_VERSION_STALE`.
- **XP educacional:** 15 XP pela conclusão de cada lição e 45 XP pela conclusão das cinco lições, totalizando 120 XP na configuração padrão. Perguntas isoladas, reflexões e aceitação de disclosures não concedem XP.
- **Níveis e recompensas:** eventos de XP registrados em ledger com deduplicação, curva `round(40 × nível^1.8)`, tiers e recompensas por nível. O nível exibido é limitado a 50; o XP pode continuar acumulando.
- **Recompensa diária:** 3 XP por padrão, uma vez por dia no fuso `America/Sao_Paulo`. Uma nova tentativa no mesmo dia retorna `409 DAILY_REWARD_ALREADY_CLAIMED`.

### Elegibilidade dos vaults

As políticas Meridian para usuários Lite são administradas e versionadas pelo backend:

| Vault | Requisito educacional | Nível mínimo |
|-------|----------------------|--------------|
| USDC | Acesso livre | Nenhum |
| EURC | Concluir M1, M2 e M3 | 0 |
| XLM | Concluir M1 a M5 | 0 |

Desbloqueios conquistados são persistidos e permanecem válidos após mudanças de política. Os endpoints dos vaults retornam a projeção `access`, com requisitos, progresso e possibilidade de depósito; vaults bloqueados continuam visíveis.

`ENFORCE_VAULT_EDUCATION=false` é o padrão: a elegibilidade é calculada e os desbloqueios são registrados, mas os requisitos educacionais não bloqueiam depósitos. Quando ativado, depósitos inelegíveis de usuários Lite retornam `409 VAULT_EDUCATION_LOCKED`. A elegibilidade também é consultada na criação de conversões para moedas avançadas.

Usuários Pro ignoram somente a exigência educacional. Disclosures continuam independentes e obrigatórios quando aplicáveis. Saques não dependem de XP, nível, modo ou conclusão de módulos.

### Usernames

O backend permite cadastrar um username permanente, consultar a disponibilidade de um nome exato e resolver destinatários por username. A consulta retorna endereço Stellar, indicação de verificação KYC e moedas recebíveis conforme a infraestrutura disponível. Esses endpoints de cadastro e consulta não constituem um fluxo completo de execução de transferências P2P.

Para os contratos dos endpoints, consulte a [referência de APIs](./docs/api.md) e o [guia de integração mobile/backend](./docs/integracao-learning-experience.md).

## Configuração do aprendizado

Defina a conexão PostgreSQL em `DATABASE_URL`. As configurações abaixo constam no [arquivo de exemplo](./.env.example):

```dotenv
ENFORCE_VAULT_EDUCATION=false
LEARNING_INTRO_MODULE_COMPLETION_XP=45
EXPERIENCE_DAILY_REWARD_XP=3
```

`LEARNING_INTRO_MODULE_COMPLETION_XP` controla o bônus de conclusão da trilha; os 15 XP por lição são definidos no catálogo persistido. `EXPERIENCE_DAILY_REWARD_XP` controla a recompensa diária.

Após configurar um banco local, aplique as migrations, gere o cliente Prisma e execute o seed para carregar o catálogo, as recompensas e as políticas iniciais:

```bash
npm run migrate:deploy
npx prisma generate
npx prisma db seed
```

Para bancos existentes, consulte o procedimento de baseline em [docs/deployment.md](./docs/deployment.md) antes de aplicar migrations. O seed preserva políticas posteriores publicadas pelo operador.

## Comandos principais

```bash
npm run start:dev    # desenvolvimento (watch mode)
npm run build        # compilar para dist/
npm test             # testes unitários
npm run test:e2e     # testes end-to-end
npm run lint         # verificar com ESLint
npm run format       # prettier --write

# Migrações
npm run migrate:deploy               # aplicar migrações pendentes (produção)
npm run start:migrate                # migrar + iniciar app (somente após baseline)

npx prisma migrate dev --name <nome> # nova migration (desenvolvimento)
npx prisma generate                  # regenerar cliente Prisma
npx prisma db seed                   # popular banco com dados iniciais
```

> **Atenção:** Consulte [docs/deployment.md](./docs/deployment.md) antes do primeiro deploy em um banco de dados existente (procedimento de baseline).
