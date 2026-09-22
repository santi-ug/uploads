import bridge from './web/bridge.js.txt'
import shortcuts from './web/shortcuts.js.txt'
export function contentResponse(html: string, instrument: boolean, revision: string) {
  const response = new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  } })
  if (!instrument) return response
  return new HTMLRewriter().onDocument({ end(end) {
    end.append(`<script>const reviewRevision=${JSON.stringify(revision)};${shortcuts}\n${bridge}</script>`, { html: true })
  } }).transform(response)
}
export function viewerResponse(slug: string) {
  const paths = {
    read: 'm3 10 9-7 9 7v11h-6v-7H9v7H3Z',
    select: 'm5 3 14 9-7 1-3 7Z',
    rect: 'M4 4h16v16H4Z',
    ellipse: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    stroke: 'm4 16-1 5 5-1L21 7l-4-4Z M14 6l4 4',
    erase: 'm3 14 9-11 9 8-8 10H9Z M7 10l9 8 M13 21h8',
    undo: 'M8 4 3 9l5 5 M3 9h10a7 7 0 0 1 0 14',
    redo: 'm16 4 5 5-5 5 M21 9h-10a7 7 0 0 0 0 14',
  }
  const keys = { read: 'q', select: 'v', rect: 'r', ellipse: 'c', stroke: 'd', erase: 'e', undo: 'z', redo: 'Shift+z' } satisfies Record<keyof typeof paths, string>
  const tool = (key: keyof typeof paths, label: string) => `<button type="button" data-tool="${key}" data-shortcut="${keys[key]}" aria-keyshortcuts="${keys[key]}" aria-label="${label}" title="${label} (${keys[key].toUpperCase()})" ${key === 'undo' || key === 'redo' ? 'disabled' : `aria-pressed="${key === 'read'}"`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key]}"/></svg><kbd aria-hidden="true">${keys[key] === 'Shift+z' ? '⇧Z' : keys[key].toUpperCase()}</kbd></button>`
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Document review</title><link rel="stylesheet" href="/_review/styles.css"><script src="/_review/client.js" defer></script></head>
<body data-slug="${slug}"><header><strong id="title" class="island">Document review</strong><div class="actions island"><button id="current" hidden>Back to current</button><button id="show" aria-expanded="false" aria-controls="panel">Comments <span id="count">0</span></button></div></header>
<main><div id="stage"><iframe id="document" title="Shared document" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" src="/${slug}/content"></iframe></div>
<aside id="panel" aria-label="Document comments" hidden><div class="panel-heading"><h1>Comments</h1><button id="close" aria-label="Close comments">Close</button></div><p id="review-state" role="status">Loading comments…</p><div class="thread-controls"><button id="new">New comment</button><button id="refresh">Refresh</button><label><input id="resolved" type="checkbox"> Show resolved</label></div><div id="threads"></div>
</aside></main>
<section id="compose-popover" role="dialog" aria-labelledby="composer-title" hidden><div class="compose-heading"><h2 id="composer-title">New comment</h2><button id="cancel-compose" aria-label="Close comment editor">Close</button></div><form id="composer"><blockquote id="target" hidden></blockquote><button type="button" id="clear-target" hidden>Clear selection</button><label for="name">Your name</label><input id="name" name="name" maxlength="60" autocomplete="name" required><label for="body">Comment</label><textarea id="body" name="body" maxlength="2000" rows="3" required placeholder="What would you change?"></textarea><p class="hint">Visible to anyone with this link. Names are self-reported.</p><div class="send-row"><p id="status" role="status" aria-live="polite"></p><button id="post" type="submit">Post</button></div></form></section>
<nav id="tools" class="island" aria-label="Annotation tools">${tool('read', 'Read and scroll')}${tool('select', 'Select element')}${tool('rect', 'Mark region')}${tool('ellipse', 'Circle')}${tool('stroke', 'Draw')}${tool('erase', 'Erase mark')}${tool('undo', 'Undo mark')}${tool('redo', 'Redo mark')}<button type="button" id="save" aria-label="Save and check for new comments" title="Save and check for new comments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></button></nav><p id="instruction" role="status">Select text to comment, or choose a markup tool.</p><button id="draft" hidden>Resume draft</button><div id="snapshot-note" hidden>Saved HTML at its original viewport. Live interaction state is not captured.</div></body></html>`, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } })
}
