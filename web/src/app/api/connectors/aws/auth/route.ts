export const runtime = 'nodejs';

import { spawn } from 'child_process';

/**
 * POST /api/connectors/aws/auth
 * Runs `rqp auth` to authenticate with AWS via the nib CLI.
 * Streams are captured; browser-based SSO will open automatically.
 * Times out after 5 minutes to allow for interactive auth flows.
 */
export async function POST() {
  return new Promise<Response>((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn('rqp', ['auth'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch {
      resolve(
        Response.json(
          { error: 'rqp not found. Install the nib CLI and ensure it is in your PATH.' },
          { status: 500 }
        )
      );
      return;
    }

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

    const timeout = setTimeout(() => {
      child.kill();
      resolve(
        Response.json({ error: 'rqp auth timed out after 5 minutes.' }, { status: 504 })
      );
    }, 5 * 60 * 1000);

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        resolve(
          Response.json(
            { error: 'rqp not found. Install the nib CLI and ensure it is in your PATH.' },
            { status: 500 }
          )
        );
      } else {
        resolve(
          Response.json({ error: err.message }, { status: 500 })
        );
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Response.json({ ok: true }));
      } else {
        const detail = stderr.join('').trim() || stdout.join('').trim();
        resolve(
          Response.json(
            { error: `rqp auth failed (exit ${code})${detail ? `: ${detail}` : '.'}` },
            { status: 500 }
          )
        );
      }
    });
  });
}
