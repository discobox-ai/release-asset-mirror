# release-asset-mirror

A Cloudflare Worker that serves GitHub Release assets from a domain you
control, using R2 as a disposable read-through cache.

```text
https://assets.example.com/tools/v1.4.0/disk.img     # a concrete release tag
https://assets.example.com/tools/latest/disk.img     # 302 -> /tools/v1.4.0/...
https://assets.example.com/tools/prerelease/disk.img # 302 -> /tools/v1.5.0-rc.1/...
```

One deployment can front any number of repositories. The first path segment is
a **namespace** you choose, mapped at deploy time to the repository it mirrors:

```jsonc
"REPOSITORIES": {
  "tools": "acme/tools",
  "images": "acme-labs/base-images",
}
```

Because the namespace is yours rather than GitHub's, the URL survives the
repository moving between owners or being renamed — you edit one line of
config and every published link keeps working.

## Why

GitHub Release downloads are fine for humans and awkward for programs: the URLs
are long, `latest` is a redirect chain, there is no CORS header, byte ranges are
unreliable, and heavy traffic is not what releases are for. This Worker puts a
short, stable, CORS-enabled, range-capable URL in front of them and caches each
asset in R2 on first request.

- **Immutable by construction.** A concrete tag's asset is cached forever
  (`max-age=31536000, immutable`); `latest` and `prerelease` are short-lived
  redirects, never cache keys.
- **No manifest, no sync job.** GitHub remains the source of truth. The first
  request for an asset fills the cache; there is nothing to publish or prewarm.
- **Single-flight fills.** A Durable Object holds a per-asset lock, so a
  thundering herd on a cold 200 MB image downloads it from GitHub once.
- **Not an open proxy.** Only the namespaces in `REPOSITORIES` resolve to
  anything, and each value must look like `owner/repository`. No request can
  reach a repository the operator did not list.

## How it works

```text
GET /tools/v1.4.0/disk.img
  └─ namespace "tools" -> acme/tools
     └─ R2 hit  ─────────────────────────────► stream from R2 (or 302 to R2)
     └─ R2 miss ─► Coordinator DO (lock) ─► GitHub ─► put in R2 ─► serve

GET /tools/latest/disk.img
  └─ resolve tag via GitHub ─► 302 /tools/v1.4.0/disk.img  (cached at the edge)
```

Assets live in R2 under `releases/{namespace}/{tag}/{asset}`, so two mirrors
that publish the same tag never collide. Responses support `GET`, `HEAD`,
`ETag`/`If-None-Match`, `Access-Control-Allow-Origin: *`, and single byte
ranges.

`latest` resolves through GitHub's public latest-download redirect, so it costs
no API quota and sees only stable releases. `prerelease` uses the Releases API
and picks the most recently published release flagged as a prerelease. Draft
releases are never visible.

Anything that is not exactly `/{namespace}/{tag}/{asset}` is a `404`, as is an
unknown namespace. A failure outside the Worker — GitHub unreachable, a
rate-limited `prerelease` lookup, a download that will not start — answers
`502` and names the cause. A `500` means a bug in the Worker itself.

## Deploy your own

You need a Cloudflare account with R2 enabled. If this is your first R2
project, open **Storage & databases → R2** in the dashboard and complete the
subscription checkout; the free tier still applies. Node.js 22 or newer.

**1. Clone and install.**

```sh
git clone https://github.com/discobox-ai/release-asset-mirror
cd release-asset-mirror
npm install
npx wrangler login
```

**2. Configure.** Edit the default deployment block in `wrangler.jsonc`:

| Setting                     | What to put there                                      |
| --------------------------- | ------------------------------------------------------ |
| `name`                      | Worker name, e.g. `acme-release-assets`                |
| `vars.REPOSITORIES`         | One `"namespace": "owner/repository"` entry per mirror |
| `r2_buckets[0].bucket_name` | R2 bucket for the cache                                |
| `routes`                    | Your hostname (uncomment; see below)                   |

**3. Create the bucket** — the name must match `bucket_name`:

```sh
npx wrangler r2 bucket create acme-release-assets
```

**4. Deploy.**

```sh
npm run check
npm run deploy
```

Wrangler prints the deployed URL. The Durable Object uses SQLite storage and
works on both the Workers Free and Paid plans; the `v1` migration creates it on
the first deploy.

### Serve it on your own domain

Add a custom domain route to the deployment block. The zone must be in the same
Cloudflare account; Wrangler creates the DNS record and certificate for you.

```jsonc
"workers_dev": false,
"routes": [{ "pattern": "assets.example.com", "custom_domain": true }],
```

Redeploy, and the mirror answers on `https://assets.example.com/`.

### Adding a repository later

Add an entry to `REPOSITORIES` and redeploy. Nothing else changes: existing
namespaces keep their cached objects, and the new one fills on first request.

### More than one deployment

Namespaces cover most reasons to want a second mirror. When you genuinely need
separate Workers — a different domain, account, or R2 bucket — add a named
environment to `env` in `wrangler.jsonc` and deploy it with `--env`. Wrangler
does **not** inherit `vars`, `r2_buckets` or `durable_objects` into a named
environment, so each block repeats them in full:

```sh
npx wrangler deploy --env staging
```

The `example` environment in `wrangler.jsonc` is a template, not a live
deployment. It exists so `npm run check` bundles the named-environment path,
and is safe to delete.

### Deploying from another repository

Committing a real deployment's configuration here would make every fork
inherit it. A deployment you operate is better kept in its own repository,
depending on a pinned version of this one:

```jsonc
// package.json
"dependencies": {
  "release-asset-mirror": "github:discobox-ai/release-asset-mirror#v0.2.0"
}
```

```ts
// src/index.ts — the entry point wrangler bundles
export { default, Coordinator } from "release-asset-mirror";
```

That repository's own `wrangler.jsonc` carries the Worker name, `REPOSITORIES`,
routes and bucket, with `"main": "src/index.ts"`. Upgrading is a version bump
in one file, and the deployed version is legible from the lockfile rather than
from whoever last ran `deploy`.

`Coordinator` must be re-exported: Wrangler resolves the Durable Object class
from the entry point, and a deployment that omits it fails at bundle time.

### Deploying from CI

`.github/workflows/deploy.yml` deploys on demand instead of from a laptop. Add
a Cloudflare API token with **Edit Cloudflare Workers** and R2 read/write
permissions as the `CLOUDFLARE_API_TOKEN` repository secret, then run the
**Deploy** workflow and name the environment (empty for the default one).

## Configuration reference

Everything except the GitHub token is a plain var in `wrangler.jsonc`.

| Var                       | Default | Meaning                                                                                                                                                             |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPOSITORIES`            | —       | **Required.** Object mapping each URL namespace to `owner/repository`. Namespaces are `[A-Za-z0-9][A-Za-z0-9._-]*`; anything else, or an unlisted name, is a `404`. |
| `ALIAS_TTL_SECONDS`       | `60`    | How long a resolved `latest`/`prerelease` tag is trusted globally.                                                                                                  |
| `EDGE_ALIAS_TTL_SECONDS`  | `60`    | How long each Cloudflare location caches an alias redirect.                                                                                                         |
| `R2_PUBLIC_BASE_URL`      | `""`    | Empty streams assets through the Worker. See below.                                                                                                                 |
| `R2_REDIRECT_TTL_SECONDS` | `3600`  | Lifetime of the redirect issued when `R2_PUBLIC_BASE_URL` is set.                                                                                                   |

`REPOSITORIES` is a JSON object in `wrangler.jsonc`. It is also accepted as
that object encoded in a string, for `.dev.vars` and CI environment overrides,
which cannot carry structured values.

### GitHub token (optional, recommended)

`latest` needs no token. `prerelease` does, in practice — GitHub has no public
prerelease redirect, so it goes through the API and hits the anonymous rate
limit quickly. Without a token, `prerelease` starts answering
`502 GitHub releases API returned 403` once that limit is reached, while
`latest` keeps working. Create a fine-grained token with public read access to
the mirrored repositories and store it as a secret after the first deploy:

```sh
npx wrangler secret put GITHUB_TOKEN
```

That publishes a new Worker version containing the secret; later deploys
preserve it. For local development put `GITHUB_TOKEN=...` in an ignored
`.dev.vars` file instead.

One token serves every namespace in a deployment, so it needs access to all of
them. Repositories that need different credentials belong in separate
deployments.

### Direct R2 delivery (optional)

By default the Worker streams cached objects from its private R2 binding, which
needs no extra domain and incurs no R2 egress charge. If you attach a custom
domain directly to the R2 bucket, set its origin instead:

```jsonc
"R2_PUBLIC_BASE_URL": "https://objects.example.com"
```

The Worker still resolves aliases, checks R2 and fills cold objects from
GitHub — but once an object exists it returns a `302` straight to
`https://objects.example.com/releases/{namespace}/{tag}/{asset}` rather than
proxying the body.

### Cache expiry (optional)

R2 is only a cache; an expired asset is simply refetched from GitHub on its next
request. To reclaim storage:

```sh
npx wrangler r2 bucket lifecycle add acme-release-assets \
  expire-release-cache releases/ --expire-days 90
```

Scope a rule to one mirror with the `releases/{namespace}/` prefix instead. R2
lifecycle age counts from object creation, not last access, so a popular object
is refetched once per expiry period.

## Verify a deployment

The first `GET` fills R2 from GitHub; the second reads it back:

```sh
export MIRROR=https://assets.example.com
curl --fail --location "$MIRROR/tools/latest/SHA256SUMS"
curl --fail --location "$MIRROR/tools/v1.4.0/SHA256SUMS"
curl --fail --range 0-31  "$MIRROR/tools/v1.4.0/SHA256SUMS"
```

`/{namespace}/latest/{asset}` returns a temporary redirect to the resolved tag.
`/{namespace}/prerelease/{asset}` returns `404` when that repository has no
published prerelease.

## Develop

```sh
npm install
npm run check   # typecheck, type-aware lint, Prettier, tests
npm run dev     # local R2 emulation, no bucket required
```

`npm run check` is what CI runs, alongside a `wrangler deploy --dry-run` of
every configured environment.

## License

MIT
