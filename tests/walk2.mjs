// 第二条浏览器走查：掌灯人控制台的每一项、第二台设备用席位链接加入、首页「看一局跑完的团」、各项导出。
// 用法：node tests/walk2.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const base = process.argv[2] || 'http://localhost:8791', out = process.argv[3] || 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const page = await ctx.newPage(); const errs = []; const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(cond ? '✔' : '✘', name, detail); };
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept(d.defaultValue() || 'x'));
const shot = async (p, n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${out}/walk2-${n}.png` }); };
const act = async (p, text) => { await p.fill('.composer textarea', text); await p.click('.composer button[type=submit]'); await p.waitForFunction(() => !document.querySelector('.table.busy') && !document.querySelector('.composer textarea').disabled, null, { timeout: 180000 }); await p.waitForTimeout(400); };
const text = (p, sel) => p.locator(sel).allInnerTexts().then((a) => a.join('\n'));

// 开一局
await page.goto(base + '/#/import'); await page.click('text=载入示例《雾港来信》'); await page.waitForTimeout(600); await page.click('text=编译成 spec');
await page.waitForSelector('#rv-head .stats'); await page.click('#rv-ck'); await page.click('#rv-go'); await page.waitForSelector('.seats'); await page.click('button.primary:has-text("开团")');
await page.waitForSelector('.composer textarea', { timeout: 30000 }); await page.waitForTimeout(1000);
const sid = /#\/s\/([\w-]+)/.exec(page.url())[1];
await act(page, '我凑近那块贴满纸的木板，一张一张往下揭');
ok('换一种说法也认得出（意图辅助或落回自由行动，都不报错）', (await text(page, '.stream')).length > 100);
await act(page, '去栈桥尽头看看');

// 掌灯 + 控制台
await page.click('.lampbtn'); await page.waitForTimeout(700); await page.click('.bar button:has-text("控制台")'); await page.waitForSelector('.drawer.on');
await page.locator('.drawer .ln', { hasText: '陆衡' }).first().waitFor(); await page.waitForTimeout(600); const before = await text(page, '.drawer'); const mind0 = Number((/陆衡\s+体魄 \d+\s+定力 (\d+)/.exec(before) || [])[1]); // 前两步里若掷出过定力检定，陆衡的定力就不是满的：比的是点一下之后少了 1
await page.locator('.drawer .ln', { hasText: '陆衡' }).locator('button:has-text("定力−")').click(); await page.waitForTimeout(1200);
ok('控制台：手动改定力，提案落库', (Number((/陆衡\s+体魄 \d+\s+定力 (\d+)/.exec(await text(page, '.drawer')) || [])[1]) === mind0 - 1), (/陆衡[^\n]*/.exec(await text(page, '.drawer')) || [''])[0]);
await page.locator('.drawer .ln', { hasText: '老葛' }).locator('button:has-text("+")').click(); await page.waitForTimeout(1200);
ok('控制台：改 NPC 态度', /老葛\s+态度 1/.test(await text(page, '.drawer')));
await page.fill('.drawer input[placeholder^="登记一条即兴事实"]', '牌馆的庄家是个左撇子'); await page.locator('.drawer button:has-text("登记")').click(); await page.waitForTimeout(1200);
ok('控制台：登记即兴事实', (await text(page, '.drawer')).includes('牌馆的庄家是个左撇子'));
await page.click('.drawer .dtabs button:has-text("剧情")'); await page.waitForTimeout(300); await page.locator('.drawer .ln', { hasText: '灯没有亮' }).locator('button:has-text("触发")').click(); await page.waitForTimeout(1500);
ok('控制台：强制触发事件', (await text(page, '.stream')).includes('今夜灯塔没有点灯'));
await page.locator('.drawer button:has-text("对抗")').click(); await page.waitForTimeout(1200);
ok('控制台：切换相位', (await page.locator('.drawer button.primary:has-text("对抗")').count()) === 1);
const fbBtn = page.locator('.drawer .ln', { hasText: '描出来的信' }).locator('button').first(); await fbBtn.click(); await page.waitForTimeout(1500);
ok('控制台：手动补线', (await text(page, '.stream')).includes('描出来的信'));
await page.locator('.drawer .ln', { hasText: '打回去重写' }).locator('button').click(); await page.waitForTimeout(6000);
ok('控制台：打断重写（旧稿划线保留）', (await page.locator('.stream .na.old').count()) >= 1);
await shot(page, '01-控制台各项操作之后');
// 席位链接
await page.click('.drawer .dtabs button:has-text("席位")'); await page.waitForTimeout(300); await page.locator('.drawer .ln', { hasText: '苏幼宁' }).last().locator('button:has-text("复制链接")').click(); await page.waitForTimeout(400);
const view = await (await fetch(`${base}/api/s/${sid}/view?t=${await page.evaluate((id) => JSON.parse(localStorage.getItem('zd.tokens'))[id].kp, sid)}`)).json();
const link = `${base}/#/s/${sid}?t=${view.seat_tokens.su}`;
await page.click('.drawer button:has-text("收起")'); await page.click('.lampbtn');

// 第二台设备：苏幼宁用席位链接加入
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push('p2 pageerror: ' + e.message));
await p2.goto(link); await p2.waitForSelector('.composer textarea', { timeout: 30000 }); await p2.waitForTimeout(1500);
ok('第二台设备：用席位链接加入，没有掌灯按钮和控制台', (await p2.locator('.lampbtn').count()) === 0 && (await p2.locator('.composer .who b').innerText()) === '苏幼宁');
ok('第二台设备：看不到任何掌灯人侧的内容', (await p2.locator('.ev.kp').allInnerTexts()).every((x) => /^落库/.test(x) && !/flag|clue|phase|npc|attitude|item/.test(x))) // 玩家席位按设计看得到「公开数值的落库」（生命/心智因哪次掷骰变了），其余掌灯人侧的东西一条都不该有;
// 陆衡在第一台设备上私下行动；苏幼宁那边不该出现
// （AI 寻访者有时会在前几轮自己公开去看渔船——那段所见本来就是公开的，不算泄露；所以比的是私下行动前后苏幼宁屏幕上多出了什么）
const s2before = await text(p2, '.stream'); const n2before = await p2.locator('.stream .ev').count();
await page.click('.composer .who label'); await act(page, '悄悄看看那些钉死的渔船');
await p2.waitForTimeout(3500);
const s2 = await text(p2, '.stream'); const n2 = await p2.locator('.stream .ev').count();
ok('信息差：陆衡的私下行动没有出现在苏幼宁的屏幕上', !s2.includes('悄悄看看那些钉死的渔船') && (s2before.includes('舱盖是从外面钉死的') || !s2.includes('舱盖是从外面钉死的')) && !s2.includes('还是刚才的样子'), `私下行动前后苏幼宁屏幕上的条目 ${n2before} → ${n2}`);
// 苏幼宁公开行动；陆衡那边应在几秒内出现
await p2.fill('.composer textarea', '问老葛：雾夜里有什么要小心的？'); await p2.tap('.composer button[type=submit]');
await p2.waitForFunction(() => !document.querySelector('.table.busy'), null, { timeout: 120000 }); await page.waitForTimeout(4000);
ok('同步：苏幼宁的公开行动几秒内出现在陆衡的屏幕上', (await text(page, '.stream')).includes('雾夜里有什么要小心的'));
await shot(p2, '02-第二台设备-苏幼宁的手机');
// 掌灯人链接不应该从席位链接里推出来
const r = await fetch(`${base}/api/s/${sid}/replay?t=${view.seat_tokens.su}&view=kp`); ok('权限：席位凭证拿不到掌灯人视角的 Replay', r.status === 403, String(r.status));
const r2 = await fetch(`${base}/api/s/${sid}/export?t=${view.seat_tokens.su}&what=bundle`); ok('权限：席位凭证拿不到存档导出', r2.status === 403, String(r2.status));

// 导出项
const kp = await page.evaluate((id) => JSON.parse(localStorage.getItem('zd.tokens'))[id].kp, sid);
for (const what of ['bundle', 'state', 'state_md', 'log', 'sheets', 'sheets_json', 'spec']) { const x = await fetch(`${base}/api/s/${sid}/export?t=${kp}&what=${what}`); const body = await x.text(); ok(`导出 ${what}`, x.status === 200 && body.length > 200, `${body.length} 字节`); }
for (const [v, f] of [['kp', 'md'], ['kp', 'html'], ['kp', 'json'], ['player', 'md'], ['player', 'html']]) { const x = await fetch(`${base}/api/s/${sid}/replay?t=${kp}&view=${v}&format=${f}`); const body = await x.text(); ok(`Replay 导出 ${v}/${f}`, x.status === 200 && body.length > 1000, `${body.length} 字节`); }
const playerMd = await (await fetch(`${base}/api/s/${sid}/replay?t=${view.seat_tokens.su}&view=player&format=md`)).text();
ok('玩家视角的 Replay 里没有导演单、没有别人的私下行动', !playerMd.includes('导演单') && !playerMd.includes('悄悄看看那些钉死的渔船'));

// 首页：看一局跑完的团
const p3 = await ctx.newPage(); await p3.goto(base + '/#/about'); await p3.waitForSelector('#demo-btn'); await p3.waitForTimeout(800); await p3.click('#demo-btn'); await p3.waitForSelector('.rp .big', { timeout: 60000 }); await p3.waitForTimeout(800);
ok('首页「看一局跑完的团」：导入示例存档并打开 Replay', (await text(p3, '.rp .lead')).includes('54 轮'), (await text(p3, '.rp .lead')).slice(0, 60));
await shot(p3, '03-示例存档的Replay');
console.log('ERRORS', errs.length, errs.slice(0, 6));
console.log('RESULT', results.filter((x) => x.pass).length + '/' + results.length);
await browser.close(); process.exit(results.every((x) => x.pass) && !errs.length ? 0 : 1);
