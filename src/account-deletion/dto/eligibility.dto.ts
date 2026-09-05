/** Blocker codes, mirroring B-1..B-11 in the business rules. */
export type BlockerCode =
  | 'VAULT_BALANCE'
  | 'VAULT_BALANCE_UNKNOWN'
  | 'WALLET_USDC_BALANCE'
  | 'WALLET_ASSET_BALANCE'
  | 'GIFT_LOCKED'
  | 'GIFT_REFUNDABLE'
  | 'DEPOSIT_IN_FLIGHT'
  | 'WITHDRAWAL_IN_FLIGHT'
  | 'TX_PENDING'
  | 'ONRAMP_IN_FLIGHT'
  | 'OFFRAMP_IN_FLIGHT'
  | 'ETHERFUSE_ORDER_IN_FLIGHT';

export type BlockerActionType =
  | 'WITHDRAW_VAULT'
  | 'WITHDRAW_WALLET'
  | 'OPEN_GIFTS'
  | 'OPEN_RAMP';

export interface BlockerAction {
  type: BlockerActionType;
  vaultId?: string;
}

/**
 * Everything the app needs to write the sentence itself.
 *
 * Amounts are decimal strings in whole units, unformatted: the client decides how
 * many decimals to show and which separator to use.
 */
export interface BlockerParams {
  amountUsd?: string;
  assetCode?: string;
  vaultId?: string;
  vaultName?: string;
  /** ISO date from which a locked gift can be reclaimed. */
  availableAt?: string;
}

/**
 * A reason the account cannot be deleted.
 *
 * Carries no display copy on purpose. The app writes the sentence, because the
 * wording depends on the Lite/Pro mode the user chose — the same balance is "no
 * porquinho" for one and "no vault" for the other, and only the client knows which.
 * A `detail` string baked here would be wrong for half the users.
 */
export interface Blocker {
  code: BlockerCode;
  /**
   * `false` means there is nothing the user can do but wait, and the app must not
   * offer an action button.
   */
  resolvable: boolean;
  action: BlockerAction | null;
  params?: BlockerParams;
}

export interface VaultShareResidual {
  vaultId: string;
  amount: string;
}

export interface WalletAssetResidual {
  assetId: string;
  amount: string;
}

export interface Residuals {
  /** USDC left in the wallet, at or below the dust threshold. */
  walletUsdc: string;
  /** Other configured assets left in the wallet, at or below the dust threshold. */
  walletAssets: WalletAssetResidual[];
  /** Vault shares too small to withdraw. Lost for good — they live in Soroban storage. */
  vaultShares: VaultShareResidual[];
  /** Wallet dust, which the closure transaction sweeps so ChangeTrust(0) can pass. */
  sweptToTreasuryUsd: string;
  /** Vault dust, which nothing can reach. */
  permanentlyLostUsd: string;
}

export type EligibilityWarning =
  | 'ONCHAIN_HISTORY_PUBLIC'
  | 'BLINDPAY_RETAINS_KYC'
  | 'PRIVY_WALLET_ARCHIVED';

export interface EligibilityResult {
  eligible: boolean;
  blockers: Blocker[];
  residuals: Residuals;
  warnings: EligibilityWarning[];
}
