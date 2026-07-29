import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { linksFromFile, parseLinksFile, LINKS_FILE_VERSION } from '../src/links-file.ts';
import { RESERVED_SLUGS } from '../src/registry.ts';

const schema = JSON.parse(readFileSync(new URL('../schema/links.schema.json', import.meta.url), 'utf8'));

const slugPattern = new RegExp(schema.properties.links.propertyNames.pattern, 'u');
const pathPattern = new RegExp(schema.properties.links.additionalProperties.properties.path.pattern, 'u');
const refPattern = new RegExp(schema.$defs.ref.pattern, 'u');
const repoPattern = new RegExp(schema.$defs.repository.pattern, 'u');

/** Does the runtime accept a registry with this one link? */
function runtimeAccepts(link: Record<string, unknown>, slug = 'thing'): boolean {
  const raw = JSON.stringify({
    version: 1,
    defaults: { repository: 'acme/product', ref: 'main' },
    links: { [slug]: link },
  });
  try {
    linksFromFile(parseLinksFile(raw, 'test'), 'test');
    return true;
  } catch {
    return false;
  }
}

/** Does the schema's pattern for this field accept the value? */
function schemaAccepts(field: 'path' | 'ref' | 'repository' | 'slug', value: string): boolean {
  const pattern = { path: pathPattern, ref: refPattern, repository: repoPattern, slug: slugPattern }[field];
  return pattern.test(value);
}

// AIDEV-NOTE: the schema restates rules the parser enforces, so it can drift and
// tell an editor something is fine that the build then rejects — or the reverse,
// which is worse because it looks like the tool is wrong. These cases assert
// both sides agree on the same input.
describe('schema and runtime agree', () => {
  test.each([
    ['examples/react', true],
    ['examples/getting-started/react', true],
    ['v1.2.3/thing', true],
    ['..hidden/thing', true],
    ['../outside', false],
    ['a/../b', false],
    ['a/..', false],
    ['..', false],
    ['/absolute', false],
    ['with space', false],
    ['with\ttab', false],
    ['with\nnewline', false],
  ])('path %p', (path, expected) => {
    expect(schemaAccepts('path', path)).toBe(expected);
    expect(runtimeAccepts({ path })).toBe(expected);
  });

  test.each([
    ['main', true],
    ['release/v1', true],
    ['with space', false],
    ['with\ttab', false],
  ])('ref %p', (ref, expected) => {
    expect(schemaAccepts('ref', ref)).toBe(expected);
    expect(runtimeAccepts({ path: 'examples/x', ref })).toBe(expected);
  });

  test.each([
    ['acme/product', true],
    ['not-a-repo', false],
    ['too/many/parts', false],
    ['https://evil.example.com', false],
  ])('repository %p', (repository, expected) => {
    expect(schemaAccepts('repository', repository)).toBe(expected);
    expect(runtimeAccepts({ path: 'examples/x', repository })).toBe(expected);
  });

  test.each([
    ['react', true],
    ['track-changes', true],
    ['React', false],
    ['my_thing', false],
    ['my--thing', false],
    ['-a', false],
    ['a-', false],
  ])('slug %p', (slug, expected) => {
    expect(schemaAccepts('slug', slug)).toBe(expected);
    expect(runtimeAccepts({ path: 'examples/x' }, slug)).toBe(expected);
  });

  test('both reject unknown properties, so a typo cannot pass silently', () => {
    expect(schema.properties.links.additionalProperties.additionalProperties).toBe(false);
    expect(runtimeAccepts({ path: 'examples/x', repositry: 'typo/here' })).toBe(false);
  });

  test('both allow the $schema hint at the root', () => {
    expect(schema.properties.$schema).toBeDefined();
    const raw = JSON.stringify({
      $schema: 'https://example.com/schema.json',
      version: 1,
      defaults: { repository: 'acme/product', ref: 'main' },
      links: { react: { path: 'examples/react' } },
    });
    expect(() => parseLinksFile(raw, 'test')).not.toThrow();
  });
});

describe('schema metadata', () => {
  test('declares the version the parser accepts', () => {
    expect(schema.properties.version.const).toBe(LINKS_FILE_VERSION);
  });

  test('reserves exactly the slugs the code reserves', () => {
    expect([...schema.properties.links.propertyNames.not.enum].sort()).toEqual([...RESERVED_SLUGS].sort());
  });

  test('is resolvable and self-describing', () => {
    expect(schema.$id).toMatch(/^https:\/\//);
    expect(schema.properties.links.description).toMatch(/permanent/i);
  });

  test('the published id points at a tag, not a moving branch', () => {
    // An editor validating against `main` checks whatever the format looks like
    // today, which is not necessarily what the installed version accepts.
    expect(schema.$id).not.toMatch(/\/main\//);
    expect(schema.$id).toMatch(/\/v\d+\.\d+\.\d+\//);
  });
});
