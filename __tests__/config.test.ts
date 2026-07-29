import { describe, expect, test } from 'bun:test';

import { parseConfig } from '../src/config.ts';

const linksConfig = JSON.stringify({ links: { repo: 'acme/product', file: 'links.json' } });

const catalogConfig = JSON.stringify({
  catalog: {
    repo: 'acme/product',
    files: ['examples/manifest.json'],
    repos: { 'acme/product': { repo: 'acme/public', ref: 'main' } },
  },
});

describe('links source', () => {
  test('reads a native registry config', () => {
    const config = parseConfig(linksConfig, 'linkkeeper.json');
    expect(config).toEqual({ kind: 'links', repo: 'acme/product', file: 'links.json' });
  });

  test.each([
    ['{"links":{}}', /'links\.repo'/],
    ['{"links":{"repo":"acme/product"}}', /'links\.file'/],
    ['{"links":"links.json"}', /'links' must be an object/],
  ])('rejects %p', (raw, message) => {
    expect(() => parseConfig(raw, 'linkkeeper.json')).toThrow(message);
  });
});

describe('catalog source', () => {
  test('reads an existing-catalog config', () => {
    const config = parseConfig(catalogConfig, 'linkkeeper.json');
    expect(config.kind).toBe('catalog');
    if (config.kind !== 'catalog') throw new Error('expected a catalog config');
    expect(config.source).toEqual({ repo: 'acme/product', files: ['examples/manifest.json'] });
    expect(config.repos['acme/product']).toEqual({ repo: 'acme/public', ref: 'main' });
  });

  test.each([
    ['{"catalog":{"repo":"a","files":[]}}', /non-empty array/],
    ['{"catalog":{"repo":"a","files":["f"]}}', /'catalog\.repos' must be an object/],
    ['{"catalog":{"repo":"a","files":["f"],"repos":{}}}', /must not be empty/],
    ['{"catalog":{"files":["f"],"repos":{"a":{"repo":"x","ref":"y"}}}}', /'catalog\.repo'/],
    ['{"catalog":{"repo":"a","files":["f"],"repos":{"a":{"repo":"x"}}}}', /'catalog\.repos\.a\.ref'/],
  ])('rejects %p', (raw, message) => {
    expect(() => parseConfig(raw, 'linkkeeper.json')).toThrow(message);
  });
});

describe('shape', () => {
  test.each([
    ['{', /not valid JSON/],
    ['[]', /must be an object/],
    ['{}', /set 'links'.*or 'catalog'/],
  ])('rejects %p', (raw, message) => {
    expect(() => parseConfig(raw, 'linkkeeper.json')).toThrow(message);
  });

  test('rejects both sources at once, since only one can be authoritative', () => {
    const both = JSON.stringify({ links: { repo: 'a/b', file: 'links.json' }, catalog: {} });
    expect(() => parseConfig(both, 'linkkeeper.json')).toThrow(/not both/);
  });

  test('errors name the config file so the fix is findable', () => {
    expect(() => parseConfig('{', 'custom.json')).toThrow(/custom\.json/);
  });
});
