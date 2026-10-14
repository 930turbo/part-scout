import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
await page.setContent(
  `<style>html,body{margin:0;width:256px;height:256px;background:transparent}svg{width:256px;height:256px}</style>${readFileSync('public/logo.svg', 'utf8')}`,
);
mkdirSync('build', { recursive: true });
await page.screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
