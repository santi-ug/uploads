import { authorize, digest, field, HttpError, readJson, record, sameOrigin } from './http'
export type Review = { status: 'open' | 'closed' | 'revoked'; expires_at: number }
export type Comment = {
  id: string; parent_id: string | null; revision: string; quote: string; selector: string;
  name: string; body: string; status: 'open' | 'resolved'; created_at: number
}
const columns = 'id, parent_id, revision, quote, selector, name, body, status, created_at'
export const findReview = (db: D1Database, slug: string) => db.prepare('SELECT status, expires_at FROM reviews WHERE slug = ?').bind(slug).first<Review>()
/** Owner operations never share the upload credential with the review browser. */
export async function manageReview(request: Request, db: D1Database, slug: string, token: string) {
  authorize(request, token)
  const input = record(await readJson(request))
  if (input.action !== 'open' && input.action !== 'close') throw new HttpError(400, 'Use open or close.')
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000
  if (input.action === 'open') {
    await db.prepare("INSERT INTO reviews (slug,status,expires_at) VALUES (?,'open',?) ON CONFLICT(slug) DO UPDATE SET status='open', expires_at=excluded.expires_at WHERE reviews.status != 'revoked'").bind(slug, expires).run()
  } else {
    await db.prepare("UPDATE reviews SET status='closed' WHERE slug=? AND status != 'revoked'").bind(slug).run()
  }
  return Response.json(await findReview(db, slug))
}
export async function listComments(db: D1Database, slug: string, review: Review, revision: string) {
  const { results } = await db.prepare(`SELECT ${columns} FROM comments WHERE slug=? ORDER BY created_at, id LIMIT 500`).bind(slug).all<Comment>()
  return Response.json({ revision, open: review.status === 'open' && review.expires_at > Date.now(), expiresAt: review.expires_at, comments: results })
}
export async function addComment(request: Request, db: D1Database, slug: string, revision: string, token: string) {
  sameOrigin(request)
  const input = record(await readJson(request))
  const id = field(input.id, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, 'Invalid comment ID.')
  const name = field(input.name, 60), body = field(input.body, 2000)
  let quote = field(input.quote, 1000, true), selector = field(input.selector, 500, true)
  let commentRevision = field(input.revision, 64)
  const parentId = input.parentId === null ? null : field(input.parentId, 36)
  if (parentId) {
    const parent = await db.prepare('SELECT revision, quote, selector FROM comments WHERE slug=? AND id=? AND parent_id IS NULL').bind(slug, parentId).first<Pick<Comment, 'revision' | 'quote' | 'selector'>>()
    if (!parent) throw new HttpError(400, 'Thread not found.')
    quote = parent.quote; selector = parent.selector; commentRevision = parent.revision
  } else if (commentRevision !== revision) throw new HttpError(409, 'This document changed. Reload before starting a new thread.')
  const actor = await digest(`${token}:${slug}:${request.headers.get('cf-connecting-ip') ?? 'local'}`)
  // A retry after a lost response must not create another comment.
  const previous = await db.prepare('SELECT id FROM comments WHERE id=? AND slug=? AND actor_hash=?').bind(id, slug, actor).first()
  if (previous) return Response.json({ id }, { status: 200 })
  const now = Date.now()
  const result = await db.prepare(`INSERT INTO comments (id,slug,parent_id,revision,quote,selector,name,body,created_at,actor_hash)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM reviews WHERE slug=? AND status='open' AND expires_at>?)
    AND (SELECT COUNT(*) FROM comments WHERE slug=?) < 500
    AND (SELECT COUNT(*) FROM comments WHERE slug=? AND created_at>?) < 30
    AND (SELECT COUNT(*) FROM comments WHERE slug=? AND actor_hash=? AND created_at>?) < 10
    ON CONFLICT(id) DO NOTHING`).bind(id, slug, parentId, commentRevision, quote, selector, name, body, now, actor, slug, now, slug, slug, now - 60_000, slug, actor, now - 60_000).run()
  if (!result.meta.changes) {
    const review = await findReview(db, slug)
    if (!review || review.status !== 'open' || review.expires_at <= now) throw new HttpError(403, 'Review is closed.')
    throw new HttpError(429, 'Comment limit reached. Please try again later.')
  }
  return Response.json({ id }, { status: 201 })
}
export async function resolveComment(request: Request, db: D1Database, slug: string, id: string, token: string) {
  authorize(request, token)
  const input = record(await readJson(request))
  if (input.status !== 'open' && input.status !== 'resolved') throw new HttpError(400, 'Invalid status.')
  const result = await db.prepare('UPDATE comments SET status=? WHERE slug=? AND id=? AND parent_id IS NULL').bind(input.status, slug, id).run()
  if (!result.meta.changes) throw new HttpError(404, 'Thread not found.')
  return Response.json({ id, status: input.status })
}
