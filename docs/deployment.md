# Deployment Guide

This document covers Railway deployment, database migration management, and the one-time baseline procedure required for an existing PostgreSQL database that has no Prisma migration history.

## Container startup

The `Dockerfile` starts the app with:

```
CMD ["node", "dist/main"]
```

Migrations are **not** run automatically on container startup. This prevents the container from hard-failing with Prisma error **P3005** when the target database already has tables but no `_prisma_migrations` history.

Run migrations intentionally using one of the methods described below.

---

## Running migrations intentionally

### Option 1 — npm script (local or CI)

```bash
npm run migrate:deploy
```

This executes `prisma migrate deploy` against the database specified by `DATABASE_URL`.

### Option 2 — combined start (for environments where migration history is already correct)

```bash
npm run start:migrate
```

This runs `prisma migrate deploy && node dist/main`. Use this only after you have confirmed that all existing migrations are properly baselined (see below).

### Option 3 — Railway one-off command

In the Railway dashboard, open **Settings → Deploy → Start Command** and temporarily override it to:

```
npx prisma migrate deploy && node dist/main
```

Revert to the default after the migration run.

---

## One-time baseline procedure for an existing database

If the production database already has tables created outside of Prisma (or from a time before `prisma migrate` was used), the `_prisma_migrations` table will be missing or empty. Running `prisma migrate deploy` against such a database exits with **P3005**.

You must baseline the database by marking each existing migration as already applied **before** running `migrate deploy` again.

### Step 1 — check migration status

```bash
DATABASE_URL="<your-production-url>" npx prisma migrate status
```

This shows which migrations are pending. If the output says the migration table does not exist or all migrations are unapplied, proceed with the baseline.

### Step 2 — mark each migration as applied

Run the following commands against the **production** database in order. Only mark a migration as applied if the corresponding schema changes are already present in the database.

```bash
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260508140745_init
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260509151728_add_managed_vault
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260511192329_add_description_to_managed_vault
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260512140440_add_blindpay_ramp
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260512182558_make_blockchain_wallet_address_optional
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260512182614_make_blockchain_wallet_address_optional
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260512183303_make_blockchain_wallet_address_required_again
DATABASE_URL="<your-production-url>" npx prisma migrate resolve --applied 20260513182027_make_user_email_optional
```

> **Important:** If production does not yet include the changes from some of the later migrations (e.g. the `add_blindpay_ramp` changes were never applied), stop at the last migration that is already reflected in the database and let `prisma migrate deploy` apply the rest.

### Step 3 — verify and redeploy

```bash
DATABASE_URL="<your-production-url>" npx prisma migrate status
```

All previously applied migrations should now show as **Applied**. Redeploy the service; Railway will start the container and run `node dist/main` without attempting any migration.

To apply any remaining new migrations, run:

```bash
npm run migrate:deploy
```

or use the Railway one-off command described above.

---

## Normal migration workflow (after baselining)

For every schema change going forward:

1. Edit `prisma/schema.prisma`.
2. Generate and test the migration locally:
   ```bash
   npx prisma migrate dev --name <descriptive_name>
   ```
3. Commit the new migration folder to the repository.
4. After deploying the new image, run the migration against production:
   ```bash
   npm run migrate:deploy
   ```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `PORT` | HTTP port (default `3000`) |

See `.env.example` for the full list of required variables.
