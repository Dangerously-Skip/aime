import { describe, expect, it } from 'vitest'
import { buildPageRange } from './pageRange.ts'

describe('buildPageRange', () => {
  it('lists every page when they all fit', () => {
    expect(buildPageRange(1, 8, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(buildPageRange(3, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('handles a single page', () => {
    expect(buildPageRange(1, 1)).toEqual([1])
  })

  it('keeps first and last reachable with a gap in the middle', () => {
    const range = buildPageRange(10, 20)
    expect(range[0]).toBe(1)
    expect(range.at(-1)).toBe(20)
    expect(range).toContain('gap')
    expect(range).toContain(10)
  })

  it('never exceeds the slot budget', () => {
    for (let page = 1; page <= 50; page += 1) {
      expect(buildPageRange(page, 50, 7).length).toBeLessThanOrEqual(7)
    }
  })

  it('spends the gap slot on real pages near the start', () => {
    expect(buildPageRange(1, 20, 7)).toEqual([1, 2, 3, 4, 5, 'gap', 20])
    expect(buildPageRange(2, 20, 7)).toEqual([1, 2, 3, 4, 5, 'gap', 20])
  })

  it('spends the gap slot on real pages near the end', () => {
    expect(buildPageRange(20, 20, 7)).toEqual([1, 'gap', 16, 17, 18, 19, 20])
    expect(buildPageRange(19, 20, 7)).toEqual([1, 'gap', 16, 17, 18, 19, 20])
  })

  it('centres the window in the middle of a long range', () => {
    expect(buildPageRange(10, 20, 7)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20])
  })

  it('always includes the current page', () => {
    for (let page = 1; page <= 40; page += 1) {
      expect(buildPageRange(page, 40, 7)).toContain(page)
    }
  })

  it('returns strictly ascending page numbers with no duplicates', () => {
    for (let page = 1; page <= 40; page += 1) {
      const numbers = buildPageRange(page, 40).filter(
        (slot): slot is number => slot !== 'gap',
      )
      expect(new Set(numbers).size).toBe(numbers.length)
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers)
    }
  })

  it('never places two gaps next to each other', () => {
    for (let page = 1; page <= 40; page += 1) {
      const range = buildPageRange(page, 40)
      for (let i = 1; i < range.length; i += 1) {
        expect(range[i] === 'gap' && range[i - 1] === 'gap').toBe(false)
      }
    }
  })

  it('clamps an out-of-range current page', () => {
    expect(buildPageRange(0, 5)).toEqual([1, 2, 3, 4, 5])
    expect(buildPageRange(99, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('enforces a minimum slot count rather than producing nonsense', () => {
    expect(buildPageRange(5, 20, 1).length).toBeLessThanOrEqual(5)
    expect(buildPageRange(5, 20, 1)).toContain(5)
  })
})
