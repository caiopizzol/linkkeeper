import { describe, expect, test } from 'bun:test';

import type { Link } from '../src/registry.ts';
import { PAGES_STATIC_LIMIT, renderRedirects } from '../src/targets/pages.ts';

function links(count: number): Link[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: `link-${index}`,
    id: `link-${index}`,
    destination: `https://github.com/acme/public/tree/main/x${index}`,
  }));
}

describe('the Cloudflare Pages rule cap', () => {
  test('a table under the cap renders with no warning', () => {
    const { content, warnings } = renderRedirects(links(10), 'test');
    expect(warnings).toEqual([]);
    expect(content.split('\n').filter((line) => line.startsWith('/'))).toHaveLength(10);
  });

  test('approaching the cap warns without failing', () => {
    // Worth knowing before the deploy that drops rules, not after.
    const { warnings } = renderRedirects(links(Math.ceil(PAGES_STATIC_LIMIT * 0.9)), 'test');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/dropped without failing the deploy/);
  });

  test('exactly at the cap still renders', () => {
    expect(() => renderRedirects(links(PAGES_STATIC_LIMIT), 'test')).not.toThrow();
  });

  test('past the cap fails, because Cloudflare would drop rules silently', () => {
    // The deploy would succeed and some links would 404, with nothing saying
    // which. Failing here is the only way that stays visible.
    expect(() => renderRedirects(links(PAGES_STATIC_LIMIT + 1), 'test')).toThrow(/exceeds the Cloudflare Pages limit/);
  });

  test('the error suggests what to do instead', () => {
    expect(() => renderRedirects(links(PAGES_STATIC_LIMIT + 1), 'test')).toThrow(/Bulk Redirects or a server target/);
  });
});
