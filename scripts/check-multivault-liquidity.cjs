/* Read-only: DeFindex strategy data and SAC.balance(pool) RPC simulations.
 * No credentials, signatures, funded accounts, or submitted transactions.
 * Run: node scripts/check-multivault-liquidity.cjs
 */
const S = require('@stellar/stellar-sdk');
const strategyUrl = 'https://www.defindex.io/api/strategies';
const rpcUrl = 'https://soroban-rpc.mainnet.stellar.gateway.fm';
const pool = 'CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD';
const strategies = {
  USDC: 'CDB2WMKQQNVZMEBY7Q7GZ5C7E7IAFSNMZ7GGVD6WKTCEWK7XOIAVZSAP',
  EURC: 'CC5CE6MWISDXT3MLNQ7R3FVILFVFEIH3COWGH45GJKL6BD2ZHF7F7JVI',
  XLM: 'CDPWNUW7UMCSVO36VAJSQHQECISPJLCVPDASKHRC5SEROAAZDUQ5DG2Z',
};
function units(raw, decimals) {
  const digits = BigInt(raw).toString().padStart(decimals + 1, '0');
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
async function main() {
  const response = await fetch(strategyUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`DeFindex HTTP ${response.status}`);
  const { data } = await response.json();
  const rows = await Promise.all(Object.entries(strategies).map(async ([symbol, address]) => {
    const strategy = data.find((row) => row.address === address);
    if (!strategy) throw new Error(`DeFindex did not return ${symbol} strategy ${address}`);
    const tx = new S.TransactionBuilder(new S.Account(S.Keypair.random().publicKey(), '0'), { fee: '100', networkPassphrase: S.Networks.PUBLIC })
      .addOperation(new S.Contract(strategy.asset).call('balance', new S.Address(pool).toScVal())).setTimeout(60).build();
    const response = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ jsonrpc: '2.0', id: symbol, method: 'simulateTransaction', params: { transaction: tx.toXDR() } }),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const simulation = await response.json();
    if (simulation.error || simulation.result?.error || !simulation.result?.results?.[0]?.xdr) throw new Error(JSON.stringify(simulation.error ?? simulation.result?.error ?? 'Missing balance result'));
    const balance = String(S.scValToNative(S.xdr.ScVal.fromXDR(simulation.result.results[0].xdr, 'base64')));
    return { symbol, strategy: address, asset: strategy.asset, decimals: strategy.assetDecimals, strategyTvlAssetUnits: units(strategy.tvl, strategy.assetDecimals), apy7dPercent: strategy.apy7d, poolBalanceAtomic: balance, poolBalanceAssetUnits: units(balance, strategy.assetDecimals), ledger: simulation.result.latestLedger };
  }));
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), network: 'mainnet', strategyUrl, rpcUrl, pool, basis: 'DeFindex strategy API plus read-only SAC.balance(pool) simulations. Pool cash balance is not a guaranteed vault withdrawal limit; no withdrawal or swap was executed.', rows }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
