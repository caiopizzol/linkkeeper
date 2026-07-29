# linkkeeper

Permanent URLs for things that move.

GitHub keeps a repository URL working after a rename, but it does not redirect
directories moved inside a repository. Linkkeeper puts a URL you control in
front of those paths:

```text
go.example.com/react -> github.com/you/repo/tree/main/examples/react
```

Move the directory, update its path in the registry, and the public URL keeps
working.

## Quick start

Linkkeeper reads two files from your repository:

```text
linkkeeper.json  Where the registry lives
links.json       Permanent slugs and their current destinations
```

Create `linkkeeper.json`:

```json
{
  "links": {
    "repo": "you/your-repo",
    "file": "links.json"
  }
}
```

Create `links.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/caiopizzol/linkkeeper/v0.1.0/schema/links.schema.json",
  "version": 1,
  "defaults": {
    "repository": "you/your-repo",
    "ref": "main"
  },
  "links": {
    "react": {
      "path": "examples/react"
    }
  }
}
```

Build the redirect table:

```bash
npx linkkeeper@0.1.0 check
npx linkkeeper@0.1.0 build
```

`check` verifies every destination. `build` writes a Cloudflare Pages redirect
table and 404 page to `dist/`.

Deploy `dist/` to Cloudflare Pages and attach your domain. From then on,
`go.example.com/react` is the permanent URL. Pinning the Linkkeeper version
keeps deployments reproducible; upgrading is an explicit version change.

## Registry

Each key under `links` is a permanent public slug. Its repository, ref, and
path may change:

```json
{
  "links": {
    "react": {
      "path": "examples/getting-started/react"
    },
    "demo": {
      "repository": "you/demos",
      "path": "showcase"
    }
  }
}
```

Keep the registry beside the code whose paths move. The move and destination
update can then land in the same commit, while Git retains the full path
history.

The schema provides editor autocomplete and catches malformed slugs,
repositories, refs, and paths. Linkkeeper also rejects duplicate JSON keys and
unknown properties instead of silently choosing a destination.

Do not rename or reuse a published slug. Linkkeeper validates the registry as
it exists today, so your repository must preserve the history of public slugs.

## Commands

```bash
npx linkkeeper@0.1.0 check
npx linkkeeper@0.1.0 build [--commit <sha>] [--out <directory>]
```

- `check` requests every destination and fails when one does not resolve.
- `build` generates `_redirects` and copies static files into `dist/`.
- `--commit` reads the registry at an exact Git commit.
- `--out` changes the output directory.

Put a custom `404.html` in `public/` next to `linkkeeper.json` to replace the
default page.

## Using an existing catalog

If your project already has a machine-readable catalog, use it directly rather
than maintaining a second registry:

```json
{
  "catalog": {
    "repo": "you/repo",
    "files": ["examples/manifest.json"],
    "repos": {
      "you/repo": {
        "repo": "you/repo",
        "ref": "main"
      }
    }
  }
}
```

Catalog entries use `id`, `slug`, `status`, `sourceRepo`, and `sourcePath`.
Only entries with a slug are published. Additional fields are ignored.

Use `links.json` for a new project. Catalog input exists for projects that
already own the same data in another format.

## Deployment notes

Cloudflare Pages is the only deployment target in v0.1. The generated output is
static, so there is no runtime or database to operate.

When the registry and deployment live in the same repository, rebuild on
changes to `linkkeeper.json`, the registry, or `public/`.

When they live in separate repositories, trigger the deployment with the exact
source commit and pass it to `--commit`. This prevents one build from reading
files from different revisions.

Redirects use `302`, not `301`, because destinations are expected to change.
Paths and refs are validated before rendering so control characters or `..`
cannot inject another rule into `_redirects`.

## Development

Requirements:

- Node.js 24 or newer for the published CLI
- Bun 1.3.14 or newer for development

Set up the repository:

```bash
git clone https://github.com/caiopizzol/linkkeeper.git
cd linkkeeper
bun install --frozen-lockfile
```

Run the same checks as CI:

```bash
bun run format:check
bun run typecheck
bun test
bun run compile
```

The packed CLI smoke test in CI also installs the generated npm package in an
empty directory. This catches packaging problems that do not appear when the
CLI runs from the source tree.

### Codebase

```text
src/cli.ts              CLI and output assembly
src/config.ts           linkkeeper.json parsing
src/links-file.ts       links.json parsing
src/registry.ts         validation and normalized links
src/source.ts           GitHub source resolution
src/targets/pages.ts    Cloudflare Pages renderer
src/verify.ts           destination checks
schema/                 JSON Schema for links.json
public/                 default static files
__tests__/              unit and packaging coverage
```

All inputs become the same `{ slug, destination }` representation before a
target renders them. Keep source parsing independent from deployment targets.

## Status

Linkkeeper v0.1 is used in production at
[go.superdoc.dev](https://go.superdoc.dev). Cloudflare Pages is the only target
today. A self-hosted server and container are intentionally deferred until
real usage justifies maintaining a second runtime.

## License

MIT
