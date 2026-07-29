/**
 * Checking that every destination exists before it is published.
 *
 * A registry can only tell you what it believes. It cannot tell you whether the
 * path still exists in the repository it names, and that does drift in practice:
 * someone moves a directory and forgets the entry. Publishing a link to a 404
 * reads as a deleted project, which is worse than never having published the
 * link, so this runs before deploy.
 *
 * AIDEV-NOTE: this and archived slugs pull in opposite directions. An archived
 * entry keeps its slug and still points at its source, so deleting that source
 * fails the deploy for every link, not just that one. The fix when it happens is
 * a tombstone destination for archived entries rather than loosening this check:
 * skipping verification for archived links would just publish the 404 quietly.
 * Not built yet because no archived entry has a slug.
 */
import type { Link } from './registry.ts';

export interface Failure {
  link: Link;
  status: string;
}

const CONCURRENCY = 8;

async function head(url: string, fetchImpl: typeof fetch): Promise<{ ok: boolean; status: string }> {
  try {
    // GitHub answers HEAD for a tree path with 200 or 404, so no body is needed.
    const response = await fetchImpl(url, { method: 'HEAD', redirect: 'follow' });
    return { ok: response.ok, status: String(response.status) };
  } catch (err) {
    return { ok: false, status: `request failed: ${(err as Error).message}` };
  }
}

export async function findBrokenLinks(
  links: readonly Link[],
  fetchImpl: typeof fetch = fetch,
  concurrency = CONCURRENCY,
): Promise<Failure[]> {
  const queue = [...links];
  const failures: Failure[] = [];

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let link = queue.shift(); link !== undefined; link = queue.shift()) {
        const { ok, status } = await head(link.destination, fetchImpl);
        if (!ok) failures.push({ link, status });
      }
    }),
  );

  return failures.sort((a, b) => a.link.slug.localeCompare(b.link.slug));
}
