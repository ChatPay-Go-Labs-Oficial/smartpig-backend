# Integração do app — multi-vault, disclosure de risco e conversão

Guia para quem vai implementar o lado do app (`../pigfi`) do Deliverable 1.

> **Branch:** `feat/vault-registry-disclosures`. Nada disso está em `main` nem em
> produção ainda. Para desenvolver contra o backend novo é preciso rodá-lo local
> nessa branch, ou aguardar o merge.

## Índice

1. [O que mudou e o que não mudou](#1-o-que-mudou-e-o-que-não-mudou)
2. [Registry de assets](#2-registry-de-assets)
3. [Lista e detalhe de vaults](#3-lista-e-detalhe-de-vaults)
4. [Disclosure de risco](#4-disclosure-de-risco)
5. [Saldo normalizado](#5-saldo-normalizado)
6. [Estados de transação](#6-estados-de-transação)
7. [Depósito com conversão](#7-depósito-com-conversão)
8. [Trustline sob demanda](#8-trustline-sob-demanda)
9. [Conversões pendentes](#9-conversões-pendentes)
10. [Portfólio em USD](#10-portfólio-em-usd)
11. [Autenticação](#11-autenticação)
12. [Problemas conhecidos no app](#12-problemas-conhecidos-no-app)

---

## 1. O que mudou e o que não mudou

**Regra geral: nada foi removido nem alterado de forma incompatível.** Todo campo
novo é adicional, e todo campo antigo continua com o mesmo significado. O app
publicado hoje continua funcionando contra este backend sem nenhuma mudança.

Isso é deliberado — as migrações são aditivas justamente para que o app possa
migrar no seu ritmo.

| Rota | O que ganhou |
|---|---|
| `GET /vaults` | `assetDecimals`, `depositsEnabled`, `isFeatured`, `displayOrder`, `disclosure` |
| `GET /vaults/:id` | `configRecord`, `disclosure` com riscos |
| `GET /vaults/:id/balance` | `sharesAsset`, `underlyingBalanceAsset`, `assetDecimals` |
| `GET /deposits/:id` | `state`, `txHash`, `failureCode` |
| `GET /withdrawals/:id` | idem |
| `POST /deposits/:id/signed-xdr` | `status` agora é o real, não `SUBMITTED` fixo |

Rotas novas:

| Método | Rota |
|---|---|
| GET | `/app-config/assets` |
| GET | `/vaults/:id/disclosure` |
| POST | `/vaults/:id/disclosure/acknowledge` |
| POST | `/wallets/:walletAccountId/trustlines` |
| POST | `/wallets/:walletAccountId/trustlines/submit` |
| GET | `/wallets/:walletAccountId/trustlines` |
| GET | `/conversions/quote` |
| GET | `/conversions/pending` |
| POST | `/conversions` |
| POST | `/conversions/:id/signed-xdr` |
| POST | `/deposits/from-conversion` |
| GET | `/portfolio/summary` |

---

## 2. Registry de assets

`GET /app-config/assets` — **rota pública**, não exige token.

Existe para que incluir um ativo novo, ou mudar como o modo Lite o chama, não
exija release de loja. Toda formatação de valor deve sair daqui.

```json
[
  {
    "symbol": "USDC", "code": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "assetId": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "contractId": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    "decimals": 7, "kind": "CLASSIC",
    "displayPrefix": "$", "displaySuffix": "",
    "liteSymbol": "USD", "liteName": "dólar",
    "liteDecimals": 2, "proDecimals": 7,
    "maxSlippageBps": 50, "isFundingAsset": true
  },
  { "symbol": "EURC", "displayPrefix": "€", "liteSymbol": "EUR", "liteName": "euro", "...": "..." },
  { "symbol": "XLM",  "displayPrefix": "",  "displaySuffix": " XLM", "kind": "NATIVE", "issuer": null, "assetId": "XLM", "...": "..." }
]
```

Pontos de atenção:

- **`assetId` do XLM é a string nua `"XLM"`**, sem issuer, porque é assim que
  `GET /wallets/:address/balance` reporta o ativo nativo. Um `findAssetBalance`
  tem que tratar os dois formatos.
- **`isFundingAsset`** marca o que a rampa entrega (USDC). Exatamente um ativo tem
  essa flag.
- **`maxSlippageBps`** é o default que o backend usa na conversão; serve para
  exibir a tolerância ao usuário.
- Adicionar `/app-config/assets` a `PUBLIC_ENDPOINTS` em `lib/api/client.ts`,
  junto de `/app-config/version`.

---

## 3. Lista e detalhe de vaults

`GET /vaults?userId=<contractId>`

```json
[
  {
    "id": "cmpgf...", "defindexVaultId": "CBD4WHL2...",
    "name": "Porquinho EURC", "assetSymbol": "EURC",
    "assetDecimals": 7,
    "assetContractId": "CDTKPWPL...",
    "apy": "1.9400", "tvl": "0.00000000",
    "protocol": "DEFINDEX",
    "depositsEnabled": true,
    "isFeatured": false,
    "displayOrder": 20,
    "disclosure": { "version": 1, "acknowledgmentRequired": true }
  }
]
```

- **`assetDecimals`** nunca era enviado; o app fixava 7 no cliente.
- **A ordem é determinística** (`displayOrder`, depois nome). Use
  `vaults.find(v => v.isFeatured) ?? vaults[0]` em vez de `vaults[0]`, senão
  incluir um vault remaneja o destaque sozinho.
- **`depositsEnabled: false`** significa depósito congelado com o vault ainda
  listado e **sacável**. A tela deve esconder o CTA de investir e manter o de
  resgatar.
- **`disclosure.acknowledgmentRequired`** vem `undefined` quando a chamada não
  leva `userId` — "não verificamos" não é a mesma coisa que "não é exigido".

`GET /vaults/:id` traz ainda `configRecord`, com os dados do contrato para a tela
de detalhe: estratégia e fonte de rendimento, roles, taxas, condições de liquidez,
dependências de oráculo e de protocolo, e os riscos. É o material do critério 10
do grant, e é o que a tela de detalhe deve exibir.

---

## 4. Disclosure de risco

Antes do **primeiro depósito em cada vault não-USDC**, o usuário tem que aceitar
o aviso de risco daquele vault. O vault USDC padrão é isento desse aceite. Para os
demais ativos, a regra é **bloqueada no servidor** e não pode ser contornada pelo
cliente.

### Como funciona

`GET /vaults/:id/disclosure`

```json
{
  "vaultId": "cmpgf...",
  "disclosure": {
    "version": 1,
    "risks": [
      { "code": "SMART_CONTRACT", "severity": "HIGH" },
      { "code": "FX_EXPOSURE", "severity": "MEDIUM", "params": { "assetCode": "EURC" } },
      { "code": "FEES", "severity": "MEDIUM", "params": { "vaultFeeBps": "1000", "defindexFeeBps": "5000" } }
    ],
    "sections": null,
    "publishedAt": "2026-10-09T12:00:00.000Z"
  },
  "acknowledgmentRequired": true
}
```

`POST /vaults/:id/disclosure/acknowledge`

```json
{ "version": 1, "appVersion": "1.4.0", "mode": "lite", "shownCodes": ["SMART_CONTRACT", "FX_EXPOSURE"] }
```

Mandar `version` é importante: se uma versão nova foi publicada enquanto a folha
estava aberta, o backend responde **409 `DISCLOSURE_VERSION_STALE`** em vez de
registrar consentimento sobre um texto que ninguém leu.

### A redação é do app

O backend manda **código e parâmetros, nunca prosa** — mesmo padrão de
`eligibility.service.ts` → `lib/copy/blockers.ts`. A redação depende do modo
Lite/Pro, e só o cliente sabe qual está ativo.

Crie `lib/copy/disclosures.ts` com `switch` exaustivo sobre `RiskCode`, como
`blockers.ts` faz, para que adicionar código na API sem copy **quebre o build**.

Códigos possíveis:

```
SMART_CONTRACT · STRATEGY_PROTOCOL · ISSUER_CREDIT · DEPEG · FX_EXPOSURE
PRICE_VOLATILITY · LIQUIDITY_WITHDRAWAL · SLIPPAGE_CONVERSION
ORACLE_DEPENDENCY · YIELD_NOT_GUARANTEED · FEES · ROLE_TRUST
UPGRADEABILITY · BACKSTOP_DEPENDENCY · NO_DEPOSIT_INSURANCE
```

**Um detalhe que muda o desenho do switch:** cada risco pode trazer
`fallbackText: { lite, pro }`. O backend pode emitir um código que o build
publicado não conhece — é o que permite atualizar disclosure sem release. Então o
`default` do switch deve renderizar `fallbackText` quando houver, e só cair numa
linha genérica se não houver.

### O bloqueio

`POST /deposits` sem aceite responde **409**:

```json
{
  "statusCode": 409,
  "code": "DISCLOSURE_NOT_ACKNOWLEDGED",
  "details": {
    "vaultId": "cmpgf...",
    "version": 1,
    "risks": [ { "code": "SMART_CONTRACT", "severity": "HIGH" } ]
  }
}
```

Os riscos vêm no erro de propósito: dá para abrir a folha direto da rejeição, sem
segunda chamada. Vale tratar os dois caminhos — o pré-voo com
`GET .../disclosure` e este 409 —, porque o segundo cobre a corrida em que a
versão sobe entre telas.

Regras: aceitar o vault A **não** vale para o B. Publicar versão nova faz todos
aceitarem de novo.

---

## 5. Saldo normalizado

`GET /vaults/:id/balance?walletAddress=G...`

```json
{
  "vaultId": "cmpgf...", "walletAddress": "GBBI...",
  "assetSymbol": "USDC", "assetDecimals": 7,
  "dfTokens": "19999000",
  "underlyingBalance": ["20390285"],
  "sharesAsset": "1.9999000",
  "underlyingBalanceAsset": ["2.0390285"]
}
```

**Use `sharesAsset` e `underlyingBalanceAsset`.** Já estão em unidades inteiras,
convertidos pelo lado que conhece os decimais do ativo.

Os campos `dfTokens` e `underlyingBalance` continuam crus só para o app publicado
não quebrar. Ao migrar, **pare de chamar `normalizeStellarAmount` nesses
caminhos** — a tela de detalhe hoje normaliza `dfTokens` duas vezes.

Repare que `dfTokens` vem como **string**, não número. A API da DeFindex sempre
devolveu string; o tipo antigo dizia `number` e era mentira.

Vault vazio devolve posição zero, não erro. Os dois vaults novos estão sem fundo,
então o fan-out de saldo na lista funciona desde já.

---

## 6. Estados de transação

`GET /deposits/:id` e `GET /withdrawals/:id` agora trazem:

```json
{
  "status": "SUBMITTED",
  "state": "PENDING",
  "txHash": "abc123...",
  "failureCode": null
}
```

`status` é o cru, mantido para compatibilidade. **`state` é o que as telas devem
renderizar:**

| `state` | Significado | O que mostrar |
|---|---|---|
| `PENDING_SIGNATURE` | XDR gerado, nada na rede | aguardando autorização |
| `PENDING` | na rede, aguardando confirmação | spinner, continuar polling |
| `SUCCESS` | confirmado | sucesso |
| `REJECTED` | não passou, **o usuário pode resolver** | mensagem + "tentar de novo" |
| `FAILED` | não passou, **o usuário não pode resolver** | mensagem + suporte + `txHash` |
| `EXPIRED` | nunca autorizado em tempo | recomeçar |

A diferença entre `REJECTED` e `FAILED` é o motivo de existirem códigos de falha:
decide se você oferece retentativa ou suporte.

`failureCode` acionável (→ `REJECTED`): `USER_REJECTED_SIGNATURE`,
`SIGNATURE_MISMATCH`, `INTENT_EXPIRED`, `INSUFFICIENT_BALANCE`, `NO_TRUSTLINE`,
`SLIPPAGE_EXCEEDED`, `QUOTE_EXPIRED`.

Não acionável (→ `FAILED`): `XDR_GENERATION_FAILED`, `UPSTREAM_UNAVAILABLE`,
`CHAIN_REJECTED`, `UNKNOWN`.

**O hook `useDeposit` já existe** em `lib/queries/deposits.queries.ts` com polling
de 5s e **nunca é usado** — o `DepositModal` marca sucesso no instante em que o
submit resolve, sem ler o status. Agora que o backend diz a verdade, vale ligá-lo.

Um cuidado: depósito submetido **nunca** vira `EXPIRED`. O time bound deixa de
importar quando a transação entra na rede.

---

## 7. Depósito com conversão

A rampa entrega **USDC**. Os vaults de EURC e XLM querem o próprio ativo. Então
depositar neles exige converter antes.

### São três transações, uma autorização

Não existe como juntar: o path payment é operação **clássica** e o depósito na
DeFindex é **Soroban**, que aceita exatamente uma operação por transação. Mas o
`signHashViaPrivy` assina hash opaco e não é interativo por chamada, então dá
para encadear sob uma única tela de autorização.

```
1. trustline do ativo alvo   (só no primeiro aporte naquele ativo)
2. swap USDC → EURC/XLM      (transação clássica)
3. depósito no vault         (transação Soroban)
```

### O plano

`POST /deposits` com `autoConvert: true`:

```json
{
  "idempotencyKey": "<uuid>",
  "userId": "<contractId>",
  "walletAccountId": "<id>",
  "vaultId": "<vault EURC>",
  "amount": "10.00",
  "assetSymbol": "USDC",
  "autoConvert": true
}
```

Resposta — **nenhuma intent foi criada ainda**:

```json
{
  "plan": {
    "steps": [
      {
        "type": "CONVERT",
        "id": "conv_...",
        "unsignedXdr": "AAAA...",
        "quote": {
          "send": "10.0000000", "sendAsset": "USDC",
          "estimatedReceive": "8.9895413",
          "minReceive": "8.9445935",
          "receiveAsset": "EURC"
        }
      },
      { "type": "DEPOSIT", "id": null, "deferred": true, "vaultId": "cmpgf..." }
    ]
  }
}
```

**Por que o depósito vem `deferred`:** a DeFindex simula o estado da conta ao
montar o XDR de depósito. Gerado antes da conversão entrar, ele lê saldo zero de
EURC e falha. Então ele só pode ser gerado depois — e aí é dimensionado pelo que
**realmente chegou**, não pela cotação.

Sem `autoConvert`, a resposta continua sendo **400** de ativo incompatível,
exatamente como hoje.

### Sequência no app

```
POST /deposits { autoConvert: true, ... }
  ├── 409 TRUSTLINE_REQUIRED  → assinar details.unsignedXdr
  │                             → POST /wallets/:id/trustlines/submit
  │                             → repetir o POST /deposits
  └── { plan }
        → signXdr(steps[0].unsignedXdr)
        → POST /conversions/:id/signed-xdr   { signedXdr }
        → POST /deposits/from-conversion     { conversionId, idempotencyKey, walletAccountId }
        → signXdr(unsignedXdr)
        → POST /deposits/:id/signed-xdr      { signedXdr }
```

Mostre `minReceive` na tela de revisão. É o piso que a rede garante: abaixo dele
a operação falha inteira e o usuário fica com o dinheiro dele — nunca com um
câmbio ruim em silêncio.

### Cotação isolada

`GET /conversions/quote?to=EURC&amount=10` — para a tela de revisão, sem criar
nada.

```json
{
  "sourceSymbol": "USDC", "targetSymbol": "EURC",
  "sendAmount": "10.0000000",
  "estimatedReceive": "8.9895413",
  "minReceive": "8.9445935",
  "slippageBps": 50,
  "path": [],
  "expiresAt": "2026-10-09T19:01:00.000Z"
}
```

`path: []` é rota direta. A cotação expira em 60s.

---

## 8. Trustline sob demanda

EURC precisa de trustline; XLM é nativo e não precisa. A reserva de 0,5 XLM é
**patrocinada pela tesouraria** — o usuário não precisa ter XLM.

`POST /wallets/:walletAccountId/trustlines` com `{ "assetSymbol": "EURC" }`

```json
{ "required": true, "assetId": "EURC:GDHU...", "unsignedXdr": "AAAA...", "expiresAt": "..." }
```

`required: false` significa que já existe — é a resposta normal em aportes
seguintes, **não é erro**.

Depois: `POST /wallets/:walletAccountId/trustlines/submit` com
`{ "assetSymbol": "EURC", "signedXdr": "..." }`.

---

## 9. Conversões pendentes

Se o swap confirma e o depósito não acontece, o usuário fica com EURC na carteira
e nenhuma posição. **Não é perda** — é o dinheiro dele, na conta dele — mas é um
saldo que parece inexplicado.

`GET /conversions/pending` lista esses casos, com `plannedDeposit` dizendo qual
vault era o destino. Vale um card retomável que pula direto para o
`POST /deposits/from-conversion`.

O swap avulso da Carteira usa os mesmos endpoints sem `vaultId`: envie também
`from` no `POST /conversions` para escolher o ativo de origem. Sem `from`, USDC
continua sendo o padrão para manter compatibilidade com o fluxo de depósito.

---

## 10. Portfólio em USD

`GET /portfolio/summary` — substitui o app ler cada vault e somar os valores como
se fossem a mesma moeda.

```json
{
  "totalUsd": "2.0406",
  "asOf": "2026-10-10T00:30:00.000Z",
  "priceSource": "REFLECTOR",
  "stale": false,
  "positions": [
    {
      "vaultId": "cmp8dq...", "vaultName": "Cofrinho PigFy",
      "assetSymbol": "USDC",
      "amountAsset": "2.0391202",
      "amountUsd": "2.0406",
      "shares": "1.9999000"
    }
  ]
}
```

Os preços vêm do oráculo Reflector, lidos do contrato de CEX/DEX que cota USDC,
EURC e XLM contra USD.

**`totalUsd` pode vir `null`.** Acontece quando alguma posição não pôde ser
precificada, ou quando algum vault não pôde ser lido. É deliberado: um total
parcial parece completo e **subestima** o que a pessoa tem. Quando vier `null`,
exiba a lista por ativo em vez de um total.

**`stale: true`** significa que algum preço usado está mais velho do que
garantimos — vale indicar na tela que o valor pode estar defasado. Preço de
`priceSource: "STATIC"` vem sempre marcado assim, porque é constante de
configuração e não cotação de mercado.

**`priceSource`** pode ser `REFLECTOR`, `STATIC`, `MIXED` ou `null`.

Vault em que o usuário não tem nada é omitido de `positions`.

Uma observação de desempenho: essa rota faz numa chamada o que o
`useAllVaultBalances` faz em N, e é a maior fonte de leitura da DeFindex na tela
inicial. Vale trocar lá.

---

## 11. Autenticação

Três comportamentos diferentes, e a diferença importa:

| Rotas | Como o usuário é resolvido |
|---|---|
| `/conversions/*`, `/wallets/:id/trustlines*`, `/deposits/from-conversion`, `/vaults/:id/disclosure*` | **Derivado do token.** O `userId` que o interceptor injeta é ignorado |
| `/deposits`, `/withdrawals`, `/vaults` | Do `userId` enviado, como sempre |
| `/app-config/assets`, `/app-config/version` | Públicas |

As do primeiro grupo movem fundo ou registram consentimento, então token válido
de um usuário não pode alcançar a conta de outro. **Elas não aceitam
`x-admin-key`** — só Bearer do Privy. Não dá para testá-las com curl e chave de
admin.

---

## 12. Problemas conhecidos no app

Levantados ao mapear a integração. Nenhum é novo, mas os vaults de EURC e XLM
tornam todos visíveis.

**`findUsdcBalance` trava o depósito de qualquer vault.**
`lib/api/wallets.ts:32-35` faz `balances.find(b => b.asset.startsWith('USDC:'))`,
e o `DepositModal` usa isso para habilitar o botão de confirmar em **todo** vault.
Hoje: quem tem EURC e não tem USDC não consegue confirmar; quem tem USDC passa e
falha na rede. É o bloqueador número um — nada funciona em EURC ou XLM antes
dele.

Trocar por um `findAssetBalance(balances, asset)` que trate `CODE:ISSUER` **e** a
string nua `'XLM'`.

**`$` fixo em cinco lugares.** `DepositModal` (chips de `QUICK_VALUES`,
`styles.amountDollar`, "Disponível na carteira", "Rende cerca de", tela de
sucesso), `WithdrawModal`, `VaultFeatured`, `ActiveVaultRow` e
`formatTvlForMode`. Usar `displayPrefix`/`displaySuffix` do registry.

**`t('asset.symbol')` devolve `"USD"` literal no Lite.** `lib/copy/terms.ts:46`.
Com três ativos isso passa a estar errado em dois terços dos casos. Usar
`liteSymbol`/`liteName` do registry.

**`formatVaultNameForMode` colapsa qualquer nome com "pig".**
`lib/utils/format.ts` devolve a string fixa `"Porquinho do PigFi"` para qualquer
nome que contenha "pig". Com um vault só funcionava; o vault atual em produção
chama-se `PigFi` justamente para cair aí. Com três, qualquer nome com "pig" fica
indistinguível. Os nomes novos (`Porquinho EURC`, `Porquinho XLM`) evitam a
colisão, mas o Lite os renderiza com cada palavra capitalizada.

**`vaults[0]` como "o vault"** em `app/(tabs)/index.tsx:186`,
`app/(tabs)/vaults.tsx:264` e `components/ui/GiftClaimSheet.tsx:106`. Usar
`isFeatured`.

**`totalInvested` soma moedas diferentes.** `app/(tabs)/index.tsx:189-196` soma
`underlyingBalance[0]` de todos os vaults como se fossem a mesma moeda, e esse
total dirige os limiares de nível do porquinho (500/1000/5000). Com USDC, EURC e
XLM juntos o número não significa nada.

**Resolvido no backend:** use `GET /portfolio/summary` (seção 10) em vez de somar
no cliente. O nível do porquinho deve rodar sobre `totalUsd`.

Um cuidado: quando `totalUsd` vier `null`, não calcule um nível — mantenha o que
já está em `lastSeenPigLevelByWallet`. Derivar nível de um total incompleto faria
o porquinho regredir sozinho quando o oráculo estivesse fora.

**Dupla normalização.** `lib/api/vaults.ts` normaliza `dfTokens` e
`app/vault/[id].tsx` normaliza de novo. Resolve-se migrando para `sharesAsset`.

**Arquivos mortos a remover.** `app/vault/[id]/deposit.tsx` e `withdraw.tsx` são
telas vivas e roteáveis dizendo "Em breve — depósito via WalletConnect".
`lib/stellar/swap.ts` é código morto, na direção errada (strict-receive XLM→USDC),
sem folga de slippage e pagando a própria fee — a conversão agora é server-side.
`docs/architecture.md:78` do app documenta esse arquivo como capacidade viva.

---

## Como rodar o backend local

```bash
cd pigfi-backend
git checkout feat/vault-registry-disclosures
docker compose up -d postgres
npx prisma migrate deploy && npx prisma generate
npm run start:dev
```

Para o app apontar nele, `EXPO_PUBLIC_API_URL` precisa de um endereço que o
device alcance — IP da LAN ou túnel. O Privy exige dev client, então o teste é
sempre em device, não no Expo Go.

O ambiente de dev usa **mainnet** (`DEFINDEX_NETWORK=mainnet`): é onde os vaults
existem, onde há liquidez de DEX e onde a BlindPay entrega USDC de verdade. O
testnet da DeFindex tem endpoints quebrados.
