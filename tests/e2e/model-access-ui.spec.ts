import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { inferenceIdentity, inferenceInvite, inferenceNonce } from '@orkestrai/collaboration-protocol/inference';

// The desktop vault is unavailable in a browser test. Keep API data isolated;
// real encrypted pairing/admission/revocation is covered in model-access.test.ts.
const models = [
  { id:'claude',displayName:'Claude',models:[{value:'sonnet',label:'Sonnet',efforts:['low','high']},{value:'opus',label:'Opus',efforts:['high','max']}],efforts:['low','high','max'],installed:true },
  { id:'codex',displayName:'Codex',models:[{value:'codex-one',label:'Codex One',efforts:['medium','high']},{value:'codex-two',label:'Codex Two',efforts:['high','xhigh']}],efforts:['medium','high','xhigh'],installed:true },
  { id:'shared',displayName:'Orkestrai',models:[],efforts:[],installed:true,bundled:true,supportsResume:true,profileStrategy:{kind:'unsupported'},setup:{docsUrl:'https://orkestrai.app/docs'} },
];
const connectionId=randomUUID(), grantId=randomUUID();
const connection = { id:connectionId,grantId,name:'QA access',guestName:'My Mac',guestId:randomUUID(),ownerPublicKey:inferenceIdentity().publicKey,relayUrl:'wss://relay.orkestrai.app/v1/inference',status:'pending',state:'waiting_approval',policy:null,expiresAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() };
const offering = {id:randomUUID(),providerId:'claude',profileId:null,label:'Work',models:null,efforts:null,images:false,availableModels:[{value:'sonnet',label:'Sonnet',efforts:['high']}]};
const policy = {offerings:[offering],concurrency:1,requestsPerMinute:10,maxRequests:null};
const grant = { id:grantId,name:'Work access',status:'active',state:'connected',pending:[],running:0,queued:0,revision:1,requestsUsed:0,expiresAt:new Date(Date.now()+86400000).toISOString(),policy,guest:null };
async function changed(page:Page) { await page.evaluate(()=>{(window as any).__modelAccessChanged();}); }
async function fixture(page:Page,read:()=>unknown) {
  await page.addInitScript(()=>{
    const streams:EventTarget[]=[];
    class FixtureEvents extends EventTarget {
      constructor(public url:string) { super(); streams.push(this); queueMicrotask(()=>this.dispatchEvent(new Event('open'))); }
      close() { const at=streams.indexOf(this); if(at>=0) streams.splice(at,1); }
    }
    (window as any).EventSource=FixtureEvents;
    (window as any).__modelAccessChanged=()=>streams.forEach(stream=>stream.dispatchEvent(new MessageEvent('changed',{data:'{}'})));
  });
  await page.route('**/api/agent-room/status',route=>route.fulfill({json:{data:{providers:models}}}));
  await page.route('**/api/agent-room/provider-profiles',route=>route.fulfill({json:{data:[]}}));
  await page.route('**/api/agent-room/provider-status/*',route=>route.fulfill({json:{data:{indicator:'none',checked:false,incidents:[]}}}));
  await page.route('**/api/model-access',route=>route.fulfill({json:{data:read()}}));
}

let settings:Record<string,unknown>;
test.beforeEach(async({request})=>{
  settings=(await(await request.get('/api/agent-room/settings')).json()).data;
  await request.put('/api/agent-room/settings',{data:{...settings,uiLanguage:'en'}});
});
test.afterEach(async({request})=>{ await request.put('/api/agent-room/settings',{data:settings}); });

test('the open invitation follows approval and revocation, and usage changes without reopening',async({page})=>{
  let state:any={grants:[structuredClone(grant)],connections:[]};
  await fixture(page,()=>state);
  await page.route('**/api/model-access/join',route=>route.fulfill({json:{data:{...connection,fingerprint:'ABCD-'.repeat(7)+'ABCD'}}}));
  await page.goto('/providers');
  await page.getByRole('button',{name:'Use invitation',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('This device’s name').fill('My Mac');
  await dialog.getByLabel('Private invitation').fill(inferenceInvite({grantId,secret:inferenceNonce(),ownerPublicKey:inferenceIdentity().publicKey,relayUrl:connection.relayUrl}));
  state.connections=[connection];
  await dialog.getByRole('button',{name:'Use invitation',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Awaiting approval');
  state.connections=[{...connection,status:'active',state:'connected',policy,expiresAt:grant.expiresAt}];
  await changed(page);
  await expect(dialog.getByRole('status')).toContainText('Connected');
  await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();
  state.grants[0].requestsUsed=3;
  await changed(page);
  await expect(page.locator('.access-card').filter({hasText:'Work access'})).toContainText('3 model requests');
  state.connections=[{...state.connections[0],status:'revoked',state:'offline'}];
  await changed(page);
  await expect(dialog.getByRole('status')).toContainText('Revoked');
  await dialog.locator('.join-actions').getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('.access-card').filter({hasText:'QA access'})).toContainText('Revoked');
});

test('account model dropdowns and effort controls preserve their exact policy on save',async({page})=>{
  let submitted:any;
  await fixture(page,()=>({grants:[],connections:[]}));
  await page.route('**/api/model-access',async route=>{
    if(route.request().method()==='POST'){ submitted=route.request().postDataJSON(); await route.fulfill({json:{data:{...grant,status:'draft'}}}); }
    else await route.fulfill({json:{data:{grants:[],connections:[]}}});
  });
  await page.route(`**/api/model-access/${grantId}`,route=>route.fulfill({json:{data:{invite:'orkestrai://invite#'+'A'.repeat(2800)}}}));
  await page.goto('/providers');
  await page.getByRole('button',{name:'Lend access',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Access name',{exact:true}).fill('Specific access');
  await dialog.getByRole('checkbox',{name:'Claude · Default',exact:true}).check();
  const scope=dialog.getByRole('group',{name:'Claude · Default',exact:true});
  const dropdown=scope.getByRole('combobox',{name:'Claude · Default · Allowed models',exact:true});
  await dropdown.click();
  await expect(page.getByRole('option',{name:'Sonnet',exact:true})).toBeVisible();
  await expect(page.getByRole('option',{name:'Codex One',exact:true})).toHaveCount(0);
  await page.getByRole('option',{name:'Sonnet',exact:true}).click();
  await page.keyboard.press('Escape');
  await scope.getByRole('radio',{name:'Choose',exact:true}).click();
  await expect(scope.getByRole('button',{name:'Maximum',exact:true})).toHaveCount(0);
  await dialog.getByRole('checkbox',{name:'Codex · Default',exact:true}).check();
  const codex=dialog.getByRole('group',{name:'Codex · Default',exact:true});
  await codex.getByRole('combobox').click();
  await expect(page.getByRole('option',{name:'Codex One',exact:true})).toBeVisible();
  await expect(page.getByRole('option',{name:'Sonnet',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await dialog.getByRole('button',{name:'Save access',exact:true}).click();
  await expect.poll(()=>submitted?.offerings).toEqual([
    {providerId:'claude',profileId:null,models:['sonnet'],efforts:['high'],images:false},
    {providerId:'codex',profileId:null,models:null,efforts:null,images:false},
  ]);
  await expect(dialog.getByRole('button',{name:'Copy invitation'})).toBeVisible();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

for(const width of [390,1280]) test(`long invitations stay inside the dialog at ${width}px`,async({page})=>{
  await fixture(page,()=>({grants:[],connections:[]}));
  await page.setViewportSize({width,height:800});
  await page.goto('/providers');
  const row=page.locator('.provider-row').filter({has:page.getByRole('heading',{name:'Orkestrai',exact:true})});
  await expect(row).toContainText('Included in Orkestrai');
  await row.getByRole('button',{name:'How to connect'}).click();
  await expect(row).not.toContainText('Install the CLI');
  await page.getByRole('button',{name:'Use invitation',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('This device’s name').fill('My Mac');
  await dialog.getByLabel('Private invitation').fill('orkestrai://invite#'+'a'.repeat(2800));
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const box=await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(width-24);
  const button=await dialog.getByRole('button',{name:'Use invitation',exact:true}).boundingBox();
  expect(button!.x+button!.width).toBeLessThanOrEqual(box!.x+box!.width);
});
