import { describe, expect, it } from 'vitest';
import { readBodyLimited } from '@/lib/checkout/read-body';

const enc = new TextEncoder();

function streamRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/checkout', {
    method: 'POST',
    headers,
    body: stream,
    // Required by undici for a streamed request body.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

function countingStream(chunkBytes: number, chunkCount: number) {
  const state = { pulled: 0, cancelled: false };
  const chunk = new Uint8Array(chunkBytes).fill(120); // 'x'
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunkCount) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { state, stream };
}

describe('readBodyLimited', () => {
  it('returns the text of a small body', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: '{"a":1}' });
    await expect(readBodyLimited(req, 1024)).resolves.toBe('{"a":1}');
  });

  it('returns an empty string when there is no body', async () => {
    const req = new Request('http://localhost/x', { method: 'POST' });
    await expect(readBodyLimited(req, 1024)).resolves.toBe('');
  });

  it('accepts a body of exactly maxBytes', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(100) });
    await expect(readBodyLimited(req, 100)).resolves.toHaveLength(100);
  });

  it('rejects a body one byte over maxBytes with 413', async () => {
    const req = new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(101) });
    await expect(readBodyLimited(req, 100)).rejects.toMatchObject({ status: 413 });
  });

  it('counts BYTES, not characters: 40k three-byte characters is 120KB', async () => {
    const text = '€'.repeat(40_000); // 40k characters, 120_000 bytes
    expect(text.length).toBeLessThan(64 * 1024);
    expect(enc.encode(text).byteLength).toBe(120_000);
    const req = new Request('http://localhost/x', { method: 'POST', body: text });
    await expect(readBodyLimited(req, 64 * 1024)).rejects.toMatchObject({ status: 413 });
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = enc.encode('a€b');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2)); // splits the euro sign
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    await expect(readBodyLimited(streamRequest(stream), 1024)).resolves.toBe('a€b');
  });

  it('stops and cancels a chunked body with no content-length before it is fully read', async () => {
    const { state, stream } = countingStream(8 * 1024, 1000); // 8MB offered
    const req = streamRequest(stream);
    expect(req.headers.get('content-length')).toBeNull();
    await expect(readBodyLimited(req, 64 * 1024)).rejects.toMatchObject({ status: 413 });
    expect(state.pulled).toBeLessThan(50);
    expect(state.cancelled).toBe(true);
  });

  it('refuses early from a declared content-length without reading the body', async () => {
    const { state, stream } = countingStream(1024, 10);
    const req = streamRequest(stream, { 'content-length': '999999' });
    await expect(readBodyLimited(req, 64 * 1024)).rejects.toMatchObject({ status: 413 });
    // A ReadableStream pre-fills one chunk on construction; the point is the body is never drained.
    expect(state.pulled).toBeLessThanOrEqual(1);
  });
});
