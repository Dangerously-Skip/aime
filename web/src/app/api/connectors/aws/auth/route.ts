export const runtime = 'nodejs';

import { spawn } from 'child_process';

/**
 * POST /api/connectors/aws/auth
 * Verifies AWS credentials via the standard credential chain
 * (`aws sts get-caller-identity`). If credentials are missing/expired the
 * user is pointed at `aws sso login` / `aws configure` — we don't run an
 * interactive flow server-side.
 */
export async function POST() {
  return new Promise<Response>((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch {
      resolve(
        Response.json(
          { error: 'aws CLI not found. Install the AWS CLI and ensure it is in your PATH.' },
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
        Response.json({ error: 'AWS credential check timed out.' }, { status: 504 })
      );
    }, 30 * 1000);

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT') {
        resolve(
          Response.json(
            { error: 'aws CLI not found. Install the AWS CLI and ensure it is in your PATH.' },
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
            {
              error:
                `No valid AWS credentials found${detail ? ` (${detail})` : ''}. ` +
                'Run `aws sso login` or `aws configure`, then try again.',
            },
            { status: 500 }
          )
        );
      }
    });
  });
}
