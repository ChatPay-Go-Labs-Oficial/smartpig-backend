import { IntentStatus } from '@prisma/client';
import {
  isTerminalState,
  isUserActionable,
  normalizeTransactionState,
  type FailureCode,
} from './transaction-state';

const FUTURE = new Date('2026-12-01T00:00:00.000Z');
const PAST = new Date('2026-01-01T00:00:00.000Z');
const NOW = new Date('2026-10-09T12:00:00.000Z');

function state(
  over: Partial<Parameters<typeof normalizeTransactionState>[0]> = {},
) {
  return normalizeTransactionState({
    status: IntentStatus.XDR_GENERATED,
    expiresAt: FUTURE,
    now: NOW,
    ...over,
  });
}

describe('normalizeTransactionState', () => {
  describe('awaiting the user', () => {
    it.each([IntentStatus.CREATED, IntentStatus.XDR_GENERATED])(
      '%s is PENDING_SIGNATURE while in time',
      (status) => {
        expect(state({ status })).toBe('PENDING_SIGNATURE');
      },
    );

    it.each([IntentStatus.CREATED, IntentStatus.XDR_GENERATED])(
      '%s past expiry is EXPIRED',
      (status) => {
        expect(state({ status, expiresAt: PAST })).toBe('EXPIRED');
      },
    );
  });

  describe('in flight', () => {
    it.each([IntentStatus.SIGNED_XDR_RECEIVED, IntentStatus.SUBMITTED])(
      '%s is PENDING',
      (status) => {
        expect(state({ status })).toBe('PENDING');
      },
    );

    it('reports SUCCESS when the transaction record already confirmed', () => {
      // The reconciliation job confirms the TransactionRecord; the intent row can
      // lag behind it for up to a minute.
      expect(state({ status: IntentStatus.SUBMITTED, txConfirmed: true })).toBe(
        'SUCCESS',
      );
    });

    it('never calls a submitted transaction EXPIRED', () => {
      // Money already moved. Time bounds stop mattering the moment it is on chain,
      // and saying "expired" about a landed deposit would be a lie.
      expect(state({ status: IntentStatus.SUBMITTED, expiresAt: PAST })).toBe(
        'PENDING',
      );
      expect(
        state({ status: IntentStatus.SIGNED_XDR_RECEIVED, expiresAt: PAST }),
      ).toBe('PENDING');
    });
  });

  it('CONFIRMED is SUCCESS, even past expiry', () => {
    expect(state({ status: IntentStatus.CONFIRMED, expiresAt: PAST })).toBe(
      'SUCCESS',
    );
  });

  describe('FAILED splits on who can fix it', () => {
    it.each<FailureCode>([
      'USER_REJECTED_SIGNATURE',
      'SIGNATURE_MISMATCH',
      'INTENT_EXPIRED',
      'INSUFFICIENT_BALANCE',
      'NO_TRUSTLINE',
      'SLIPPAGE_EXCEEDED',
      'QUOTE_EXPIRED',
    ])('%s is REJECTED, because the user can act', (failureCode) => {
      expect(state({ status: IntentStatus.FAILED, failureCode })).toBe(
        'REJECTED',
      );
    });

    it.each<FailureCode>([
      'XDR_GENERATION_FAILED',
      'UPSTREAM_UNAVAILABLE',
      'CHAIN_REJECTED',
      'UNKNOWN',
    ])('%s is FAILED, because the user cannot', (failureCode) => {
      expect(state({ status: IntentStatus.FAILED, failureCode })).toBe(
        'FAILED',
      );
    });

    it('treats a missing failure code as FAILED, not REJECTED', () => {
      // Fail closed on the honest side: offering "try again" for something we
      // cannot explain wastes the user's time.
      expect(state({ status: IntentStatus.FAILED, failureCode: null })).toBe(
        'FAILED',
      );
    });

    it('treats an unrecognised failure code as FAILED', () => {
      expect(
        state({ status: IntentStatus.FAILED, failureCode: 'SOMETHING_NEW' }),
      ).toBe('FAILED');
    });
  });
});

describe('isUserActionable', () => {
  it('is false for null and undefined', () => {
    expect(isUserActionable(null)).toBe(false);
    expect(isUserActionable(undefined)).toBe(false);
  });

  it('separates the two groups', () => {
    expect(isUserActionable('NO_TRUSTLINE')).toBe(true);
    expect(isUserActionable('CHAIN_REJECTED')).toBe(false);
  });
});

describe('isTerminalState', () => {
  it('keeps the client polling only while something can still change', () => {
    expect(isTerminalState('PENDING_SIGNATURE')).toBe(false);
    expect(isTerminalState('PENDING')).toBe(false);
  });

  it.each(['SUCCESS', 'REJECTED', 'FAILED', 'EXPIRED'] as const)(
    '%s stops the polling',
    (s) => {
      expect(isTerminalState(s)).toBe(true);
    },
  );
});
