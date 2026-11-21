import { CheckoutError } from './parse';

/**
 * Reads a request body as UTF-8 text, refusing anything over `maxBytes`.
 *
 * request.text() buffers an entire body before any size check can run, and a
 * chunked upload carries no Content-Length to check up front. So the body is
 * read incrementally with a running BYTE count (not a character count: a
 * three-byte character is three bytes), and the stream is cancelled the moment
 * the limit is crossed, so an oversized upload is never fully pulled into memory.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string> {
  // Fast path: a declared length over the limit needs no reading at all.
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    throw new CheckoutError('Request body is too large', 413);
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CheckoutError('Request body is too large', 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(bytes);
}
