import { _electron as electron } from 'playwright';
const app = await electron.launch({ args:['.'], cwd: process.cwd(), env:{...process.env, PORT:'63500'} });
const page = await app.firstWindow();
const logs=[];
page.on('console', m=>logs.push(`[${m.type()}] `+m.text().slice(0,300)));
page.on('pageerror', e=>logs.push('PAGEERROR: '+(e.stack||e.message).slice(0,900)));
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(6000);
const H=async()=>(await page.locator('h1,h2').first().innerText().catch(()=>'')).trim();

// welcome
const inp=page.locator('input').first();
if(await inp.isVisible().catch(()=>false)) await inp.fill('Adam');
await page.getByRole('button',{name:'Continue',exact:true}).click();
await page.waitForTimeout(1200);
console.log('step:',await H());

// PROVIDER STEP — actually configure OpenRouter (the untested path)
await page.getByRole('button',{name:/OpenRouter/}).click();
await page.waitForTimeout(400);
await page.locator('input[type="password"]').first().fill('sk-or-v1-testkey000');
await page.getByRole('button',{name:'Save & verify',exact:true}).click();
console.log('clicked Save & verify; waiting for scan…');
await page.waitForTimeout(12000);
console.log('  success line visible:', await page.getByText(/Saved and verified/).isVisible().catch(()=>false));
console.log('  error line:', await page.locator('p.text-destructive').innerText().catch(()=>'(none)'));
const btns=async()=>page.locator('button').evaluateAll(b=>b.map(x=>`"${x.innerText.trim().slice(0,26)}"${x.disabled?'[DIS]':''}`).filter(s=>s!=='""'));
console.log('  buttons:',(await btns()).join(' '));

// advance
for(let i=0;i<8;i++){
  const hd=await H();
  if(hd.includes('Help make this better')){
    console.log('>>> FEEDBACK reached (with a provider configured)');
    const gs=page.getByRole('button',{name:'Get started',exact:true});
    console.log('   enabled=',await gs.isEnabled().catch(()=>'n/a'));
    await gs.click({timeout:4000}).then(()=>console.log('   clicked')).catch(e=>console.log('   CLICK FAILED:',e.message.split('\n')[0]));
    await page.waitForTimeout(4000);
    console.log('   heading AFTER=',await H());
    console.log('   body:', (await page.locator('body').innerText()).slice(0,180).replace(/\n+/g,' | '));
    break;
  }
  let moved=false;
  for(const t of ['Continue','Skip — set up later']){
    const el=page.getByRole('button',{name:t,exact:true}).first();
    if(await el.isVisible().catch(()=>false)&&await el.isEnabled().catch(()=>false)){await el.click();moved=true;break;}
  }
  if(!moved){ console.log('   stuck at:',hd,'buttons:',(await btns()).join(' ')); break; }
  await page.waitForTimeout(900);
}
console.log('\n--- console ---'); console.log(logs.length?logs.slice(0,25).join('\n'):'(none)');
await app.close();
