# Integração de aprendizado e experiência

Este documento descreve o contrato backend do PigFi Experience após o alinhamento com o HackMeridian e com a trilha introdutória v1.1.0.

## 1. Identidade e modo Lite/Pro

Todas as rotas abaixo usam o usuário autenticado. O backend resolve o `User.id` local a partir do bearer token do Privy e das carteiras Stellar verificadas; o app não envia `userId`.

O modo salvo pelo mobile no AsyncStorage é sincronizado por:

```http
PATCH /users/me/experience-mode
Content-Type: application/json

{ "mode": "LITE" }
```

- Usuário novo começa em `LITE`.
- Usuário antigo com valor `null` é tratado como `PRO`.
- No `PRO`, educação não bloqueia vaults.
- No `LITE`, USDC é livre e EURC/XLM seguem a trilha.
- Disclosure, disponibilidade operacional e elegibilidade educacional são verificações independentes.
- Aprendizado nunca bloqueia saldo, retirada ou saque.

`GET /users/me` devolve o perfil autenticado, incluindo `experienceMode` e `username`.

## 2. Catálogo v1.1.0

O catálogo é versionado e publicado pela seed. Ele contém o módulo “Introdução ao PigFi”, composto por cinco lições (`M1` a `M5`):

- 28 telas curtas, com IDs `L1-T01` em diante;
- 30 perguntas, seis por lição, com IDs `L1-Q01` em diante;
- cinco reflexões opcionais, sem XP;
- boas-vindas e dicionário;
- variações de título, vocabulário e complemento para Lite/Pro.

As três atividades de hábito antigas não fazem parte desta entrega. O backend nunca devolve o gabarito.

```http
GET /learning/content
GET /learning/modules
GET /learning/modules/:moduleKey
GET /learning/progress
```

`GET /learning/modules/:moduleKey` devolve `steps` já ordenados. Cada item informa `type` (`screen`, `question` ou `reflection`) e `key`. Perguntas também devolvem `reviewScreenKey`, usado pelo botão “Rever explicação”.

O retorno inclui `presentationMode`. No Pro, inclui também o vocabulário técnico e usa `proTitle` quando definido. `GET /learning/content` informa `introModuleCompletionXp`, enquanto cada item de `GET /learning/modules` informa o `completionXp` da lição.

## 3. Retomada entre aparelhos

Qualquer passo, inclusive uma pergunta, pode ser salvo:

```http
PATCH /learning/modules/M3/progress
Content-Type: application/json

{ "contentItemKey": "L3-Q01" }
```

`GET /learning/progress` devolve o progresso do usuário autenticado e:

```json
{
  "completedQuestionIds": ["L1-Q01", "L1-Q02"],
  "resume": {
    "moduleId": "M1",
    "stepKey": "L1-T03",
    "contentItemId": "L1-T03"
  }
}
```

`contentItemId` foi mantido como alias de compatibilidade; integrações novas devem usar `stepKey`.

## 4. Respostas, conclusão e XP

```http
POST /learning/questions/L1-Q01/answer
Content-Type: application/json

{ "optionId": "B", "contentVersion": 4 }
```

Se a versão vista pelo app estiver desatualizada, o backend retorna `409 LEARNING_CONTENT_VERSION_STALE`. O app deve recarregar a pergunta.

Regras:

| Evento                         |  XP |
| ------------------------------ | --: |
| Acertar pergunta               |   0 |
| Concluir uma lição (6 acertos) |  15 |
| Concluir as cinco lições       |  45 |
| Total da introdução            | 120 |
| Reflexão ou disclosure         |   0 |

Os valores são configuráveis (`completionXp` da lição e `LEARNING_INTRO_MODULE_COMPLETION_XP`). O ledger usa chaves únicas `lesson:M1` e `module:INTRO`, portanto repetir, trocar de aparelho ou concorrer entre sessões não duplica XP.

Quando uma resposta conclui uma lição, o retorno já traz tudo de que a tela de conclusão precisa:

```json
{
  "correct": true,
  "lessonCompleted": true,
  "moduleCompleted": false,
  "xpAwarded": 15,
  "lessonXpAwarded": 15,
  "introModuleXpAwarded": 0,
  "totalXp": 45,
  "levelBefore": 0,
  "levelAfter": 1,
  "tierAfter": "BEGINNER",
  "newUnlocks": ["EURC"]
}
```

`newUnlocks` contém somente liberações permanentes adquiridas nessa resposta.

## 5. Elegibilidade Meridian

A política publicada nesta entrega usa nível mínimo zero:

| Vault | Nível | Lições obrigatórias |
| ----- | ----: | ------------------- |
| USDC  |     0 | nenhuma             |
| EURC  |     0 | M1, M2, M3          |
| XLM   |     0 | M1, M2, M3, M4, M5  |

Vaults continuam visíveis. As APIs de vault devolvem `access`, incluindo `requiredLevel` e `missingModules`. O item de nível só precisa aparecer no app quando `requiredLevel > 0`.

Uma liberação adquirida é persistida em `UserVaultUnlock` e não é revogada por políticas futuras. No Lite, a mesma elegibilidade é avaliada ao guardar e antes de criar uma troca para EURC/XLM. No Pro, há bypass. A flag `ENFORCE_VAULT_EDUCATION` continua controlando o bloqueio durante o rollout; quando habilitada, a falha é `409 VAULT_EDUCATION_LOCKED`.

## 6. Níveis e recompensa diária

A curva é:

```text
round(40 × nível^1,8)
```

`GET /experience/profile` devolve o perfil, recompensas, `levelThresholds` dos níveis 1 a 50 e:

```json
{
  "dailyReward": {
    "available": true,
    "xp": 3,
    "nextAvailableAt": "2026-10-26T03:00:00.000Z"
  }
}
```

A recompensa diária é resgatada uma vez por dia no calendário de `America/Sao_Paulo`:

```http
POST /experience/daily-reward/claim
```

Ela concede 3 XP por padrão (`EXPERIENCE_DAILY_REWARD_XP`) e não conta como atividade de Chama. Repetição no mesmo dia retorna `409 DAILY_REWARD_ALREADY_CLAIMED`.

## 7. Nome de usuário e transferência

O backend cadastra e resolve o apelido; o mobile continua montando e assinando o pagamento Stellar.

```http
GET  /usernames/{username}/availability
POST /users/me/username
GET  /usernames/{username}
```

Regras do username:

- único sem diferença prática de maiúsculas/minúsculas, pois é normalizado para minúsculas;
- permanente;
- 3 a 20 caracteres;
- começa com letra e aceita apenas letras minúsculas, números, ponto e sublinhado;
- resolução somente por nome exato, sem listagem ou autocomplete.

Exemplo de resolução:

```json
{
  "username": "joao.silva",
  "displayName": "João Silva",
  "verified": true,
  "stellarAddress": "GA7KQ...2MXP",
  "receives": { "USDC": true, "EURC": false, "XLM": true }
}
```

O nome KYC só é mostrado quando o cadastro está verificado; caso contrário, `displayName` é `Usuário PigFi`. As trustlines de USDC/EURC são consultadas na rede e XLM é nativo.

Decisão desta entrega: no Pro, a transferência direta por endereço continua somente em USDC. Lite transfere por username; Pro pode usar username ou o fluxo preexistente por endereço. Transferência não concede XP.

## 8. Migração e garantias

- IDs editoriais antigos `M1-Q01` são migrados para `L1-Q01`, preservando progresso.
- Bônus antigos de lição recebem a chave lógica nova para não serem creditados outra vez.
- Alterar texto aumenta `contentVersion`, mas não repete XP.
- Disclosure continua por usuário, vault e versão e nunca concede XP.
- Nenhuma conclusão inicia troca, depósito ou seleção de vault automaticamente.
