#!/usr/bin/env node
/**
 * linkkeeper CLI.
 *
 *   linkkeeper build [--commit <sha>] [--out <dir>]
 *   linkkeeper check [--commit <sha>]
 *
 * Both read `linkkeeper.json` from the working directory. `--commit` pins the
 * revision links are read at; without it the source's default branch is
 * resolved to a commit first, so a build is always tied to one revision.
 */
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseConfig, type FileConfig } from './config.ts';
import { RegistryError, buildLinks, type Link } from './registry.ts';
import { linksFromFile, parseLinksFile } from './links-file.ts';
import { renderRedirects } from './targets/pages.ts';
import { fetchEntries, fetchFile, resolveCommit } from './source.ts';
import { findBrokenLinks } from './verify.ts';

const CONFIG_FILE = 'linkkeeper.json';

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new RegistryError(`--${name} needs a value`);
  return value;
}

function sourceRepo(config: FileConfig): string {
  return config.kind === 'links' ? config.repo : config.source.repo;
}

async function resolveLinks(config: FileConfig, commit: string): Promise<Link[]> {
  const label = `${sourceRepo(config)}@${commit}`;

  if (config.kind === 'links') {
    const { text, origin } = await fetchFile(config.repo, config.file, commit);
    return linksFromFile(parseLinksFile(text, origin), origin);
  }

  return buildLinks(await fetchEntries(config.source, commit), config, label);
}

async function load(argv: readonly string[]): Promise<{ links: Link[]; label: string }> {
  const config = parseConfig(await readFile(path.resolve(CONFIG_FILE), 'utf8'), CONFIG_FILE);
  const commit = flag(argv, 'commit') ?? (await resolveCommit(sourceRepo(config), 'HEAD'));

  return { links: await resolveLinks(config, commit), label: `${sourceRepo(config)}@${commit}` };
}

/**
 * The static files copied alongside the redirect table.
 *
 * A `public/` in the working directory wins, so a project can ship its own 404
 * page. Otherwise the one bundled with linkkeeper is used, which is what makes
 * `linkkeeper build` work in a directory holding nothing but a config.
 */
async function resolveStaticDir(): Promise<string> {
  const local = path.resolve('public');
  try {
    await stat(local);
    return local;
  } catch {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  }
}

async function build(argv: readonly string[]): Promise<void> {
  const { links, label } = await load(argv);
  const outDir = path.resolve(flag(argv, 'out') ?? 'dist');

  const { content, warnings } = renderRedirects(links, label);

  await mkdir(outDir, { recursive: true });
  await cp(await resolveStaticDir(), outDir, { recursive: true });
  await writeFile(path.join(outDir, '_redirects'), content);

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  console.log(`built ${links.length} links from ${label}`);
}

async function check(argv: readonly string[]): Promise<void> {
  const { links, label } = await load(argv);
  const failures = await findBrokenLinks(links);

  if (failures.length > 0) {
    console.error(`${failures.length} of ${links.length} destinations do not resolve:\n`);
    for (const { link, status } of failures) {
      console.error(`  /${link.slug}  [${status}]  ${link.destination}`);
      console.error(`    the path moved or was deleted; update it, or drop the slug until the source is back\n`);
    }
    process.exit(1);
  }

  console.log(`all ${links.length} destinations resolve (${label})`);
}

const [command = '', ...rest] = process.argv.slice(2);

try {
  if (command === 'build') await build(rest);
  else if (command === 'check') await check(rest);
  else {
    console.error('usage: linkkeeper <build|check> [--commit <sha>] [--out <dir>]');
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof RegistryError ? err.message : err);
  process.exit(1);
}
