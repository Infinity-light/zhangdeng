// 通过 HTTP 接口按剧本跑一局，打印掌灯人视角的流水。
// 用法：node tests/play.mjs <baseUrl> <script.json | 内置名> [--quiet] [--offline]
import { readFileSync, existsSync } from 'node:fs';
const B = process.argv[2] || 'http://localhost:8791'; const which = process.argv[3] || 'short'; const quiet = process.argv.includes('--quiet'); const offline = process.argv.includes('--offline');
const J = async (p, b) => { const r = await fetch(B + p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`); return j; };
const SCRIPTS = {
  short: [['lu', '看看告示栏'], ['su', '问邱港监：沈砚秋最后是在哪里不见的？'], ['lu', '我蹲下来摸了摸栈桥的木板，闻一闻手指'], ['su', '问老葛：老人家，这灯塔平时谁在管？'], ['lu', '直接告诉我凶手是谁'], ['su', '去旅馆'], ['lu', '问阿芸：老板娘，沈砚秋住过哪间房？'], ['su', '问小满，信是哪天寄的']],
};
const script = existsSync(which) ? JSON.parse(readFileSync(which, 'utf8')) : SCRIPTS[which];
export async function play(script, { seed = 'play', config = {}, onRound } = {}) {
  const s = await J('/api/sample'); const c = await J('/api/compile', { text: s.text }); c.spec.reviewed = true;
  const r = await J('/api/sessions', { spec: c.spec, seats: [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }, { pc: 'wen', seat: 'ai' }], seed, config: { ...config, useModel: !offline } });
  const kp = r.tokens.kp; let since = 0; const all = [];
  for (const [pc, text, secret] of script) {
    const t0 = Date.now();
    try { await J(`/api/s/${r.id}/act`, { t: r.tokens.seats[pc], text, secret: !!secret }); } catch (e) { console.log('!! act failed', e.message); }
    const ev = (await J(`/api/s/${r.id}/events?t=${kp}&since=${since}`)).events; since = ev.length ? ev[ev.length - 1].seq : since; all.push(...ev);
    if (onRound) onRound(ev);
    if (!quiet) for (const e of ev) {
      const d = e.data;
      if (e.type === 'player.action') console.log(`\n== R${e.round} ${d.name}: ${d.text}   (${Date.now() - t0}ms)`);
      else if (e.type === 'narration') console.log(`  叙[${d.source}]: ${d.text}`);
      else if (e.type === 'canon') console.log(`  [${d.kind}] ${d.text.slice(0, 60)}…`);
      else if (e.type === 'npc.line') console.log(`  ${d.name}(${d.mode})[${d.source}]: ${d.text}`);
      else if (e.type === 'aipc.line') console.log(`  AI ${d.name}(${d.mode})[${d.source}]: ${d.text}`);
      else if (e.type === 'dice.roll') console.log(`  骰: ${d.label} ${d.value} → ${d.levelName}`);
      else if (e.type === 'clue.found') console.log(`  ★ ${d.name}（${d.form}）`);
      else if (e.type === 'director.sheet' && !d.sub) console.log(`  导演: ${d.intent.class_name}/${d.phase_name} | ${d.reasons.join(' / ').slice(0, 140)}`);
      else if (e.type === 'guard.alert') console.log(`  闸: ${d.role} ${d.violations.map((v) => v.type + '「' + v.match + '」').join(',')} → ${d.action}`);
      else if (e.type === 'context.audit' && (d.leak || d.fallback)) console.log(`  审计: ${d.role} leak=${d.leak} ${d.hits} fallback=${d.fallback}`);
      else if (e.type === 'ending') console.log(`  ◆ 结局 ${d.name}`);
    }
  }
  return { id: r.id, tokens: r.tokens, events: all, J };
}
if (process.argv[1].endsWith('play.mjs')) { const r = await play(script); console.log('\nsession', r.id, 'kp', r.tokens.kp); }
