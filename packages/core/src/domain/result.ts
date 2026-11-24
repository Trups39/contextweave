/**
 * Explicit success/failure values. Domain code never throws for expected
 * failures (bad input, illegal transition, model unavailable); callers must
 * handle `ok: false`. Exceptions are reserved for programmer errors.
 */
export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_URL'
  | 'EMPTY_CAPTURE'
  | 'NOT_FOUND'
  | 'UNVERIFIED_CLAIM'
  | 'ILLEGAL_TRANSITION'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_OUTPUT_INVALID'
  | 'CONSENT_REQUIRED'
  | 'URL_MISMATCH';

export interface DomainError {
  code: DomainErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: DomainErrorCode, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});
