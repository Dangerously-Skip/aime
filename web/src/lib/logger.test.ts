import { describe, it, expect, vi } from 'vitest';
import { APP_NAME } from '@/config/branding';

/*
 * pino is replaced so importing the module does not start the pino-pretty
 * transport's worker thread. What is under test is the option object handed
 * to it, which is exactly what reaches every log line.
 */
const { pinoMock } = vi.hoisted(() => {
  const fn = vi.fn((opts: unknown) => ({ opts, child: vi.fn() }));
  return { pinoMock: Object.assign(fn, { stdTimeFunctions: { isoTime: () => '' } }) };
});
vi.mock('pino', () => ({ default: pinoMock }));

import { logBase } from './logger';

describe('logger base fields', () => {
  it('names the product, not the internal tool it was forked from', () => {
    const base = logBase('development', undefined);
    expect(base.application).toBe(APP_NAME.toLowerCase());
    expect(JSON.stringify(base)).not.toMatch(/quarry|kaos/i);
  });

  it('honours APPLICATION_NAME and maps production to prod, anything else to dev', () => {
    expect(logBase('production', 'my-fleet')).toEqual({ application: 'my-fleet', environment: 'prod' });
    expect(logBase('test', '').environment).toBe('dev');
  });

  it('is what the module-level logger is actually built with', () => {
    const opts = pinoMock.mock.calls[0][0] as { base: unknown };
    expect(opts.base).toEqual(logBase(process.env.NODE_ENV || 'development', process.env.APPLICATION_NAME));
  });
});
