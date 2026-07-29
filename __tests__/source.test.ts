import { describe, expect, test } from 'bun:test';

import { fetchEntries, resolveCommit, type SourceSpec } from '../src/source.ts';

const COMMIT = 'a'.repeat(40);

const source: SourceSpec = { repo: 'acme/catalog', files: ['examples/manifest.json', 'demos/manifest.json'] };

function stubFetch(routes: Record<string, { status?: number; body?: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.body ?? '', { status: route.status ?? 200 });
  }) as typeof fetch;
}

describe('pinning', () => {
  test('reads every file at the same commit', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response('[]');
    }) as typeof fetch;

    await fetchEntries(source, COMMIT, fetchImpl);

    expect(seen).toEqual([
      `https://raw.githubusercontent.com/acme/catalog/${COMMIT}/examples/manifest.json`,
      `https://raw.githubusercontent.com/acme/catalog/${COMMIT}/demos/manifest.json`,
    ]);
  });

  test.each(['main', 'HEAD', 'v1.0.0', 'abc1234'])('refuses to read at the mutable ref %p', async (ref) => {
    // A branch can move between the two reads, which would build one deploy
    // from two revisions and leave no record of which was shipped.
    await expect(fetchEntries(source, ref, stubFetch({}))).rejects.toThrow(/not a full commit SHA/);
  });
});

describe('failures', () => {
  test('a missing file names the file and the status', async () => {
    const fetchImpl = stubFetch({
      [`https://raw.githubusercontent.com/acme/catalog/${COMMIT}/examples/manifest.json`]: { body: '[]' },
      [`https://raw.githubusercontent.com/acme/catalog/${COMMIT}/demos/manifest.json`]: { status: 404 },
    });

    await expect(fetchEntries(source, COMMIT, fetchImpl)).rejects.toThrow(/demos\/manifest\.json: HTTP 404/);
  });

  test('entries from every file are combined', async () => {
    const fetchImpl = stubFetch({
      [`https://raw.githubusercontent.com/acme/catalog/${COMMIT}/examples/manifest.json`]: { body: '[{"id":"a"}]' },
      [`https://raw.githubusercontent.com/acme/catalog/${COMMIT}/demos/manifest.json`]: { body: '[{"id":"b"}]' },
    });

    const entries = await fetchEntries(source, COMMIT, fetchImpl);
    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('resolveCommit', () => {
  test('returns the sha a ref points at', async () => {
    const fetchImpl = stubFetch({
      'https://api.github.com/repos/acme/catalog/commits/HEAD': { body: JSON.stringify({ sha: COMMIT }) },
    });
    expect(await resolveCommit('acme/catalog', 'HEAD', fetchImpl)).toBe(COMMIT);
  });

  test('fails loudly when the ref cannot be resolved', async () => {
    await expect(resolveCommit('acme/catalog', 'nope', stubFetch({}))).rejects.toThrow(/cannot resolve/);
  });
});
