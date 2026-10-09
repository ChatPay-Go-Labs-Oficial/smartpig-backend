import { Injectable, Logger } from '@nestjs/common';
import { DefindexService } from './defindex.service';
import {
  DEFINDEX_SHARE_DECIMALS,
  fromAssetUnits,
  toAssetUnits,
} from './asset-amount';
import type {
  NormalizedPosition,
  NormalizedVaultInfo,
  PrepareDepositRequest,
  PrepareWithdrawRequest,
  PreparedTx,
  SubmitResult,
  VaultAdapter,
  VaultRef,
} from './vault-adapter.port';

export const DEFINDEX_PROTOCOL = 'DEFINDEX';

/**
 * How DeFindex answers a balance read on a vault whose total supply is zero.
 *
 * The contract derives a holder's underlying amount from a ratio against total
 * supply, so an empty vault makes that simulation fail instead of returning zero.
 * Semantically the answer is unambiguous — no supply means no position — and a
 * freshly created vault is exactly the case the app hits first, since the vault
 * list fans a balance read across every vault it shows.
 */
const EMPTY_VAULT_ERROR = /AmountOverTotalSupply/i;

/**
 * The DeFindex implementation of {@link VaultAdapter}.
 *
 * A thin layer over `DefindexService` on purpose: the retry policy, the
 * `getVaultInfo` TTL cache and in-flight de-duplication, and the error mapping
 * all stay there. What this class adds is the normalization — raw contract units
 * in, whole units out — and a protocol-shaped surface the services can depend on
 * without knowing DeFindex exists.
 */
@Injectable()
export class DefindexVaultAdapter implements VaultAdapter {
  readonly protocol = DEFINDEX_PROTOCOL;
  private readonly logger = new Logger(DefindexVaultAdapter.name);

  constructor(private readonly defindex: DefindexService) {}

  async getInfo(ref: VaultRef): Promise<NormalizedVaultInfo> {
    const info = await this.defindex.getVaultInfo(ref.contractId);

    return {
      contractId: ref.contractId,
      name: info.name,
      symbol: info.symbol,
      assetSymbol: info.assetSymbol,
      // DeFindex reports TVL in raw units of the primary asset.
      tvl:
        info.tvl === null ? null : fromAssetUnits(info.tvl, ref.assetDecimals),
      apy: info.apy ?? null,
      roles: info.roles,
      fees: info.fees,
      strategies: (info.assets ?? []).flatMap((asset) =>
        (asset.strategies ?? []).map((s) => ({
          contractId: s.address,
          name: s.name,
          paused: s.paused,
        })),
      ),
    };
  }

  async getPosition(
    ref: VaultRef,
    account: string,
  ): Promise<NormalizedPosition> {
    const balance = await this.readBalance(ref, account);

    return {
      // Shares are always 7 decimals, independent of the underlying asset.
      shares: fromAssetUnits(balance.dfTokens, DEFINDEX_SHARE_DECIMALS),
      underlying: (balance.underlyingBalance ?? []).map((amount) =>
        fromAssetUnits(amount, ref.assetDecimals),
      ),
      // Kept so the published app, which normalizes client-side, is unaffected.
      raw: {
        dfTokens: balance.dfTokens,
        underlyingBalance: balance.underlyingBalance ?? [],
      },
    };
  }

  async getApy(ref: VaultRef): Promise<number | null> {
    const { apy } = await this.defindex.getVaultApy(ref.contractId);
    return apy ?? null;
  }

  async prepareDeposit(req: PrepareDepositRequest): Promise<PreparedTx> {
    const { vault, callerAddress, amount, slippageBps } = req;

    // Single-element array: a one-asset vault. `amounts` is positional, one entry
    // per vault asset, so a multi-asset vault would need every amount supplied
    // here — which nothing upstream models today.
    const { xdr } = await this.defindex.generateDepositXdr({
      vaultAddress: vault.contractId,
      callerAddress,
      amounts: [toAssetUnits(amount, vault.assetDecimals)],
      slippageBps,
    });

    return { xdr };
  }

  async prepareWithdraw(req: PrepareWithdrawRequest): Promise<PreparedTx> {
    const { vault, callerAddress, shares, slippageBps } = req;

    const { xdr } = await this.defindex.generateWithdrawXdr({
      vaultAddress: vault.contractId,
      callerAddress,
      shareAmount: toAssetUnits(shares, DEFINDEX_SHARE_DECIMALS),
      slippageBps,
    });

    return { xdr };
  }

  /**
   * Reads a balance, translating "the vault is empty" into a zero position.
   *
   * Deliberately narrow: only this one documented error, and only on this read.
   * Everything else propagates, because a vault we cannot reach must not be shown
   * to the user as a vault they hold nothing in.
   */
  private async readBalance(
    ref: VaultRef,
    account: string,
  ): Promise<{
    dfTokens: number | string;
    underlyingBalance: (number | string)[];
  }> {
    try {
      return await this.defindex.getVaultBalance(ref.contractId, account);
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (EMPTY_VAULT_ERROR.test(message)) {
        this.logger.debug(
          `Vault ${ref.id} has no supply yet; reporting an empty position`,
        );
        return { dfTokens: 0, underlyingBalance: [] };
      }
      throw err;
    }
  }

  async submit(signedXdr: string): Promise<SubmitResult> {
    const result = await this.defindex.submitSignedTransaction({
      xdr: signedXdr,
    });
    return { txHash: result.txHash, success: result.success };
  }
}
