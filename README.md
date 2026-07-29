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

Fork this repository, then:

```bash
bun install
cp links.example.json links.json    # your registry
bun run build                       # writes dist/
```

Point `linkkeeper.json` at wherever your registry lives, wire the deploy below,
and the URLs are yours.

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

## Setup

Point `linkkeeper.json` at that registry:

```json
{ "links": { "repo": "you/repo", "file": "links.json" } }
```

Then:

```bash
bun run build    # write dist/, ready for Cloudflare Pages
bun run check    # request every destination, fail on any 404
```

`dist/` holds the generated `_redirects` plus everything in `public/`. Point a
Cloudflare Pages project at it and attach your domain.

To redeploy when the registry changes, send a `repository_dispatch` from the
repository that owns it:

```yaml
- run: |
    gh api repos/you/linkkeeper/dispatches \
      --field event_type=source-updated \
      --field "client_payload[sha]=${GITHUB_SHA}"
```

The sending job needs credentials that can dispatch here. A GitHub App scoped to
this repository beats a personal token: no expiry, not tied to one person's
account, and a fresh token per run. A fine-grained PAT with `Contents: read and
write` works too.

### Order matters

Provision before wiring up the dispatch. A dispatch that cannot authenticate
should fail the job rather than skip quietly, since a silent skip leaves the
published redirects stale while every check stays green. That means the sending
workflow is red from the moment it lands if its credentials are not in place.

1. Create the Pages project, set `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` here, and deploy once. An empty table is a valid
   deploy and proves the pipeline. If the project is not named after the
   repository, set the `CLOUDFLARE_PAGES_PROJECT` variable.
2. Attach the domain and confirm it resolves.
3. Give the source repository credentials that can dispatch here, and nothing
   else.
4. Merge the change that adds the registry and the sending workflow.
5. Confirm the routes resolve before pointing documentation at them.

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

Cloudflare Pages is the only deploy target. The core is plain data in, string
out, so another target is a renderer and a workflow, not a rewrite.

Not built yet, deliberately: telling you a registered path vanished in a pull
request, and suggesting where it moved. That is the next thing worth adding once
there are real reorganizations to learn from.

## License

MIT
