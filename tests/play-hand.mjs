// 亲手玩：每调用一次走一步，浏览器资料目录留在磁盘上，所以下一次调用接着同一局。
// 手机尺寸（390×844，触摸）。每一步打印新出现的叙述、此刻够得着的东西、时间和状态，并截一张图。
// 用法：node tests/play-hand.mjs <baseUrl> <stateDir> new [第几个角色]      从封面点「下船」开一局
//       node tests/play-hand.mjs <baseUrl> <stateDir> say "<一句话>"        在输入框里打字并行动
//       node tests/play-hand.mjs <baseUrl> <stateDir> chip "<够得着的东西>"  点一下那个东西再行动
//       node tests/play-hand.mjs <baseUrl> <stateDir> look                   只看当前画面
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const [base, dir, cmd, arg] = process.argv.slice(2);
mkdirSync(dir + '/shots', { recursive: true });
const stf = dir + '/state.json'; const st = existsSync(stf) ? JSON.parse(readFileSync(stf, 'utf8')) : { n: 0, seen: 0, url: null, log: [] };
const ctx = await chromium.launchPersistentContext(dir + '/profile', { channel: 'chrome', headless: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = ctx.pages()[0] || await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const settle = async () => { await page.waitForFunction(() => !document.querySelector('.table.busy') && (document.querySelector('.ev.end') || !document.querySelector('.composer textarea').disabled), null, { timeout: 240000 }); await page.waitForTimeout(3200); };
const t0 = Date.now();
if (cmd === 'new') {
  await page.goto(base + '/#/'); await page.waitForSelector('.cover .go'); await page.waitForTimeout(1500); await page.screenshot({ path: `${dir}/shots/00-封面.png` });
  await page.locator('.cover .go').tap(); await page.waitForSelector('.pick .person', { timeout: 30000 }); await page.waitForTimeout(500); await page.screenshot({ path: `${dir}/shots/00-你是谁.png` });
  await page.locator('.person').nth(Number(arg || 0)).tap(); await page.waitForSelector('.composer textarea', { timeout: 60000 }); await page.waitForTimeout(2500);
  st.url = page.url(); st.seen = 0; st.n = 0; st.log = [];
} else {
  await page.goto(st.url); await page.waitForSelector('.composer textarea, .ev.end', { timeout: 60000 }); await page.waitForTimeout(1500);
  if (cmd === 'say') { await page.locator('.composer textarea').fill(arg); await page.locator('.composer button[type=submit]').tap(); await settle(); }
  if (cmd === 'chip') { await page.locator('.reach button', { hasText: arg }).first().tap(); await page.waitForTimeout(200); if (/：$/.test(await page.inputValue('.composer textarea'))) throw new Error('问人要用 say'); await page.locator('.composer button[type=submit]').tap(); await settle(); }
}
const snap = await page.evaluate(() => ({ text: document.querySelector('.stream').innerText, ttl: document.querySelector('.bar .ttl')?.innerText, clock: document.querySelector('.bar .clock, .bar .ttl + *')?.innerText, reach: [...document.querySelectorAll('.reach button')].map((b) => (b.classList.contains('p') ? '@' : b.classList.contains('x') ? '→' : '') + b.innerText), me: document.querySelector('.side.l')?.innerText.replace(/\s+/g, ' ').slice(0, 160), night: document.querySelector('.night i')?.style.width, ended: !!document.querySelector('.ev.end') }));
const fresh = snap.text.slice(st.seen); st.seen = snap.text.length; st.n++;
const sec = ((Date.now() - t0) / 1000).toFixed(0);
await page.screenshot({ path: `${dir}/shots/${String(st.n).padStart(2, '0')}.png` });
st.log.push({ n: st.n, cmd, arg, sec, clock: snap.clock, scene: snap.ttl, fresh });
writeFileSync(stf, JSON.stringify(st, null, 1));
console.log(fresh.trim()); console.log(`\n—— ${snap.ttl} ${snap.clock}　夜 ${snap.night}　用时 ${sec}s　${snap.ended ? '【已收团】' : ''}\n够得着：${snap.reach.join(' ')}\n${snap.me}`);
if (errs.length) console.log('PAGE ERRORS', errs);
await ctx.close();
