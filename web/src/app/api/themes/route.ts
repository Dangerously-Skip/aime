import { NextResponse } from 'next/server';
import { listDeckThemes } from '@/lib/themes/catalog';

export const runtime = 'nodejs';

/**
 * The deck theme catalog, for the picker.
 *
 * A route rather than a build-time constant because the themes are files on
 * disk: a user who drops one into the plugin directory should see it in the
 * picker, and after 492de26 their file survives updates. Reading at request
 * time is what makes that true.
 */
export async function GET() {
  return NextResponse.json({ themes: listDeckThemes() });
}
