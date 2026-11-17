// 浏览器走查：导入页读 .docx；跑几步之后在 Replay 页请模型把记录稿润色成小说体（需要服务端配了模型）。
// 用法：node tests/walk-novel.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const base = process.argv[2] || 'http://localhost:8787', out = process.argv[3] || 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const errs = [];
const ok = (name, cond, detail = '') => console.log(cond ? '✔' : '✘', name, detail);
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept(d.defaultValue() || 'x'));
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/desktop-${n}.png` }); };
const act = async (text) => { await page.fill('.composer textarea', text); await page.click('.composer button[type=submit]'); await page.waitForFunction(() => !document.querySelector('.table.busy') && !document.querySelector('.composer textarea').disabled, null, { timeout: 180000 }); await page.waitForTimeout(400); };

// 1　.docx：浏览器里解出正文，填进导入框（不上传原件）
await page.goto(base + '/#/import'); await page.waitForSelector('textarea');
await page.setInputFiles('input[type=file][accept*=".docx"]', fileURLToPath(new URL('./fixtures/测试用-停摆节选.docx', import.meta.url)));
await page.waitForFunction(() => document.querySelector('textarea').value.length > 40, null, { timeout: 15000 });
const docx = await page.inputValue('textarea');
ok('.docx 在浏览器里读成了正文', docx.length > 40 && !/<w:|PK\u0003/.test(docx), `${docx.length} 字，开头：${docx.slice(0, 30).replace(/\n/g, ' ')}`);
await shot('n01-导入docx');

// 2　跑几步，再去 Replay 请模型润色
await page.goto(base + '/#/'); await page.goto(base + '/#/import'); await page.waitForSelector('textarea');
await page.click('text=载入示例《枯井》'); await page.waitForTimeout(600); await page.click('text=编译成 spec');
await page.waitForSelector('#rv-head .stats'); await page.click('#rv-ck'); await page.click('#rv-go'); await page.waitForSelector('.seats'); await page.click('button.primary:has-text("开团")');
await page.waitForSelector('.composer textarea', { timeout: 30000 }); await page.waitForTimeout(1000);
for (const t of ['翻看供桌下的族谱', '问族长：三个孩子是什么时候不见的', '凑近看最下面一排牌位', '四处看看', '去晒谷场', '问阿穗：夜里井里是什么声音']) await act(t);
await shot('n02-环顾与重问');
await page.click('.bar button:has-text("掌灯")').catch(() => {}); await page.waitForTimeout(400);
await page.click('.bar button:has-text("Replay")'); await page.waitForSelector('.rp .big'); await page.waitForTimeout(900);
await page.click('.tabs.sec button:has-text("记录稿")'); await page.waitForTimeout(500); const btn = page.locator('button:has-text("润色成小说体")'); await btn.scrollIntoViewIfNeeded(); await shot('n03-Replay-记录稿');
const t0 = Date.now(); await btn.click();
await page.waitForSelector('p.dim.small:has-text("小说体")', { timeout: 400000 }); await page.waitForTimeout(800);
const head = await page.locator('p.dim.small:has-text("小说体")').first().innerText(); const novel = await page.locator('.novel').first().innerText();
ok('Replay 页请模型润色成小说体', novel.length > 200, `${head}　用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await page.locator('.novel').first().scrollIntoViewIfNeeded(); await shot('n04-Replay-小说体');
console.log('ERRORS', errs.length, JSON.stringify(errs.slice(0, 5)));
await browser.close();
