# Save-to-agent delivery

Save submits the open comment draft, when complete, then queues unsubmitted posted
comments and replies. A draft needs a name and a description; drawings alone cannot
say what should change. Post still stores a comment without starting work. Refresh
still fetches comments. Save shows progress, queued, accepted, and offline states.

A local relay connects one document to one T3 conversation. It polls every two
seconds, waits for the conversation to be idle, then uses T3's authenticated
`POST /api/orchestration/dispatch` with `thread.turn.start`. It preserves the
conversation's permission and interaction modes. The same delivery ID becomes the
command and message ID, making dispatch and acknowledgement retries idempotent.
“Sent to your agent” means T3 accepted the turn request, not that edits finished.

The relay must run on the Mac hosting T3. The browser never receives owner or T3
credentials and cannot choose another conversation. Comments remain untrusted data,
not authorization for unrelated work or privileged actions. Anyone with the review
link can submit feedback while the explicitly connected watch is active.

## Connect

After publishing a review, run:

```sh
publish-doc --connect-agent /absolute/path/to/document.html <t3-thread-id>
```

The helper uses the existing upload credential and T3's installed `auth session
issue` CLI. It checks the conversation and review connection before starting a
separate process. It reports the PID and expiry. On macOS it supports the installed
T3 Code or T3 Code Nightly app; otherwise set `T3_CLI` to the CLI executable.
`T3CODE_HOME` selects the T3 data directory. No T3 installation or database patching
is needed. The helper uses T3's existing authenticated HTTP interface.

The watch and T3 credential expire after four hours. Reconnecting an active watch
for the same conversation reuses it; restart after expiry to reconnect. Stop only
the reported relay PID to end the watch early. A missing heartbeat marks the relay
offline after 30 seconds. The relay does not launch itself on reboot. Expiry, a
sleeping Mac, closed T3, or a stopped dev server prevents automatic pickup; feedback
already queued stays persisted. Save reports this instead of claiming delivery.

For a local preview without a publish manifest entry:

```sh
DOCS_UPLOAD_TOKEN=local-review-test-only node scripts/connect-review-agent.mjs \
  http://127.0.0.1:8787/<slug> <t3-thread-id>
```

Configuration, credentials, PID, and logs live in `~/.config/docs-review/<url-hash>/`.
The directory is private and credential files use mode 0600. Do not commit them.

## Storage and rollout

Apply `0003_review_delivery.sql` before using this release. It adds a nullable
comment delivery ID, a transactional delivery queue, and a per-document relay lease.
It does not alter existing comments. A batch captures only unsubmitted comments,
so multiple Save clicks, including concurrent clicks, cannot resubmit a comment.
Only the current owner-authorized relay can acknowledge its document's batches.
Closing or revoking a review stops queueing and relay delivery.

The Worker migration and deploy are separate production actions. Until deployed,
this feature is available only on the local preview branch. This adapter supports
T3; do not promise automatic pickup in another harness without an equivalent tested
connection.
