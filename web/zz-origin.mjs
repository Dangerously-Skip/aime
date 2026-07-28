import { _electron as electron } from 'playwright';
import { rmSync } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
setTimeout(()=>{ console.log('(timeout)'); process.exit(1); }, 150000);
const ud = join(tmpdir(),'aime-origin-'+Date.now());
async function go(port, fn, label){
  const app = await electron.launch({ args:['.', `--user-data-dir=${ud}`], cwd: process.cwd(), env:{...process.env, PORT:String(port)} });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(()=>{});
  await page.waitForTimeout(4500);
  console.log(label, JSON.stringify(await fn(page)));
  await app.close(); await new Promise(r=>setTimeout(r,2000));
}
const A = process.env.PA, B = process.env.PB;
await go(A, p=>p.evaluate(()=>{ localStorage.setItem('marker','set-on-first-port'); return { origin: location.origin, marker: localStorage.getItem('marker') }; }), `write  @${A} ->`);
await go(A, p=>p.evaluate(()=>({ origin: location.origin, marker: localStorage.getItem('marker') })), `same   @${A} ->`);
await go(B, p=>p.evaluate(()=>({ origin: location.origin, marker: localStorage.getItem('marker') })), `differ @${B} ->`);
rmSync(ud,{recursive:true,force:true});
