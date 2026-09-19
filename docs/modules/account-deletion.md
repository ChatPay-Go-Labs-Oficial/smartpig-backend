# Módulo: Account Deletion

**Localização:** `src/account-deletion/`

## Responsabilidade

Decide se uma conta pode ser excluída **sem o usuário perder dinheiro** e sem interromper uma operação em andamento.

É leitura pura: não escreve nada. A resposta é consultiva — a verificação que de fato autoriza a exclusão é a refeita no momento da confirmação, porque um Pix pode cair entre uma e outra.

> **Estado atual:** só o portão de aptidão existe. A saga de exclusão, o scrub de dados pessoais e o encerramento on-chain são fases seguintes. O `BlindPayModule` só vira dependência nessa fase — estado de KYC **não** bloqueia exclusão, de propósito: um usuário reprovado no KYC também tem o direito de ir embora.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/account-deletion/eligibility` | Aptidão, bloqueios, saldos residuais e avisos |

Ver detalhes em [api.md](../api.md#account-deletion).

A conta inspecionada vem do **token**, nunca da requisição. O cliente do app injeta um `userId` em toda chamada; esta rota ignora. O caminho é `token → endereços Stellar verificados no Privy → `WalletAccount` ativo mais antigo → `userId`.

## Princípio: na dúvida, bloqueia

Toda comparação contra o limite de poeira é feita em `Decimal`. Um `float` aqui deixaria um saldo passar e ser destruído junto com a conta.

Quando um saldo não pode ser **provado** vazio, ele bloqueia. É por isso que uma leitura de vault que falha vira `VAULT_BALANCE_UNKNOWN` em vez de ser tratada como zero.

## Bloqueios

| Código | Origem | `resolvable` | Ação sugerida |
|--------|--------|--------------|----------------|
| `VAULT_BALANCE` | saldo no vault acima da poeira | sim | `WITHDRAW_VAULT` |
| `VAULT_BALANCE_UNKNOWN` | saldo do vault não pôde ser lido | não | — |
| `WALLET_USDC_BALANCE` | USDC na carteira acima da poeira | sim | `WITHDRAW_WALLET` |
| `WALLET_ASSET_BALANCE` | outro ativo configurado acima da poeira | sim | `WITHDRAW_WALLET` |
| `GIFT_LOCKED` | presente enviado, travado na rede até expirar | não | — |
| `GIFT_REFUNDABLE` | presente expirado com saldo a recuperar | sim | `OPEN_GIFTS` |
| `DEPOSIT_IN_FLIGHT` | depósito em estado não terminal | não | — |
| `WITHDRAWAL_IN_FLIGHT` | saque em estado não terminal | não | — |
| `TX_PENDING` | `TransactionRecord` em `PENDING` | não | — |
| `ONRAMP_IN_FLIGHT` | on-ramp BlindPay em andamento | não | — |
| `OFFRAMP_IN_FLIGHT` | off-ramp BlindPay em andamento | não | — |
| `ETHERFUSE_ORDER_IN_FLIGHT` | ordem Etherfuse em andamento | não | — |

`resolvable: false` significa que não há nada a fazer além de esperar, e a tela **não deve** oferecer botão de ação.

XLM nunca é avaliado: a conta é patrocinada e o que está lá é reserva da tesouraria, que segue junto no `AccountMerge` do encerramento.

## Quais vaults são lidos

O escopo é a **allowlist (`ALLOWED_VAULT_IDS`) união os vaults que o usuário tocou** — depósito, saque ou snapshot de portfólio.

A allowlist sozinha não basta: ela é onde o app deposita *hoje* e muda com o tempo. Um vault retirado da lista continua guardando o que já estava lá dentro, e ler só a lista atual deixaria esse saldo ser destruído com a conta. O histórico custa uma query e **nenhuma** chamada DeFindex a mais para quem nunca saiu da allowlist.

Sem allowlist configurada, o escopo é o catálogo inteiro.

`isActive` deliberadamente **não** entra nesse filtro: um vault pode ser aposentado com alguém ainda posicionado nele, e essa posição precisa continuar bloqueando.

## Rate limit do DeFindex

Uma chamada por vault disparada de uma vez foi o que esgotou a cota da API: o catálogo inteiro saía no mesmo tick, voltava 429, e todo vault virava `VAULT_BALANCE_UNKNOWN` — uma tela cheia de bloqueios sem ação possível.

O que a rota faz hoje:

- no máximo **3 leituras simultâneas** (`VAULT_READ_CONCURRENCY`), preservando a ordem do catálogo para a lista de bloqueios não dançar entre duas verificações;
- ao receber a primeira estrangulada, **para de ler** os vaults restantes — gastar a cota que sobrou só torna a retentativa do usuário menos provável de dar certo;
- falha **transitória** (429 → 503, timeout → 504) vira **503** na rota inteira, não bloqueio. A tela já renderiza isso como "tente de novo", que é a resposta honesta: não sabemos o saldo, e esperar não muda isso;
- falha **não transitória** (erro de contrato, 400, 502) continua virando `VAULT_BALANCE_UNKNOWN`, porque esperar não resolve.

## A resposta não carrega texto

Nenhum bloqueio traz frase pronta. A redação depende do modo Lite/Pro escolhido pelo usuário — o mesmo saldo é "no porquinho" para um e "no vault" para o outro — e só o cliente sabe qual está ativo. O app escreve a frase a partir de `code` e `params`.

Valores vêm como string decimal em unidades inteiras, sem formatação: o cliente decide casas decimais e separador.

## Configuração

| Variável | Default | Efeito |
|----------|---------|--------|
| `ACCOUNT_DELETION_DUST_USD` | `0.01` | Abaixo disso um saldo não bloqueia — vira residual (varrido ou perdido) |
| `ALLOWED_VAULT_IDS` | `''` | Vaults lidos na verificação, além do histórico do usuário. Vazio = catálogo inteiro |

> **Pendência conhecida:** o app espera receber `dustThresholdUsd` na resposta, para a frase de consentimento não ter o limite escrito à mão (se a configuração muda e a frase não, a tela mente sobre o que o usuário vai perder). O `EligibilityResult` ainda não devolve esse campo.

## Testes

`eligibility.service.spec.ts` cobre os doze bloqueios, as fronteiras do limite de poeira em `Decimal`, o escopo de vaults (allowlist, histórico, deduplicação, ausência de filtro `isActive`), o teto de concorrência, a preservação de ordem e a separação entre falha transitória e definitiva.
