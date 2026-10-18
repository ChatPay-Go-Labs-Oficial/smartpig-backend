-- AlterTable
ALTER TABLE "portfolio_snapshots" ADD COLUMN     "assetSymbol" TEXT,
ADD COLUMN     "priceSource" TEXT,
ADD COLUMN     "priceUsd" DECIMAL(20,8),
ADD COLUMN     "shareAmount" DECIMAL(30,8);

-- CreateTable
CREATE TABLE "asset_price_snapshots" (
    "id" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "priceUsd" DECIMAL(20,8) NOT NULL,
    "source" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_price_snapshots_assetSymbol_capturedAt_idx" ON "asset_price_snapshots"("assetSymbol", "capturedAt");
