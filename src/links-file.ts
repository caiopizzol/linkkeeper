/**
 * The native registry: `links.json`, authored by hand in the repository whose
 * paths move.
 *
 * Slugs are object keys rather than a field on each entry. That puts the
 * permanent name and the disposable path visibly on different lines, and makes
 * a collision a syntax-level mistake rather than a semantic one:
 *
 *   {
 *     "version": 1,
 *     "defaults": { "repository": "acme/product", "ref": "main" },
 *     "links": {
 *       "react": { "path": "examples/react" },
 *       "docs-rag": { "repository": "acme/demos", "path": "rag" }
 *     }
 *   }
 *
 * `defaults` exists so the common case — one repository, one ref — is not
 * repeated on every entry. A link may override either.
 *
 * Unknown properties are rejected rather than ignored: `repositry` should fail
 * loudly, not silently publish the default repository.
 */
import { RegistryError, assertPublishableSlug, buildDestination, type Link, type RepoTarget } from './registry.ts';

/** Bumped only for a breaking change to this file's shape. */
export const LINKS_FILE_VERSION = 1;

export interface LinksFile {
  version: number;
  defaults: RepoTarget;
  links: Record<string, { repository?: string; ref?: string; path: string }>;
}

/**
 * Reject duplicate object keys, which `JSON.parse` would otherwise hide.
 *
 * AIDEV-NOTE: JSON *text* may repeat a key; `JSON.parse` silently keeps the
 * last value. For a registry keyed by permanent slug that is the exact failure
 * it exists to prevent: two entries claiming `/react`, one silently winning, no
 * error. A `JSON.parse` reviver cannot catch this — it only ever sees the
 * surviving key — so the raw text has to be walked. This is a small scanner
 * rather than a regex because a regex cannot tell a brace inside a string from
 * a structural one, and `{"path": "a{b"}` would break it.
 */
function assertNoDuplicateKeys(raw: string, origin: string): void {
  // One set of seen keys per object depth. Arrays index numerically and cannot
  // collide, so only object frames collect keys.
  const frames: (Set<string> | null)[] = [];
  let index = 0;

  const readString = (): string => {
    // Caller has consumed the opening quote.
    let out = '';
    while (index < raw.length) {
      const ch = raw[index++];
      if (ch === '\\') {
        // Whatever follows an escape cannot end the string. The exact value
        // does not matter here: only key identity does, and JSON.parse has
        // already accepted the escape if we got this far.
        out += raw[index++] ?? '';
        continue;
      }
      if (ch === '"') return out;
      out += ch;
    }
    return out;
  };

  while (index < raw.length) {
    const ch = raw[index++];

    if (ch === '"') {
      const value = readString();
      // A string is a key when the next non-space character is a colon and the
      // innermost frame is an object.
      let peek = index;
      while (peek < raw.length && /\s/.test(raw[peek] ?? '')) peek++;
      if (raw[peek] === ':') {
        const frame = frames[frames.length - 1];
        if (frame) {
          if (frame.has(value)) {
            throw new RegistryError(`${origin}: duplicate key '${value}'; each key may appear once`);
          }
          frame.add(value);
        }
      }
      continue;
    }

    if (ch === '{') frames.push(new Set());
    else if (ch === '[') frames.push(null);
    else if (ch === '}' || ch === ']') frames.pop();
  }
}

function parseStrictJson(raw: string, origin: string): unknown {
  const parsed = JSON.parse(raw);
  // Only reached when the text is valid JSON, so the scanner never has to
  // handle malformed input.
  assertNoDuplicateKeys(raw, origin);
  return parsed;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RegistryError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RegistryError(`${label} must be a non-empty string`);
  }
  return value;
}

/**
 * Reject properties the format does not define.
 *
 * A typo like `repositry` is worse than an error: the value is dropped, the
 * default repository is used instead, and a link quietly points somewhere it
 * was never meant to. This is also what the JSON Schema declares, so an editor
 * and the build agree.
 */
function assertKnownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new RegistryError(`${label}: unknown property '${key}' (allowed: ${allowed.join(', ')})`);
    }
  }
}

export function parseLinksFile(raw: string, origin: string): LinksFile {
  let parsed: unknown;
  try {
    parsed = parseStrictJson(raw, origin);
  } catch (err) {
    if (err instanceof RegistryError) throw err;
    throw new RegistryError(`${origin}: not valid JSON: ${(err as Error).message}`);
  }

  const root = asRecord(parsed, origin);
  // `$schema` is an editor hint, not part of the format, so it is allowed and
  // otherwise ignored.
  assertKnownKeys(root, ['$schema', 'version', 'defaults', 'links'], origin);

  if (root.version !== LINKS_FILE_VERSION) {
    throw new RegistryError(
      `${origin}: unsupported version ${JSON.stringify(root.version)}; this linkkeeper reads version ${LINKS_FILE_VERSION}`,
    );
  }

  const defaults = asRecord(root.defaults, `${origin}: 'defaults'`);
  assertKnownKeys(defaults, ['repository', 'ref'], `${origin}: 'defaults'`);

  const links = asRecord(root.links, `${origin}: 'links'`);

  const parsedLinks: LinksFile['links'] = {};
  for (const [slug, value] of Object.entries(links)) {
    const label = `${origin}: links.${slug}`;
    const entry = asRecord(value, `${origin}: 'links.${slug}'`);
    assertKnownKeys(entry, ['path', 'repository', 'ref'], label);

    parsedLinks[slug] = {
      path: asNonEmptyString(entry.path, `${label}.path`),
      ...(entry.repository === undefined
        ? {}
        : { repository: asNonEmptyString(entry.repository, `${label}.repository`) }),
      ...(entry.ref === undefined ? {} : { ref: asNonEmptyString(entry.ref, `${label}.ref`) }),
    };
  }

  return {
    version: LINKS_FILE_VERSION,
    defaults: {
      repo: asNonEmptyString(defaults.repository, `${origin}: 'defaults.repository'`),
      ref: asNonEmptyString(defaults.ref, `${origin}: 'defaults.ref'`),
    },
    links: parsedLinks,
  };
}

/** Reduce a registry to published links, sorted so generated output is stable. */
export function linksFromFile(file: LinksFile, origin: string): Link[] {
  return Object.entries(file.links)
    .map(([slug, entry]) => {
      assertPublishableSlug(slug, origin);
      const target: RepoTarget = {
        repo: entry.repository ?? file.defaults.repo,
        ref: entry.ref ?? file.defaults.ref,
      };
      return {
        slug,
        id: slug,
        destination: buildDestination(target, entry.path, `${origin}: '${slug}'`),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
