# SCF45 — Soroswap, DeFindex e liquidez

Consulta em 25/09/2026. Raven foi usado para descoberta e confirmação do contexto Soroswap/DeFindex; dados operacionais abaixo vieram diretamente da DeFindex e de simulações RPC somente de leitura.

## Soroswap

Sim, o fluxo documentado suporta `assetIn`, `assetOut`, valores em unidades atômicas, rede e `slippageBps`:

`POST /quote` → `POST /quote/build` → assinatura do usuário → `POST /send`.

Usar API key somente no backend. O agregador aceita Soroswap, Phoenix e Aquarius. Solicitar cotação para o par, sentido e valor real, validar impacto de preço/valor mínimo/expiração e manter a mesma wallet como origem e destino. A confirmação do swap deve preceder o depósito; se o depósito falhar, o ativo convertido continua na wallet. Na saída, confirmar resgate, converter para USDC e só então iniciar BlindPay. Não reenviar swaps automaticamente por timeout sem reconciliar o hash.

Fonte atual: https://docs.soroswap.finance/api/quickstart

Não houve teste de cotação autenticada, swap, assinatura ou gasto de fundos. A disponibilidade de rota e seu preço dependem de cada cotação.

## DeFindex vigente

O monorepo antigo paltalabs/defindex foi substituído como referência pelos repositórios `defindex-io`. A documentação atual confirma as três estratégias Blend Autocompound e o pool Fixed:

- https://docs.defindex.io/contract-deployments/index
- https://github.com/defindex-io/stellar-contracts
- https://docs.defindex.io/strategies/blend-autocompound
- https://www.defindex.io/api/strategies

A própria estratégia Blend já utiliza Soroswap para converter recompensas BLND no ativo subjacente. Essa conversão interna de recompensas é distinta do swap da wallet do usuário.

## Snapshot às 14:31:26 UTC / 11:31:26 de Brasília

Ledger RPC: 64612207. Valores em unidades do próprio ativo, não equivalentes em dólares.

| Ativo | TVL da estratégia DeFindex | Saldo do ativo no pool Blend | APY anualizado a partir de 7 dias, retornado pela DeFindex |
|---|---:|---:|---:|
| USDC | 20.174.092,4512792 | 10.349.077,1406918 | 8,44884794% |
| EURC | 61.475,3213706 | 147.531,6427274 | 0,15029968% |
| XLM | 48.495,1160956 | 698.595.137,2449912 | 0,00006815% |

O saldo do pool foi lido por `SAC.balance(pool)` em simulação. Não representa limite de resgate garantido do vault: saques também dependem da posição, do estado do protocolo/estratégia e da simulação da transação específica. TVL da estratégia é uma medida diferente. A API de estratégias não fornece timestamp do indexador; o horário acima é o da consulta, e não uma garantia de atualização do TVL/APY no mesmo ledger.

O APY observado de XLM é muito baixo. A proposta atual de XLM deve ser exposição voluntária ao ativo com aprendizado, sem anunciar rendimento equivalente ao USDC. EURC é diversificação cambial; o rendimento observado também foi inferior ao USDC.

Pool: `CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD`.

Dados brutos, contratos e fontes: [multivault-liquidity-2026-09-25.json](multivault-liquidity-2026-09-25.json).

Reproduzir: `node scripts/check-multivault-liquidity.cjs`. O script não usa segredos, não assina e não envia transações. Não houve contato humano com a equipe DeFindex; a consulta foi às fontes técnicas e API oficiais.
