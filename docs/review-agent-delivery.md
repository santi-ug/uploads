# Save-to-agent delivery

Save submits the open comment draft, when complete, then queues unsubmitted posted
comments and replies. A draft needs a name and a description; drawings alone cannot
say what should change. Post still stores a comment without starting work. Refresh
still fetches comments. An empty Save reports no new feedback. Save shows progress,
queued, accepted, and offline states.

A local relay connects one document to one exact agent session. It polls every two
seconds and sends saved feedback through that harness: T3's authenticated turn API,
`codex exec resume`, or `claude --bg --resume`. Codex starts a turn in its recorded
working directory. `codex queue` alone does not wake an idle session. Claude waits
until its background session finishes its current turn, stops the completed service,
then resumes the same session ID. Otherwise Claude starts a copy. T3 keeps the
conversation's permission and interaction modes. “Sent to your agent” means the
harness accepted the feedback, not that edits finished. The wake-up message names
only the saved comment IDs. The agent reads their full text and drawings from the
public `/comments` endpoint, keeping large annotations out of CLI arguments.

The relay must run on the Mac hosting the selected session. The browser never receives
owner or harness credentials and cannot choose another session. Comments remain untrusted data,
not authorization for unrelated work or privileged actions. Anyone with the review
link can submit feedback while the explicitly connected watch is active.

## Connect

After publishing a review, run:

```sh
publish-doc --connect-agent /absolute/path/to/document.html t3:<conversation-id>
publish-doc --connect-agent /absolute/path/to/document.html codex:<session-uuid>
publish-doc --connect-agent /absolute/path/to/document.html claude:<session-uuid>
```

Give the connector the session ID for the conversation doing this work. Never pick
the latest session by recency. For Claude, run `/background` in that conversation
first and use its full session UUID from `claude agents --json`. An interactive
Claude session cannot safely receive an automatic resume: Claude would start a copy
while it is running. Codex uses its full session UUID. T3 uses the T3 conversation
ID, not the provider session ID inside it. The helper checks the local session and
review connection, then reports the relay PID and expiry. On macOS, T3 Code and T3
Code Nightly are supported; otherwise set `T3_CLI` to its executable.

The watch and any T3 credential expire after four hours. Reconnecting an active watch
for the same conversation reuses it; restart after expiry to reconnect. The connector
reuses the relay ID for that same session so a fresh lease does not block it. Stop only
the reported relay PID to end the watch early. A missing heartbeat marks the relay
offline after 30 seconds. The relay does not launch itself on reboot. Expiry, a
sleeping Mac, a stopped agent host, or a stopped dev server prevents automatic pickup; feedback
already queued stays persisted. Save reports this instead of claiming delivery.

For a local preview without a publish manifest entry:

```sh
DOCS_UPLOAD_TOKEN=local-review-test-only node scripts/connect-review-agent.mjs \
  http://127.0.0.1:8787/<slug> t3:<conversation-id>
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
this feature is available only on the local preview branch. The three installed
harnesses have adapters; another agent app needs its own resume or queue adapter.
No generic shell process can wake every agent app. T3's deterministic command ID
deduplicates retries. The CLI adapters store a local acceptance receipt before
acknowledging the server, but a crash between CLI acceptance and receipt write may
deliver the same feedback again; the delivery ID lets the agent recognize a retry.
