const {defineConfig, devices} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './browser-tests',
  timeout: 30000,
  use: {baseURL: process.env.AVA_TEST_URL || 'http://127.0.0.1:8080'},
  projects: [
    {name: 'desktop', use: {browserName: 'chromium', viewport: {width: 1440, height: 1100}}},
    {name: 'iphone', use: {...devices['iPhone 13'], browserName: 'webkit'}},
    {name: 'small-phone', use: {...devices['iPhone SE'], browserName: 'webkit'}},
  ],
});
