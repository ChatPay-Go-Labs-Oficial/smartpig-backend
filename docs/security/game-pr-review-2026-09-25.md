# Revisão de segurança da branch game — 25/09/2026

## Decisão

**PR em rascunho: não aprovar merge ou deploy enquanto os bloqueios abaixo estiverem abertos.** Esta é uma revisão dos arquivos e integrações alterados, com auditoria automatizada de dependências e segredos. Não é uma auditoria independente de todo o produto nem garantia de ausência de vulnerabilidades.

## Dependências

`npm audit` final: **0 críticas, 3 altas, 0 moderadas e 0 baixas**, total 3 nós sinalizados. A contagem inclui dependências afetadas indiretamente; não equivale ao número de falhas independentes.

O resultado inicial era 16 nós sinalizados (10 altos). Atualizações compatíveis do lockfile reduziram para 3 altos. Não houve atualização major do SDK Stellar.

Pacotes com advisories diretos ainda encontrados:

| Pacote | Severidade | Referência de correção |
|---|---|---|
| axios | high | [advisory](https://github.com/advisories/GHSA-f4gw-2p7v-4548), [advisory](https://github.com/advisories/GHSA-42h9-826w-cgv3) |
| toml | high | [advisory](https://github.com/advisories/GHSA-82x6-q7mm-w9cf), [advisory](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j) |

O SDK Stellar 15.1.0 mantém axios 1.15.0 e toml 3.0.0 na árvore. A recomendação automática envolve upgrade major do SDK. Resolver com atualização compatível dos consumidores ou migração planejada, validar assinatura/serialização, integração e build dos ambientes usados e repetir a auditoria. Não foi usado `npm audit fix --force`. Não mascarar essas ocorrências com allowlist de vulnerabilidades.

## Segredos

Gitleaks 8.30.1, obtido do release oficial com checksum SHA-256 conferido, examinou snapshot de todos os arquivos versionados e novos não ignorados. Os nove alertas foram examinados: dois endereços públicos de contratos Stellar em `.env.example` do app e sete UUIDs de idempotência em exemplos Swagger do backend. Não eram credenciais. Uma varredura adicional de seeds Stellar com validação de checksum não encontrou nenhuma seed válida. Arquivos `.env` reais e diretórios ignorados não entram no commit.

## Revisão de código

- Rotas `@Admin` agora exigem a chave configurada e usam comparação de tempo constante; um bearer comum não passa por fallback. A listagem e consulta de vaults continuam autenticadas por usuário; sincronização permanece administrativa.
- Criação, leitura, listagem e submissão de depósitos/saques usam identidade autenticada; colisão de idempotência não revela intent de terceiro. Testes cobrem leitura/submissão não autorizadas. A identidade do DTO não é autoridade.
- Pontos calculados no servidor, unicidade por usuário/pergunta, validação de conteúdo e sequência; saques não dependem de pontos.
- Exclusão de conta elimina recompensas educacionais. A atualização da `game` incorporou as correções de exclusão/identidade já presentes em `origin/main`.
- Vault recém-descoberto permanece inativo para curadoria; sync não reativa os existentes.

## Validação

- Build aprovado; 27 suites / 257 testes aprovados.
- ESLint dos arquivos TypeScript alterados: zero erros e zero warnings.
- PostgreSQL 16 local descartável: todas as migrações aplicadas, concorrência de 20 respostas concede uma recompensa, 150 pontos persistem entre instâncias. Container encerrado e removido.
- Instalação a partir do lockfile verificada. Prisma regenerado localmente.
- Sem deploy, migração de produção, criação de vault ou movimentação financeira.

## Bloqueios adicionais de lançamento

A revisão não implementou a jornada financeira multiativo do PRD. Criação administrativa ainda precisa confirmar resultado on-chain antes de publicar o catálogo, reconciliar timeout e validar configuração/roles. Depósitos EURC/XLM, swaps, precisão da UI, reconhecimento de riscos e validação mainnet permanecem pendentes. Manter novos vaults desabilitados. A revisão de ownership realizada aqui cobre os endpoints de depósitos/saques alterados; os demais módulos não receberam uma auditoria completa nesta tarefa.

A exigência de chave nas rotas administrativas é uma mudança intencional de acesso: clientes que chamavam `vault-manager` com bearer comum precisam usar um fluxo administrativo separado, sem embutir a chave no aplicativo.
