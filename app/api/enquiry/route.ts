// POST /api/enquiry
//
// A trade enquiry: who the business is, which fragrances it is interested in (optional) and who
// to write back to. THERE IS NO PRICE ANYWHERE IN THIS FLOW: the request is never asked for one,
// a price sent anyway is never read, and nothing here returns one.
//
// SUCCESS MEANS THE ROWS WERE SAVED. A failed write is an honest 503 and the visitor keeps what
// they typed. NOTHING IN THIS FILE LOGS CONTACT DATA: the log carries a reference and a count.

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { FRAGRANCES, VOLUMES } from '@/lib/catalog/data';
import { CheckoutError } from '@/lib/checkout/parse';
import { clientIp } from '@/lib/checkout/rate-limit';
import { readBodyLimited } from '@/lib/checkout/read-body';
import { parseEnquiry } from '@/lib/enquiry/parse';
import { enquiryLimiter } from '@/lib/enquiry/rate-limit';
import type { EnquiryResponse } from '@/lib/enquiry/types';
import { StoreUnavailableError, recordEnquiry } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

// One generic message for every infrastructure or configuration failure. The internal error goes
// to the server log only and never into a response.
const UNAVAILABLE = 'We could not send your enquiry just now. Please try again in a moment.';

export async function POST(request: Request) {
  try {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      throw new CheckoutError('Content-Type must be application/json', 415);
    }
    if (!enquiryLimiter.allow(clientIp(request.headers))) {
      throw new CheckoutError('Too many requests. Please wait a moment and try again.', 429);
    }

    const text = await readBodyLimited(request, MAX_BODY_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CheckoutError('Request body must be valid JSON', 400);
    }
    const enquiry = parseEnquiry(body);

    // The catalogue, not the browser, decides what exists and what it is called.
    const lines = enquiry.lines.map((line) => {
      const f = FRAGRANCES.find((x) => x.id === line.fragranceId);
      if (!f) throw new CheckoutError('One of the fragrances you chose is no longer listed. Please reload the page.', 400);
      const volume = f.volumes.find((v) => v === line.volumeId);
      if (!volume) throw new CheckoutError(`${f.name} is not offered in the volume you chose. Please reload the page.`, 400);
      // A snapshot, deliberately WITHOUT a price. An out-of-stock fragrance is accepted: an enquiry may ask about it.
      return {
        fragranceId: f.id,
        fragranceName: f.name,
        volumeId: volume,
        volumeLabel: VOLUMES[volume].label,
        cases: line.cases,
      };
    });

    const reference = `YZE-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    await recordEnquiry({
      reference,
      company: enquiry.company,
      contactName: enquiry.contactName,
      email: enquiry.email,
      phone: enquiry.phone,
      city: enquiry.city,
      businessType: enquiry.businessType,
      storeWebsite: enquiry.storeWebsite,
      wantsSamples: enquiry.wantsSamples,
      message: enquiry.message,
      lines,
    });

    console.info('[enquiry] received', { reference, lines: lines.length });
    const response: EnquiryResponse = { reference };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: error.status === 429 ? { 'Retry-After': '60' } : undefined },
      );
    }
    if (error instanceof StoreUnavailableError) {
      // These errors carry no row data by construction (fixed messages only).
      console.error('[enquiry] unavailable', error);
      return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    }
    // Name only: an unknown error's message could echo anything, including what was submitted.
    console.error('[enquiry] unexpected failure', { name: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
