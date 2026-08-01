/**
 * A tiny seeded PRNG (mulberry32).
 *
 * `Math.random()` would regenerate a different dataset on every reload, which
 * makes the demo un-screenshottable and any test that asserts "23 invoices are
 * overdue" inherently flaky. A fixed seed gives a dataset that is realistic but
 * reproducible.
 *
 * Not cryptographically secure, and not intended to be — this seeds fixtures,
 * never tokens, IDs or anything a user could rely on being unguessable.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** True with probability `p`. */
  chance(p: number): boolean
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  const int = (min: number, max: number): number => {
    if (max < min) throw new RangeError(`Empty range: [${min}, ${max}]`)
    return min + Math.floor(next() * (max - min + 1))
  }

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty array')
    // Non-null assertion is sound: index is bounded by length, checked above.
    return items[int(0, items.length - 1)]!
  }

  return { next, int, pick, chance: (p) => next() < p }
}
