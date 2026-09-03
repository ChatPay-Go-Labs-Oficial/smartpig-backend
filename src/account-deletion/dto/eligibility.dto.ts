/** Blocker codes, mirroring B-1..B-11 in the business rules. */
export type BlockerCode =
  | 'VAULT_BALANCE'
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

export interface Blocker {
  code: BlockerCode;
  title: string;
  detail: string;
  /** false tells the app not to offer an action button — nothing the user can do but wait. */
  resolvable: boolean;
  action: BlockerAction | null;
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
