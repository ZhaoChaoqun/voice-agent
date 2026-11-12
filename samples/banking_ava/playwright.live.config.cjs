const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './browser-tests',
  testMatch: 'live.cjs',
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: process.env.AVA_TEST_URL || 'http://127.0.0.1:8080',
    browserName: 'chromium',
    viewport: {width: 390, height: 844},
    permissions: ['microphone'],
    launchOptions: {args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      ...(process.env.AVA_TEST_SPEECH_FILE
        ? [`--use-file-for-fake-audio-capture=${process.env.AVA_TEST_SPEECH_FILE}%noloop`] : []),
    ]},
  },
});
