import { authorize, field, HttpError, readJson, record, sameOrigin } from './http'
import { type Comment, type Review } from './reviews'

const leaseMs = 30_000
const uuid = (value: unknown) => {
  const id = field(value, 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, 'Invalid request ID.')
  return id
}
type Delivery = { id: string; status: 'queued' | 'delivered'; created_at: number }
export async function deliveryStatus(db: D1Database, slug: string) {
  const agent = await db.prepare('SELECT seen_at FROM review_agents WHERE slug=?').bind(slug).first<{ seen_at: number }>()
  const delivery = await db.prepare('SELECT id,status,created_at FROM review_deliveries WHERE slug=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(slug).first<Delivery>()
  return { connected: Boolean(agent && agent.seen_at > Date.now() - leaseMs), delivery }
}
export async function saveFeedback(request: Request, db: D1Database, slug: string, review: Review) {
  sameOrigin(request)
  const id = uuid(record(await readJson(request)).id)
  const existing = await db.prepare('SELECT id,status,created_at FROM review_deliveries WHERE id=? AND slug=?').bind(id, slug).first<Delivery>()
  if (existing) return Response.json({ ...(await deliveryStatus(db, slug)), delivery: existing })
  if (review.status !== 'open' || review.expires_at <= Date.now()) throw new HttpError(403, 'Review is closed.')
  if (!(await deliveryStatus(db, slug)).connected) throw new HttpError(503, 'Comments are saved, but no agent is connected. Try Save again when the agent reconnects.')
  // A D1 batch is one transaction: capture the exact batch, then mark only those comments as submitted.
  await db.batch([
    db.prepare(`INSERT INTO review_deliveries(id,slug,comment_ids,created_at)
      SELECT ?,?,json_group_array(c.id),? FROM comments c
      WHERE c.slug=? AND c.delivery_id IS NULL AND c.status='open'
      AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM comments p WHERE p.id=c.parent_id AND p.status='open'))
      HAVING COUNT(*)>0 ON CONFLICT(id) DO NOTHING`).bind(id, slug, Date.now(), slug),
    db.prepare(`UPDATE comments SET delivery_id=? WHERE slug=? AND delivery_id IS NULL
      AND id IN (SELECT value FROM json_each((SELECT comment_ids FROM review_deliveries WHERE id=? AND slug=?)))`).bind(id, slug, id, slug),
  ])
  return Response.json(await deliveryStatus(db, slug))
}
/** Only an owner-authorized, document-bound relay can claim feedback or acknowledge delivery. */
export async function agentDelivery(request: Request, db: D1Database, slug: string, review: Review, id: string, token: string) {
  authorize(request, token)
  const input = record(await readJson(request)), relayId = uuid(input.relayId), now = Date.now()
  if (review.status !== 'open' || review.expires_at <= now) throw new HttpError(403, 'Review is closed.')
  if (id) {
    uuid(id)
    const agent = await db.prepare('SELECT relay_id FROM review_agents WHERE slug=? AND seen_at>?').bind(slug, now - leaseMs).first<{ relay_id: string }>()
    if (agent?.relay_id !== relayId) throw new HttpError(409, 'Agent connection expired.')
    await db.prepare("UPDATE review_deliveries SET status='delivered' WHERE slug=? AND id=?").bind(slug, id).run()
    return Response.json({ ok: true })
  }
  const lease = await db.prepare(`INSERT INTO review_agents(slug,relay_id,seen_at) VALUES(?,?,?)
    ON CONFLICT(slug) DO UPDATE SET relay_id=excluded.relay_id,seen_at=excluded.seen_at
    WHERE review_agents.relay_id=excluded.relay_id OR review_agents.seen_at<?`).bind(slug, relayId, now, now - leaseMs).run()
  if (!lease.meta.changes) throw new HttpError(409, 'Another agent is connected to this review.')
  const delivery = await db.prepare("SELECT id,status,created_at FROM review_deliveries WHERE slug=? AND status='queued' ORDER BY created_at,id LIMIT 1").bind(slug).first<Delivery>()
  if (!delivery) return Response.json({ delivery: null })
  const { results } = await db.prepare('SELECT id,parent_id,revision,name,body,quote,selector,markup FROM comments WHERE slug=? AND delivery_id=? ORDER BY created_at,id').bind(slug, delivery.id).all<Pick<Comment, 'id' | 'parent_id' | 'revision' | 'name' | 'body' | 'quote' | 'selector' | 'markup'>>()
  return Response.json({ delivery: { ...delivery, comments: results.map(comment => ({ ...comment, markup: comment.markup ? JSON.parse(comment.markup) : null })) } })
}
