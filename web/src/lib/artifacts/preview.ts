/**
 * Wraps an HTML fragment in a full document shell for safe iframe rendering.
 * If the content already contains <html> or <!DOCTYPE>, returns as-is.
 */
export function wrapInHtmlDoc(content: string): string {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("<!doctype") || lower.startsWith("<html")) {
    return trimmed;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; }
</style>
</head>
<body>
${trimmed}
</body>
</html>`;
}
