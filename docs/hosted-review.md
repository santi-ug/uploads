# Hosted document review

## Decision

Keep published HTML in the existing KV namespace and store reviews in D1. Serve a
trusted review viewer around an opaque-origin sandboxed document. This allows
phone and guest review without exposing a Mac or the Lavish control server.

Design A was approved: a bottom drawer below 761 CSS pixels, a side panel above it.
The viewer uses the system font, light/dark themes, 44px buttons, and a keyboard-aware
mobile drawer. Read mode preserves document controls. Comment mode captures a tapped
element or selected text. The drawer closes without discarding its draft.

## Workflow

```sh
publish-doc --review /absolute/path/plan.html
publish-doc /absolute/path/plan.html
publish-doc --comments /absolute/path/plan.html
publish-doc --resolve /absolute/path/plan.html <thread-id>
publish-doc --reopen-thread /absolute/path/plan.html <thread-id>
publish-doc --close-review /absolute/path/plan.html
publish-doc --open-review /absolute/path/plan.html
```

The first command enables comments for 30 days; ordinary republishing preserves
review state and all comments. Opening again explicitly renews the 30-day window.
Closing or expiry disables new posts but keeps the document and comments readable.
Unpublishing revokes access to the document, content, and feedback. A revoked slug
cannot be reused; the publisher generates a fresh slug after unpublishing.

The same link works for guests and the owner. No signup is required. Names are
self-reported, not verified identities. Anyone holding the link can read all comments.
Owner controls run through the authenticated CLI, never through browser credentials.
Feedback retrieval is a snapshot, not automatic agent execution. The Fleet skill
defines when to retrieve it and when to wait for further feedback.

## Data and trust boundaries

- Each comment stores its document slug, HTML SHA-256 revision, quote, CSS locator,
  display name, text, timestamp, and optional root thread ID.
- A new thread requires the current revision. Replies inherit the root's anchor.
  Earlier revisions retain their quote and an Earlier version label; the viewer
  does not claim an old selector points to the new content.
- UUID request IDs deduplicate network retries. One SQL statement checks review
  state and rate limits atomically before inserting.
- Limits: 2,000 comment characters, 60 name characters, 1,000 quote characters,
  12 KB request body, 10 comments per IP/document/minute, 30 per document/minute,
  500 total per document. The total cap includes replies and resolved comments.
- Only a hash derived from IP, document, and owner secret is stored for rate limits;
  it is not returned to readers. Rotation of the upload secret resets this rate key.
- Guest POSTs require same-origin JSON. All owner actions require the existing bearer
  token. Requests cannot nominate a filesystem path or execute agent commands.
- Authored HTML has no same-origin privilege, network requests, forms, or embeds.
  Inline scripts and styles and HTTPS/data images remain available. Popup links open
  outside the sandbox. The trusted viewer renders comment content with textContent.
- The sandbox applies to ordinary document responses too, preventing a document script
  from reading same-origin review storage. This matches Fleet's HTML artifact contract,
  but legacy documents using external scripts, forms, fetch, or linked CSS need review
  before deployment because those features will now be blocked.

## Local verification

```sh
pnpm install
pnpm exec wrangler types src/env.d.ts --include-runtime=false
pnpm exec wrangler d1 migrations apply REVIEWS --local
# Set UPLOAD_TOKEN in ignored .dev.vars to the public test fixture local-review-test-only.
pnpm exec wrangler dev --local --port 8891 --ip 127.0.0.1
REVIEW_TEST_URL=http://127.0.0.1:8891 pnpm test
pnpm typecheck
pnpm exec wrangler deploy --dry-run
```

The integration tests refuse a non-loopback URL and use only a dummy local secret.
The local publisher can use DOCS_BASE_URL, DOCS_MANIFEST, and DOCS_UPLOAD_TOKEN to
exercise the full command without touching the real manifest or Keychain secret.

## Release sequence

Production deployment is a separate approval. The agent performs these steps after
approval, not the user:

1. Create `docs-reviews` with `wrangler d1 create docs-reviews --binding REVIEWS
   --update-config`, or reuse its ID if it already exists. Commit the actual binding.
2. Apply `wrangler d1 migrations apply REVIEWS --remote` before deploying the Worker.
3. Deploy the approved Worker. Existing DOCS and UPLOAD_TOKEN remain in place.
4. Update the checkout used by the publish-doc symlink and activate the approved
   Fleet skill changes. No account-specific credentials or Lavish hooks are needed.
5. Publish a synthetic review, open its HTTPS URL on a phone, post a comment, fetch
   it through the CLI, close review, and verify new posts fail. Unpublish the fixture.

Rollback the Worker to its previous version if verification fails. Keep D1 intact
so comments survive rollback; roll back the CLI/skill activation together. Existing
document KV values are never rewritten by viewing or reviewing.
