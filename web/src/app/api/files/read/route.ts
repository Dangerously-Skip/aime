import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

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

  // Security: restrict to home directory subtree
  const home = os.homedir();
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

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

    const content = await fs.readFile(resolved, 'utf-8');
    return Response.json({ content, size: stat.size, name: path.basename(resolved) });
  } catch {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }
}
