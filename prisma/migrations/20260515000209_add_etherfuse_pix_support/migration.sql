-- AlterTable
ALTER TABLE "etherfuse_bank_accounts" ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" TEXT,
ADD COLUMN     "rail" TEXT NOT NULL DEFAULT 'spei',
ALTER COLUMN "clabe" DROP NOT NULL;
