/**
 * Which highlight.js language a file is, in ONE place.
 *
 * Extracted from `code-renderer.tsx` when the EDITOR gained highlighting too.
 * Two copies of this would drift the moment someone taught one of them about a
 * new extension, and the symptom — a file that is coloured when you read it and
 * plain when you edit it — is exactly the confusing kind.
 */

const EXT_TO_LANG: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".css": "css",
  ".scss": "scss",
  ".html": "xml",
  ".xml": "xml",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".dockerfile": "dockerfile",
  ".graphql": "graphql",
  ".swift": "swift",
  ".kt": "kotlin",
  ".md": "markdown",
  ".mdx": "markdown",
};

/**
 * Files whose identity lives in their BASENAME. `.env.example` was the reported
 * case: ext `.example` matches nothing, so it fell to highlight.js AUTO-detect,
 * which scored an env file as markdown-ish and rendered every comment block in
 * italic emphasis with the `# ====` separator runs wrapping into fake
 * horizontal rules. KEY=value files are ini — comments and assignments
 * highlight correctly.
 */
const BASENAME_TO_LANG: Array<[RegExp, string]> = [
  [/^\.env($|\.)/, "ini"], // .env, .env.local, .env.example, .env.production…
  [/^\.git(ignore|modules|attributes|config)$/, "ini"],
  [/^\.editorconfig$/, "ini"],
  [/^\.npmrc$|^\.nvmrc$|^\.node-version$|^\.tool-versions$/, "ini"],
  [/^(dockerfile|containerfile)$/i, "dockerfile"],
  [/^makefile$/i, "makefile"],
];

/**
 * Plain text that must never go near auto-detect: certificates, logs, locks.
 * Highlighting these adds nothing and (as with .env.example) invents emphasis.
 */
const PLAIN_EXTS = new Set([".txt", ".log", ".lock", ".pem", ".crt", ".cer", ".key", ".pub"]);

/** The language for a file, or `''` when it should not be highlighted. */
export function resolveHljsLanguage({ ext, name }: { ext: string; name?: string }): {
  lang: string;
  isPlain: boolean;
} {
  const baseLang = name ? BASENAME_TO_LANG.find(([re]) => re.test(name))?.[1] : undefined;
  // Basename wins over extension (`.env.example`'s ext is ".example"), then the
  // extension map. Plain set beats everything but an explicit basename match.
  const lang = baseLang ?? (PLAIN_EXTS.has(ext) ? '' : EXT_TO_LANG[ext] || '');
  return { lang, isPlain: !baseLang && !lang && PLAIN_EXTS.has(ext) };
}

/** Convenience for callers that only have an extension. */
export function hljsLanguageFor(ext?: string): string {
  return resolveHljsLanguage({ ext: ext ?? '' }).lang;
}
