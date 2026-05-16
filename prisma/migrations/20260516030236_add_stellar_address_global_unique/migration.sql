/*
  Warnings:

  - A unique constraint covering the columns `[stellarAddress]` on the table `wallet_accounts` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "wallet_accounts_userId_stellarAddress_key";

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_stellarAddress_key" ON "wallet_accounts"("stellarAddress");
