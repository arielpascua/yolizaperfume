import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAGRANCES } from '@/lib/catalog/data';

let POST: (req: Request) => Promise<Response>;
let dir: string;
const oos = FRAGRANCES.find((f) => !f.inStock)!;

beforeAll(async () => {
  process.env.ENQUIRY_RATE_LIMIT_PER_MIN = '1000';
  POST = (await import('./route')).POST;
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'yz-enq-'));
  vi.stubEnv('LOCAL_STORE_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
});

afterAll(() => {
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const body = (over: Record<string, unknown> = {}) => ({
  company: 'Casa Bella',
  contactName: 'Ana Reyes',
  email: 'ana@casabella.example',
  businessType: 'boutique',
  wantsSamples: true,
  items: [{ fragranceId: 'yz-01', volumeId: '50ml', cases: 2 }],
  ...over,
});

const call = (b: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://localhost/api/enquiry', { method: 'POST', headers, body: typeof b === 'string' ? b : JSON.stringify(b) }));

const saved = () => {
  const file = path.join(dir, 'enquiries.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

describe('POST /api/enquiry', () => {
  it('saves an enquiry with a name snapshot and no price, and returns a reference', async () => {
    const res = await call(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reference).toMatch(/^YZE-[0-9A-F]{10}$/);
    const [row] = saved();
    expect(row.lines[0]).toMatchObject({ fragranceName: 'Sampaguita Nocturne', volumeLabel: '50 ml', cases: 2 });
    expect(JSON.stringify(row)).not.toMatch(/price|₱/i);
  });

  it('accepts an open application and an out-of-stock fragrance', async () => {
    expect((await call(body({ items: [] }))).status).toBe(200);
    expect((await call(body({ items: [{ fragranceId: oos.id, volumeId: oos.volumes[0], cases: 1 }] }))).status).toBe(200);
  });

  it('rejects unknown fragrances, bad content type, bad JSON and a filled honeypot', async () => {
    expect((await call(body({ items: [{ fragranceId: 'nope', volumeId: '50ml', cases: 1 }] }))).status).toBe(400);
    expect((await call(body(), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await call('{oops')).status).toBe(400);
    expect((await call(body({ website: 'bot' }))).status).toBe(400);
    expect(saved().length).toBeLessThanOrEqual(2);
  });

  it('answers 503 rather than pretending when nothing can store it', async () => {
    vi.stubEnv('LOCAL_STORE_DIR', '');
    const res = await call(body());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/could not send/i);
  });

  it('never logs contact details', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await call(body());
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/casabella|Ana Reyes/i);
    info.mockRestore();
  });
});
