import { classifyFailure } from './failure-classifier';

describe('classifyFailure', () => {
  describe('our own guards, before the network', () => {
    it('recognises the hash pin rejection', () => {
      expect(
        classifyFailure(
          new Error(
            'Signed transaction does not match the generated transaction',
          ),
        ),
      ).toBe('SIGNATURE_MISMATCH');
    });

    it('recognises an unsigned inner transaction', () => {
      expect(
        classifyFailure(new Error('Transaction must be signed by the user')),
      ).toBe('SIGNATURE_MISMATCH');
    });

    it('recognises an expired intent', () => {
      expect(classifyFailure(new Error('Deposit intent abc has expired'))).toBe(
        'INTENT_EXPIRED',
      );
    });
  });

  describe('chain result codes', () => {
    it.each([
      ['op_underfunded', 'INSUFFICIENT_BALANCE'],
      ['tx_insufficient_balance', 'INSUFFICIENT_BALANCE'],
      ['op_no_trust', 'NO_TRUSTLINE'],
      ['op_over_sendmax', 'SLIPPAGE_EXCEEDED'],
      ['op_under_destmin', 'SLIPPAGE_EXCEEDED'],
      ['tx_bad_auth', 'SIGNATURE_MISMATCH'],
    ] as const)('%s classifies as %s', (raw, expected) => {
      expect(classifyFailure(new Error(raw))).toBe(expected);
    });

    it('falls back to CHAIN_REJECTED for an unclassified tx_ code', () => {
      expect(classifyFailure(new Error('tx_failed'))).toBe('CHAIN_REJECTED');
    });

    it('classifies a Soroban host error as a chain rejection', () => {
      expect(
        classifyFailure(
          new Error(
            'Error simulating transaction: HostError: Error(Storage, MissingValue)',
          ),
        ),
      ).toBe('CHAIN_REJECTED');
    });
  });

  describe('transport is not the chain', () => {
    it.each(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'socket hang up'])(
      '%s is UPSTREAM_UNAVAILABLE',
      (raw) => {
        expect(classifyFailure(new Error(raw))).toBe('UPSTREAM_UNAVAILABLE');
      },
    );

    it('reads an axios 503 from the response', () => {
      const err = {
        message: 'Request failed',
        response: { status: 503, data: {} },
      };
      expect(classifyFailure(err)).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('reads the result code out of an axios payload', () => {
      const err = {
        message: 'Request failed with status code 400',
        response: {
          status: 400,
          data: { extras: { result_codes: { operations: ['op_no_trust'] } } },
        },
      };
      expect(classifyFailure(err)).toBe('NO_TRUSTLINE');
    });
  });

  describe('the fallback carries the context the text lacks', () => {
    it('uses it when nothing matches', () => {
      expect(
        classifyFailure(new Error('something odd'), 'XDR_GENERATION_FAILED'),
      ).toBe('XDR_GENERATION_FAILED');
    });

    it('uses it for an empty or absent error', () => {
      expect(classifyFailure(null, 'XDR_GENERATION_FAILED')).toBe(
        'XDR_GENERATION_FAILED',
      );
      expect(classifyFailure(undefined)).toBe('UNKNOWN');
      expect(classifyFailure('')).toBe('UNKNOWN');
    });

    it('does not override a recognised cause', () => {
      // Where it happened matters less than what happened, when we can tell.
      expect(
        classifyFailure(new Error('op_no_trust'), 'XDR_GENERATION_FAILED'),
      ).toBe('NO_TRUSTLINE');
    });
  });

  it('accepts a bare string', () => {
    expect(classifyFailure('op_underfunded')).toBe('INSUFFICIENT_BALANCE');
  });

  it('survives a payload that will not serialize', () => {
    const circular: Record<string, unknown> = { message: 'op_no_trust' };
    circular.self = circular;
    expect(
      classifyFailure({ message: 'op_no_trust', response: { data: circular } }),
    ).toBe('NO_TRUSTLINE');
  });
});
