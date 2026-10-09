import type { FailureCode } from './transaction-state';

/**
 * Patterns matched against whatever an upstream failure carries.
 *
 * Order matters: the first match wins, so specific causes precede generic ones.
 * Matching on strings is unpleasant, but it is what both the DeFindex API and
 * Horizon actually give us — neither returns a stable machine code for these.
 */
const PATTERNS: ReadonlyArray<readonly [RegExp, FailureCode]> = [
  // Our own hash pin, before anything reaches the network.
  [/does not match the generated transaction/i, 'SIGNATURE_MISMATCH'],
  [/must be signed by the user|tx_bad_auth|bad_auth/i, 'SIGNATURE_MISMATCH'],

  [/has expired|tx_too_late|intent expired/i, 'INTENT_EXPIRED'],
  [/quote (has )?expired|quote_expired/i, 'QUOTE_EXPIRED'],

  [
    /op_underfunded|tx_insufficient_balance|insufficient balance/i,
    'INSUFFICIENT_BALANCE',
  ],
  [/op_no_trust|no_trustline|trustline (is )?missing/i, 'NO_TRUSTLINE'],
  [/op_over_sendmax|op_under_destmin|slippage/i, 'SLIPPAGE_EXCEEDED'],

  // Transport before protocol: a timeout is not a chain rejection.
  [
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|timeout|socket hang up/i,
    'UPSTREAM_UNAVAILABLE',
  ],
  [
    /50[0-4]\b|bad gateway|service unavailable|gateway timeout/i,
    'UPSTREAM_UNAVAILABLE',
  ],

  [/tx_|op_|Error\(Storage|HostError|simulat/i, 'CHAIN_REJECTED'],
];

/** Pulls the useful text out of whatever was thrown. */
function describe(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;

  const parts: string[] = [];
  const err = error as {
    message?: unknown;
    response?: { data?: unknown; status?: unknown };
    code?: unknown;
  };

  if (typeof err.message === 'string') parts.push(err.message);
  if (typeof err.code === 'string') parts.push(err.code);
  const status = err.response?.status;
  if (typeof status === 'number' || typeof status === 'string') {
    parts.push(String(status));
  }
  if (err.response?.data !== undefined) {
    try {
      parts.push(JSON.stringify(err.response.data));
    } catch {
      // A payload that will not serialize tells us nothing; the message carries it.
    }
  }

  return parts.join(' ');
}

/**
 * Classifies a failure so the client can tell "try again" from "contact support".
 *
 * `fallback` lets the call site say what kind of failure this was when the text
 * is unrecognisable — a throw while generating an XDR is `XDR_GENERATION_FAILED`
 * whatever it says, because of *where* it happened.
 */
export function classifyFailure(
  error: unknown,
  fallback: FailureCode = 'UNKNOWN',
): FailureCode {
  const text = describe(error);
  if (!text) return fallback;

  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return fallback;
}
