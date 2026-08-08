/**
 * The link registry: what a source contributes, and what a deploy is built from.
 *
 * A source entry is intentionally loose. It is the shape a catalog already has,
 * not a shape a project must migrate to, and unknown fields are ignored rather
 * than rejected. The narrow, validated shape is `Link`, which is all the
 * resolver and the renderers ever see.
 */

/** One entry as it appears in a project's own catalog file. */
export interface SourceEntry {
  /** Stable internal key. Used in error messages so a failure names something findable. */
  id: string;
  /** Public name. An entry without one is not published. */
  slug?: string | null;
  /** See `PUBLISHABLE_STATUSES`. */
  status?: string | null;
  /** Repository the entry's source lives in, as `owner/name`. */
  sourceRepo?: string | null;
  /** Path to the entry's source within that repository. */
  sourcePath?: string | null;
}

/** One published link, after validation. */
export interface Link {
  slug: string;
  id: string;
  destination: string;
}

export interface RepoTarget {
  /** Repository to link into, as `owner/name`. Lets a source keep a pre-rename name. */
  repo: string;
  /** Ref to link at. */
  ref: string;
}

export interface Config {
  /** Repositories a link may point into, keyed by the `sourceRepo` value used in catalogs. */
  repos: Record<string, RepoTarget>;
}

export class RegistryError extends Error {}

/**
 * Statuses a published slug may hold.
 *
 * A slug outlives the thing it names. Restricting publication to `active` would
 * mean archiving an entry forces removing its slug, so the tool would require
 * breaking the URL it promises is permanent. `hidden` controls whether
 * something is advertised, and `archived` records that it is no longer
 * maintained; neither is a reason to stop answering a link someone already has.
 *
 * `shim` is excluded: a shim is a compatibility stub standing in for an old
 * path, not a thing worth a permanent public name of its own.
 */
export const PUBLISHABLE_STATUSES: ReadonlySet<string> = new Set(['active', 'hidden', 'archived']);

const ROUTE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** `owner/name`, the only shape a repository reference may take. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Whitespace or a control character anywhere that reaches generated output.
 *
 * `_redirects` is line-oriented and space-separated, so a newline inside a path
 * ends the rule being written and starts one nobody authored. On a domain we
 * own that is an open redirect, which is a usable phishing primitive. Catalogs
 * are trusted input today; this is the boundary where an upstream mistake would
 * otherwise become a live redirect.
 */
const UNSAFE_IN_OUTPUT = /[\s\p{Cc}]/u;

/**
 * Reserved so a slug can never shadow a service route. `docs`, `live`, and
 * `source` are held back for per-link variants that do not exist yet, so adding
 * them later cannot collide with a slug already published.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  '404',
  'api',
  'assets',
  'docs',
  'health',
  'index',
  'live',
  'source',
]);

function assertSafeRepo(repo: string, label: string): void {
  if (!REPO_PATTERN.test(repo)) {
    throw new RegistryError(`${label}: '${repo}' is not an owner/name repository reference`);
  }
}

function assertSafeRef(ref: string, label: string): void {
  if (ref.length === 0 || UNSAFE_IN_OUTPUT.test(ref)) {
    throw new RegistryError(`${label}: ref '${ref}' contains whitespace or a control character`);
  }
}

/**
 * A path is interpolated into both a URL and a redirect line, so it must be
 * relative, free of whitespace and control characters, and free of `..`, which
 * would let a catalog entry address a tree other than the one it names.
 */
function assertSafePath(path: string, label: string): void {
  if (UNSAFE_IN_OUTPUT.test(path)) {
    throw new RegistryError(`${label}: path '${path}' contains whitespace or a control character`);
  }
  if (path.startsWith('/')) throw new RegistryError(`${label}: path '${path}' must be relative`);
  if (path.split('/').includes('..')) throw new RegistryError(`${label}: path '${path}' must not contain '..'`);
}

/**
 * Check a route is legal to publish. Shared by every input shape so the rules a
 * URL must satisfy cannot drift between them.
 */
export function assertPublishableSlug(slug: string, origin: string): void {
  if (!ROUTE_PATTERN.test(slug)) {
    throw new RegistryError(`${origin}: route '${slug}' must contain lowercase kebab-case path segments`);
  }
  const firstSegment = slug.split('/', 1)[0] ?? '';
  if (RESERVED_SLUGS.has(firstSegment)) {
    throw new RegistryError(
      `${origin}: route '${slug}' starts with '${firstSegment}', which is reserved for the service`,
    );
  }
}

/**
 * Assemble and validate a destination URL. The last checkpoint before a string
 * becomes a redirect line, so every input shape goes through it.
 */
export function buildDestination(target: RepoTarget, path: string, label: string): string {
  assertSafeRepo(target.repo, label);
  assertSafeRef(target.ref, label);
  assertSafePath(path, label);

  const destination = `https://github.com/${target.repo}/tree/${target.ref}/${path}`;

  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    throw new RegistryError(`${label}: '${destination}' is not a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new RegistryError(`${label}: '${destination}' is not https`);

  return destination;
}

function requireString(entry: SourceEntry, field: 'sourceRepo' | 'sourcePath', origin: string): string {
  const value = entry[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RegistryError(`${origin}: '${entry.id}' is published but has no ${field}`);
  }
  return value;
}

function destinationFor(entry: SourceEntry, config: Config, origin: string): string {
  const label = `${origin}: '${entry.id}'`;
  const sourceRepo = requireString(entry, 'sourceRepo', origin);
  const sourcePath = requireString(entry, 'sourcePath', origin);

  assertSafeRepo(sourceRepo, label);

  const target = config.repos[sourceRepo];
  if (!target) {
    // Defaulting here would publish a link into a repository nobody chose.
    throw new RegistryError(`${label} points at unknown repository '${sourceRepo}'. Add it to 'repos' in the config.`);
  }

  return buildDestination(target, sourcePath, label);
}

/**
 * Reduce source entries to the links that should be published.
 *
 * Only entries with a slug are published, and only in a status that may hold
 * one; see `PUBLISHABLE_STATUSES`.
 */
export function buildLinks(entries: readonly SourceEntry[], config: Config, origin: string): Link[] {
  const links: Link[] = [];
  const claimed = new Map<string, string>();

  for (const entry of entries) {
    if (typeof entry.slug !== 'string' || entry.slug.length === 0) continue;

    const status = entry.status ?? '';
    if (!PUBLISHABLE_STATUSES.has(status)) {
      throw new RegistryError(
        `${origin}: '${entry.id}' has slug '${entry.slug}' but status '${status}', which cannot hold one`,
      );
    }
    assertPublishableSlug(entry.slug, origin);

    const owner = claimed.get(entry.slug);
    if (owner) {
      throw new RegistryError(`${origin}: slug '${entry.slug}' is claimed by both '${owner}' and '${entry.id}'`);
    }
    claimed.set(entry.slug, entry.id);

    links.push({ slug: entry.slug, id: entry.id, destination: destinationFor(entry, config, origin) });
  }

  return links.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function parseEntries(raw: string, origin: string): SourceEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryError(`${origin}: not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new RegistryError(`${origin}: expected an array of entries`);

  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new RegistryError(`${origin}: entry at index ${index} is not an object`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      throw new RegistryError(`${origin}: entry at index ${index} has no id`);
    }
    return candidate as unknown as SourceEntry;
  });
}
