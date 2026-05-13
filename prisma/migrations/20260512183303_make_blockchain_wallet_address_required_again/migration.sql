/*
  Warnings:

  - Made the column `address` on table `blindpay_blockchain_wallets` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "blindpay_blockchain_wallets" ALTER COLUMN "address" SET NOT NULL;
