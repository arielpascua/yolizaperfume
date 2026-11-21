import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('Node requirement is stated once and agrees everywhere', () => {
  const RANGE = '^20.19.0 || ^22.13.0 || >=24.0.0';

  it('package.json and the lockfile root say the same range', () => {
    expect(JSON.parse(read('package.json')).engines.node).toBe(RANGE);
    expect(JSON.parse(read('package-lock.json')).packages[''].engines.node).toBe(RANGE);
  });

  it('the README names the same floor', () => {
    expect(read('README.md')).toMatch(/Requires Node 20\.19 or newer \(20\.19\+, 22\.13\+ or 24\+/);
  });
});
