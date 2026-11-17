// 从一份存档重新生成 examples/ 里的整套示例文件（存档、Replay、日志、状态库、角色卡、spec）。
// 用法：node ops/make-examples.mjs <存档.json> <输出目录> <文件名里的模组名>
// 例：  node ops/make-examples.mjs 我的存档.json examples 雾港来信
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRulepack } from '../engine/rules.mjs';
import { Session } from '../engine/session.mjs';
import { LlmChain } from '../engine/llm/index.mjs';
import { buildReplay, toMarkdown, toHTML, sheetsMarkdown, stateMarkdown } from '../engine/replay.mjs';

const [file, out, name] = process.argv.slice(2);
const root = new URL('../rulepacks/', import.meta.url); const rps = {}; for (const d of readdirSync(root)) rps[d] = loadRulepack(new URL(`${d}/rulepack.json`, root));
const bundle = JSON.parse(readFileSync(file, 'utf8'));
const S = Session.fromBundle(JSON.parse(JSON.stringify(bundle)), { rp: rps[bundle.rulepack], llm: new LlmChain([]), tokens: {}, id: bundle.id });
for (const b of Object.values(S.branches)) { const v = b.verifyChain(); if (!v.ok) throw new Error(`分支 ${b.id} 验链失败`); }
S.switchBranch('main'); mkdirSync(out, { recursive: true });
const w = (f, text) => { writeFileSync(join(out, f), text); console.log('  ', f, (text.length / 1024).toFixed(0) + ' KB'); };
const firstHuman = Object.values(S.s.pcs).find((p) => p.seat === 'human').id;
w(`示例存档-${name}.json`, JSON.stringify(bundle));
w(`${name}.module.spec.json`, JSON.stringify(S.specForKp, null, 1));
const kp = buildReplay(S, 'main', 'kp'), pl = buildReplay(S, 'main', firstHuman);
w(`示例Replay-${name}-掌灯人视角.md`, toMarkdown(kp, 'kp')); w(`示例Replay-${name}-掌灯人视角.html`, toHTML(kp, 'kp')); w(`示例Replay-${name}-玩家视角.md`, toMarkdown(pl, 'player'));
w(`示例日志-${name}-main.jsonl`, S.b.log.map((e) => JSON.stringify(e)).join('\n') + '\n');
w(`示例状态库-${name}.json`, JSON.stringify(S.s, null, 1)); w(`示例状态库-${name}.md`, stateMarkdown(S));
w(`示例角色卡-${name}.json`, JSON.stringify(S.s.pcs, null, 1)); w(`示例角色卡-${name}.md`, sheetsMarkdown(S));
console.log(`${name}：${S.s.round} 轮，分支 ${Object.keys(S.branches).join('、')}，规则包 ${bundle.rulepack}`);
