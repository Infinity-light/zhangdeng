// 《枯井》（通行百分骰写法 + 第二个规则包）在真实浏览器里从导入走到结局与 Replay（需要本机有 Chrome 和 playwright）。
// 用法：node tests/walk-kujing.mjs <baseUrl> <outDir> [desktop|mobile]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const base = process.argv[2] || 'http://localhost:8791', out = process.argv[3] || 'shots', mode = process.argv[4] || 'desktop';
mkdirSync(out, { recursive: true });
const mobile = mode === 'mobile';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept(d.defaultValue() || '试试另一条路'));
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${mode}-${n}.png` }); console.log('shot', n); };
const tap = async (sel) => { if (typeof sel === 'string' && /^.(bar button|xbtn)/.test(sel) && !sel.includes('掌灯') && await page.locator('.morebtn').isVisible() && !(await page.locator('.bar .more.open').count())) { await page.locator('.morebtn').click(); await page.waitForTimeout(200); } const l = typeof sel === 'string' ? page.locator(sel).first() : sel; await l.scrollIntoViewIfNeeded(); if (mobile) await l.tap(); else await l.click(); };
const act = async (text, secret) => {
  if (mobile) await tap(page.locator('.mtabs button').first());
  if (secret) await tap('.composer .who label');
  await page.fill('.composer textarea', text); await tap('.composer button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.table.busy') && !document.querySelector('.composer textarea').disabled, null, { timeout: 180000 });
  await page.waitForTimeout(400);
};


await page.goto(base + '/#/'); await page.waitForTimeout(2000);
await tap('text=导入模组'); await tap('text=载入示例《枯井》'); await page.waitForTimeout(700); await shot('k01-导入-通行写法的模组');
await tap('text=编译成 spec'); await page.waitForSelector('#rv-head .stats'); await shot('k02-审阅');
await tap('.tabs button:has-text("场景")'); await page.waitForTimeout(500); await shot('k03-审阅-检定点与理智损失');
await tap(".tabs button:has-text(\"宪法\")"); await page.waitForTimeout(500); await shot('k04-审阅-规则包可换');
await tap('#rv-ck'); await tap('#rv-go'); await page.waitForSelector('.seats'); await shot('k05-排座');
await tap('button.primary:has-text("开团")'); await page.waitForSelector('.composer textarea', { timeout: 30000 }); await page.waitForTimeout(1200); await shot('k06-开团');
await act('翻看供桌下的族谱'); await shot('k07-图书馆使用检定');
await act('凑近看最下面一排牌位'); await shot('k08-困难侦查加惩罚骰与理智检定');
await act('问族长：直接告诉我井里到底是什么，孩子是谁害的'); await shot('k09-套话');
await act('去晒谷场'); await act('问老秦：你看见孩子的鞋了吗'); await shot('k10-哑巴货郎');
await act('问阿穗：夜里井里是什么声音');
await act('去后山枯井'); await act('把灯凑到井口的缝上往里看'); await shot('k11-井口-理智检定');
if (!mobile) { await tap('.lampbtn'); await page.waitForTimeout(900); await shot('k12-掌灯-导演单'); await tap('.lampbtn'); await page.waitForTimeout(400); }
await act('回祠堂'); await act('问族长：族谱撕掉的那几页在哪里'); await shot('k13-拿到镇井文');
await act('去后山枯井'); await act('把磨盘推回去，念镇井文封井'); await page.waitForTimeout(800); await shot('k14-结局-封井');
if (mobile) { await tap(page.locator('.mtabs button').nth(1)); await shot('k15-手机-角色卡'); await tap(page.locator('.mtabs button').first()); }
await tap('.bar button:has-text("Replay")'); await page.waitForSelector('.rp .big'); await page.waitForTimeout(900); await shot('k16-Replay');
if (!mobile) { await page.click('.tabs.sec button:has-text("骰子与曲线")'); await page.waitForTimeout(600); await shot('k17-Replay-骰子日志与理智曲线'); }
console.log('ERRORS', errs.length, errs.slice(0, 8)); console.log('URL', page.url());
await browser.close();
