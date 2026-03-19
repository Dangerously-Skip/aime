import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const MAX_DEPTH = 4;
const MAX_RESULTS = 50;
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.turbo',
]);

interface FileResult {
  path: string;
  name: string;
  relative: string;
}

async function walk(
  dir: string,
  cwd: string,
  q: string,
  results: FileResult[],
  depth: number,
  limit: number,
): Promise<void> {
  if (depth > MAX_DEPTH || results.length >= limit) return;

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const name of names) {
    if (results.length >= limit) break;
    const fullPath = path.join(dir, name);

    let stat: import('fs').Stats;
    try { stat = await fs.stat(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.has(name) && !name.startsWith('.')) {
        await walk(fullPath, cwd, q, results, depth + 1, limit);
      }
    } else if (stat.isFile()) {
      const rel = path.relative(cwd, fullPath);
      const matchesQuery =
        !q ||
        name.toLowerCase().includes(q.toLowerCase()) ||
        rel.toLowerCase().includes(q.toLowerCase());
      if (matchesQuery) {
        results.push({ path: fullPath, name, relative: rel });
      }
    }
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? '';
  const cwd = request.nextUrl.searchParams.get('cwd') ?? '';
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') ?? '15', 10),
    MAX_RESULTS,
  );

  if (!cwd) return Response.json({ files: [] });

  // Security: restrict to home directory subtree
  const home = os.homedir();
  const resolved = path.resolve(cwd);
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp')) {
    return Response.json({ files: [] });
  }

  try {
    const results: FileResult[] = [];
    await walk(resolved, resolved, q, results, 0, limit);
    return Response.json({ files: results });
  } catch {
    return Response.json({ files: [] });
  }
}
