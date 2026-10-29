import * as Joi from 'joi';

export const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),

  // JWT legado. `JWT_ACCESS_SECRET` foi removido: nao era lido em lugar nenhum
  // (a autenticacao e 100% Privy) e carregava o default 'change-me', que vira um
  // segredo fraco conhecido no dia em que alguem religar a chave sem notar.
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

  /// Replaces the built-in asset registry entirely. Lets an asset be added on
  /// Railway without a deploy. Validated at boot; malformed config stops startup.
  STELLAR_ASSETS_JSON: Joi.string().allow('').optional(),

  /// Soroban RPC, required to read the Reflector oracle. Without it pricing falls
  /// back to STATIC, so the mode always describes what will actually happen.
  STELLAR_SOROBAN_RPC_URL: Joi.string().uri().optional(),
  /// `REFLECTOR` reads the oracle. `STATIC` uses PRICING_STATIC_USD, which is an
  /// explicit escape hatch rather than a silent fallback: a configured constant
  /// presented as a market price is worse than no price.
  PRICING_MODE: Joi.string().valid('REFLECTOR', 'STATIC').default('REFLECTOR'),
  /// `USDC=1,EURC=1.12,XLM=0.19`
  PRICING_STATIC_USD: Joi.string().allow('').default(''),
  /// Any funded account; a simulation never charges or signs it.
  REFLECTOR_SIMULATION_SOURCE: Joi.string().optional(),

  /// `DEX` uses a classic path payment against the Stellar order book. `DISABLED`
  /// leaves a vault listed and withdrawable with deposits paused, which is the
  /// honest degradation when a pair has no usable market.
  CONVERSION_MODE: Joi.string().valid('DEX', 'DISABLED').default('DEX'),
  STELLAR_HORIZON_TIMEOUT_MS: Joi.number().integer().min(1000).default(15000),

  // Vaults
  // Keep disabled during the staged rollout: the new app collects acknowledgments,
  // while installed legacy builds can still deposit. Enable only after every active
  // non-USDC vault has a published disclosure and the compatible app is mandatory.
  ENFORCE_VAULT_DISCLOSURE: Joi.boolean().default(false),
  // Evaluate and expose education eligibility during rollout, but keep legacy
  // deposits open until the compatible clients and policies are published.
  ENFORCE_VAULT_EDUCATION: Joi.boolean().default(false),
  LEARNING_INTRO_MODULE_COMPLETION_XP: Joi.number()
    .integer()
    .min(0)
    .default(45),
  EXPERIENCE_DAILY_REWARD_XP: Joi.number().integer().min(1).default(3),
  // `allow('')` is load-bearing: Joi.string() rejects an empty string, and
  // `.default('')` only applies when the key is absent. Without it, the documented
  // "empty means no allowlist" could only be expressed by deleting the variable —
  // setting it empty refused to boot. That is the migration path once the registry
  // is authoritative, so it has to be expressible.
  ALLOWED_VAULT_IDS: Joi.string().allow('').default(''),

  // Account deletion
  ACCOUNT_DELETION_DUST_USD: Joi.number().min(0).default(0.01),
  // Depois disso a solicitação vira FAILED e pede investigação manual.
  ACCOUNT_DELETION_MAX_CLEANUP_RETRIES: Joi.number()
    .integer()
    .min(1)
    .default(10),

  // Push notifications (Expo Push Service). Opcional: sem token o Expo aceita o
  // envio; com "Enhanced Push Security" ligado no projeto Expo ele passa a ser
  // obrigatório.
  EXPO_ACCESS_TOKEN: Joi.string().optional(),
  // Liga/desliga os jobs de envio e de receipts sem precisar de deploy.
  PUSH_DISPATCH_ENABLED: Joi.boolean().default(true),
});
