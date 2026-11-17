// 意图辅助的测试：node --test tests/assist.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../engine/rules.mjs';
import { compileMarkdown } from '../engine/compiler.mjs';
import { Session } from '../engine/session.mjs';
import { LlmChain } from '../engine/llm/index.mjs';

const rp = R.loadRulepack(new URL('../rulepacks/chaohen-v1/rulepack.json', import.meta.url));
const md = readFileSync(new URL('../modules/雾港来信.md', import.meta.url), 'utf8');
const seats = [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }, { pc: 'wen', seat: 'ai' }];
// 假模型：分类器按预设回答，其余角色回一句无害的话；记下每次收到的上下文
function fake(answers) {
  const seen = [];
  const chain = new LlmChain([{ name: 'fake', url: 'http://fake/chat/completions', model: 'fake', key: '', perMinute: 9999, timeoutMs: 5000 }], async (url, init) => {
    const body = JSON.parse(init.body); const sys = body.messages[0].content, user = body.messages[1].content; seen.push({ sys, user });
    const content = sys.includes('意图分类器') ? answers.intent(user) : sys.includes('话题分类器') ? answers.topic(user) : '雾还在。';
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ choices: [{ message: { content } }] }) };
  });
  chain.seen = seen; return chain;
}
const mk = (llm) => { const spec = compileMarkdown(md); spec.reviewed = true; return Session.create({ id: 'a', spec, rp, seats, seed: 'assist', config: { aiInitiative: 0 }, llm, tokens: {} }); };

test('换一种说法：关键词认不出时，意图辅助把它归到公开选项里的某一项', async () => {
  const llm = fake({ intent: () => '{"kind":"examine","target":"告示栏"}', topic: () => '0' });
  const S = mk(llm); await S.act({ pc: 'lu', text: '我凑近那块贴满纸的木板，一张一张往下揭' });
  const sheet = S.b.log.find((e) => e.type === 'director.sheet'); assert.equal(sheet.data.intent.kind, 'examine'); assert.equal(sheet.data.intent.assisted, '告示栏');
  assert.ok(S.b.log.some((e) => e.type === 'dice.roll' && /告示栏/.test(e.data.label)));
});

test('意图辅助答了一个不在列表里的目标：不采信，按自由行动处理，不否决', async () => {
  const llm = fake({ intent: () => '{"kind":"examine","target":"潮钟"}', topic: () => '0' });
  const S = mk(llm); await S.act({ pc: 'lu', text: '我想找找这附近有没有什么钟' });
  const sheet = S.b.log.find((e) => e.type === 'director.sheet'); assert.equal(sheet.data.intent.kind, 'free');
  assert.equal(S.b.log.filter((e) => e.type === 'dice.roll').length, 0);
});

test('意图辅助看到的只有此刻公开可见的名字：够不着的东西、真相层都不在它的上下文里', async () => {
  const llm = fake({ intent: () => '{"kind":"none"}', topic: () => '0' });
  const S = mk(llm); await S.act({ pc: 'lu', text: '去灯塔' }); await S.act({ pc: 'lu', text: '我四处转转，看看有什么' });
  const ctx = llm.seen.filter((x) => x.sys.includes('意图分类器')); assert.ok(ctx.length >= 1);
  const last = ctx[ctx.length - 1].user;
  assert.match(last, /记录簿/); assert.match(last, /铁门/);
  assert.ok(!/潮钟|钟舌/.test(last), '还没打开铁门，潮钟和钟舌不该出现在选项里');
  const spec = S.specForKp; for (const nr of spec.truth.never_reveal) for (const k of nr.keywords) assert.ok(!last.includes(k), `选项里出现了「${k}」`);
  assert.equal(S.b.log.filter((e) => e.type === 'context.audit' && e.data.role === 'intent' && e.data.leak).length, 0);
});

test('话题辅助：没说到关键词也能问到 NPC 肯说的事；「绝不分享」的标题不进它的上下文', async () => {
  const llm = fake({ intent: () => '{"kind":"none"}', topic: (u) => (u.includes('今夜的令') ? '1' : '0') });
  const S = mk(llm); await S.act({ pc: 'lu', text: '去灯塔' }); await S.act({ pc: 'lu', text: '问魏长庚：塔顶上怎么是黑的' });
  const line = S.b.log.find((e) => e.type === 'npc.line'); assert.equal(line.data.mode, 'share'); assert.match(line.data.text, /今夜有令/);
  const S2 = mk(llm); await S2.act({ pc: 'lu', text: '问邱港监：你们这儿夜里都做些什么' });
  const topicCtx = llm.seen.filter((x) => x.sys.includes('话题分类器')).map((x) => x.user).join('\n');
  assert.ok(topicCtx.includes('沈砚秋的失踪')); assert.ok(!topicCtx.includes('约'), '「约」是邱秉仁绝不分享的那一项的标题');
});
