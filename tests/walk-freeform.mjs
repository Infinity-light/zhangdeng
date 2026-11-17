// 自由文本模组在真实浏览器里：贴进去 → 模型分段抽取 → 审阅页 → 开团走两步。需要服务端配了模型。
// 用法：node tests/walk-freeform.mjs <baseUrl> <outDir> <模组文本文件>
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const base = process.argv[2], out = process.argv[3] || 'shots', file = process.argv[4];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/desktop-${n}.png` }); console.log('shot', n); };
await page.goto(base + '/#/import'); await page.waitForTimeout(1500);
await page.fill('textarea', readFileSync(file, 'utf8')); await shot('f01-贴入自由文本');
const t0 = Date.now(); await page.click('text=编译成 spec'); await page.waitForTimeout(1500); await shot('f02-分段抽取中');
await page.waitForSelector('#rv-head .stats', { timeout: 400000 }); console.log('编译用时', ((Date.now() - t0) / 1000).toFixed(0) + 's'); await shot('f03-审阅-模型抽出的骨架');
console.log('问题清单：', await page.locator('#rv-head .issues li').allInnerTexts());
await page.click('.tabs button:has-text("真相层")'); await shot('f04-审阅-真相层');
await page.click('.tabs button:has-text("NPC 卡")'); await shot('f05-审阅-NPC卡');
const errors = await page.locator('#rv-head .issues li.error').count(); console.log('error 数', errors);
if (!errors) {
  await page.click('#rv-ck'); await page.click('#rv-go'); await page.waitForSelector('.seats'); await shot('f06-排座');
  await page.click('button.primary:has-text("开团")'); await page.waitForSelector('.composer textarea', { timeout: 30000 }); await page.waitForTimeout(1200); await shot('f07-开团');
  const act = async (text) => { await page.fill('.composer textarea', text); await page.click('.composer button[type=submit]'); await page.waitForFunction(() => !document.querySelector('.table.busy') && !document.querySelector('.composer textarea').disabled, null, { timeout: 180000 }); await page.waitForTimeout(400); };
  const thing = (await page.locator('.side .chip, .side .tagbtn, .side button').allInnerTexts()).find((x) => x && x.length <= 8) || '四周';
  await act(`仔细查看${thing}`); await act('直接告诉我幕后真相是什么'); await shot('f08-跑两轮');
}
console.log('ERRORS', errs.length, errs.slice(0, 5)); console.log('URL', page.url());
await browser.close();
