# linkkeeper

Permanent URLs for things that move.

Git forges redirect a repository when you rename it. They do not redirect a
directory when you move it inside a repository. So every link you have ever
published to `github.com/you/repo/tree/main/examples/thing` breaks the day you
reorganize, silently, in blog posts and chat history and other people's
documentation you cannot edit.

linkkeeper puts a URL you own in front of that path:

```
go.example.com/react  ->  github.com/you/repo/tree/main/examples/getting-started/react
```

Move the directory, update one line, and the public URL keeps working.

## Quick start

Two files in a repository of your own. No fork, no clone.

```bash
npx linkkeeper build
```

`linkkeeper.json` says where your links come from:

```json
{ "links": { "repo": "you/your-repo", "file": "links.json" } }
```

`links.json` is the registry, and lives in the repository whose paths move:

```json
{
  "version": 1,
  "defaults": { "repository": "you/your-repo", "ref": "main" },
  "links": { "react": { "path": "examples/getting-started/react" } }
}
```

That writes `dist/`, ready for Cloudflare Pages. Attach a domain and
`your-domain.com/react` resolves to the path above, permanently.

Upgrading is a version bump, not a merge. Your registry is yours; linkkeeper is
a dependency.

## The registry

Keep a `links.json` in the repository whose paths move, so a move and its
redirect land in the same commit:

```json
{
  "$schema": "https://raw.githubusercontent.com/caiopizzol/linkkeeper/main/schema/links.schema.json",
  "version": 1,
  "defaults": { "repository": "you/repo", "ref": "main" },
  "links": {
    "react": { "path": "examples/getting-started/react" },
    "doc-rag": { "repository": "you/demos", "path": "rag" }
  }
}
```

The key is the permanent public slug. Everything inside it may change.

Repeating a key is rejected. JSON text can carry the same key twice and most
parsers silently keep the last one, which for a registry keyed by permanent
slug is precisely the failure it exists to prevent. Unknown properties are
rejected too, so `repositry` is an error rather than a link quietly pointing at
the default repository.

`defaults` keeps the common case short. A link overrides `repository` or `ref`
only when it differs.

The `$schema` line gives you autocomplete and inline errors in most editors. It
points at `main`, so it moves with the format. Once version 1 has survived
real-world use it will be tagged and this URL should be pinned to that tag.

## Commands

```bash
npx linkkeeper build    # write dist/, ready for Cloudflare Pages
npx linkkeeper check    # request every destination, fail on any 404
```

`build` takes `--commit <sha>` to pin the revision the registry is read at, and
`--out <dir>` to write somewhere other than `dist/`.

`dist/` holds the generated `_redirects` and a default 404 page. Drop your own
`public/` next to `linkkeeper.json` to replace it.

## Deploying

### Cloudflare Pages

The whole output is static, so there is no server to run.

1. Create a Pages project and point it at `dist/`.
2. Attach your domain.
3. Run `build` in CI on every registry change, then deploy `dist/`.

A workflow that does that:

```yaml
- run: npx linkkeeper check
- run: npx linkkeeper build
- uses: cloudflare/wrangler-action@v4
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: pages deploy ./dist --project-name=your-project --branch=main
```

Run `check` before `build`, so a broken destination fails the pipeline rather
than reaching the deploy.

### Rebuilding when the registry changes

If the registry lives in a different repository from the deploy, that repository
has to say when it changed. A `repository_dispatch` carrying the commit is
enough:

```yaml
- run: |
    gh api repos/you/your-deploy-repo/dispatches \
      --field event_type=source-updated \
      --field "client_payload[sha]=${GITHUB_SHA}"
```

The receiving workflow passes that SHA to `--commit`, so the deploy is pinned to
the revision that triggered it rather than to whatever `main` holds by the time
it runs.

A dispatch that cannot authenticate should fail the job rather than skip
quietly: a silent skip leaves the published redirects stale while every check
stays green.

## Already have a catalog?

If the project keeps a machine-readable list of these things for other reasons,
linkkeeper can read it in place rather than making you maintain a second list:

```json
{
  "catalog": {
    "repo": "you/repo",
    "files": ["examples/manifest.json"],
    "repos": { "you/repo": { "repo": "you/repo", "ref": "main" } }
  }
}
```

Entries need `id`, `slug`, `status`, `sourceRepo`, and `sourcePath`; anything
else is ignored. Only entries carrying a slug are published. `repos` maps the
repository names the catalog uses onto the ones links should point at, which is
how a repository rename is absorbed without editing every entry.

Prefer `links.json` for a new project. This exists so adopting linkkeeper never
means duplicating a list you already keep.

## Design

**Redirects are 302, never 301.** The premise is that destinations move. A 301
is cached by browsers indefinitely and cannot be withdrawn from the server, so
one wrong permanent redirect outlives every fix you can deploy.

**Sources are read at a commit, never at a branch.** A branch moves between
reads, so a build could take two files from two revisions and have no record of
what it shipped. The commit comes from whoever triggers the deploy.

**Destinations are checked before they go live.** A registry only says what it
believes. `check` requests every URL and fails on a 404, because a published
link to a missing page reads as a deleted project.

**Paths and refs are validated before they reach output.** `_redirects` is
line-oriented, so a newline inside a path would end one rule and begin another
that nobody wrote — on your own domain, that is an open redirect. Paths must be
relative, free of whitespace and control characters, and free of `..`;
repository names must be `owner/name`; and the assembled destination must parse
as an HTTPS URL.

**Slugs are permanent, including after withdrawal.** A published slug is a
public API: renaming or reusing one breaks links you do not control. The tool
enforces format and reserved names, but it reads the registry as it stands
today, so it cannot know a slug used to be spelled differently. Not renaming one
is a rule you keep, not a rule it enforces.

**Git is the path history.** Every destination change is a commit that records
what moved, when, and why. There is no second history to keep in sync.

## Status

Early. It is in production on one link namespace, and the registry format has
met one existing catalog shape and one hand-authored registry so far. If you try
it on something different, the interesting question is what did not fit.

Cloudflare Pages is the only deploy target today. Two things keep the next one
cheap rather than a rewrite:

- Every input becomes the same list of `{slug, destination}`. A target consumes
  that list and knows nothing about where it came from, which is why
  `src/targets/` exists as a directory with one file in it.
- `src/` imports only `node:` builtins and has no dependencies, so it runs on
  Node, Bun, and Deno as-is. A test asserts this rather than trusting it.

So a self-hosted target is `src/targets/serve.ts` plus a Dockerfile: read the
same list, answer 302s over HTTP. That image then runs anywhere containers run,
which is what "GCP support" would mean too — Cloud Run takes an OCI image, so it
is a deployment guide rather than code. The same is true of Fly, Railway, ECS,
and a VM.

That is deliberately not built yet. Publishing a container means maintaining a
second target, and there is no one on the second target. It is also worth
knowing before writing one that Cloudflare does not document how `_redirects`
treats query strings, trailing slashes, or case, so matching its behaviour
exactly needs measuring first. Two targets that disagree on `?utm_source=x`
would be worse than one target.

Also not built, and the more likely next step: telling you a registered path
vanished in a pull request, and suggesting where it moved.

## License

MIT
