import { createLimiter } from '@/lib/checkout/rate-limit';

function limitFromEnv(): number {
  const n = Number(process.env.ENQUIRY_RATE_LIMIT_PER_MIN);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

/** Enquiry submissions per IP per minute (ENQUIRY_RATE_LIMIT_PER_MIN, default 5). In memory, per server instance. */
export const enquiryLimiter = createLimiter({ limit: limitFromEnv(), windowMs: 60_000 });
