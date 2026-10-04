import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveUserPath } from '@/lib/security/user-file-access';

const MAX_FILE_SIZE = 256 * 1024; // 256 KB

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
  '.md', '.mdx', '.txt', '.sh', '.bash', '.zsh', '.fish',
  '.html', '.css', '.scss', '.sass', '.less',
  '.env', '.gitignore', '.gitattributes',
  '.sql', '.graphql', '.gql', '.proto',
  '.tf', '.hcl', '.dockerfile', '',
]);

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path') ?? '';
  if (!filePath) return Response.json({ error: 'path required' }, { status: 400 });

  // Home or temp subtree, symlinks resolved, credential locations refused —
  // see user-file-access.ts for why each of those is load-bearing.
  const access = await resolveUserPath(filePath);
  if (!access.ok) {
    return access.reason === 'not-found'
      ? Response.json({ error: 'File not found' }, { status: 404 })
      : Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const resolved = access.path;

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return Response.json({ error: 'Not a file' }, { status: 400 });
    if (stat.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: `File too large (${Math.round(stat.size / 1024)}KB, max 256KB)` },
        { status: 413 },
      );
    }

    const ext = path.extname(resolved).toLowerCase();
    if (ext && !TEXT_EXTENSIONS.has(ext)) {
      return Response.json({ error: 'Binary or unsupported file type' }, { status: 400 });
    }

    const buf = await fs.readFile(resolved);
    // Extensionless names (Makefile, LICENSE) are allowed, so sniff for binary
    // content rather than trusting the missing extension.
    if (buf.includes(0)) {
      return Response.json({ error: 'Binary or unsupported file type' }, { status: 400 });
    }
    const content = buf.toString('utf-8');
    return Response.json({ content, size: stat.size, name: path.basename(filePath) });
  } catch {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }
}
