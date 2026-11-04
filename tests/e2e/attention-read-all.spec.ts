import { expect, test } from '@playwright/test';

test('bulk read refreshes the center and keeps pending items actionable', async ({ page, request }) => {
  const original = (await (await request.get('/api/agent-room/settings')).json()).data;
  await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en' } });
  const now = new Date().toISOString();
  const items = ['A pending question','An unread warning'].map((title,index) => ({ id:`item-${index}`,workspaceId:'fixture-workspace',workspaceName:'Attention QA',nodeId:null,taskId:null,category:'message',severity:'info',status:'open',title,body:null,sourceType:'notification',sourceId:null,action:{},actionAvailable:false,readAt:null,snoozedUntil:null,resolvedAt:null,createdAt:now,updatedAt:now }));
  let requests = 0;
  await page.route('**/api/agent-room/attention?*', route => route.fulfill({json:{data:items}}));
  await page.route('**/api/agent-room/attention/read-all', route => {
    requests++;for(const item of items){item.status='read';item.readAt=now as never;}
    return route.fulfill({json:{data:{count:2,readAt:now}}});
  });
  try {
    await page.goto('/settings');
    await page.getByRole('button',{name:'Open Attention Center',exact:true}).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByText('An unread warning',{exact:true})).toBeVisible();
    await panel.getByTestId('attention-read-all').click();
    await expect.poll(()=>requests).toBe(1);
    await expect(panel.getByText('A pending question',{exact:true})).toBeVisible();
    await expect(panel.getByText('An unread warning',{exact:true})).toBeVisible();
    await expect(panel.locator('.attention-card').locator('strong')).toHaveCount(2);
  } finally { await request.put('/api/agent-room/settings',{data:original}); }
});
