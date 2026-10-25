# PigFi Experience e Learning

Este módulo implementa a trilha educacional do PigFi, o progresso individual, o XP e a elegibilidade educacional para novos depósitos. Consulta de saldo, retirada e recuperação de fundos nunca dependem da trilha.

## Identidade do usuário

As rotas de aprendizado e experiência não recebem `userId`. O backend valida o Bearer token do Privy, consulta as carteiras Stellar verificadas e resolve o `User.id` local com `AccountOwnerService`. Assim, um cliente não pode consultar nem alterar o progresso de outra pessoa.

## Modos de experiência

- `PRO`: preserva o fluxo já existente. Todos os vaults continuam acessíveis e o disclosure específico de cada vault permanece obrigatório.
- `LITE`: adiciona a orientação educacional. USDC permanece aberto; vaults avançados são avaliados pela política publicada, pelo nível e pelos módulos concluídos.
- Usuários criados após esta entrega começam em `LITE`.
- Usuários anteriores, cujo campo está `null`, são tratados como `PRO` para compatibilidade.

O mobile deve sincronizar a escolha persistida no AsyncStorage com `PATCH /users/me/experience-mode`. A operação é idempotente e pode ser repetida no login ou após uma atualização do aplicativo.

## Catálogo e progresso

A seed publica cinco módulos (`M1` a `M5`), 30 questões, três práticas de hábito (`H-A01` a `H-A03`), boas-vindas e glossário. IDs editoriais são estáveis. Uma alteração de texto incrementa `LEARNING_CATALOG_VERSION`/`contentVersion`, mas não cria novo crédito de XP. A seed valida seis questões por módulo, gabaritos e chaves duplicadas, e desativa itens removidos sem apagar o progresso histórico.

Cada primeiro acerto concede 10 XP. A conclusão das seis questões obrigatórias de um módulo concede 40 XP uma única vez. Tentativas erradas não retiram pontos e podem ser refeitas. O ledger usa uma chave única por usuário, tipo e origem para impedir crédito duplicado entre sessões ou dispositivos.

O cliente deve enviar a versão exibida ao responder. Se o catálogo tiver sido atualizado, a API retorna `409` com o código `LEARNING_CONTENT_VERSION_STALE`; o app deve recarregar a questão.

## Elegibilidade de vault

Políticas são versionadas por vault e configuradas pelas rotas administrativas. O desbloqueio Lite exige simultaneamente o nível mínimo e todos os módulos requeridos. Quando adquirido, ele é persistido e não é revogado por uma recalibração posterior da política.

No primeiro bootstrap de um vault que ainda não possui política, a seed cria os padrões provisórios do produto: EURC exige nível 5 e M1–M3; XLM exige nível 10 e M1–M5. Se o vault já possui qualquer versão, a seed preserva integralmente a configuração administrativa. Uma versão publicada é imutável; ajustes exigem uma nova versão.

A listagem e o detalhe dos vaults continuam retornando todos os produtos, acompanhados do objeto `access`. Isso evita esconder posições e caminhos de retirada. A propriedade `canDeposit` combina disponibilidade operacional, disclosure e elegibilidade educacional.

O bloqueio de novos depósitos é controlado por `ENFORCE_VAULT_EDUCATION`:

- `false` (padrão): calcula e expõe a elegibilidade, sem bloquear o fluxo; indicado para rollout e atualização gradual dos clientes.
- `true`: depósitos Lite inelegíveis retornam `409` com código `VAULT_EDUCATION_LOCKED`.

O gate é executado antes de criar depósitos diretos ou depósitos provenientes de conversão. Ele não interfere em saques.

## Endpoints

Todos os endpoints abaixo exigem autenticação, salvo as regras administrativas já existentes:

- `PATCH /users/me/experience-mode`
- `GET /learning/content`
- `GET /learning/modules`
- `GET /learning/modules/:moduleKey`
- `PATCH /learning/modules/:moduleKey/progress`
- `POST /learning/questions/:questionKey/answer`
- `GET /learning/progress`
- `GET /experience/profile`
- `GET /admin/vaults/:vaultId/eligibility-policies`
- `POST /admin/vaults/:vaultId/eligibility-policies`

## Publicação

1. Executar a migration e regenerar o Prisma Client.
2. Executar `npx prisma db seed` para publicar o catálogo e as recompensas.
3. Manter `ENFORCE_VAULT_EDUCATION=false` enquanto o mobile sincroniza os modos locais.
4. Revisar as políticas provisórias dos vaults avançados e publicar nova versão se necessário.
5. Monitorar a projeção `access` e só então habilitar o enforcement.

O disclosure continua separado da aprendizagem: aceitar riscos não concede XP, e concluir a trilha não substitui o aceite da versão vigente do disclosure.
