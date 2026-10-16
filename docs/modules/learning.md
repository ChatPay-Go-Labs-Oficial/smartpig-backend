# Aprendizado e acesso aos vaults

Implementação SCF45: cards informativos → perguntas de múltipla escolha → pontos persistentes → liberação de depósitos.

- USDC: 0 pontos, disponível desde o início.
- EURC: `EDUCATION_EURC_POINTS`, padrão 90.
- XLM: `EDUCATION_XLM_POINTS`, padrão 150.
- 5 lições sequenciais, 3 perguntas por lição, 10 pontos por acerto. As três primeiras tratam de fundamentos, fluxo PigFi e moedas; as duas últimas tratam de volatilidade e liquidez.
- As configurações aceitam inteiros: EURC entre 1 e 149; XLM acima de EURC e até 150. Alterar limites muda a política de acesso imediatamente após reiniciar o backend.
- Erros não pontuam; é possível revisar e tentar novamente. Acertos repetidos nunca pontuam novamente.

## API autenticada

`GET /learning/lessons` retorna cards e perguntas sem gabarito. `GET /learning/progress` retorna pontos, perguntas e lições concluídas e requisitos dos três ativos. `POST /learning/lessons/:id/answers` recebe somente `questionId`, `optionId`, `version` e retorna correção, explicação, pontos concedidos e progresso.

O backend resolve o usuário local pelas wallets verificadas pelo Privy, seguindo a mesma ordenação do login. Não aceita pontuação, indicação de acerto ou identidade no corpo da resposta. Criação, listagem, leitura e submissão de depósitos e saques também usam a identidade autenticada; intents de outro usuário são rejeitados. Saques não exigem pontos.

A tabela `learning_rewards` tem índice único `(userId, questionId)` e usa `createMany(skipDuplicates: true)` / `ON CONFLICT DO NOTHING`. O total é calculado a partir das recompensas persistidas. Uma nova versão de conteúdo não pontua novamente a mesma pergunta: IDs de perguntas devem ser estáveis. Acrescentar perguntas exige revisar também o teto dos limites em `env.schema.ts`.

O progresso antigo no AsyncStorage não é promovido a pontuação válida: ele era calculado no cliente sem correção verificável. A trilha nova começa com as recompensas persistidas no servidor. O store legado permanece sem uso pela trilha nova.

## Vaults e configuração

`GET /vaults` e `GET /vaults/:id` incluem `access` com pontos necessários, faltantes, `unlocked`, `depositsEnabled` e `canDeposit`. As respostas e caches do app são específicas por usuário. Vaults inativos com depósitos confirmados do usuário continuam listados para acesso à posição.

`DISABLED_DEPOSIT_VAULT_IDS` contém IDs do catálogo separados por vírgula. Impede novos depósitos e a submissão de intents ainda não enviados. Saques e consulta de saldo não dependem de pontuação nem de `isActive`. `ALLOWED_VAULT_IDS` também é aplicado no backend ao depositar, e não apenas na listagem. A sincronização não sobrescreve `isActive` em registros existentes, mantém novos registros inativos para curadoria e normaliza `native` para XLM.

Esta política governa as operações pelo PigFi, não as chamadas externas a contratos permissionless. Um XDR já entregue ao usuário não pode ser revogado por uma flag apenas no backend; pausar on-chain é uma operação distinta.

O progresso educacional é removido durante a exclusão de conta. Rotas administrativas exigem a chave administrativa configurada; um bearer comum não concede acesso. Consultas de catálogo continuam disponíveis a usuários autenticados.

## Implantação

1. Aplicar `npm run migrate:deploy` no ambiente de destino antes de publicar o backend novo.
2. Publicar backend e depois app. Os limites iniciais podem ser mantidos ou configurados.
3. Configurar/registrar os vaults EURC e XLM selecionados. Estratégia DeFindex não é endereço de vault.

Não há criação automática de vaults nem execução de swaps nesta alteração. A integração Soroswap foi verificada tecnicamente; o fluxo transacional de swap é uma entrega separada.

## Verificação

- `npm run build`
- `npm test -- --runInBand`
- Em PostgreSQL local descartável com migrations aplicadas, `LEARNING_TEST_DATABASE_URL=postgresql://...@127.0.0.1:PORT/pigfi_learning_test node scripts/test-learning-postgres.cjs` verifica concorrência real e persistência.
- App: `npx tsc --noEmit` e ESLint nos arquivos alterados.
