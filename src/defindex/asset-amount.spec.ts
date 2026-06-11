import { BadRequestException } from '@nestjs/common';
import { toAssetUnits } from './asset-amount';

describe('toAssetUnits', () => {
  it.each([
    ['2', 20_000_000],
    ['2.50', 25_000_000],
    ['0.0000001', 1],
  ])('converts %s USDC to minimum units', (amount, expected) => {
    expect(toAssetUnits(amount, 7)).toBe(expected);
  });

  it('rejects precision beyond the asset decimals', () => {
    expect(() => toAssetUnits('2.00000001', 7)).toThrow(BadRequestException);
  });

  it('rejects zero amounts', () => {
    expect(() => toAssetUnits('0', 7)).toThrow(BadRequestException);
  });

  it('rejects amounts outside the SDK safe integer range', () => {
    expect(() => toAssetUnits('900719925.4740992', 7)).toThrow(
      BadRequestException,
    );
  });
});
