import { HttpError, record } from './http'

type Point = { x: number; y: number }
type Mark = { kind: 'stroke'; points: Point[] } | { kind: 'rect' | 'ellipse'; x: number; y: number; width: number; height: number }
export type Markup = { version: 1; viewport: { width: number; height: number }; marks: Mark[] }

function number(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, 'Invalid annotation coordinates.')
  return Math.round(value * 10) / 10
}

/** Accept geometry only. Never store guest SVG/HTML, URLs, styles, or executable markup. */
export function parseMarkup(value: unknown): Markup | null {
  if (value === undefined || value === null) return null
  const input = record(value), viewport = record(input.viewport)
  if (input.version !== 1 || !Array.isArray(input.marks) || !input.marks.length || input.marks.length > 32) throw new HttpError(400, 'Use 1 to 32 annotation marks.')
  let points = 0
  const marks = input.marks.map((value): Mark => {
    const mark = record(value)
    if (mark.kind === 'stroke') {
      if (!Array.isArray(mark.points) || mark.points.length < 2 || mark.points.length > 512) throw new HttpError(400, 'Invalid annotation stroke.')
      points += mark.points.length
      if (points > 2048) throw new HttpError(400, 'Too many annotation points.')
      return { kind: 'stroke', points: mark.points.map(value => { const point = record(value); return { x: number(point.x, 0, 200_000), y: number(point.y, 0, 200_000) } }) }
    }
    if (mark.kind !== 'rect' && mark.kind !== 'ellipse') throw new HttpError(400, 'Unknown annotation tool.')
    return { kind: mark.kind, x: number(mark.x, 0, 200_000), y: number(mark.y, 0, 200_000), width: number(mark.width, 1, 20_000), height: number(mark.height, 1, 20_000) }
  })
  return { version: 1, viewport: { width: number(viewport.width, 240, 8000), height: number(viewport.height, 160, 8000) }, marks }
}
