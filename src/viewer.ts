import bridge from './web/bridge.js.txt'
export function contentResponse(html: string, instrument: boolean, revision: string) {
  const response = new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  } })
  if (!instrument) return response
  return new HTMLRewriter().onDocument({ end(end) {
    end.append(`<script>const reviewRevision=${JSON.stringify(revision)};${bridge}</script>`, { html: true })
  } }).transform(response)
}
export function viewerResponse(slug: string) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Document review</title><link rel="stylesheet" href="/_review/styles.css"><script src="/_review/client.js" defer></script></head>
<body data-slug="${slug}"><header><strong id="title">Document review</strong><div class="actions"><button id="mode" aria-pressed="false">Comment</button><button id="show" aria-expanded="false" aria-controls="panel">Comments <span id="count">0</span></button></div></header>
<main><iframe id="document" title="Shared document" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" src="/${slug}/content"></iframe>
<aside id="panel" aria-label="Document comments" hidden><div class="panel-heading"><h1>Comments</h1><button id="close" aria-label="Close comments">Close</button></div><p id="review-state" role="status">Loading comments…</p><div class="thread-controls"><button id="new">New comment</button><button id="refresh">Refresh</button><label><input id="resolved" type="checkbox"> Show resolved</label></div><div id="threads"></div>
<form id="composer"><h2 id="composer-title">New comment</h2><blockquote id="target" hidden></blockquote><button type="button" id="clear-target" hidden>Clear selection</button><label for="name">Your name</label><input id="name" name="name" maxlength="60" autocomplete="name" required><label for="body">Comment</label><textarea id="body" name="body" maxlength="2000" rows="3" required placeholder="What would you change?"></textarea><p class="hint">Visible to anyone with this link. Names are self-reported.</p><div class="send-row"><p id="status" role="status" aria-live="polite"></p><button id="post" type="submit">Post</button></div></form></aside></main><p id="instruction" hidden>Tap a section or select text to comment. Press Escape to stop.</p></body></html>`, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } })
}
