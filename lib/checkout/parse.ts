// Shared request-parsing primitives. REJECTS RATHER THAN REPAIRS: a value that is the wrong
// type or carries control characters means caller and server disagree about what is being sent.

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Control characters (tab, CR and LF included: none of these fields is multi-line, and a CR/LF in a
// name or address is how header and log injection starts), DEL, the Unicode bidi/format overrides
// that make text display as something it is not, the Arabic letter mark, the C1 controls and the
// line/paragraph separators. Ordinary accented and non-Latin text is untouched.
// Built from char codes so no invisible character ever sits in this source file.
const ch = (...codes: number[]) => codes.map((c) => String.fromCharCode(c)).join('');
const range = (a: number, b: number) => `${ch(a)}-${ch(b)}`;
// Bidi/format overrides, the Arabic letter mark and the line/paragraph separators.
const INVISIBLES = ch(0x061c, 0x200e, 0x200f, 0x2028, 0x2029) + range(0x202a, 0x202e) + range(0x2066, 0x2069);
// Control characters (tab, CR and LF included), DEL and the C1 controls.
const FORBIDDEN_CHARS = new RegExp(`[${range(0, 0x1f)}${range(0x7f, 0x9f)}${INVISIBLES}]`);
// A message may be multi-line: tab (9), LF (10) and CR (13) are allowed there, and only there.
const FORBIDDEN_IN_MESSAGE = new RegExp(`[${range(0, 8)}${range(0x0b, 0x0c)}${range(0x0e, 0x1f)}${range(0x7f, 0x9f)}${INVISIBLES}]`);

export function readString(value: unknown, field: string, max: number, required: boolean): string {
  if (value === null || value === undefined || value === '') {
    if (required) throw new CheckoutError(`${field} is required`, 400);
    return '';
  }
  if (typeof value !== 'string') throw new CheckoutError(`${field} must be text`, 400);
  // Checked on the RAW value, before trim(), so a trailing newline cannot be trimmed away unnoticed.
  if (FORBIDDEN_CHARS.test(value)) throw new CheckoutError(`${field} contains characters that are not allowed`, 400);
  const trimmed = value.trim();
  if (required && !trimmed) throw new CheckoutError(`${field} is required`, 400);
  if (trimmed.length > max) throw new CheckoutError(`${field} is too long`, 400);
  return trimmed;
}

export function readMessage(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new CheckoutError(`${field} must be text`, 400);
  if (FORBIDDEN_IN_MESSAGE.test(value)) throw new CheckoutError(`${field} contains characters that are not allowed`, 400);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new CheckoutError(`${field} is too long`, 400);
  return trimmed;
}

export function readEmail(value: unknown, max: number): string {
  const email = readString(value, 'Email', max, true);
  if (!EMAIL_RE.test(email)) throw new CheckoutError('That email address does not look right', 400);
  return email;
}

export function asObject(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CheckoutError(`${what} must be a JSON object`, 400);
  }
  return body as Record<string, unknown>;
}
