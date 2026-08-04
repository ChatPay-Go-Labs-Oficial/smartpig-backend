-- CreateEnum
CREATE TYPE "BlindPayKycStatus" AS ENUM ('VERIFYING', 'APPROVED', 'REJECTED', 'COMPLIANCE_REQUEST', 'APPROVED_RFI');

-- AlterTable
ALTER TABLE "blindpay_receivers"
    ADD COLUMN "tosId" TEXT,
    ADD COLUMN "kycStatus" "BlindPayKycStatus" NOT NULL DEFAULT 'VERIFYING',
    ADD COLUMN "kycWarnings" JSONB,
    ADD COLUMN "rejectionReason" TEXT,
    ADD COLUMN "kycUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "blindpay_kyc_attempts" (
    "id" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "blindpayReceiverId" TEXT NOT NULL,
    "kycStatus" "BlindPayKycStatus" NOT NULL,
    "rejectionReason" TEXT,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blindpay_kyc_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blindpay_kyc_attempts_receiverId_idx" ON "blindpay_kyc_attempts"("receiverId");

-- CreateIndex
CREATE INDEX "blindpay_receivers_blindpayReceiverId_idx" ON "blindpay_receivers"("blindpayReceiverId");

-- AddForeignKey
ALTER TABLE "blindpay_kyc_attempts" ADD CONSTRAINT "blindpay_kyc_attempts_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "blindpay_receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
