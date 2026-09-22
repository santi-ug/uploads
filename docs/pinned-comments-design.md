# Pinned comments

## Decision

Keep saved annotations separate from draft geometry and undo history. Render all
visible root threads from the loaded revision in one overlay. Each anchored thread
gets a first-letter pin, using the same name-derived color as its sidebar avatar.

The sidebar is 200px with 10px text. Its rows open a nearby thread and scroll to the
pin without changing the iframe URL or clearing other drawings. Pins and rows use
the same selection state. Close and Escape clear that selection. Polling preserves
unchanged rows and pin nodes so keyboard focus survives refreshes.

General comments have no invented location. Earlier-version comments remain readable
in the thread popup, with an explicit View original version action. Snapshot mode
shows all visible comments from that revision; Back to current restores the draft.

## Geometry and limits

Marks retain their original viewport in storage. Live overlays scale coordinates
by the width ratio; text/element anchors also relocate to their matching selector.
This is approximate when responsive text reflows, especially for freehand marks
without a selector. Original layout explicitly opens the saved HTML and viewport
for precise inspection of those marks. No geometry or database migration is needed.

The sandbox bridge owns pins and drawing layers; the trusted viewer owns thread
text, replies, and navigation. Revision-matched messages synchronize selection and
pin position. Opening a saved thread never turns its geometry into an editable draft.

Mobile retains the comments list sheet and opens a single thread above the toolbar.
Touch pin targets extend beyond the visible 28px pin; desktop text remains 10px.

## Scrolling

Marks and pins live in an absolute, document-coordinate overlay. A separate fixed
surface captures drawing gestures. Scrolling does not rebuild SVG nodes, measure
text anchors, or reposition pins in JavaScript; the browser scrolls them with the
page. Saved geometry is rebuilt only when threads, selection, or viewport size
change, independently of draft pointer movement. The cross-frame thread popup
still receives the selected pin's viewport position through the existing bridge.

A local 2.4-second scroll probe measured 11px maximum annotation drift and 822
shape redraws before this change, versus 0px drift and zero redraws after it.
This establishes alignment and reduced work, not a cross-browser FPS guarantee.
