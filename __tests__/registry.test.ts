import { describe, expect, test } from 'bun:test';

import { RegistryError, buildLinks, parseEntries, type Config, type SourceEntry } from '../src/registry.ts';

const config: Config = {
  repos: {
    'acme/catalog': { repo: 'acme/public', ref: 'main' },
  },
};

function entry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    id: 'thing',
    slug: 'thing',
    status: 'active',
    sourceRepo: 'acme/catalog',
    sourcePath: 'examples/thing',
    ...overrides,
  };
}

function build(entries: SourceEntry[]) {
  return buildLinks(entries, config, 'test');
}

describe('publishing', () => {
  test('an active entry with a slug becomes a link', () => {
    expect(build([entry()])).toEqual([
      { slug: 'thing', id: 'thing', destination: 'https://github.com/acme/public/tree/main/examples/thing' },
    ]);
  });

  test('an entry without a slug is not published', () => {
    expect(build([entry({ slug: undefined }), entry({ slug: null })])).toEqual([]);
  });

  test('links are sorted by slug so generated diffs stay readable', () => {
    const links = build([
      entry({ id: 'c', slug: 'charlie' }),
      entry({ id: 'a', slug: 'alpha' }),
      entry({ id: 'b', slug: 'bravo' }),
    ]);
    expect(links.map((link) => link.slug)).toEqual(['alpha', 'bravo', 'charlie']);
  });
});

describe('slug rules', () => {
  test('a duplicate slug is rejected', () => {
    expect(() => build([entry({ id: 'first' }), entry({ id: 'second' })])).toThrow(/claimed by both/);
  });

  test.each(['Thing', 'my_thing', 'my--thing', '-thing', 'thing-', 'thing!'])('rejects the slug %p', (slug) => {
    expect(() => build([entry({ slug })])).toThrow(/kebab-case/);
  });

  test.each(['docs', 'live', 'source', 'health', '404'])('rejects the reserved slug %p', (slug) => {
    expect(() => build([entry({ slug })])).toThrow(/reserved/);
  });

  test.each(['active', 'hidden', 'archived'])('publishes a %p entry, so the URL outlives the entry', (status) => {
    // A slug must keep resolving after something is hidden or archived.
    // Requiring 'active' would make withdrawing an entry break its permanent URL.
    expect(build([entry({ status })])).toHaveLength(1);
  });

  test.each(['shim', 'draft', '', undefined])('rejects a slug on a %p entry', (status) => {
    expect(() => build([entry({ status })])).toThrow(/cannot hold one/);
  });
});

describe('destinations', () => {
  test('an unknown repository fails instead of defaulting to one', () => {
    expect(() => build([entry({ sourceRepo: 'someone/elsewhere' })])).toThrow(/unknown repository/);
  });

  test('a source repository can be published under a different name', () => {
    // Catalogs outlive repository renames; the config is what decides the
    // published URL, so a stale name in the catalog cannot leak into a link.
    const renamed = buildLinks([entry({ sourceRepo: 'acme/catalog' })], config, 'test');
    expect(renamed[0]?.destination).toContain('/acme/public/');
  });

  test('a published entry with no source path fails', () => {
    expect(() => build([entry({ sourcePath: undefined })])).toThrow(/sourcePath/);
  });
});

describe('parsing', () => {
  test('unknown fields are ignored rather than rejected', () => {
    const entries = parseEntries('[{"id":"a","slug":"a","status":"active","title":"A","extra":{"deep":1}}]', 'test');
    expect(entries[0]?.id).toBe('a');
  });

  test('a non-array document is rejected', () => {
    expect(() => parseEntries('{"id":"a"}', 'test')).toThrow(RegistryError);
  });

  test('an entry without an id is rejected', () => {
    expect(() => parseEntries('[{"slug":"a"}]', 'test')).toThrow(/no id/);
  });

  test('malformed JSON names the file it came from', () => {
    expect(() => parseEntries('{oops', 'catalog.json')).toThrow(/catalog\.json/);
  });
});
