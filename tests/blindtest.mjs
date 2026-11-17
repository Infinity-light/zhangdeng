// NPC 口吻盲测（模型当裁判）：从一份存档里取出每个 NPC 说过的话，去掉名字，
// 只给裁判看各人的「公开身份 + 口吻描述」，让它猜这句话是谁说的。量的是验收第 6 条的「盲测能辨认是谁在说话」。
// 这是模型裁判，不是真人盲测；裁判和演员可能是同一个型号，结果只能当参考。
// 用法：node tests/blindtest.mjs <存档.json> [输出.json]     （需要在 .env 或环境变量里配模型）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { LlmChain, providersFromEnv } from '../engine/llm/index.mjs';
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const [file, out] = process.argv.slice(2);
const bundle = JSON.parse(readFileSync(file, 'utf8')); const spec = bundle.spec; const log = bundle.branches[bundle.current || 'main'].log;
const llm = new LlmChain(providersFromEnv()); if (!llm.enabled) { console.error('没有配置模型'); process.exit(2); }
const npcs = spec.npcs.map((n, i) => ({ id: n.id, name: n.name, letter: 'ABCDEFGH'[i], names: [n.name, ...n.aliases] }));
const allNames = npcs.flatMap((n) => n.names).sort((a, b) => b.length - a.length);
const mask = (t) => allNames.reduce((s, n) => s.split(n).join('某人'), t);
// 每句话只取一次；太短的（少于 6 个字）不测，认不出是正常的
const seen = new Set(); const items = [];
for (const e of log) if (e.type === 'npc.line' && e.data.text && e.data.text.length >= 6 && !seen.has(e.data.text)) { seen.add(e.data.text); items.push({ npc: e.data.npc, text: e.data.text, mode: e.data.mode, source: e.data.source, round: e.round }); }
const roster = npcs.map((n) => { const d = spec.npcs.find((x) => x.id === n.id); return `${n.letter}. ${mask(d.public_identity)}。口吻：${mask(d.voice.style)}`; }).join('\n');
const system = `下面是一场故事里的 ${npcs.length} 个人物，只给出身份和说话的样子：\n${roster}\n\n我会给你一句话，请判断最可能是谁说的。只输出一个字母，不要解释。`;
let ok = 0; const rows = []; const by = Object.fromEntries(npcs.map((n) => [n.id, { name: n.name, n: 0, ok: 0 }]));
for (const it of items) {
  let guess = '?';
  try { const r = await llm.complete({ role: 'judge', system, user: `这句话：「${mask(it.text)}」`, maxTokens: 8, temperature: 0, timeoutMs: 20000, maxWaitMs: 60000 }); guess = (/[A-H]/.exec(r.text.toUpperCase()) || ['?'])[0]; } catch (e) { guess = '!'; }
  const truth = npcs.find((n) => n.id === it.npc); const hit = guess === truth.letter; if (hit) ok++; by[it.npc].n++; if (hit) by[it.npc].ok++;
  rows.push({ round: it.round, truth: truth.name, guess: npcs.find((n) => n.letter === guess)?.name || guess, hit, mode: it.mode, source: it.source, text: it.text });
  process.stdout.write(hit ? '·' : '×');
}
const res = { file, judge: llm.describe()[0], npcs: npcs.length, lines: items.length, correct: ok, accuracy: items.length ? +(ok / items.length).toFixed(3) : null, chance: +(1 / npcs.length).toFixed(3), by_npc: Object.values(by), by_source: {}, rows };
for (const r of rows) { const k = r.source === 'offline' ? '作者写定的台词' : '模型生成的台词'; (res.by_source[k] ||= { n: 0, ok: 0 }); res.by_source[k].n++; if (r.hit) res.by_source[k].ok++; }
console.log(`\n${npcs.length} 个 NPC，${items.length} 句台词，裁判 ${res.judge}：认对 ${ok} 句（${(res.accuracy * 100).toFixed(0)}%），随机猜是 ${(res.chance * 100).toFixed(0)}%`);
for (const b of res.by_npc) console.log(`  ${b.name}：${b.ok}/${b.n}`);
for (const [k, v] of Object.entries(res.by_source)) console.log(`  ${k}：${v.ok}/${v.n}`);
for (const r of rows.filter((x) => !x.hit)) console.log(`  × 第${r.round}轮 ${r.truth} 被认成 ${r.guess}：${r.text.slice(0, 40)}`);
if (out) writeFileSync(out, JSON.stringify(res, null, 1));
