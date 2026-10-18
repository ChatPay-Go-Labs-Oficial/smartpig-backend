import { BadRequestException } from '@nestjs/common';
import { fromAssetUnits, toAssetUnits } from './asset-amount';

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

describe('fromAssetUnits', () => {
  it('converts raw units to whole units at 7 decimals', () => {
    expect(fromAssetUnits(483895863729, 7)).toBe('48389.5863729');
  });

  it('pads to the asset precision, so the string is stable to compare', () => {
    expect(fromAssetUnits(10_000_000, 7)).toBe('1.0000000');
  });

  it('handles zero', () => {
    expect(fromAssetUnits(0, 7)).toBe('0.0000000');
  });

  it('accepts a string, which is how the API reports managed funds', () => {
    expect(fromAssetUnits('500980675724', 7)).toBe('50098.0675724');
  });

  it('accepts a bigint without losing precision', () => {
    // 190179051599843 raw is the Meru vault's TVL; number handles it, but the
    // next order of magnitude would not.
    expect(fromAssetUnits(190179051599843n, 7)).toBe('19017905.1599843');
  });

  it('keeps precision past what a float could hold', () => {
    expect(fromAssetUnits('9007199254740993', 7)).toBe('900719925.4740993');
  });

  it('round-trips with toAssetUnits', () => {
    expect(fromAssetUnits(toAssetUnits('42.5', 7), 7)).toBe('42.5000000');
  });

  it('works at other precisions', () => {
    expect(fromAssetUnits(123456, 6)).toBe('0.123456');
    expect(fromAssetUnits(42, 0)).toBe('42');
  });

  it('rejects a fractional raw amount', () => {
    expect(() => fromAssetUnits('1.5', 7)).toThrow(
      /not an integer number of units/,
    );
  });

  it('rejects invalid decimals', () => {
    expect(() => fromAssetUnits(1, -1)).toThrow(/Asset decimals/);
    expect(() => fromAssetUnits(1, 1.5)).toThrow(/Asset decimals/);
  });
});
