// 在线上照着一串行动真玩一局，把屏幕上出现的字按轮记下来（叙述、台词各自的来源一并记），遇到线索卡、掷骰、结局各截一张图。
// node tests/play-evidence.mjs <baseUrl> <输出目录> <模组文件名> <宽> <高> <行动1> <行动2> …      需要 playwright 和 Chrome
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const [base, out, mod, w, h, ...acts] = process.argv.slice(2); mkdirSync(out, { recursive: true }); const mobile = +w < 700;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') { errs.push('console: ' + m.text().slice(0, 300)); console.log('console.error', m.text().slice(0, 300)); } });
await page.addInitScript(() => { try { localStorage.setItem('zd.sound', 'false'); } catch { /* 无存储 */ } });
const tap = (l) => (mobile ? l.tap() : l.click()); let n = 0; const shot = (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });
await page.goto(`${base}/#/go/${encodeURIComponent(mod)}`); await page.waitForSelector('.person'); await page.waitForTimeout(1200);
await tap(page.locator('.person').first()); await page.waitForSelector('.table'); await page.waitForSelector('.reach button, .scenebox .chips span', { state: 'attached', timeout: 60000 }); await page.waitForTimeout(3000); await shot('开场');
const health = await (await fetch(base + '/api/health')).json(); const log = { base, version: health.version, model: health.model, module: mod, viewport: `${w}x${h}`, session: page.url().split('/s/')[1], rounds: [] };
// 屏幕上这一轮新出现的块：类型、文字、来源（灯没亮时来源藏着，但节点在）
const grab = () => page.evaluate(() => { const box = document.querySelector('.stream .in'); const kids = [...box.children]; let i = kids.length - 1; while (i >= 0 && !kids[i].classList.contains('rd')) i--; return kids.slice(Math.max(0, i)).filter((e) => !e.classList.contains('kpnote')).map((e) => { const ev = e.classList.contains('ev') ? e : e.querySelector('.ev') || e; const cls = ev.className; const src = ev.querySelector('.src')?.textContent || ''; const c = ev.cloneNode(true); c.querySelectorAll('.src').forEach((x) => x.remove()); const kind = /\bna\b/.test(cls) ? '叙述' : /\bnp ai\b/.test(cls) ? 'AI同伴' : /\bnp\b/.test(cls) ? 'NPC' : /\bdc\b/.test(cls) ? '掷骰' : /\bcl\b/.test(cls) ? '线索' : /\bend\b/.test(cls) ? '结局' : /\bpa\b/.test(cls) ? '行动' : /\bca\b/.test(cls) ? '原文' : cls.includes('rd') ? '轮' : '其他'; return { kind, src, text: c.innerText.replace(/\s*\n\s*/g, ' / ').trim() }; }); });
for (const a of acts) {
  const rd0 = await page.locator('.stream .in > .rd').count();   // 这一轮真的出来了（多了一道轮次线）才算数
  await page.locator('.composer textarea').fill(a, { timeout: 240000 }); await tap(page.locator('.composer button[type=submit]'));
  const seen = { dice: false, clue: false };
  const t0 = Date.now(); for (;;) {
    if (!seen.dice && await page.locator('.dicefx.landed').count()) { seen.dice = true; await page.waitForTimeout(300); await shot('掷骰'); }
    const idle = await page.evaluate((k) => document.querySelectorAll('.stream .in > .rd').length > k && !document.querySelector('.table.busy') && !document.querySelector('.table.staging') && (document.querySelector('.composer.over') || !document.querySelector('.composer textarea').disabled), rd0);
    if (idle && Date.now() - t0 > 1500) break; if (Date.now() - t0 > 240000) { errs.push('等太久：' + a); break; } await page.waitForTimeout(120);
  }
  await page.waitForTimeout(900); const blocks = await grab(); log.rounds.push({ action: a, sec: +((Date.now() - t0) / 1000).toFixed(1), blocks });
  if (blocks.some((b) => b.kind === '线索')) { await page.locator('.stream .ev.cl').last().evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(500); await shot('线索卡'); }
  console.log(a, '→', blocks.filter((b) => ['叙述', 'NPC', 'AI同伴', '结局'].includes(b.kind)).map((b) => `[${b.kind}|${b.src}] ${b.text}`).join('  ').slice(0, 420));
  if (await page.locator('.finale').count()) { await page.waitForTimeout(5200); await shot('结局幕'); log.ending = await page.evaluate(() => ({ name: document.querySelector('.finale h2').innerText.replace(/\s/g, ''), text: document.querySelector('.finale p').innerText })); await tap(page.locator('.finale .acts button').nth(1)); await page.waitForTimeout(900); await page.locator('.stream .ev.end').evaluate((e) => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(500); await shot('结局页-叙述流里'); break; }
}
await shot('最后'); log.errors = errs; writeFileSync(`${out}/记录.json`, JSON.stringify(log, null, 1)); console.log('errs', errs, 'ending', log.ending?.name); await browser.close();
