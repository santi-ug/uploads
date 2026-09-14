# Visual annotations

## Decision

Use a small web overlay and persist validated geometry with each comment. Keep the
Cloudflare review infrastructure and original HTML publication path. No desktop server
or Electron dependency is involved. This supports text selection, element selection,
rectangles, circles, and freehand marks on phones and computers.

The interaction follows T3's nearby editor and tool palette, inspected in its native
browser and [pinned MIT source](https://github.com/pingdotgg/t3code/blob/9d4bb550a6588a462852a7802bc37a3fd62d0a76/apps/desktop/src/preview/PickPreload.ts).
T3's Electron screenshot path and composer integration do not transfer to a public
Worker. This implementation does not copy that code. It stores the coordinates that
T3's composer record drops, and offers explicit ellipse and native text selection.

## Terms and limits

- Mark: a rectangle, ellipse, or freehand stroke in document page coordinates.
- Markup: a group of marks with the viewport at which they were drawn.
- Snapshot: owner-authored HTML identified by SHA-256, retained for 90 days.
- Replay: that HTML loaded at its original viewport with the saved markup overlay.

Locking the viewport preserves geometry across devices; it can require scrolling on
a smaller screen. Replay is not a screenshot. It does not preserve live script or
canvas state. A screenshot capture service would add infrastructure and a new privacy
boundary and is outside this change.

Undo/redo stores bounded draft history, including erased marks. Cancelled gestures
do not commit. Posting retries reuse the request ID; reload restores local drafts.
Old-version drafts cannot post as current until the reviewer chooses a new target.
