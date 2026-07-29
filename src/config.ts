/**
 * Loading and validating `linkkeeper.json`, the deploy-side config.
 *
 * It says where links come from. Two shapes, because two situations are real:
 *
 *   { "links": "links.json" }
 *     The native registry, authored by hand in the repository whose paths move.
 *     This is what a new project should use.
 *
 *   { "catalog": { "repo": "...", "files": [...], "repos": { ... } } }
 *     An existing catalog the project already maintains for other reasons.
 *     Adopting linkkeeper should not mean duplicating a list that already
 *     exists, so entries are read in place and mapped to the same links.
 */
import { RegistryError, type Config } from './registry.ts';
import type { SourceSpec } from './source.ts';

export interface LinksSource {
  kind: 'links';
  /** Repository holding the registry, as `owner/name`. */
  repo: string;
  /** Path to the registry within that repository. */
  file: string;
}

export interface CatalogSource extends Config {
  kind: 'catalog';
  source: SourceSpec;
}

export type FileConfig = LinksSource | CatalogSource;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RegistryError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RegistryError(`${label} must be a non-empty string`);
  return value;
}

function parseCatalog(root: Record<string, unknown>, path: string): CatalogSource {
  const catalog = asRecord(root.catalog, `${path}: 'catalog'`);
  const files = catalog.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new RegistryError(`${path}: 'catalog.files' must be a non-empty array`);
  }

  const reposRaw = asRecord(catalog.repos, `${path}: 'catalog.repos'`);
  const repos: Config['repos'] = {};
  for (const [key, value] of Object.entries(reposRaw)) {
    const target = asRecord(value, `${path}: 'catalog.repos.${key}'`);
    repos[key] = {
      repo: asNonEmptyString(target.repo, `${path}: 'catalog.repos.${key}.repo'`),
      ref: asNonEmptyString(target.ref, `${path}: 'catalog.repos.${key}.ref'`),
    };
  }
  if (Object.keys(repos).length === 0) throw new RegistryError(`${path}: 'catalog.repos' must not be empty`);

  return {
    kind: 'catalog',
    source: {
      repo: asNonEmptyString(catalog.repo, `${path}: 'catalog.repo'`),
      files: files.map((file, index) => asNonEmptyString(file, `${path}: 'catalog.files[${index}]'`)),
    },
    repos,
  };
}

export function parseConfig(raw: string, path: string): FileConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryError(`${path}: not valid JSON: ${(err as Error).message}`);
  }

  const root = asRecord(parsed, path);

  const hasLinks = root.links !== undefined;
  const hasCatalog = root.catalog !== undefined;
  if (hasLinks && hasCatalog) {
    throw new RegistryError(`${path}: set 'links' or 'catalog', not both`);
  }
  if (!hasLinks && !hasCatalog) {
    throw new RegistryError(`${path}: set 'links' (a registry file) or 'catalog' (an existing catalog to read)`);
  }

  if (hasLinks) {
    const links = asRecord(root.links, `${path}: 'links'`);
    return {
      kind: 'links',
      repo: asNonEmptyString(links.repo, `${path}: 'links.repo'`),
      file: asNonEmptyString(links.file, `${path}: 'links.file'`),
    };
  }

  return parseCatalog(root, path);
}
