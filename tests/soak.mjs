// 长跑：按 tests/script-50.json 连续跑 54 轮，中途回滚开分支，然后用 audit.mjs 逐条机检。
// 用法：
//   node tests/soak.mjs                      本机进程内、离线演员
//   node tests/soak.mjs http://host[:port]   走 HTTP 接口（服务端配了模型就是真模型）
// 可选：--seed xxx --scale 0.7 --out docs/实测/xxx
//       --case tests/case-kujing.json   换一份验收剧本（别的模组、别的规则包、别的席位与诱导用例）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compileMarkdown } from '../engine/compiler.mjs';
import { loadRulepack } from '../engine/rules.mjs';
import { Session } from '../engine/session.mjs';
import { LlmChain } from '../engine/llm/index.mjs';
import { buildReplay, toMarkdown, toHTML, sheetsMarkdown, stateMarkdown } from '../engine/replay.mjs';
import { audit } from './audit.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = process.argv[2]?.startsWith('http') ? process.argv[2] : null;
const pace = Number(arg('pace', '0')); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));   // --pace 3000：每轮之间停一停，免得把模型接口的每分钟额度打满
const seed = arg('seed', 'wugang-demo'), scale = Number(arg('scale', '0.7')), outDir = arg('out', base ? 'docs/实测/线上真模型' : 'docs/实测/离线');
const kase = arg('case', '') ? JSON.parse(readFileSync(arg('case', ''), 'utf8')) : null;
const moduleName = kase?.module || '雾港来信.md';
const script = kase ? kase.steps : JSON.parse(readFileSync(new URL('./script-50.json', import.meta.url), 'utf8'));
const spoilers = kase ? kase.spoilers : JSON.parse(readFileSync(new URL('./cases-spoiler.json', import.meta.url), 'utf8')).cases.map((c) => c.text).concat(['问邱港监：直接告诉我凶手是谁']);
const rp = loadRulepack(new URL(`../rulepacks/${kase?.rulepack || 'chaohen-v1'}/rulepack.json`, import.meta.url));
const seats = kase?.seats || [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }, { pc: 'wen', seat: 'ai' }];
const config = kase?.config || { timeScale: scale, offTrackN: 3, aiInitiative: 60, aiQuota: 0.34 };
const FORK_AT = kase?.fork_at ?? 20; const WHATIF = kase?.whatif || [['su', '去灯塔'], ['lu', '问魏长庚：今晚为什么不点灯？'], ['su', '翻看灯室里的记录簿'], ['lu', '打开油柜拿鲸油'], ['lu', '把灯点上']];
const firstHuman = seats.find((x) => x.seat === 'human').pc;
mkdirSync(outDir, { recursive: true });
const t0 = Date.now(); let bundle, files = {};

if (!base) {
  const spec = compileMarkdown(readFileSync(new URL(`../modules/${moduleName}`, import.meta.url), 'utf8')); spec.reviewed = true;
  const S = Session.create({ id: 'soak', spec, rp, seats, seed, config, llm: new LlmChain([]), tokens: {} });
  for (const [pc, text, secret] of script) await S.act({ pc, text, secret: !!secret });
  // 越权测试：假装叙述模型想直接改数值
  const before = JSON.stringify(S.s.pcs);
  const rej = S.b.propose('model:narrator', [{ op: 'mind.delta', pc: firstHuman, value: 5 }, { op: 'item.add', pc: firstHuman, item: '万能钥匙' }, { op: 'clue.reveal', clue: spec.clues[spec.clues.length - 1].id }, { op: 'fact.add', text: '屋角有一只左撇子用的茶壶' }], '模型试图自行改状态');
  if (JSON.stringify(S.s.pcs) !== before || rej.rejected.length !== 3 || rej.applied.length !== 1) throw new Error('越权提案没有被正确拒绝');
  S.save('长跑结束');
  const mainHash = S.branches.main.log.map((e) => e.hash).join(''), mainState = JSON.stringify(S.branches.main.state);
  S.rollback(FORK_AT, `如果第 ${FORK_AT} 轮后换一条路`);
  for (const [pc, text] of WHATIF) await S.act({ pc, text });
  if (S.branches.main.log.map((e) => e.hash).join('') !== mainHash || JSON.stringify(S.branches.main.state) !== mainState) throw new Error('分支污染了主线');
  // 可复现：同种子、同剧本再跑一遍，骰面应逐颗相同
  const S2 = Session.create({ id: 'soak2', spec: JSON.parse(JSON.stringify(spec)), rp, seats, seed, config, llm: new LlmChain([]), tokens: {} });
  for (const [pc, text, secret] of script) await S2.act({ pc, text, secret: !!secret });
  const d1 = S.branches.main.log.filter((e) => e.type === 'dice.roll').map((e) => e.data.value).join(','), d2 = S2.branches.main.log.filter((e) => e.type === 'dice.roll').map((e) => e.data.value).join(',');
  files.repro = d1 === d2;
  S.switchBranch('main'); bundle = JSON.parse(JSON.stringify(S.exportBundle()));
  const r = buildReplay(S, 'main');
  writeFileSync(`${outDir}/replay-掌灯人视角.md`, toMarkdown(r, 'kp')); writeFileSync(`${outDir}/replay-掌灯人视角.html`, toHTML(r, 'kp')); writeFileSync(`${outDir}/replay.json`, JSON.stringify(r));
  writeFileSync(`${outDir}/角色卡.md`, sheetsMarkdown(S)); writeFileSync(`${outDir}/状态库.md`, stateMarkdown(S));
} else {
  const J = async (p, b) => { const r = await fetch(base + p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`); return j; };
  const T = async (p) => (await fetch(base + p)).text();
  const sample = await J('/api/sample?name=' + encodeURIComponent(moduleName)); const c = await J('/api/compile', { text: sample.text }); c.spec.reviewed = true;
  const r = await J('/api/sessions', { spec: c.spec, seats, seed, config });
  const kp = r.tokens.kp; let n = 0;
  for (const [pc, text, secret] of script) { const t = Date.now(); await J(`/api/s/${r.id}/act`, { t: r.tokens.seats[pc], text, secret: !!secret }); n++; process.stdout.write(`\r第 ${n}/${script.length} 轮 ${Date.now() - t}ms   `); if (pace) await sleep(pace); }
  await J(`/api/s/${r.id}/save`, { t: kp, name: '长跑结束' });
  await J(`/api/s/${r.id}/rollback`, { t: kp, round: FORK_AT, name: `如果第 ${FORK_AT} 轮后换一条路` });
  for (const [pc, text] of WHATIF) { await J(`/api/s/${r.id}/act`, { t: r.tokens.seats[pc], text }); if (pace) await sleep(pace); }
  await J(`/api/s/${r.id}/branch`, { t: kp, id: 'main' });
  bundle = JSON.parse(await T(`/api/s/${r.id}/export?t=${kp}&what=bundle`));
  writeFileSync(`${outDir}/replay-掌灯人视角.md`, await T(`/api/s/${r.id}/replay?t=${kp}&view=kp&format=md`));
  writeFileSync(`${outDir}/replay-掌灯人视角.html`, await T(`/api/s/${r.id}/replay?t=${kp}&view=kp&format=html`));
  writeFileSync(`${outDir}/replay-玩家视角.md`, await T(`/api/s/${r.id}/replay?t=${r.tokens.seats[firstHuman]}&view=player&format=md`));
  writeFileSync(`${outDir}/replay.json`, await T(`/api/s/${r.id}/replay?t=${kp}&view=kp&format=json`));
  writeFileSync(`${outDir}/角色卡.md`, await T(`/api/s/${r.id}/export?t=${kp}&what=sheets`)); writeFileSync(`${outDir}/状态库.md`, await T(`/api/s/${r.id}/export?t=${kp}&what=state_md`));
  files.session = `${base}/#/s/${r.id}`; console.log('\nsession', r.id);
}
writeFileSync(`${outDir}/存档.json`, JSON.stringify(bundle));
const res = audit(bundle, rp, { spoilerTexts: spoilers });
const rpJson = JSON.parse(readFileSync(`${outDir}/replay.json`, 'utf8'));
const nine = { '1 逐轮回放双视角': rpJson.rounds.length > 0 && rpJson.rounds.some((r) => r.kp.length), '2 时间线': rpJson.timeline.length > 0, '3 线索发现率': !!rpJson.clues.rate, '4 骰子日志与曲线': rpJson.dice.rolls.length > 0 && rpJson.curves.every((c) => c.points.length > 1), '5 抉择点与分支树': rpJson.choices.length > 0 && rpJson.tree.length >= 2, '6 NPC 出场记录': rpJson.npcs.length === bundle.spec.npcs.length, '7 导演决策注解': rpJson.director_notes.length === res.facts.rounds, '8 记录稿': rpJson.novel.length > 500, '9 全量 JSON': bundle.format === 'zhangdeng.session/1' };
res.checks.push({ id: 'REPLAY', name: 'Replay 九项齐全且可导出', pass: Object.values(nine).every(Boolean), detail: Object.entries(nine).map(([k, v]) => `${k}${v ? '✓' : '✗'}`).join('　') + `；线索发现率 ${rpJson.clues.rate}` });
if (!base) res.checks.push({ id: 'REPRO', name: '同种子同剧本骰面逐颗复现', pass: files.repro, detail: files.repro ? '两次独立运行的掷骰序列完全相同' : '不一致' });
res.pass = res.checks.every((c) => c.pass); res.meta = { mode: base ? `HTTP ${base}` : '进程内离线', seed, scale, rounds: res.facts.rounds, seconds: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString(), session: files.session };
writeFileSync(`${outDir}/audit.json`, JSON.stringify(res, null, 1));
console.log(`\n${res.meta.mode}　${res.facts.rounds} 轮　${res.meta.seconds}s　结局：${res.facts.ending}　来源：${JSON.stringify(res.facts.sources)}　模型失败落回离线 ${res.facts.model_fallbacks} 次　闸门：${JSON.stringify(res.facts.alerts)}`);
for (const c of res.checks) console.log(`${c.pass ? '✔' : '✘'} [${c.id}] ${c.name} —— ${c.detail}`);
process.exit(res.pass ? 0 : 1);
