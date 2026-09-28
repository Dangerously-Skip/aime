/**
 * `pitch-deck-vc` -> `Pitch Deck VC`, `retro-tv` -> `Retro TV`.
 *
 * Plain capitalise-each-word turned acronyms into words ("Pitch Deck Vc",
 * "Y2k Chrome"), which reads as a typo in a picker whose whole job is to look
 * designed. Words on the acronym list are upper-cased whole; everything else
 * gets a leading capital.
 *
 * Pure and dependency-free so both the server-side theme catalog and client
 * components can use it.
 */
const ACRONYMS = new Set(['vc', 'tv', 'y2k', 'ai', 'api', 'ui', 'ux', 'mcp', 'sql', 'aws', 'pdf', 'crm', 'ci', 'cd', 'lsp']);

export function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
