// 玩家动线的浏览器走查：封面 → 下船 → 你是谁 → 桌面上点「够得着的东西」起话头、行动 → 掷骰 → 线索 → Replay。
// 看的是第一次点开的人多快能玩起来，以及手机上每一屏排版是否正常（有没有横向溢出、按钮是否在屏内）。
// 用法：node tests/walk-play.mjs <baseUrl> <outDir> [mobile|desktop|small]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const base = process.argv[2] || 'http://localhost:8787', out = process.argv[3] || 'shots', mode = process.argv[4] || 'mobile';
mkdirSync(out, { recursive: true });
const VP = { mobile: { width: 390, height: 844 }, small: { width: 360, height: 640 }, desktop: { width: 1440, height: 900 } }[mode];
const touch = mode !== 'desktop';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext(touch ? { viewport: VP, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: VP });
const page = await ctx.newPage(); const errs = []; const results = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(cond ? '✔' : '✘', name, detail); };
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${mode}-p${n}.png` }); console.log('shot', n); };
const tap = async (l) => { l = typeof l === 'string' ? page.locator(l).first() : l; if (touch) await l.tap(); else await l.click(); };
// 排版检查：页面不能比屏幕宽；指定的元素要整个在屏内
const fits = async (name, sels = []) => {
  const r = await page.evaluate((sels) => { const w = document.documentElement.clientWidth; const over = document.documentElement.scrollWidth > w + 1; const bad = []; for (const s of sels) for (const el of document.querySelectorAll(s)) { const b = el.getBoundingClientRect(); if (b.width && (b.left < -1 || b.right > w + 1 || b.bottom > innerHeight + 1 || b.top < -1)) bad.push(`${s} [${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`); } return { over, bad, w, sw: document.documentElement.scrollWidth }; }, sels);
  ok(`排版：${name}`, !r.over && !r.bad.length, r.over ? `页面宽 ${r.sw} > 屏宽 ${r.w}` : r.bad.join('；'));
};
const settle = async () => { await page.waitForFunction(() => !document.querySelector('.table.busy') && !document.querySelector('.composer textarea').disabled, null, { timeout: 180000 }); await page.waitForTimeout(2600); };

const t0 = Date.now();
await page.goto(base + '/#/'); await page.waitForSelector('.cover .go'); await page.waitForFunction(() => document.querySelector('.cover .letter').textContent.length > 4, null, { timeout: 15000 }); await page.waitForTimeout(1800);
await fits('封面', ['.cover h1', '.cover .letter', '.cover .go', '.cover .sub a']); await shot('01-封面');
// 封面上每一行都不折行成孤字：标题一行、信上那句话最多两行、底下四个入口在同一行
const cov = await page.evaluate(() => { const lh = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)); const tops = [...document.querySelectorAll('.cover .sub a')].map((a) => Math.round(a.getBoundingClientRect().top)); return { h1: lh(document.querySelector('.cover h1')), letter: lh(document.querySelector('.cover .letter')), subRows: new Set(tops).size }; });
ok('封面：标题一行、信一到两行、四个入口同一行', cov.h1 === 1 && cov.letter <= 2 && cov.subRows === 1, JSON.stringify(cov));
await tap('.cover .go'); await page.waitForSelector('.pick .person', { timeout: 20000 }); await page.waitForTimeout(600);
await fits('你是谁', ['.pick h1', '.person']); await shot('02-你是谁');
await tap(page.locator('.person').first()); await page.waitForSelector('.composer textarea', { timeout: 30000 }); await page.waitForTimeout(1500);
const tPlay = ((Date.now() - t0) / 1000).toFixed(1);
ok('从打开到站在故事里（含等封面出字的 1.8 秒和两次截图）', true, `${tPlay} 秒，点了 2 下`);
await fits('桌面 · 开场', ['.bar', '.composer textarea', '.composer button[type=submit]']); await shot('03-开场');
// 用「够得着的东西」起话头（手机在输入框上面，桌面在左栏）
const chip = touch ? page.locator('.reach button').first() : page.locator('.scenebox .chips span').first();
const chipText = (await chip.innerText()).trim(); await tap(chip); await page.waitForTimeout(300);
ok('点一下看得见的东西，话就起了头', (await page.inputValue('.composer textarea')).includes(chipText), await page.inputValue('.composer textarea'));
await shot('04-起话头'); await tap('.composer button[type=submit]'); await page.waitForSelector('.ev.dc', { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(350);
if (await page.locator('.ev.dc').count()) { await shot('05-骰子在滚'); }
await settle(); ok('掷骰有结果', (await page.locator('.ev.dc .res').count()) >= 1, (await page.locator('.ev.dc').first().innerText()).replace(/\s+/g, ' '));
await fits('桌面 · 掷骰之后', ['.composer textarea']); await shot('06-掷骰与所见');
// 再走几步：问人、换地方
const person = touch ? page.locator('.reach button.p').first() : page.locator('.scenebox .who').first();
if (await person.count()) { await tap(person); await page.keyboard.type('最近镇上出过什么事'); await tap('.composer button[type=submit]'); await settle(); await shot('07-问人'); }
const things = touch ? page.locator('.reach button:not(.p):not(.x)') : page.locator('.scenebox .chips:not(.exits) span');
for (let i = 1; i < Math.min(4, await things.count()); i++) { await tap(things.nth(i)); await tap('.composer button[type=submit]'); await settle(); }
await shot('08-几步之后');
const exit = touch ? page.locator('.reach button.x').first() : page.locator('.scenebox .chips.exits span').first();
await tap(exit); await tap('.composer button[type=submit]'); await settle(); await page.waitForTimeout(800); await fits('桌面 · 换场', ['.composer textarea']); await shot('09-换场');
ok('到了新地方，有换场卡', (await page.locator('.ev.ca.scene').count()) >= 2);
if (touch) {
  await tap(page.locator('.mtabs button').nth(1)); await fits('人与地'); await shot('10-人与地'); await tap(page.locator('.mtabs button').nth(2)); await fits('线索'); await shot('11-线索'); await tap(page.locator('.mtabs button').first());
  await tap('.morebtn'); await page.waitForTimeout(300); await fits('菜单', ['.bar .more']); await shot('12-菜单'); await tap('.bar .more button:has-text("Replay")');
} else { await tap('.lampbtn'); await page.waitForTimeout(900); await shot('10-拧亮灯'); await tap('.lampbtn'); await tap('.bar button:has-text("Replay")'); }
await page.waitForSelector('.rp .big'); await page.waitForTimeout(900); await fits('Replay', ['.rp h1']); await shot('13-Replay');
// 其余入口在手机上也要排得下
for (const [hash, name, sel] of [['#/shelf', '换个故事', '.shelf .story'], ['#/about', '这是什么', '.about h2'], ['#/import', '导入', '.drop'], ['#/saves', '存档', 'h1']]) { await page.goto(base + '/' + hash); await page.waitForSelector(sel); await page.waitForTimeout(700); await fits(name, [sel]); await shot('2' + ['#/shelf', '#/about', '#/import', '#/saves'].indexOf(hash) + '-' + name); }
console.log('ERRORS', errs.length, errs.slice(0, 6)); console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
await browser.close();
