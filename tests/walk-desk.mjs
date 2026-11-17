// 规则台在真实浏览器里：开《枯井》→ 拧亮灯 → 控制台 → 掷检定、暗骰、理智检定、对手登场、排先攻、交手、成长检定。
// 用法：node tests/walk-desk.mjs <baseUrl> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const base = process.argv[2] || 'http://localhost:8787', out = process.argv[3] || 'shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const shot = async (n) => { await page.waitForTimeout(600); await page.screenshot({ path: `${out}/desktop-${n}.png` }); console.log('shot', n); };
const settle = async () => { await page.waitForTimeout(900); await page.waitForSelector('.drawer.on'); };
await page.goto(base + '/#/import'); await page.waitForTimeout(1200);
await page.click('text=载入示例《枯井》'); await page.waitForTimeout(600); await page.click('text=编译成 spec'); await page.waitForSelector('#rv-head .stats');
await page.click('#rv-ck'); await page.click('#rv-go'); await page.waitForSelector('.seats');
await page.click('button.primary:has-text("开团")'); await page.waitForSelector('.composer textarea', { timeout: 30000 }); await page.waitForTimeout(1000);
await page.click('.lampbtn'); await page.waitForTimeout(600); await page.click('.bar button:has-text("控制台")'); await settle();
const d = page.locator('.drawer'); await page.click('.drawer .dtabs button:has-text("规则台")'); await page.waitForTimeout(300); 
const row = (text) => d.locator('.ln', { hasText: text }).first();
await d.locator('button:has-text("掷检定")').scrollIntoViewIfNeeded();
await d.locator('.ln.wrap').first().locator('select').nth(1).selectOption('侦查'); await d.locator('.ln.wrap').first().locator('select').nth(2).selectOption('困难'); await d.locator('.ln.wrap').first().locator('select').nth(3).selectOption('1');
await d.locator('button:has-text("掷检定")').click(); await settle();
await d.locator('button:has-text("暗骰")').click(); await settle();
await row('检定　成功/失败损失').locator('input').nth(0).fill('1'); await row('检定　成功/失败损失').locator('input').nth(1).fill('1d6'); await row('检定　成功/失败损失').locator('input').nth(2).fill('缝里伸出来一只手');
await row('检定　成功/失败损失').locator('button').click(); await settle();
await d.locator('input[placeholder="对手名"]').fill('井底之物'); await d.locator('button:has-text("登场")').click(); await settle();
await d.locator('button:has-text("排先攻")').click(); await settle();
for (let i = 0; i < 3; i++) { await d.locator('button:has-text("寻访者攻击")').first().click(); await settle(); if (await d.locator('button:has-text("它攻击·闪避")').count()) { await d.locator(`button:has-text("${i % 2 ? '它攻击·反击' : '它攻击·闪避'}")`).first().click(); await settle(); } }
await d.locator('button:has-text("掷检定")').scrollIntoViewIfNeeded(); await shot('d01-规则台');
await d.locator('button:has-text("掷成长检定")').click(); await settle();
await d.locator('button:has-text("收起")').click(); await page.waitForTimeout(500); await shot('d02-战斗轮写进叙述流-掌灯人视角');
await page.click('.lampbtn'); await page.waitForTimeout(700); await shot('d03-同一段-玩家视角看不到暗骰');
await page.click('.bar button:has-text("Replay")'); await page.waitForSelector('.rp .big'); await page.click('.tabs.sec button:has-text("骰子与曲线")'); await page.waitForTimeout(600); await shot('d04-Replay-骰子日志含战斗');
console.log('ERRORS', errs.length, errs.slice(0, 6)); console.log('URL', page.url());
await browser.close();
