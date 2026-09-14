# uploads — public asset host for agent PR media

## docs Worker

Hosted review adds a mobile comment drawer and desktop side panel to the same link:

```sh
publish-doc --review ~/writeups/plan.html
publish-doc --comments ~/writeups/plan.html
```

Guest comments are stored in Cloudflare D1. The Mac can be offline. See
[hosted review](docs/hosted-review.md) for owner controls, trust boundaries, local
tests, and the approval-gated release sequence.

Link-only HTML host for writeups, mocks, and client-facing documents.

- `src/index.ts` serves `GET /<slug>` publicly and gates `PUT`/`DELETE` behind a bearer token.
- `scripts/publish-doc` publishes a local file and prints its URL. Symlinked to `~/.local/bin/publish-doc`.
- Slugs are 22 hex chars, generated locally and cached in `~/.config/docs-publish/manifest.tsv`
  so re-publishing a file keeps the link already shared.
- The token lives in the macOS keychain under `docs-upload-token` and as the Worker secret
  `UPLOAD_TOKEN`. It is never stored in this repo.

```
publish-doc ~/writeups/pricing.html         publish or update, prints the URL
publish-doc --unpublish ~/writeups/x.html   revoke
publish-doc --list                          every live doc
```

Deploy with `pnpm deploy`. Base URL is `https://docs.santiu.workers.dev`, overridable with
`DOCS_BASE_URL`.
