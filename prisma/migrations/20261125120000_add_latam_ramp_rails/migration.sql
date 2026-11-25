-- AlterTable
ALTER TABLE "blindpay_receivers" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'BR';

-- AlterTable
ALTER TABLE "blindpay_bank_accounts" ADD COLUMN     "details" JSONB;

-- AlterTable
ALTER TABLE "onramp_transactions" ADD COLUMN     "fiatCurrency" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN     "paymentInstructions" JSONB;

-- AlterTable
ALTER TABLE "offramp_transactions" ADD COLUMN     "fiatCurrency" TEXT NOT NULL DEFAULT 'BRL';

