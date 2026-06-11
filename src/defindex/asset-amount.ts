import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export function toAssetUnits(
  amount: Decimal | string,
  assetDecimals: number,
): number {
  if (!Number.isInteger(assetDecimals) || assetDecimals < 0) {
    throw new BadRequestException('Asset decimals configuration is invalid');
  }

  const decimalAmount = new Decimal(amount);

  if (decimalAmount.lte(0)) {
    throw new BadRequestException('Deposit amount must be greater than zero');
  }

  const scaledAmount = decimalAmount.mul(new Decimal(10).pow(assetDecimals));

  if (!scaledAmount.isInteger()) {
    throw new BadRequestException(
      `Deposit amount supports at most ${assetDecimals} decimal places`,
    );
  }

  const units = scaledAmount.toNumber();
  if (!Number.isSafeInteger(units)) {
    throw new BadRequestException('Deposit amount is too large');
  }

  return units;
}
