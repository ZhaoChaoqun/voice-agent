const {test, expect} = require('@playwright/test');

test('mobile layout, presenter access and safe rendering', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/config', route => route.fulfill({json: {model: 'gpt-realtime-2.1'}}));
  await page.goto('/');
  await expect(page.getByRole('button', {name: 'Talk to AVA', exact: true})).toBeVisible();
  await expect(page.getByText('Illustrative only. Not an official Commerzbank service.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const start = await page.locator('#start').boundingBox();
  expect(start.height).toBeGreaterThanOrEqual(44);
  if (test.info().project.name !== 'desktop') {
    expect(start.y + start.height).toBeLessThanOrEqual(page.viewportSize().height);
  }
  await page.screenshot({path: `test-results/ava-${test.info().project.name}.png`, fullPage: true});
  expect(errors).toEqual([]);
});

test('text call, captions, inbox, end and cleanup without microphone', async ({page}) => {
  await page.route('**/api/config', route => route.fulfill({json: {model: 'gpt-realtime-2.1'}}));
  await page.routeWebSocket('**/api/voice?transport=text', socket => {
    socket.send(JSON.stringify({type: 'demo.ready', state: {inbox: []}}));
    socket.send(JSON.stringify({type: 'response.output_audio_transcript.done', item_id: 'hello',
      transcript: "Hi, Commerzbank, you're through to AVA, your AI assistant for this demo."}));
    socket.send(JSON.stringify({type: 'demo.idle'}));
    socket.onMessage(raw => {
      const event = JSON.parse(raw);
      if (event.type !== 'demo.text') return;
      socket.send(JSON.stringify({type: 'demo.user_text', text: event.text}));
      socket.send(JSON.stringify({type: 'demo.state', state: {inbox: [{
        id: 'overdraft', title: 'Your overdraft request', detail: 'EUR 5,000 total limit requested. Pending payslip and checks. Demo only.',
      }]}}));
      socket.send(JSON.stringify({type: 'demo.idle'}));
    });
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Prefer to type?'}).click();
  await expect(page.locator('#message')).toBeEnabled();
  await page.locator('#message').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(page.locator('#inbox')).toContainText('Pending payslip and checks');
  await expect(page.locator('#transcript')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#transcript img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'End conversation', exact: true}).click();
  await expect(page.locator('#connection')).toHaveText('Conversation ended');
  await expect(page.locator('#inbox-count')).toHaveText('1 item');
  await page.getByRole('button', {name: 'Prefer to type?'}).click();
  await expect(page.locator('#inbox-count')).toHaveText('0 items');
  await page.getByRole('button', {name: 'End conversation', exact: true}).click();
});

test('denied microphone leaves a recoverable state', async ({page, browserName}) => {
  await page.route('**/api/config', route => route.fulfill({json: {model: 'gpt-realtime-2.1'}}));
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    }
  });
  await page.goto('/');
  await page.getByRole('button', {name: 'Talk to AVA', exact: true}).click();
  // Windows WebKit lacks WebRTC; actual Safari supports it. Both failure paths must recover.
  await expect(page.locator('#notice')).toContainText(browserName === 'webkit'
    ? 'Voice needs Safari or Chrome on HTTPS' : 'Microphone permission was denied');
  await expect(page.getByRole('button', {name: 'Talk to AVA', exact: true})).toBeEnabled();
});
