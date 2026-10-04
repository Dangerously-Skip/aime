import { NextRequest } from 'next/server';
import { identityFileHandlers } from '@/lib/identity/file-route';

export const runtime = 'nodejs';

const handlers = identityFileHandlers('USER.md');

export async function GET() {
  return handlers.GET();
}

export async function POST(req: NextRequest) {
  return handlers.POST(req);
}
