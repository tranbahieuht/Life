import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:45000,
  expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:3000',browserName:'chromium',channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
});
