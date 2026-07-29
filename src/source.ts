/**
 * Fetching catalog files from the repository that owns them.
 *
 * Reads happen at a pinned commit, never at a branch name. A branch moves, so
 * two files fetched from one could come from different revisions, and a deploy
 * built from it could not say which revision it shipped. The commit is supplied
 * by whoever triggers the deploy.
 */
import { RegistryError, parseEntries, type SourceEntry } from './registry.ts';

export interface SourceSpec {
  /** Repository holding the catalog files, as `owner/name`. */
  repo: string;
  /** Catalog files within that repository. */
  files: string[];
}

/** Resolve a ref to the commit it currently points at. */
export async function resolveCommit(repo: string, ref: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${ref}`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new RegistryError(`cannot resolve ${repo}@${ref}: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { sha?: unknown };
  if (typeof body.sha !== 'string') throw new RegistryError(`cannot resolve ${repo}@${ref}: no sha in response`);
  return body.sha;
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function assertCommit(commit: string): void {
  if (!COMMIT_PATTERN.test(commit)) {
    throw new RegistryError(`'${commit}' is not a full commit SHA; resolve the ref before fetching`);
  }
}

/** Read one file from a repository at one commit. */
export async function fetchFile(
  repo: string,
  file: string,
  commit: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; origin: string }> {
  assertCommit(commit);
  const origin = `${repo}@${commit.slice(0, 8)}:${file}`;
  const response = await fetchImpl(`https://raw.githubusercontent.com/${repo}/${commit}/${file}`);
  if (!response.ok) throw new RegistryError(`${origin}: HTTP ${response.status}`);
  return { text: await response.text(), origin };
}

/**
 * Read every catalog file in a source at one commit.
 *
 * `commit` must be a full SHA. Accepting a branch name here is the mistake this
 * signature exists to prevent: it would silently reintroduce the split-revision
 * read that pinning avoids.
 */
export async function fetchEntries(
  source: SourceSpec,
  commit: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceEntry[]> {
  assertCommit(commit);

  const perFile = await Promise.all(
    source.files.map(async (file) => {
      const { text, origin } = await fetchFile(source.repo, file, commit, fetchImpl);
      return parseEntries(text, origin);
    }),
  );

  return perFile.flat();
}
