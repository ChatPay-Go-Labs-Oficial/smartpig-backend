import { IntentStatus } from '@prisma/client';

/**
 * What the client shows the user.
 *
 * The six `IntentStatus` values are a persistence concern — they describe where a
 * row is in our pipeline. They are not what a person needs to see, and three of
 * them mean "nothing is wrong, keep waiting". This is the client-facing
 * projection.
 */
export type TransactionState =
  /** We produced an XDR; nothing is on chain until the user authorizes it. */
  | 'PENDING_SIGNATURE'
  /** Signed and submitted. On chain, awaiting confirmation. */
  | 'PENDING'
  | 'SUCCESS'
  /**
   * Did not go through, and the user can do something about it — retry, top up,
   * authorize again. Distinct from FAILED because the copy and the call to action
   * are completely different.
   */
  | 'REJECTED'
  /** Did not go through for a reason the user cannot act on. Needs support. */
  | 'FAILED'
  /** Never authorized in time. The XDR's time bounds have passed. */
  | 'EXPIRED';

/**
 * Why a transaction did not go through.
 *
 * Split into two groups below. The split is the whole point of having codes: the
 * app needs to know whether to offer "try again" or "contact support".
 */
export type FailureCode =
  // ── Actionable by the user → REJECTED ──────────────────────────────────
  /** The user dismissed the signing prompt. */
  | 'USER_REJECTED_SIGNATURE'
  /** The signed XDR did not match the one we issued (hash pin). Retry cleanly. */
  | 'SIGNATURE_MISMATCH'
  /** Authorized too late; the XDR's time bounds had passed. */
  | 'INTENT_EXPIRED'
  | 'INSUFFICIENT_BALANCE'
  /** The destination asset has no trustline on the account. */
  | 'NO_TRUSTLINE'
  /** A conversion moved past its acceptable price before landing. */
  | 'SLIPPAGE_EXCEEDED'
  /** A quote was consumed after it expired. */
  | 'QUOTE_EXPIRED'
  // ── Not actionable → FAILED ────────────────────────────────────────────
  /** DeFindex could not build the XDR at all. */
  | 'XDR_GENERATION_FAILED'
  /** DeFindex or Horizon was unreachable, timed out, or 5xx'd. */
  | 'UPSTREAM_UNAVAILABLE'
  /** The network rejected the transaction for a reason we did not classify. */
  | 'CHAIN_REJECTED'
  | 'UNKNOWN';

/**
 * Failure codes the user can resolve themselves.
 *
 * A `Set` rather than a conditional so adding a code forces a decision about
 * which side it lands on, instead of silently defaulting to "contact support".
 */
const USER_ACTIONABLE: ReadonlySet<FailureCode> = new Set<FailureCode>([
  'USER_REJECTED_SIGNATURE',
  'SIGNATURE_MISMATCH',
  'INTENT_EXPIRED',
  'INSUFFICIENT_BALANCE',
  'NO_TRUSTLINE',
  'SLIPPAGE_EXCEEDED',
  'QUOTE_EXPIRED',
]);

export function isUserActionable(
  code: FailureCode | null | undefined,
): boolean {
  return code ? USER_ACTIONABLE.has(code) : false;
}

export interface NormalizeInput {
  status: IntentStatus;
  expiresAt: Date;
  failureCode?: string | null;
  /** Set once a TransactionRecord exists, which only happens after submission. */
  txConfirmed?: boolean;
  now?: Date;
}

/**
 * Projects a stored intent onto the state the client should render.
 *
 * Expiry is evaluated only for intents still awaiting a signature. Once a
 * transaction is submitted the time bounds no longer matter — it either landed or
 * it did not, and calling a submitted deposit "expired" because a wall clock
 * passed would be a lie about money that already moved.
 */
export function normalizeTransactionState(
  input: NormalizeInput,
): TransactionState {
  const {
    status,
    expiresAt,
    failureCode,
    txConfirmed,
    now = new Date(),
  } = input;

  switch (status) {
    case IntentStatus.CONFIRMED:
      return 'SUCCESS';

    case IntentStatus.FAILED:
      return isUserActionable(failureCode as FailureCode)
        ? 'REJECTED'
        : 'FAILED';

    case IntentStatus.SIGNED_XDR_RECEIVED:
    case IntentStatus.SUBMITTED:
      // The reconciliation job may have confirmed the transaction without the
      // intent row having caught up yet.
      return txConfirmed ? 'SUCCESS' : 'PENDING';

    case IntentStatus.CREATED:
    case IntentStatus.XDR_GENERATED:
      return now > expiresAt ? 'EXPIRED' : 'PENDING_SIGNATURE';
  }
}

/** Whether the client should keep polling this state. */
export function isTerminalState(state: TransactionState): boolean {
  return state !== 'PENDING_SIGNATURE' && state !== 'PENDING';
}
