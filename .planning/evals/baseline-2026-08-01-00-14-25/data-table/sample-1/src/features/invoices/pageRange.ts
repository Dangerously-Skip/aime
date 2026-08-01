/**
 * Which page buttons to render.
 *
 * Rendering all 8 pages of a 200-row table would be fine; rendering all 400
 * pages of a 10,000-row one is not. This produces a fixed-width control that
 * always keeps the first page, the last page and the current page's neighbours
 * reachable, collapsing the rest into gaps.
 */

export type PageSlot = number | 'gap'

/**
 * @param current  Active page, 1-based.
 * @param pageCount Total pages, at least 1.
 * @param maxSlots Maximum entries returned, gaps included. Minimum 5, and odd
 *                 values keep the current page visually centred.
 */
export function buildPageRange(
  current: number,
  pageCount: number,
  maxSlots = 7,
): PageSlot[] {
  const slots = Math.max(5, maxSlots)
  const total = Math.max(1, pageCount)
  const page = Math.min(Math.max(current, 1), total)

  // Few enough to show everything: no gaps, no arithmetic.
  if (total <= slots) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  // Reserve two slots for first/last and two for the gap markers.
  const windowSize = slots - 4
  let start = page - Math.floor((windowSize - 1) / 2)
  let end = start + windowSize - 1

  // Near the ends, spend the gap slot on real page numbers instead.
  if (start <= 3) {
    start = 2
    end = slots - 2
  } else if (end >= total - 2) {
    end = total - 1
    start = total - (slots - 3)
  }

  const result: PageSlot[] = [1]
  if (start > 2) result.push('gap')
  for (let p = start; p <= end; p += 1) result.push(p)
  if (end < total - 1) result.push('gap')
  result.push(total)

  return result
}
