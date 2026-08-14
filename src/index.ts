/**
 * Link-only HTML host. Documents are addressed by an unguessable slug generated
 * by the publisher, stored in KV, and served as HTML to anyone holding the link.
 * Writes and deletes require the upload token; reads are public by design.
 */
interface Env {
	DOCS: KVNamespace
	UPLOAD_TOKEN: string
}

/** Slugs are client-generated hex. Anything else 404s so the namespace can't be probed. */
const SLUG_PATTERN = /^[0-9a-f]{22,64}$/

/** KV values cap at 25 MB; writeups are orders of magnitude smaller than this. */
const MAX_BYTES = 5_000_000

const HTML_HEADERS = {
	'content-type': 'text/html; charset=utf-8',
	// Link-only sharing only works if the link stays out of search results.
	'x-robots-tag': 'noindex, nofollow, noarchive',
	// Re-publishing reuses the slug, so a cached copy would outlive the edit.
	'cache-control': 'no-store',
	'referrer-policy': 'no-referrer',
}

export default {
	async fetch(request, env) {
		const slug = new URL(request.url).pathname.slice(1)
		if (!SLUG_PATTERN.test(slug)) return new Response('not found', { status: 404 })

		switch (request.method) {
			case 'GET':
			case 'HEAD':
				return serve(slug, env, request.method === 'HEAD')
			case 'PUT':
				return rejectUnauthorized(request, env) ?? store(slug, request, env)
			case 'DELETE':
				return rejectUnauthorized(request, env) ?? remove(slug, env)
			default:
				return new Response('method not allowed', {
					status: 405,
					headers: { allow: 'GET, HEAD, PUT, DELETE' },
				})
		}
	},
} satisfies ExportedHandler<Env>

async function serve(slug: string, env: Env, headOnly: boolean): Promise<Response> {
	const html = await env.DOCS.get(slug, 'text')
	if (html === null) return new Response('not found', { status: 404 })
	return new Response(headOnly ? null : html, { headers: HTML_HEADERS })
}

async function store(slug: string, request: Request, env: Env): Promise<Response> {
	const html = await request.text()
	if (html.length > MAX_BYTES) return new Response('document too large', { status: 413 })

	const title = request.headers.get('x-doc-title') ?? slug
	const publishedAt = new Date().toISOString()
	await env.DOCS.put(slug, html, { metadata: { title, publishedAt } })

	return Response.json({ slug, title, publishedAt })
}

async function remove(slug: string, env: Env): Promise<Response> {
	await env.DOCS.delete(slug)
	return new Response(null, { status: 204 })
}

/** Returns a 401 for a missing or wrong bearer token, or null when the caller is authorized. */
function rejectUnauthorized(request: Request, env: Env): Response | null {
	const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
	return matches(provided, env.UPLOAD_TOKEN)
		? null
		: new Response('unauthorized', { status: 401 })
}

function matches(provided: string, expected: string): boolean {
	const encoder = new TextEncoder()
	const a = encoder.encode(provided)
	const b = encoder.encode(expected)
	// timingSafeEqual throws on length mismatch, and length alone leaks nothing useful here.
	if (a.byteLength !== b.byteLength) return false
	return crypto.subtle.timingSafeEqual(a, b)
}
