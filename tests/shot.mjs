// 单页截图：node tests/shot.mjs <url> <out.png> [desktop|mobile] [waitMs] [fullPage]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const [url, out, mode = 'desktop', wait = '2500', full] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const c = await b.newContext(mode === 'mobile' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1440, height: 900 } });
const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(url); await p.waitForTimeout(Number(wait)); await p.screenshot({ path: out, fullPage: !!full });
console.log('shot', out, 'errors', errs); await b.close();
