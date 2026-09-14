import { authorize, digest, headers, HttpError, readText } from './http'
import { addComment, findReview, listComments, manageReview, resolveComment } from './reviews'
import { contentResponse, viewerResponse } from './viewer'
import client from './web/client.js.txt'
import styles from './web/styles.css.txt'

type Env = Cloudflare.Env & { UPLOAD_TOKEN: string }
const slugPattern = /^[0-9a-f]{22,64}$/

export default {
  async fetch(request, env) {
    try {
      const response = await route(request, env)
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
      return response
    } catch (error) {
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers })
      console.error('Document request failed', error instanceof Error ? error.name : 'UnknownError')
      return Response.json({ error: 'Service unavailable. Please retry.' }, { status: 503, headers })
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/_review/client.js') return new Response(client, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
  if (request.method === 'GET' && url.pathname === '/_review/styles.css') return new Response(styles, { headers: { 'content-type': 'text/css; charset=utf-8' } })
  const [, slug = '', action = '', id = '', extra] = url.pathname.split('/')
  if (!slugPattern.test(slug) || extra !== undefined) throw new HttpError(404, 'Not found.')
  if (action === '' && request.method === 'PUT') {
    authorize(request, env.UPLOAD_TOKEN)
    const tombstone = await findReview(env.REVIEWS, slug)
    if (tombstone?.status === 'revoked') throw new HttpError(410, 'Link revoked. Publish with a new slug.')
    const html = await readText(request, 5_000_000)
    const title = (request.headers.get('x-doc-title') ?? slug).slice(0, 200)
    const publishedAt = new Date().toISOString()
    await env.DOCS.put(slug, html, { metadata: { title, publishedAt } })
    return Response.json({ slug, title, publishedAt })
  }
  if (action === '' && request.method === 'DELETE') {
    authorize(request, env.UPLOAD_TOKEN)
    // Tombstone first: a cached KV value must not reopen a revoked link.
    await env.REVIEWS.prepare("INSERT INTO reviews (slug,status,expires_at) VALUES (?,'revoked',0) ON CONFLICT(slug) DO UPDATE SET status='revoked',expires_at=0").bind(slug).run()
    await env.DOCS.delete(slug)
    return new Response(null, { status: 204 })
  }
  const review = await findReview(env.REVIEWS, slug)
  if (review?.status === 'revoked') throw new HttpError(404, 'Not found.')
  const html = await env.DOCS.get(slug, 'text')
  if (html === null) throw new HttpError(404, 'Not found.')
  const revision = await digest(html)
  if (action === 'review' && !id && request.method === 'POST') return manageReview(request, env.REVIEWS, slug, env.UPLOAD_TOKEN)
  if (action === 'comments' && review) {
    if (!id && request.method === 'GET') return listComments(env.REVIEWS, slug, review, revision)
    if (!id && request.method === 'POST') return addComment(request, env.REVIEWS, slug, revision, env.UPLOAD_TOKEN)
    if (id && request.method === 'PATCH') return resolveComment(request, env.REVIEWS, slug, id, env.UPLOAD_TOKEN)
  }
  if ((action === '' || action === 'content') && !id && (request.method === 'GET' || request.method === 'HEAD')) {
    const response = action === '' && review ? viewerResponse(slug) : contentResponse(html, Boolean(review), revision)
    return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response
  }
  throw new HttpError(405, 'Method or route not supported.')
}
