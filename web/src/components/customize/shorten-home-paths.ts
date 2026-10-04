/**
 * Replace a home-directory prefix inside free text with `~`.
 *
 * Health-check fixes arrive from the server with absolute paths
 * (`Create /Users/alex/.claude/SOUL.md to …`), which wrap across three lines of
 * a narrow card and bury the part that matters — the file name — while also
 * printing the account name. The client does not know the home directory, so
 * this recognises the three shapes a home path takes rather than a value.
 *
 * `/Users/Shared` is a real directory on macOS, not anyone's home, and is left
 * alone.
 */
// An account name. Followed by a separator it is everything up to it
// (`first.last/`); at the end of a path it may not END in sentence
// punctuation, so "home is /Users/alex." keeps its full stop.
const NAME = String.raw`(?:[^\\/\s]+(?=[\\/])|[^\\/\s]*[^\\/\s.,;:)])`;
const HOME_PREFIX = new RegExp(
  String.raw`(?:\b[A-Za-z]:\\Users\\(?!Public\b)${NAME}|/Users/(?!Shared\b)${NAME}|/home/${NAME})(?=[\\/]|\s|$|[.,;:)])`,
  'g',
);

export function shortenHomePaths(text: string): string {
  return text.replace(HOME_PREFIX, '~');
}
