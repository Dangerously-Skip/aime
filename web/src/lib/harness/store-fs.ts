import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { HarnessStore } from './store';

/**
 * The filesystem backing — what the harness has always used, now behind the
 * interface so the renderer can supply a different one.
 *
 * SERVER ONLY. It imports `node:fs`, so a client component reaching this drags
 * `fs` into a browser bundle and fails at `next build` rather than at runtime.
 * That is the failure this repo already shipped once, via
 * provider-manager.tsx -> credentials -> app-paths -> fs, with typecheck and
 * 2,777 tests green.
 */
export function fsStore(dir: string): HarnessStore {
  const resolve = (key: string) => path.join(dir, key);

  return {
    async readText(key) {
      try {
        return await fs.readFile(resolve(key), 'utf8');
      } catch {
        // Absent is normal — a run that has not written a question yet.
        return null;
      }
    },

    async writeText(key, contents) {
      /*
       * Temp file then rename, kept from the original ledger writer. A crash
       * mid-write leaves the previous state intact rather than a truncated file,
       * and a truncated ledger is worse than a missing one because the loop will
       * parse it and act on the result.
       */
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
      try {
        await fs.writeFile(tmp, contents, 'utf8');
        await fs.rename(tmp, file);
      } catch (e) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
    },

    async appendText(key, contents) {
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Genuine append: the progress log is append-only and concurrent sessions
      // must not clobber each other by read-modify-write.
      await fs.appendFile(file, contents, 'utf8');
    },

    async remove(key) {
      await fs.rm(resolve(key), { force: true }).catch(() => {});
    },

    async keys() {
      /*
       * RECURSIVE, and posix-separated, because the other backings key on the
       * whole string. A non-recursive readdir returned nothing for
       * `nested/goal.json` while memory and localStorage returned it — the same
       * store answering the same question two different ways, which is exactly
       * the drift the contract suite exists to stop. Caught by adding the case
       * to that suite rather than by relaxing it to match the weaker backing.
       */
      const walk = async (rel: string): Promise<string[]> => {
        let entries;
        try {
          entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
        } catch {
          return [];
        }
        const out: string[] = [];
        for (const e of entries) {
          const key = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) out.push(...(await walk(key)));
          else if (e.isFile()) out.push(key);
        }
        return out;
      };
      return walk('');
    },
  };
}
