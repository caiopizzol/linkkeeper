import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

function sourceFiles(dir = SRC, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

const files = sourceFiles();

// AIDEV-NOTE: src/ is deliberately runnable on Node, Deno, and Bun. The
// container target will need that — a redirect server pinned to one runtime is
// a much harder thing to self-host — and it is true today for free. A single
// `Bun.file` or `bun:sqlite` import would quietly take it away, so it is
// asserted rather than hoped for. Tests may use bun:test; src may not.
describe('src stays runtime-portable', () => {
  test('there is source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((file) => [path.relative(SRC, file), file]))('%s uses no Bun-only API', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/from ['"]bun:/);
    expect(source).not.toMatch(/\bBun\./);
  });

  test.each(files.map((file) => [path.relative(SRC, file), file]))('%s imports only node: builtins', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      const specifier = match[1] ?? '';
      expect(specifier.startsWith('.') || specifier.startsWith('node:')).toBe(true);
    }
  });

  test('no runtime dependencies, so any runtime can execute it', () => {
    // A dependency-free tool is one `npx`/`bunx` away from working, and needs no
    // install step inside a container image.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
