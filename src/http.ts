export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const headers = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow, noarchive',
}
/** Bound bytes while reading, including chunked bodies without Content-Length. */
export async function readText(request: Request, limit: number) {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let size = 0, text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Request too large.') }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Invalid request body.')
  } finally { reader.releaseLock() }
}
export async function readJson(request: Request, limit = 12_000): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use application/json.')
  const text = await readText(request, limit)
  try { return JSON.parse(text) } catch { throw new HttpError(400, 'Invalid JSON.') }
}
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'Expected an object.')
  return Object.fromEntries(Object.entries(value))
}
export function field(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new HttpError(400, 'Invalid or missing field.')
  return value.trim()
}
export async function digest(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}
export function authorize(request: Request, expected: string) {
  const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  const encoder = new TextEncoder()
  const a = encoder.encode(provided), b = encoder.encode(expected)
  if (!expected || a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) throw new HttpError(401, 'Unauthorized.')
}
export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'Open the review link to comment.')
}
