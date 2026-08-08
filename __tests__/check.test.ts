import { describe, expect, test } from 'bun:test';

import type { Link } from '../src/registry.ts';
import { renderRedirects } from '../src/targets/pages.ts';
import { findBrokenLinks } from '../src/verify.ts';

function link(slug: string, destination = `https://github.com/acme/public/tree/main/${slug}`): Link {
  return { slug, id: slug, destination };
}

function stubFetch(broken: ReadonlySet<string>): typeof fetch {
  return (async (input: RequestInfo | URL) =>
    new Response('', { status: broken.has(String(input)) ? 404 : 200 })) as typeof fetch;
}

describe('findBrokenLinks', () => {
  test('reports nothing when every destination resolves', async () => {
    expect(await findBrokenLinks([link('a'), link('b')], stubFetch(new Set()))).toEqual([]);
  });

  test('reports the links that do not resolve', async () => {
    const missing = 'https://github.com/acme/public/tree/main/gone';
    const failures = await findBrokenLinks([link('here'), link('gone')], stubFetch(new Set([missing])));

    expect(failures).toHaveLength(1);
    expect(failures[0]?.link.slug).toBe('gone');
    expect(failures[0]?.status).toBe('404');
  });

  test('a network failure counts as broken rather than passing', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;

    const failures = await findBrokenLinks([link('a')], fetchImpl);
    expect(failures[0]?.status).toMatch(/socket hang up/);
  });

  test('checks every link even when more links than workers', async () => {
    const links = Array.from({ length: 25 }, (_, index) => link(`link-${index}`));
    const failures = await findBrokenLinks(
      links,
      stubFetch(new Set(links.map((entry) => entry.destination))),
      /* concurrency */ 4,
    );
    expect(failures).toHaveLength(25);
  });
});

describe('renderRedirects', () => {
  test('every redirect is temporary', () => {
    // Destinations are expected to move. A cached 301 cannot be withdrawn.
    const rendered = renderRedirects([link('a'), link('b')], 'test').content;
    for (const line of rendered.split('\n').filter((entry) => entry.startsWith('/'))) {
      expect(line).toMatch(/ 302$/);
    }
    expect(rendered).not.toContain(' 301');
  });

  test('records where the table came from', () => {
    expect(renderRedirects([], 'acme/catalog@abc123').content).toContain('acme/catalog@abc123');
  });

  test('output is stable for the same input', () => {
    const links = [link('a'), link('b')];
    expect(renderRedirects(links, 'test').content).toBe(renderRedirects(links, 'test').content);
  });

  test('renders a nested route without changing flat routes', () => {
    const rendered = renderRedirects([link('react'), link('examples/react')], 'test').content;
    expect(rendered).toContain('/react https://github.com/acme/public/tree/main/react 302');
    expect(rendered).toContain('/examples/react https://github.com/acme/public/tree/main/examples/react 302');
  });
});
