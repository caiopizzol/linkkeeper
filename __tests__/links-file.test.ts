import { describe, expect, test } from 'bun:test';

import { linksFromFile, parseLinksFile, type LinksFile } from '../src/links-file.ts';

function raw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    defaults: { repository: 'acme/product', ref: 'main' },
    links: { react: { path: 'examples/react' } },
    ...overrides,
  });
}

function parse(overrides: Record<string, unknown> = {}): LinksFile {
  return parseLinksFile(raw(overrides), 'links.json');
}

describe('parsing', () => {
  test('reads defaults and links', () => {
    const file = parse();
    expect(file.defaults).toEqual({ repo: 'acme/product', ref: 'main' });
    expect(file.links.react).toEqual({ path: 'examples/react' });
  });

  test('a link may override the repository and ref', () => {
    const file = parse({ links: { rag: { repository: 'acme/demos', ref: 'release', path: 'rag' } } });
    expect(file.links.rag).toEqual({ repository: 'acme/demos', ref: 'release', path: 'rag' });
  });

  test.each([
    [{ version: 2 }, /unsupported version 2/],
    [{ version: undefined }, /unsupported version/],
    [{ defaults: {} }, /'defaults\.repository'/],
    [{ defaults: { repository: 'acme/product' } }, /'defaults\.ref'/],
    [{ links: { react: {} } }, /links\.react\.path/],
    [{ links: { react: 'examples/react' } }, /'links\.react' must be an object/],
    [{ links: [] }, /'links' must be an object/],
  ])('rejects %p', (overrides, message) => {
    expect(() => parse(overrides)).toThrow(message);
  });

  test('malformed JSON names the file', () => {
    expect(() => parseLinksFile('{oops', 'links.json')).toThrow(/links\.json/);
  });
});

describe('building links', () => {
  test('the key is the slug and the value holds the mutable path', () => {
    const links = linksFromFile(parse(), 'links.json');
    expect(links).toEqual([
      { slug: 'react', id: 'react', destination: 'https://github.com/acme/product/tree/main/examples/react' },
    ]);
  });

  test('a nested route may point at the same path as a flat compatibility route', () => {
    const file = parse({
      links: {
        'examples/react': { path: 'examples/react' },
        react: { path: 'examples/react' },
      },
    });
    expect(linksFromFile(file, 'links.json')).toEqual([
      {
        slug: 'examples/react',
        id: 'examples/react',
        destination: 'https://github.com/acme/product/tree/main/examples/react',
      },
      { slug: 'react', id: 'react', destination: 'https://github.com/acme/product/tree/main/examples/react' },
    ]);
  });

  test('defaults fill in what a link does not override', () => {
    const file = parse({
      links: {
        react: { path: 'examples/react' },
        rag: { repository: 'acme/demos', path: 'rag' },
      },
    });
    const byslug = Object.fromEntries(linksFromFile(file, 'links.json').map((l) => [l.slug, l.destination]));
    expect(byslug.react).toBe('https://github.com/acme/product/tree/main/examples/react');
    expect(byslug.rag).toBe('https://github.com/acme/demos/tree/main/rag');
  });

  test('links are sorted so generated output is stable', () => {
    const file = parse({ links: { charlie: { path: 'c' }, alpha: { path: 'a' }, bravo: { path: 'b' } } });
    expect(linksFromFile(file, 'links.json').map((l) => l.slug)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  test('slug rules match the catalog path, since both produce public URLs', () => {
    expect(() => linksFromFile(parse({ links: { Bad_Slug: { path: 'a' } } }), 'links.json')).toThrow(/kebab-case/);
    expect(() => linksFromFile(parse({ links: { docs: { path: 'a' } } }), 'links.json')).toThrow(/reserved/);
  });

  test('path safety matches the catalog path', () => {
    // Same boundary, same rules: an injected newline must not become a rule.
    expect(() => linksFromFile(parse({ links: { a: { path: 'x 302\n/evil https://e.example' } } }), 'l')).toThrow(
      /control character/,
    );
    expect(() => linksFromFile(parse({ links: { a: { path: '../outside' } } }), 'l')).toThrow(/must not contain/);
  });

  test('a repeated slug is rejected rather than silently overwritten', () => {
    // JSON *text* may repeat a key and JSON.parse keeps the last value without
    // complaint. For a registry keyed by permanent slug that is the exact
    // failure it exists to prevent, so the raw text is checked.
    expect(() =>
      parseLinksFile(
        '{"version":1,"defaults":{"repository":"a/b","ref":"main"},"links":{"x":{"path":"one"},"x":{"path":"two"}}}',
        'links.json',
      ),
    ).toThrow(/duplicate key 'x'/);
  });

  test('a repeated key anywhere is rejected, not just a slug', () => {
    expect(() =>
      parseLinksFile('{"version":1,"version":1,"defaults":{"repository":"a/b","ref":"main"},"links":{}}', 'links.json'),
    ).toThrow(/duplicate key 'version'/);
  });

  test('a brace or quote inside a string does not confuse the duplicate check', () => {
    // The check walks raw text, so it has to know a brace inside a string is
    // not structural. A regex-based version would fail here.
    const file = parseLinksFile(
      '{"version":1,"defaults":{"repository":"a/b","ref":"main"},"links":{"x":{"path":"a{b\\"c"}}}',
      'links.json',
    );
    expect(file.links.x?.path).toBe('a{b"c');
  });

  test('the same key in sibling objects is fine', () => {
    const file = parseLinksFile(
      '{"version":1,"defaults":{"repository":"a/b","ref":"main"},"links":{"x":{"path":"one"},"y":{"path":"two"}}}',
      'links.json',
    );
    expect(Object.keys(file.links)).toEqual(['x', 'y']);
  });

  test('an unknown property is rejected, since a typo would publish the wrong place', () => {
    expect(() => parse({ links: { react: { path: 'p', repositry: 'typo/here' } } })).toThrow(
      /unknown property 'repositry'/,
    );
    expect(() => parse({ defaults: { repository: 'a/b', ref: 'main', reff: 'x' } })).toThrow(/unknown property 'reff'/);
    expect(() => parse({ verison: 1 })).toThrow(/unknown property 'verison'/);
  });
});
