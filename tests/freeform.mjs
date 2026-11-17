// 自由文本模组 → spec 的实测脚本（需要配置了模型的环境变量，见 .env.example）。
// 用法：node tests/freeform.mjs <模组文本文件> [规则包id] [输出json]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { compileFreeText } from '../engine/extract.mjs';
import { specSummary } from '../engine/compiler.mjs';
import { loadRulepack } from '../engine/rules.mjs';
import { LlmChain, providersFromEnv } from '../engine/llm/index.mjs';
import { Session } from '../engine/session.mjs';
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const rps = {}; for (const d of readdirSync(new URL('../rulepacks/', import.meta.url))) rps[d] = loadRulepack(new URL(`../rulepacks/${d}/rulepack.json`, import.meta.url));
const [file, rp = 'tongxing-d100', out] = process.argv.slice(2);
const llm = new LlmChain(providersFromEnv()); if (!llm.enabled) { console.error('没有配置模型'); process.exit(2); }
const t0 = Date.now(); const spec = await compileFreeText(readFileSync(file, 'utf8'), llm, { rulepacks: rps, rulepack: rp, sourceName: file });
console.log(`用时 ${((Date.now() - t0) / 1000).toFixed(1)}s　${spec.source.compiler}　分段：${spec.source.stages.map((s) => `${s.stage}${s.error ? '✗' : ' ' + (s.ms / 1000).toFixed(0) + 's'}`).join('，')}`);
console.log(JSON.stringify(specSummary(spec)));
for (const i of spec.issues) console.log(' ', i.level, i.where, '—', i.msg);
console.log('场景:', spec.scenes.map((s) => `${s.name}[${s.npcs.join(',')}](${s.interactables.map((i) => i.name + (i.check ? '<' + i.check.skill + '/' + i.check.tier + '>' : '') + (i.mind ? '{' + i.mind.success + '/' + i.mind.fail + '}' : '') + (i.clue ? '→' + i.clue : '')).join('，')})`).join(' | '));
console.log('线索:', spec.clues.map((c) => `${c.id}${c.key ? '*' : ''} ${c.name}〔${c.carriers.map((k) => k.via).join(' / ')}〕${c.give_item ? ' 给:' + c.give_item : ''}`).join(' | '));
console.log('NPC:', spec.npcs.map((n) => `${n.name}@${n.home}${n.nonverbal ? '(不说话)' : ''} 知${n.knowledge.map((k) => k.share[0] + (k.gives_clue ? '→' + k.gives_clue : '')).join(',')}`).join(' | '));
console.log('真相:', spec.truth.summary.slice(0, 60), '… 不可泄露:', spec.truth.never_reveal.map((r) => `${r.keywords.join('/')}@${r.unlock || '永不'}`).join(' ; '));
console.log('触发器:', spec.triggers.map((t) => `${t.name} ${t.effects.join(',')}`).join(' | '));
console.log('结局:', spec.endings.map((e) => `${e.name}(${e.when_any.map((c) => c.map((a) => (a.neg ? '!' : '') + (a.k || a.v)).join('&')).join(' 或 ')})`).join(' | '), '抉择:', spec.key_choices.map((k) => k.options[0].keywords.join('/')).join(' ; '));
console.log('预设:', spec.pregens.map((p) => `${p.name}(${p.role}) ${Object.keys(p.attrs_named).length}属性 ${Object.keys(p.skills_named).length}技能`).join(' | '));
if (!spec.issues.some((i) => i.level === 'error')) {
  spec.reviewed = true; const S = Session.create({ id: 'ff', spec, rp: rps[rp], seats: spec.pregens.slice(0, 2).map((p) => ({ pc: p.id, seat: 'human' })), seed: 'ff', config: { useModel: false }, llm: new LlmChain([]), tokens: {} });
  const pc = spec.pregens[0].id; const sc = spec.scenes.find((s) => s.id === spec.meta.start_scene);
  for (const it of sc.interactables.slice(0, 2)) await S.act({ pc, text: `仔细查看${it.name}` });
  console.log(`✔ 未经人工修改即可开团；离线试跑 ${S.s.round} 轮，掷骰 ${S.b.log.filter((e) => e.type === 'dice.roll').length} 次，线索 ${Object.values(S.s.clues).filter((c) => c.found).length}/${spec.clues.length}`);
} else console.log('✗ 有 error，需在审阅页修正后才能开团');
if (out) writeFileSync(out, JSON.stringify(spec, null, 1));
