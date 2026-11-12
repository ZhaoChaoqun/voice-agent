// Opt-in paid integration test: no service mocks. Audio hardware is simulated.
const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('real WebRTC audio, mute and microphone cleanup at phone size', async ({page}) => {
  const code = process.env.DEMO_ACCESS_CODE ||
    fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^DEMO_ACCESS_CODE=(.+)$/m)?.[1].trim();
  if (!code) throw new Error('Provide DEMO_ACCESS_CODE for this opt-in live test.');
  await page.addInitScript(() => {
    window.testPeers = [];
    window.testTracks = [];
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) { super(...args); window.testPeers.push(this); }
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      window.testTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto('/');
  await page.locator('#access-code').fill(code);
  await page.getByRole('button', {name: 'Unlock demo'}).click();
  await page.getByRole('button', {name: 'Talk to AVA', exact: true}).click();
  await expect(page.locator('#connection')).toHaveText('Connected to AVA', {timeout: 65000});
  await expect(page.locator('#transcript')).toContainText('Commerzbank', {timeout: 45000});
  await expect.poll(async () => page.evaluate(async () => {
    const report = await window.testPeers[0].getStats();
    return [...report.values()].filter(item => item.type === 'inbound-rtp' && item.kind === 'audio')
      .reduce((sum, item) => sum + (item.packetsReceived || 0), 0);
  }), {timeout: 20000}).toBeGreaterThan(0);
  if (process.env.AVA_TEST_SPEECH_FILE) {
    await expect(page.locator('#transcript .user').filter({hasText: /overdraft/i}).first()).toBeVisible({timeout: 60000});
    await expect(page.locator('#transcript .assistant').last()).toContainText(/two thousand|2,000/i, {timeout: 45000});
  }
  await page.locator('#mute').click();
  expect(await page.evaluate(() => window.testTracks.every(track => !track.enabled))).toBe(true);
  if (!process.env.AVA_TEST_SPEECH_FILE) {
    await expect(page.locator('#message')).toBeEnabled({timeout: 30000});
    await page.locator('#message').fill('Can you check the current overdraft limit on my fictional account?');
    await page.getByRole('button', {name: 'Send message', exact: true}).click();
    await expect(page.locator('#transcript')).toContainText(/two thousand|2,000/i, {timeout: 45000});
  }
  await page.screenshot({path: 'test-results/ava-live-phone.png', fullPage: true});
  await page.getByRole('button', {name: 'End conversation', exact: true}).click();
  expect(await page.evaluate(() => window.testTracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => window.testPeers.every(peer => peer.connectionState === 'closed'))).toBe(true);
  await expect(page.locator('#notice')).toBeHidden();
});
