import { describe, it, expect } from 'vitest';
import { titleCase } from './title-case';

describe('titleCase', () => {
  it.each([
    ['pitch-deck-vc', 'Pitch Deck VC'],
    ['retro-tv', 'Retro TV'],
    ['y2k-chrome', 'Y2K Chrome'],
    ['swiss-grid', 'Swiss Grid'],
    ['developer_tools', 'Developer Tools'],
    ['automation', 'Automation'],
    ['ai ml', 'AI Ml'],
  ])('%s -> %s', (input, expected) => {
    expect(titleCase(input)).toBe(expected);
  });
});
