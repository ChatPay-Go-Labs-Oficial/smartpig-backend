# Copilot Instructions

## Product

**SmartPig** is a personal finance / investment app with a **React Native** mobile frontend and this **NestJS** backend. The core feature is integrating with **DeFindex** to let users interact with DeFi vaults (list vaults, check APY/balance, deposit, withdraw) without ever exposing their private key to the backend.

The backend sits between the mobile app and DeFindex. It orchestrates operations, enforces auth/validation, stores state, and returns unsigned XDRs to the client for signing.

## Commands

```bash
# Development
npm run start:dev       # watch mode (recommended)
npm run start:debug     # debug + watch mode

# Build
npm run build           # compile to dist/

# Test
npm test                          # unit tests
npm test -- --testPathPattern=app # run a single spec file (e.g. app.controller.spec.ts)
npm run test:e2e                  # e2e tests (test/jest-e2e.json config)
npm run test:cov                  # coverage report

# Lint / Format
npm run lint            # eslint --fix
npm run format          # prettier --write
```

## Architecture

NestJS uses a module-based architecture. Each feature domain should be a self-contained module with:
- `*.module.ts` — declares controllers and providers; imported into `AppModule`
- `*.controller.ts` — route handlers (HTTP layer only)
- `*.service.ts` — business logic, injectable via NestJS DI
- `*.spec.ts` — unit tests co-located with the source file

`AppModule` (`src/app.module.ts`) is the root module. Add new feature modules to its `imports` array.

The server listens on `process.env.PORT` (falls back to `3000`).

### Planned module structure

```
src/
├── auth/            # JWT auth, guards
├── users/           # user account management
├── wallets/         # user wallet addresses
├── defindex/        # DeFindex SDK wrapper (DefindexService, DefindexMapper, DefindexOrchestrator)
├── vaults/          # vault catalog, APY, balance queries
├── portfolio/       # per-user portfolio snapshots
├── deposits/        # deposit intents and XDR generation
├── withdrawals/     # withdrawal intents and XDR generation
├── transactions/    # transaction records and status tracking
├── jobs/            # background jobs (reconciliation, APY sync, snapshots)
├── common/          # shared filters, interceptors, decorators, pipes
├── config/          # ConfigModule setup, env validation
└── infra/           # database, queue, observability providers
```

## DeFindex Integration

### Decisions
- **Use the official `@defindex/sdk`** (not raw REST). It provides full TypeScript typing, handles auth, and abstracts XDR generation. Direct REST is only a fallback if the SDK lacks a needed operation.
- The `DefindexService` wraps the SDK. All DeFindex calls go through it — never call the SDK directly from controllers or other services.
- `DefindexMapper` converts SDK responses into internal domain DTOs.
- `DefindexOrchestrator` coordinates multi-step flows (e.g., create intent → generate XDR → wait for signed XDR → submit).

### XDR / signing flow
The backend **never holds user private keys**. For deposit/withdrawal:
1. Backend calls SDK to generate an unsigned XDR and returns it to the mobile app.
2. The mobile app signs the XDR with the user's wallet.
3. The mobile app sends the signed XDR back to the backend.
4. Backend submits the signed XDR via SDK and updates transaction status.

### Key constraints — never violate these
- `DEFINDEX_API_KEY` lives only in server-side env vars; never sent to the mobile client.
- The backend never stores or handles user private keys.
- All deposit/withdrawal intents must be idempotent (idempotency key on creation).
- Every DeFindex SDK call must have retry logic, timeout, and circuit breaker.
- Audit every sensitive operation in `ApiAuditLog`.

## Domain Entities

| Entity | Purpose |
|---|---|
| `User` | Authenticated app user |
| `WalletAccount` | User's Stellar wallet address(es) |
| `VaultCatalog` | Cached list of DeFindex vaults with metadata |
| `DepositIntent` | A pending/processed deposit operation; holds XDR state |
| `WithdrawalIntent` | A pending/processed withdrawal operation; holds XDR state |
| `TransactionRecord` | Final on-chain transaction result linked to an intent |
| `PortfolioSnapshot` | Point-in-time snapshot of user's vault balances |
| `ApiAuditLog` | Immutable log of all sensitive backend operations |

Intent status flow: `CREATED → XDR_GENERATED → SIGNED_XDR_RECEIVED → SUBMITTED → CONFIRMED | FAILED`

## Security Rules

- Validate all incoming payloads with NestJS `ValidationPipe` + `class-validator`.
- Rate-limit sensitive endpoints (auth, deposit, withdrawal).
- Protect against replay attacks with idempotency keys and nonce/timestamp checks.
- Use structured logging — never log raw XDRs, private keys, or secrets.
- Segregate environments (`dev`, `staging`, `prod`) with separate API keys and databases.
- Use a secrets manager (e.g., AWS Secrets Manager, Vault) in production — not plain `.env` files.

## Database & ORM

- **PostgreSQL** with **Prisma 5** ORM.
- Schema lives in `prisma/schema.prisma`. Always run `npx prisma migrate dev` after schema changes in development.
- Use `PrismaService` (a NestJS injectable at `src/infra/prisma/prisma.service.ts`, extends `PrismaClient`) as the single database access point — never instantiate `PrismaClient` directly in modules.
- `PrismaModule` is `@Global()` — import it once in `AppModule`, then inject `PrismaService` anywhere without re-importing.
- Prisma client is generated to `node_modules/.prisma/client` via `npx prisma generate`.
- Seed script goes in `prisma/seed.ts`; run with `npx prisma db seed`.

## Authentication

**Strategy: Social Login (Google + Apple) → internal JWT (access + refresh tokens)**

Flow:
1. Mobile app performs OAuth with Google or Apple and obtains an ID token.
2. Mobile sends the ID token to `POST /auth/google` or `POST /auth/apple`.
3. Backend verifies the ID token against Google/Apple public keys, upserts a `User` record.
4. Backend issues a short-lived **access token** (JWT, 15 min) and a long-lived **refresh token** (opaque, stored in DB, 30 days).
5. All subsequent requests send `Authorization: Bearer <access_token>`.
6. `POST /auth/refresh` rotates the refresh token (old token invalidated on use).
7. After login, the user links their Stellar **wallet address** via `POST /wallets` — wallet is stored in `WalletAccount`, not used for auth.

Key rules:
- Verify Google ID tokens with `google-auth-library`; verify Apple tokens with Apple's JWKS endpoint.
- Never trust the social profile data without verifying the token signature.
- Refresh tokens are hashed before storage (bcrypt or SHA-256).
- `POST /auth/logout` revokes the refresh token immediately.
- Use `@nestjs/passport` + `passport-jwt` for the JWT guard on protected routes.
- Apple Sign-In is required if the app offers any social login on iOS (App Store rule).

## Key Environment Variables

```
PORT=3000
DATABASE_URL=postgresql://...

# JWT
JWT_ACCESS_SECRET=
JWT_ACCESS_EXPIRATION=900        # seconds (15 min)
JWT_REFRESH_EXPIRATION=2592000   # seconds (30 days)

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Apple Sign-In
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=               # P8 key contents

# DeFindex
DEFINDEX_API_KEY=
DEFINDEX_BASE_URL=
DEFINDEX_TIMEOUT_MS=10000

REDIS_URL=
```

## Conventions

- **Single quotes** and **trailing commas** everywhere (enforced by Prettier).
- Unit test files live in `src/` alongside the source (`*.spec.ts`). E2E tests live in `test/`.
- Jest's `rootDir` is `src/`; test files must match `*.spec.ts` to be picked up by the default `npm test`.
- `noImplicitAny` is disabled — explicit `any` is allowed but `@typescript-eslint/no-explicit-any` is off.
- `emitDecoratorMetadata` and `experimentalDecorators` are enabled — required for NestJS decorators (`@Injectable()`, `@Controller()`, etc.).
- Use NestJS CLI to scaffold new resources: `npx nest g module <name>`, `npx nest g controller <name>`, `npx nest g service <name>`.
