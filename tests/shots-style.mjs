// 给界面风格留对照图：手机（390×844）和桌面（1440×900）各一套——封面、你是谁、桌面、掷骰、示例回放里的线索卡与结局卡。
// node tests/shots-style.mjs <baseUrl> <输出目录>      需要 playwright 和 Chrome
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const [base, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [tag, w, h] of [['手机', 390, 844], ['桌面', 1440, 900]]) {
  const mobile = w < 700; const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('zd.sound', 'false'); } catch { /* 无存储 */ } });
  const tap = (l) => (mobile ? l.tap() : l.click()); const shot = (name) => page.screenshot({ path: `${out}/${tag}-${name}.png` });
  await page.goto(base + '/#/'); await page.waitForSelector('.cover .go'); await page.waitForTimeout(2600); await shot('1封面');
  await tap(page.locator('.cover .go')); await page.waitForSelector('.person'); await page.waitForTimeout(1500); await shot('2你是谁');
  await tap(page.locator('.person').first()); await page.waitForSelector('.table'); await page.waitForTimeout(3800); await shot('3桌面');
  await page.locator('.composer textarea').fill('看看告示栏'); await tap(page.locator('.composer button[type=submit]'));
  await page.waitForSelector('.dicefx.landed', { timeout: 60000 }).catch(() => errs.push('没等到骰子')); await page.waitForTimeout(350); await shot('4掷骰');
  await page.waitForFunction(() => !document.querySelector('.table.busy') && !document.querySelector('.table.staging'), null, { timeout: 120000 }).catch(() => {}); await page.waitForTimeout(900); await shot('5掷骰之后');
  // 示例回放：一局跑完的团，里面有线索卡和结局卡
  await page.goto(base + '/#/about'); await page.waitForSelector('#demo-btn'); await tap(page.locator('#demo-btn')); await page.waitForSelector('.rp .stream .ev', { timeout: 60000 }); await page.waitForTimeout(1500); await shot('6回放页');
  for (const [sel, name] of [['.ev.cl', '7线索卡'], ['.ev.dc', '8骰子牌'], ['.ev.ca.trigger, .ev.ca.event', '9事件'], ['.ev.end', '10结局卡']]) {
    const l = page.locator(sel).first(); if (!(await l.count())) { errs.push('没有 ' + sel); continue; }
    await l.evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(700); await shot(name);
  }
  console.log(tag, errs.length ? errs : 'ok'); await ctx.close();
}
await browser.close();
