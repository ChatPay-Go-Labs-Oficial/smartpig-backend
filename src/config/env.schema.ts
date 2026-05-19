import * as Joi from 'joi';

export const envSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().required().min(32),
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
  DEFINDEX_NETWORK: Joi.string().valid('testnet', 'mainnet').default('testnet'),

  // Redis
  REDIS_URL: Joi.string().optional(),

  // BlindPay
  BLINDPAY_API_KEY: Joi.string().optional(),
  BLINDPAY_INSTANCE_ID: Joi.string().optional(),
  BLINDPAY_BASE_URL: Joi.string().uri().optional(),
  BLINDPAY_WEBHOOK_SECRET: Joi.string().optional(),
  BLINDPAY_TOKEN: Joi.string().optional(),

  // Etherfuse
  ETHERFUSE_API_KEY: Joi.string().optional(),
  ETHERFUSE_BASE_URL: Joi.string().uri().optional(),
  ETHERFUSE_WEBHOOK_SECRET: Joi.string().optional(),

  // Vaults
  ALLOWED_VAULT_IDS: Joi.string().default(''),
});
