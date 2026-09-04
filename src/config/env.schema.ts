import * as Joi from 'joi';

export const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),

  // JWT — required from Phase 3 onwards; warn early if missing
  JWT_ACCESS_SECRET: Joi.string().default('change-me'),
  JWT_ACCESS_EXPIRATION: Joi.number().default(900),
  JWT_REFRESH_EXPIRATION: Joi.number().default(2592000),

  // Google OAuth
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),

  // Apple Sign-In
  APPLE_CLIENT_ID: Joi.string().optional(),
  APPLE_TEAM_ID: Joi.string().optional(),
  APPLE_KEY_ID: Joi.string().optional(),
  APPLE_PRIVATE_KEY: Joi.string().optional(),

  // DeFindex
  DEFINDEX_API_KEY: Joi.string().optional(),
  DEFINDEX_BASE_URL: Joi.string().uri().optional(),
  DEFINDEX_TIMEOUT_MS: Joi.number().default(10000),
  DEFINDEX_VAULT_INFO_CACHE_TTL_MS: Joi.number().min(0).default(300000),
  DEFINDEX_NETWORK: Joi.string().valid('testnet', 'mainnet').default('testnet'),

  // Redis
  REDIS_URL: Joi.string().optional(),

  // BlindPay
  BLINDPAY_API_KEY: Joi.string().optional(),
  BLINDPAY_INSTANCE_ID: Joi.string().optional(),
  BLINDPAY_BASE_URL: Joi.string().uri().optional(),
  BLINDPAY_WEBHOOK_SECRET: Joi.string().optional(),
  BLINDPAY_TOKEN: Joi.string().optional(),
  BLINDPAY_PARTNER_FEE_ID: Joi.string().optional(),

  // Etherfuse
  ETHERFUSE_API_KEY: Joi.string().optional(),
  ETHERFUSE_BASE_URL: Joi.string().uri().optional(),
  ETHERFUSE_WEBHOOK_SECRET: Joi.string().optional(),

  // Stellar
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),
  STELLAR_USDC_ASSET_CODE: Joi.string().default('USDC'),
  STELLAR_USDC_ISSUER: Joi.string().required(),
  STELLAR_TESOURO_ASSET_CODE: Joi.string().optional(),
  STELLAR_TESOURO_ISSUER: Joi.string().optional(),
  STELLAR_FEE_BUMP_BASE_FEE: Joi.number().integer().min(100).default(500),
  STELLAR_FEE_BUMP_MULTIPLIER: Joi.number().min(1).default(2),

  // Privy — wallet-based auth (required)
  PRIVY_APP_ID: Joi.string().required(),
  PRIVY_APP_SECRET: Joi.string().required(),

  // Treasury — sponsored Stellar account activation
  TREASURY_STELLAR_SECRET: Joi.string().required(),

  // Gifts — claimable-balance gifting
  GIFT_CLAIM_AGENT_SECRET: Joi.string().optional(),
  // Comma-separated founder emails; empty/absent = gifting enabled for everyone
  GIFT_ALLOWED_EMAILS: Joi.string().optional(),
  GIFT_MIN_USD: Joi.number().min(0).default(1),
  GIFT_MAX_USD: Joi.number().min(1).default(100),
  GIFT_EXPIRY_DAYS: Joi.number().integer().min(1).default(7),
  GIFT_MAX_PENDING_PER_USER: Joi.number().integer().min(1).default(5),

  // Admin API Key for administrative routes
  ADMIN_API_KEY: Joi.string().optional(),

  // Vaults
  ALLOWED_VAULT_IDS: Joi.string().default(''),

  // Account deletion
  ACCOUNT_DELETION_DUST_USD: Joi.number().min(0).default(0.01),
});
