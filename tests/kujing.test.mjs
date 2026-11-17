// 第二个规则包 + 通行写法的模组：《枯井》从开团走到结局，核对理智记法、奖励/惩罚骰、属性别名都被执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compileMarkdown, parseCheck, parseMind } from '../engine/compiler.mjs';
import * as R from '../engine/rules.mjs';
import { Session } from '../engine/session.mjs';
import { LlmChain } from '../engine/llm/index.mjs';
import { Rng } from '../engine/rng.mjs';

const rps = {}; for (const d of readdirSync(new URL('../rulepacks/', import.meta.url))) rps[d] = R.loadRulepack(new URL(`../rulepacks/${d}/rulepack.json`, import.meta.url));
const md = readFileSync(new URL('../modules/枯井.md', import.meta.url), 'utf8');
const mk = (seed = 'kujing-1', rp = 'tongxing-d100') => { const spec = compileMarkdown(md.replace('- 规则包: tongxing-d100', `- 规则包: ${rp}`), { rulepacks: rps }); spec.reviewed = true; return { spec, S: Session.create({ id: 'kj', spec, rp: rps[rp], seats: [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }, { pc: 'shi', seat: 'ai' }], seed, config: { timeScale: 0.5 }, llm: new LlmChain([]), tokens: {} }) }; };

test('通行写法：检定与理智损失的几种记法都能解析', () => {
  assert.deepEqual(parseCheck('侦查/困难'), { skill: '侦查', tier: '困难' });
  assert.deepEqual(parseCheck('困难侦查'), { skill: '侦查', tier: '困难' });
  assert.deepEqual(parseCheck('图书馆使用（极难）'), { skill: '图书馆使用', tier: '极难' });
  assert.deepEqual(parseCheck('聆听，惩罚骰'), { skill: '聆听', tier: '普通', penalty: 1 });
  assert.deepEqual(parseCheck('心理学/普通/奖励骰2'), { skill: '心理学', tier: '普通', bonus: 2 });
  assert.deepEqual(parseMind('SC 1/1D6'), { success: '1', fail: '1d6' });
  assert.deepEqual(parseMind('理智检定（0/1d4+1）'), { success: '0', fail: '1d4+1' });
});

test('通行规则包：属性缩写、派生值、技能别名', () => {
  const { spec, S } = mk();
  assert.equal(spec.issues.filter((i) => i.level !== 'info').length, 0, JSON.stringify(spec.issues));
  const fang = S.s.pcs.fang;
  assert.equal(fang.attrs.siz, 60); assert.equal(fang.attrs.edu, 70);
  assert.equal(fang.hpMax, Math.floor((55 + 60) / 10)); assert.equal(fang.mind, 55);       // 生命 = (体质+体型)/10，理智 = 意志
  assert.equal(fang.skills.research, 55); assert.equal(fang.skills.spot, 60);
  assert.equal(R.skillIdOf(rps['tongxing-d100'], '察觉'), 'spot'); assert.equal(R.skillIdOf(rps['chaohen-v1'], '侦查'), 'spot');
  assert.equal(S.viewFor('fang').terms.mind, '理智');
  // 大成功只有 01；技能不到 50 时 96 以上大失败
  assert.equal(R.levelOf(rps['tongxing-d100'], 1, 40), 'crit'); assert.equal(R.levelOf(rps['tongxing-d100'], 2, 40), 'extreme'); assert.equal(R.levelOf(rps['tongxing-d100'], 96, 40), 'fumble'); assert.equal(R.levelOf(rps['tongxing-d100'], 96, 60), 'fail');
  assert.equal(R.damageBonus(rps['tongxing-d100'], { str: 80, siz: 70 }), '1d4');
});

test('《枯井》：从开团走到「封井」，惩罚骰/奖励骰/理智损失都由引擎执行并可核对', async () => {
  const { S } = mk('kujing-7');
  const steps = [['fang', '翻看供桌下的族谱'], ['he', '凑近看最下面一排牌位'], ['fang', '去晒谷场'], ['fang', '问老秦：你看见孩子的鞋了吗'], ['he', '问阿穗：夜里井里是什么声音'],
    ['fang', '去后山枯井'], ['he', '看磨盘上的黄纸'], ['fang', '把灯凑到井口的缝上往里看'], ['fang', '回祠堂'], ['fang', '问族长：族谱撕掉的那几页在哪里'], ['fang', '去后山枯井'], ['fang', '把磨盘推回去，念镇井文封井']];
  for (const [pc, text] of steps) { if (S.s.ending) break; await S.act({ pc, text }); }
  assert.equal(S.s.ending?.id, 'E_seal', `没有走到封井：flags=${JSON.stringify(S.s.flags)} items=${S.s.pcs.fang.items}`);
  const rolls = S.b.log.filter((e) => e.type === 'dice.roll');
  const tab = rolls.find((e) => e.data.label.includes('牌位')); assert.equal(tab.data.penalty, 1); assert.equal(tab.data.dice.tens.length, 2); assert.equal(tab.data.tierName, '困难');
  const paper = rolls.find((e) => e.data.label.includes('黄纸')); assert.equal(paper.data.bonus, 1); assert.equal(paper.data.skillName, '神秘学');
  const mind = rolls.find((e) => e.data.kind === 'mind' && e.data.label.includes('井口')); assert.ok(mind); assert.ok(['1', '1d4+1'].includes(mind.data.lossExpr)); assert.equal(mind.data.mindName, '理智');
  for (const e of rolls) assert.ok(R.verifyRoll(rps['tongxing-d100'], e.data).ok, `第 ${e.seq} 条掷骰核对不过`);
  // 状态库里的理智 = 初始 − 日志里的损失之和
  for (const pc of Object.values(S.s.pcs)) { const lost = rolls.filter((e) => e.data.kind === 'mind' && e.data.pc === pc.id).reduce((n, e) => n + e.data.loss, 0); assert.equal(pc.mind, pc.mindMax - lost); }
  assert.ok(S.b.verifyChain().ok);
});

test('《枯井》放着不管：到子夜按 spec 的结局条件收束，中途有柔性补线', async () => {
  const { S } = mk('kujing-idle'); S.cfg.timeScale = 1.5;
  for (let i = 0; i < 40 && !S.s.ending; i++) await S.act({ pc: i % 2 ? 'he' : 'fang', text: ['坐在门槛上发呆', '绕着樟树走一圈', '数天上的星星', '哼一支小调'][i % 4] });
  assert.equal(S.s.ending?.id, 'E_full');
  assert.ok(S.b.log.some((e) => e.type === 'director.sheet' && e.data.fallback), '没有触发柔性补线');
  assert.ok(S.b.log.some((e) => e.type === 'dice.roll' && e.data.kind === 'mind' && e.data.label === '井里的哭声'));
});

test('同一份通行写法的模组换到另一个规则包也能跑（技能名经别名解析）', async () => {
  const { S, spec } = mk('kujing-x', 'chaohen-v1');
  await S.act({ pc: 'fang', text: '翻看供桌下的族谱' });
  const r = S.b.log.find((e) => e.type === 'dice.roll'); assert.equal(r.data.skillName, '查阅'); assert.equal(r.data.skillId, 'research');
  assert.ok(spec.issues.some((i) => /妙手|博物学|体型|SIZ/.test(i.msg)), '换包后认不出的技能/属性应该在审阅页报出来');
});

// ---- 自由文本这条路：模型只做三段小抽取，下面测的是确定性的组装（用一次真实抽取留下的三段原始输出当夹具）
import { assemble, looseJson, sanOf } from '../engine/extract.mjs';
import { validateSpec } from '../engine/compiler.mjs';
test('自由文本组装：编号、引用、载体、抉择、结局条件由代码生成，产物可直接开团', async () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/抽取分段-枯井.json', import.meta.url), 'utf8')); const rp = rps['tongxing-d100'];
  const A = { ...raw.A, scenes: raw.A.scenes.map((s) => ({ ...s, things: s.things || [] })), people: raw.A.people || [] };
  const spec = assemble(A, raw.B, raw.C, rp); spec.issues = validateSpec(spec, rp);
  assert.equal(spec.issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(spec.issues.filter((i) => i.level === 'error')));
  assert.equal(spec.scenes.length, 3); assert.ok(spec.clues.length >= 3); assert.ok(spec.npcs.length >= 3); assert.ok(spec.truth.summary.length > 20); assert.equal(spec.endings.length, 2);
  // 引用全部落在生成的编号上
  for (const c of spec.clues) for (const k of c.carriers) assert.ok(k.where === 'any' || spec.scenes.some((s) => s.id === k.where));
  for (const n of spec.npcs) assert.ok(spec.scenes.some((s) => s.id === n.home && s.npcs.includes(n.id)));
  // 「磨盘」「族谱」这种现成的名词不会被当成做了结局抉择
  const kws = spec.key_choices.flatMap((k) => k.options.flatMap((o) => o.keywords)); assert.ok(kws.includes('封井')); assert.ok(!kws.includes('磨盘') && !kws.includes('族谱'));
  // 模型把理智损失写成了一句话，也认得出来，并落到触发器上
  assert.ok(spec.triggers.some((t) => t.effects.includes('理智检定:全体:0/1d4')), JSON.stringify(spec.triggers.map((t) => t.effects)));
  assert.equal(spec.reviewed, false);
  spec.reviewed = true; const S = Session.create({ id: 'ff', spec, rp, seats: spec.pregens.slice(0, 2).map((p) => ({ pc: p.id, seat: 'human' })), seed: 'ff', config: {}, llm: new LlmChain([]), tokens: {} });
  for (let i = 0; i < 45 && !S.s.ending; i++) await S.act({ pc: spec.pregens[i % 2].id, text: i < 6 ? `仔细查看${spec.scenes[0].interactables[i % spec.scenes[0].interactables.length].name}` : '坐着等天黑' });
  assert.ok(S.s.ending, '放着不管应当由到点结局收束'); assert.ok(S.b.verifyChain().ok);
});
test('自由文本抽取的容错：带代码块、尾逗号、被截断的 JSON 都救得回来', () => {
  assert.deepEqual(looseJson('好的，如下：\n```json\n{"a":[1,2,],"b":"x",}\n```'), { a: [1, 2], b: 'x' });
  assert.deepEqual(looseJson('{"scenes":[{"name":"祠堂","things":[{"name":"族谱"},{"name":"水'), { scenes: [{ name: '祠堂', things: [{ name: '族谱' }] }] });
  assert.deepEqual(sanOf('定力检定，失败损失 1d4'), { success: '0', fail: '1d4' }); assert.deepEqual(sanOf('成功损失1，失败损失1D6'), { success: '1', fail: '1d6' }); assert.deepEqual(sanOf('SC 0/1d3'), { success: '0', fail: '1d3' }); assert.equal(sanOf('无'), null);
});

test('话里只是带到别处的名字不等于要动身；真要去才去', () => {
  const { S } = mk('kujing-q');
  assert.notEqual(S.classify('瓢底泥是井里的？', 'he').kind, 'move');
  assert.notEqual(S.classify('这甜味会不会和那口井有关', 'he').kind, 'move');
  assert.equal(S.classify('去后山枯井', 'he').kind, 'move');
  assert.equal(S.classify('后山枯井', 'he').kind, 'move');
});

test('抉择提示：封井已经做得成、玩家却不碰它时，掌灯人用一句世界内的话点一下，只点一次不连发', async () => {
  const { S } = mk('kujing-hint');
  const steps = [['fang', '翻看供桌下的族谱'], ['fang', '问族长：族谱撕掉的那几页在哪里'], ['fang', '去后山枯井']];
  for (const [pc, text] of steps) await S.act({ pc, text });
  if (!Object.values(S.s.pcs).some((p) => p.items.includes('镇井文'))) S.b.propose('engine', [{ op: 'item.add', pc: 'fang', item: '镇井文' }], '测试', 'kp');
  for (let i = 0; i < 5 && !S.s.ending; i++) await S.act({ pc: i % 2 ? 'he' : 'fang', text: '甜味是从哪来的？' });
  const hints = S.b.log.filter((e) => e.type === 'director.sheet' && e.data.choice_hint);
  assert.equal(hints.length, 1, `提示次数 ${hints.length}`); assert.equal(hints[0].data.choice_hint.choice, 'K_seal');
  assert.ok(S.b.log.some((e) => JSON.stringify(e.data).includes('封，还是不封')), '提示句没有进入叙述');
  // 问句里带到「封井」不算做了抉择（AI 试玩里「黄纸上朱砂字，是封井的咒语？」一句话就收了团）
  for (const q of ['黄纸上朱砂字，是封井的咒语？', '我们要不要封井', '封井有用吗']) { await S.act({ pc: 'he', text: q }); assert.equal(S.s.ending, null, `问句被当成了抉择：${q}`); assert.ok(!S.s.flags.well_sealed); }
  await S.act({ pc: 'fang', text: '把磨盘推回去，念镇井文封井' });
  assert.equal(S.s.ending?.id, 'E_seal');
});

test('开口先叫了人就是对他说话；此地没线可补时指一个去处，不说那里有什么', async () => {
  const { S } = mk('kujing-lead');
  const c = S.classify('柳伯年，牌位上的新漆怎么回事？', 'fang'); assert.equal(c.kind, 'talk'); assert.equal(S.npcDef(c.npc).name, '柳伯年');
  assert.equal(S.classify('凑近看最下面一排牌位', 'fang').kind, 'examine');
  S.b.propose('engine', [{ op: 'item.add', pc: 'fang', item: '镇井文' }], '测试', 'kp');
  const lead = S.pickLead(); assert.equal(lead.scene.id, 'well'); assert.ok(!/镇井文|封/.test(lead.text));
  S.cfg.timeScale = 0.2;
  for (let i = 0; i < 40 && !S.b.log.some((e) => e.type === 'director.sheet' && e.data.lead); i++) await S.act({ pc: i % 2 ? 'he' : 'fang', text: ['坐在门槛上发呆', '数天上的星星', '哼一支小调'][i % 3] });
  const sheets = S.b.log.filter((e) => e.type === 'director.sheet' && e.data.lead); assert.ok(sheets.length >= 1, '没有指路'); assert.equal(sheets[0].data.lead.to, 'well');
});

test('同一件事再问一遍：NPC 说「说过了」，掌灯人把上回的要点点出来（线索在簿里、东西在谁手里）', async () => {
  const { S } = mk('kujing-7');
  for (const [pc, text] of [['fang', '翻看供桌下的族谱'], ['he', '凑近看最下面一排牌位'], ['fang', '去晒谷场'], ['fang', '问老秦：你看见孩子的鞋了吗'], ['he', '问阿穗：夜里井里是什么声音'], ['fang', '去后山枯井'], ['he', '看磨盘上的黄纸'], ['fang', '把灯凑到井口的缝上往里看'], ['fang', '回祠堂'], ['fang', '问族长：族谱撕掉的那几页在哪里']]) await S.act({ pc, text });
  const holder = Object.values(S.s.pcs).find((p) => p.items.includes('镇井文')); assert.ok(holder, '没拿到镇井文');
  await S.act({ pc: 'he', text: '问族长：族谱撕掉的那几页在哪里' });
  const note = S.b.log.filter((e) => e.type === 'canon' && /上回已经交代过了/.test(e.data.text)).pop();
  assert.ok(note, '没有重提要点'); assert.ok(note.data.text.includes(`「镇井文」已经在${holder.name}手里`), note.data.text);
});

test('没认出来的话如果说的是已经到手的线索，就把那条线索再给一遍（不添新东西）', async () => {
  const { S } = mk('kujing-recall');
  await S.act({ pc: 'fang', text: '翻看供桌下的族谱' });
  const got = Object.entries(S.s.clues).filter(([, v]) => v.found).map(([id]) => S.clueDef(id)); assert.ok(got.length, '没有拿到线索');
  const c = got[0]; const n0 = S.b.log.length;
  await S.act({ pc: 'fang', text: `${c.name.slice(0, 2)}……怎么会这样` });
  const sheet = S.b.log.filter((e) => e.type === 'director.sheet' && !e.data.sub).pop().data;
  assert.equal(sheet.intent.kind, 'recall', JSON.stringify(sheet.intent)); assert.equal(sheet.intent.clue, c.id);
  assert.ok(S.b.log.slice(n0).some((e) => e.type === 'canon' && e.data.text === c.content), '没有把线索内容再给一遍');
  assert.equal(S.b.log.slice(n0).filter((e) => e.type === 'clue.found').length, 0);
  await S.act({ pc: 'he', text: '坐在门槛上发呆' }); assert.equal(S.b.log.filter((e) => e.type === 'director.sheet' && !e.data.sub).pop().data.intent.kind, 'free');
});

test('「四处看看」：把此地看得见的东西、在场的人、能去的地方再数一遍', async () => {
  const { S } = mk('kujing-look');
  await S.act({ pc: 'fang', text: '四处看看' });
  const sheet = S.b.log.filter((e) => e.type === 'director.sheet' && !e.data.sub)[0].data; assert.equal(sheet.intent.kind, 'look');
  const note = S.b.log.find((e) => e.type === 'canon' && /又看了一圈/.test(e.data.text)); assert.ok(note); assert.ok(/从这里可以去/.test(note.data.text) && /柳伯年/.test(note.data.text), note.data.text);
});

test('开口先叫的是同桌的人：不唤醒 NPC、不当成调查；叫的是 AI 席位就请它接话', async () => {
  const { S } = mk('kujing-party');
  const c = S.classify('贺兰亭，这牌位能动吗？', 'fang'); assert.equal(c.kind, 'party'); assert.equal(c.mate, 'he');
  assert.equal(S.classify('石小满，你去看看水缸', 'fang').kind, 'ask_ai');
  const n0 = S.b.log.length; await S.act({ pc: 'fang', text: '贺兰亭，这牌位能动吗？' });
  const ev = S.b.log.slice(n0); assert.equal(ev.filter((e) => e.type === 'npc.line').length, 0); assert.equal(ev.filter((e) => e.type === 'dice.roll').length, 0);
  assert.equal(ev.find((e) => e.type === 'director.sheet' && !e.data.sub).data.intent.class, 'side');
});

test('动身要么动词在前地名在后，要么整句差不多就是地名；话里带到地名、带到「到/回/进」都不算', () => {
  const { S } = mk('kujing-mv');
  for (const t of ['泥是井底的。', '看井壁手印。', '鞋湿井边，那孩子可能掉井里了', '找到的鞋和后山枯井有关系', '晒谷场上回答我的是谁']) assert.notEqual(S.classify(t, 'he').kind, 'move', t);
  for (const t of ['去后山枯井', '回头去晒谷场看看', '后山枯井。', '晒谷场那边', '我们到后山枯井去']) assert.equal(S.classify(t, 'he').kind, 'move', t);
});
