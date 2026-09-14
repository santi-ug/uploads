# Review verification

All runtime checks used local Wrangler on port 8891 with local KV/D1 and a dummy
upload token. No production Worker, database, or publisher symlink was changed.

## Automated checks

- `REVIEW_TEST_URL=http://127.0.0.1:8891 pnpm test`: 5 passed, 0 failed.
- `pnpm typecheck`: exit 0.
- `bash -n scripts/publish-doc`: exit 0.
- `node --check` for both browser scripts: exit 0.
- `wrangler d1 migrations apply REVIEWS --local`: migration applied successfully.
- `wrangler deploy --dry-run`: successful bundle, 31.57 KiB before compression.

## Observed UI and CLI behavior

- Chromium: posted a general comment; `publish-doc --comments` returned its text.
- iPhone 17 Pro simulator, Safari/iOS 26.5: enabled Comment, tapped a paragraph,
  saw its quote in the drawer, and posted an anchored comment. CLI returned the
  exact quote and `p:nth-of-type(2)` selector.
- iPad mini simulator, Safari/iOS 26.5: opened the drawer and read saved threads.
- iPhone dark mode: inspected readable black-background document and drawer.
- Simulated a failed POST in Chromium: Not sent appeared and the draft remained.
  Restored fetch and retried: Posted appeared, draft cleared, count increased once.
- CLI resolved a thread and closed review. Browser refresh disabled Comment and Post
  and displayed the closed state. Reopening through the CLI succeeded.
- Escape closed the drawer and returned keyboard focus to Comments.
- The authored document's checklist button still worked under the content sandbox.

T3 preview resizing timed out, so mobile layout checks used Safari simulators rather
than claiming that a desktop browser viewport had changed. Native input automation
needed separate focus/type actions; one test display name was cleaned up in local
D1 after accidental input. Comment body and anchor evidence were preserved.

## Remaining release gates

- Physical-phone access over the public HTTPS URL after deployment.
- Exhaustive touch selection-handle, keyboard, orientation, and assistive-technology
  coverage. The focused-field keyboard adjustment needs broader device testing.
- D1 provisioning, remote migration, production deployment, and CLI/skill activation.
- Legacy HTML compatibility review for the new sandbox, especially external scripts
  or network requests outside Fleet's existing artifact rules.

## Images

| Before | Desktop review |
| --- | --- |
| ![Plain document](https://github.com/santi-ug/uploads/releases/download/assets/1789420800-review-before.png) | ![Desktop review](https://github.com/santi-ug/uploads/releases/download/assets/1789420800-review-desktop.png) |

![iPhone Safari review](https://github.com/santi-ug/uploads/releases/download/assets/1789420800-review-iphone.png)
