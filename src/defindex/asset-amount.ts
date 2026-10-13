import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export const DEFINDEX_SHARE_DECIMALS = 7;

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

/**
 * Raw contract units to a decimal string in whole asset units.
 *
 * The inverse of {@link toAssetUnits}, and the only place the conversion should
 * happen. Returns a string, not a number: a balance is money, and `number` loses
 * precision past 2^53 while `0.1 + 0.2` is the classic way to misreport one.
 *
 * Only the backend knows an asset's decimals, which is why normalizing here —
 * rather than in the client — is what let the app stop hardcoding 7.
 */
export function fromAssetUnits(
  units: number | string | bigint,
  assetDecimals: number,
): string {
  if (!Number.isInteger(assetDecimals) || assetDecimals < 0) {
    throw new BadRequestException('Asset decimals configuration is invalid');
  }

  const raw = new Decimal(String(units));
  if (!raw.isInteger()) {
    throw new BadRequestException(
      `Raw amount ${String(units)} is not an integer number of units`,
    );
  }

  return raw.div(new Decimal(10).pow(assetDecimals)).toFixed(assetDecimals);
}
