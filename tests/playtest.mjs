// AI 试玩：让模型来当「人类玩家」，用它自己的话一轮一轮往下玩，而不是照着写好的剧本念。
// 用途：脚本长跑里玩家的话都是我们写的、正好踩在关键词上；这个试玩看的是「陌生人随口说的话」引擎接不接得住。
// 试玩员只看得到自己席位看得到的东西（走席位凭证取事件），不知道真相，也不知道引擎的关键词。
// 用法：node tests/playtest.mjs <baseUrl> [--module 枯井.md] [--rounds 40] [--seed xxx] [--out docs/实测/AI试玩-枯井] [--pace 2500]
//   试玩员用的模型从环境变量读（见 .env.example）；可用 PLAYTEST_MODEL 指定智谱型号，默认 glm-4-flash-250414。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { LlmChain, providersFromEnv } from '../engine/llm/index.mjs';
import { loadRulepack } from '../engine/rules.mjs';
import { audit } from './audit.mjs';
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
// --minutes N：按真实时间跑满 N 分钟（或到收团为止），不按步数停
const base = process.argv[2]; const moduleName = arg('module', '雾港来信.md'); const minutes = Number(arg('minutes', '0')); const maxRounds = minutes ? 1e9 : Number(arg('rounds', '40')); const startedAt = Date.now(); const pace = Number(arg('pace', '2500'));
const out = arg('out', `docs/实测/AI试玩-${moduleName.replace(/\.\w+$/, '')}`); mkdirSync(out, { recursive: true });
const llm = new LlmChain(providersFromEnv({ ...process.env, ZHIPU_MODELS: process.env.PLAYTEST_MODEL || 'glm-4-flash-250414,glm-4.5-flash' })); if (!llm.enabled) { console.error('没有配置模型'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 网络抖一下（连接超时、断线）不该让整局试玩作废：连不上就退避重试，最多六次；HTTP 层面的报错照旧算出错
let netRetries = 0;
const F = async (url, init) => { for (let i = 0; ; i++) { try { return await fetch(url, init); } catch (e) { if (i >= 5) throw e; netRetries++; await new Promise((x) => setTimeout(x, 3000 * (i + 1))); } } };
const J = async (p, b) => { const r = await F(base + p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 200)}`), { status: r.status }); return j; };
const T = async (p) => (await F(base + p)).text();

const PERSONAS = [
  '你是个认真的玩家：想把事情查清楚，会仔细看东西、找人问话、把线索连起来，也会害怕。一个地方查不出新东西了，或者有人、有线索指向别处，你会动身去那儿；手里有了能用的东西，你会想着去用它。',
  '你是个不按牌理出牌的玩家：有时认真查，有时故意跑题（闲逛、发呆、做些不相干的事），有时想走捷径——直接逼问别人、对人撒谎、甚至跳出故事问主持人要答案。',
];
const sample = await J('/api/sample?name=' + encodeURIComponent(moduleName)); const c = await J('/api/compile', { text: sample.text }); c.spec.reviewed = true;
const pregens = c.spec.pregens; const authored = pregens.some((p) => p.ai?.authored);
const seats = pregens.map((p, i) => ({ pc: p.id, seat: (authored ? p.ai?.authored : i >= 2) ? 'ai' : 'human' }));
const humans = seats.filter((s) => s.seat === 'human').map((s) => s.pc);
const r = await J('/api/sessions', { spec: c.spec, seats, seed: arg('seed', 'playtest-1'), config: { timeScale: Number(arg('scale', '0.7')) } });
console.log('session', `${base}/#/s/${r.id}`, '人类席位（由试玩员扮演）：', humans.join('、'));
const since = Object.fromEntries(humans.map((h) => [h, 0])); const seen = Object.fromEntries(humans.map((h) => [h, []])); const last = {}; const turns = []; let errors = 0;
const brief = (e) => { const d = e.data; switch (e.type) {
  case 'player.action': return `${d.name}：${d.text}`; case 'narration': return d.text; case 'canon': return (d.title ? `〔${d.title}〕` : '') + d.text; case 'npc.line': return `${d.name}说：${d.text}`;
  case 'aipc.line': return `${d.name}说：${d.text}`; case 'clue.found': return `（得到线索：${d.name}——${d.content}${d.item ? '；同时拿到了物品「' + d.item + '」' : ''}）`; case 'dice.roll': return `（掷骰 ${d.label}：${d.levelName}${d.loss ? '，损失 ' + d.loss : ''}）`; case 'ending': return `【结局：${d.name}】${d.text}`; default: return ''; } };
let ended = false; let canned = 0;
for (let n = 0; n < maxRounds && !ended && !(minutes && Date.now() - startedAt >= minutes * 60000); n++) {
  const pc = humans[n % humans.length]; const tok = r.tokens.seats[pc];
  const ev = (await J(`/api/s/${r.id}/events?t=${tok}&since=${since[pc]}`)); since[pc] = ev.seq; for (const e of ev.events) { const b = brief(e); if (b) seen[pc].push(b); if (e.type === 'ending') ended = true; }
  if (ended) break;
  const v = await J(`/api/s/${r.id}/view?t=${tok}`); const me = v.pcs.find((p) => p.id === pc);
  const system = `你在玩一场调查恐怖题材的桌面跑团，扮演「${me.name}」（${me.role}）。${PERSONAS[humans.indexOf(pc) % PERSONAS.length]}\n每次只输出你这一步要说的话或要做的事：一句话，不超过 30 个字，像真人玩家在桌边随口说出来的那样。不要编号，不要解释，不要加引号，不要替别人行动。不要重复你上一步做过的事。`;
  const user = `现在是 ${v.clock}，你们在「${v.scene.name}」。\n看得见的东西：${v.scene.things.join('、') || '（没什么特别的）'}\n在场的人：${v.scene.npcs.map((x) => `${x.name}（${x.public_identity}）`).join('、') || '（没有别人）'}\n可以去的地方：${v.scene.exits.join('、')}\n你们已经知道的：${v.clues.map((x) => x.name).join('、') || '（还什么都不知道）'}\n你身上有：${me.items.join('、') || '（没什么）'}\n\n最近发生的：\n${seen[pc].slice(-12).map((x) => '- ' + x.slice(0, 160)).join('\n') || '- （刚到）'}\n\n你的上一步：${last[pc] || '（还没有行动过）'}\n你这一步：`;
  let text = '';
  const say = async () => { try { const g = await llm.complete({ role: 'playtester', system, user, maxTokens: 60, temperature: 0.9, timeoutMs: 20000, maxWaitMs: 30000 }); return g.text.replace(/^["“「『]+|["”」』]+$/g, '').split('\n')[0].replace(/^[\d.、\-\s]+/, '').slice(0, 60).trim(); } catch { return ''; } };
  // 试玩员的模型没出声（限流、超时）就等一等再问一次；还不行才用一句垫场话，并记数——垫场话多了，这一局就不能算数
  text = await say(); if (!text) { await new Promise((x) => setTimeout(x, 4000)); text = await say(); }
  if (!text) { text = ['四处看看', '再想想', '和同伴商量一下'][n % 3]; canned++; }
  const t0 = Date.now(); let ok = true, err = '';
  try { await J(`/api/s/${r.id}/act`, { t: tok, text }); } catch (e) { ok = false; err = e.message; errors++; }
  last[pc] = text; turns.push({ n: n + 1, pc, text, ok, err, ms: Date.now() - t0 });
  process.stdout.write(`\r第 ${n + 1} 步 ${me.name}：${text.slice(0, 24)}${ok ? '' : ' ✘'}                    `);
  if (pace) await sleep(pace);
}
const kp = r.tokens.kp; const bundle = JSON.parse(await T(`/api/s/${r.id}/export?t=${kp}&what=bundle`)); const log = bundle.branches.main.log;
writeFileSync(`${out}/存档.json`, JSON.stringify(bundle)); writeFileSync(`${out}/replay-掌灯人视角.md`, await T(`/api/s/${r.id}/replay?t=${kp}&view=kp&format=md`)); writeFileSync(`${out}/replay-玩家视角.md`, await T(`/api/s/${r.id}/replay?t=${r.tokens.seats[humans[0]]}&view=player&format=md`));
const root = new URL('../rulepacks/', import.meta.url); const rp = loadRulepack(new URL(`${bundle.rulepack}/rulepack.json`, root));
const sheets = log.filter((e) => e.type === 'director.sheet' && !e.data.sub);
const probes = sheets.filter((e) => e.data.intent?.probe).map((e) => log.find((x) => x.type === 'player.action' && x.round === e.round)?.data.text).filter(Boolean);
const res = audit(bundle, rp, { spoilerTexts: probes });
const kinds = {}; const classes = {}; let assisted = 0; for (const e of sheets) { const k = e.data.narrator_gets?.kind || e.data.intent?.kind; kinds[k] = (kinds[k] || 0) + 1; const cl = e.data.intent?.class_name; if (cl) classes[cl] = (classes[cl] || 0) + 1; if (e.data.intent?.assisted) assisted++; }
const lines = sheets.map((e) => { const a = log.find((x) => x.type === 'player.action' && x.round === e.round); return `| ${e.round} | ${a?.data.name} | ${a?.data.text.replace(/\|/g, '／')} | ${e.data.narrator_gets?.kind}${e.data.intent?.assisted ? '（辅助：' + e.data.intent.assisted + '）' : ''}${e.data.narrator_gets?.target ? ' → ' + e.data.narrator_gets.target : ''} | ${e.data.intent?.class_name || ''}${e.data.fallback ? '；补线 ' + e.data.fallback.clue_name : ''} |`; });
const summary = { session: `${base}/#/s/${r.id}`, module: moduleName, rounds: res.facts.rounds, ending: res.facts.ending, wall_minutes: Math.round((Date.now() - startedAt) / 6000) / 10, steps: turns.length, net_retries: netRetries, http_errors: errors, http_error_detail: turns.filter((x) => !x.ok).map((x) => ({ step: x.n, err: String(x.err).slice(0, 160) })), player_canned: canned, player_model: process.env.PLAYTEST_MODEL || 'glm-4-flash-250414', kinds, classes, assisted, probes: probes.length, sources: res.facts.sources, model_fallbacks: res.facts.model_fallbacks, alerts: res.facts.alerts, checks: res.checks.map((c) => ({ id: c.id, pass: c.pass, detail: c.detail })), avg_ms: Math.round(turns.reduce((a, t) => a + t.ms, 0) / Math.max(1, turns.length)), max_ms: Math.max(...turns.map((t) => t.ms)) };
writeFileSync(`${out}/试玩小结.json`, JSON.stringify(summary, null, 1));
writeFileSync(`${out}/每一步怎么被理解的.md`, `# AI 试玩：每一步玩家说了什么、引擎把它理解成了什么\n\n${moduleName}，${res.facts.rounds} 轮，结局：${res.facts.ending}。玩家的话是模型临场说的，不是剧本。\n\n| 轮 | 谁 | 玩家的原话 | 引擎的理解 | 归类 |\n|---|---|---|---|---|\n${lines.join('\n')}\n`);
console.log(`\n${moduleName}　${res.facts.rounds} 轮　结局：${res.facts.ending}　HTTP 出错 ${errors} 次　每步平均 ${summary.avg_ms}ms（最慢 ${summary.max_ms}ms）`);
console.log('引擎的理解：', JSON.stringify(kinds), '　归类：', JSON.stringify(classes), `　意图辅助介入 ${assisted} 次　试探边界 ${probes.length} 次`);
for (const c of res.checks) console.log(`${c.pass ? '✔' : '✘'} [${c.id}] ${c.detail.slice(0, 150)}`);
