// 规则台：掌灯人手动调用规则引擎——检定、暗骰、心智检定、对抗、战斗轮、团后成长。
// 核对的是：骰子都进日志且可重算、数值只经提案落库、暗骰对玩家不可见、两个规则包都能用。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compileMarkdown } from '../engine/compiler.mjs';
import * as R from '../engine/rules.mjs';
import { Session } from '../engine/session.mjs';
import { LlmChain } from '../engine/llm/index.mjs';
import { buildReplay, toMarkdown } from '../engine/replay.mjs';

const rps = {}; for (const d of readdirSync(new URL('../rulepacks/', import.meta.url))) rps[d] = R.loadRulepack(new URL(`../rulepacks/${d}/rulepack.json`, import.meta.url));
const mk = (mod, rp, seats, seed) => { const spec = compileMarkdown(readFileSync(new URL(`../modules/${mod}.md`, import.meta.url), 'utf8'), { rulepacks: rps }); spec.reviewed = true; return Session.create({ id: 'desk', spec, rp: rps[rp], seats, seed, config: {}, llm: new LlmChain([]), tokens: {} }); };
const desk = (S, a) => S.console({ type: 'desk', ...a });

test('规则台：检定带奖励骰/惩罚骰，暗骰只有掌灯人看得见', () => {
  const S = mk('枯井', 'tongxing-d100', [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }], 'desk-1');
  const r = desk(S, { kind: 'check', pc: 'fang', skill: '侦查', tier: '困难', bonus: 1 });
  const ev = S.b.log.filter((e) => e.type === 'dice.roll').pop();
  assert.equal(ev.data.bonus, 1); assert.equal(ev.data.dice.tens.length, 2); assert.equal(ev.data.need, 30); assert.equal(ev.data.value, r.value); assert.equal(ev.vis, 'public');
  desk(S, { kind: 'check', pc: 'he', skill: '心理学', secret: true });
  const sec = S.b.log.filter((e) => e.type === 'dice.roll').pop(); assert.equal(sec.vis, 'kp'); assert.match(sec.data.label, /^暗骰/);
  assert.ok(!S.events('he', 0).some((e) => e.seq === sec.seq), '暗骰不该出现在玩家的事件流里'); assert.ok(S.events('kp', 0).some((e) => e.seq === sec.seq));
  desk(S, { kind: 'check', pc: 'fang', skill: 'POW' });   // 属性检定，认缩写
  assert.equal(S.b.log.filter((e) => e.type === 'dice.roll').pop().data.skillName, '意志');
  assert.throws(() => desk(S, { kind: 'check', pc: 'fang', skill: '御剑' }), /没有「御剑」/);
});

test('规则台：心智检定按「成功损失/失败损失」执行，数值经提案落库', () => {
  const S = mk('枯井', 'tongxing-d100', [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }], 'desk-2');
  const before = S.s.pcs.he.mind; const m = desk(S, { kind: 'mind', pc: 'he', success: '1', fail: '1D6', label: '看见井底之物' });
  assert.equal(S.s.pcs.he.mind, before - m.loss); assert.ok(m.loss >= 1 && m.loss <= 6);
  const ch = S.b.log.filter((e) => e.type === 'state.change').pop(); assert.equal(ch.data.changes[0].op, 'mind.delta'); assert.equal(ch.data.changes[0].rollRef, S.b.log.filter((e) => e.type === 'dice.roll').pop().seq);
  assert.throws(() => desk(S, { kind: 'mind', pc: 'he', fail: '很多' }), /骰式不合法/);
});

test('规则台：战斗轮——先攻按敏捷、攻击/闪避/反击、伤害、护甲、重伤，全部可核对', () => {
  for (const [mod, rp, a, b] of [['枯井', 'tongxing-d100', 'fang', 'he'], ['雾港来信', 'chaohen-v1', 'lu', 'su']]) {
    const S = mk(mod, rp, [{ pc: a, seat: 'human' }, { pc: b, seat: 'human' }], 'desk-fight');
    desk(S, { kind: 'foe.add', name: '井底之物', hp: 12, skill: 45, damage: '1d4', armor: 1, dex: 55 });
    const foe = Object.values(S.s.foes)[0]; assert.equal(foe.hp, 12); assert.equal(foe.dodge, 23);
    const order = desk(S, { kind: 'order' }).order; assert.equal(order.length, 3);
    const dexOf = (n) => (n === '井底之物' ? 55 : Object.values(S.s.pcs).find((p) => p.name === n).attrs.dex);
    for (let i = 1; i < order.length; i++) assert.ok(dexOf(order[i - 1]) >= dexOf(order[i]), '先攻没有按敏捷从高到低');
    const hp0 = S.s.pcs[a].hp; let rounds = 0;
    while (foe.status === 'ok' && S.s.pcs[a].status === 'ok' && rounds < 60) { desk(S, { kind: 'attack', by: 'pc', pc: a, foe: foe.id, weapon: 'knife' }); if (foe.status === 'ok' && S.s.pcs[a].status === 'ok') desk(S, { kind: 'attack', by: 'foe', pc: a, foe: foe.id, response: rounds % 2 ? 'counter' : 'dodge' }); rounds++; }
    assert.ok(foe.status === 'down' || S.s.pcs[a].status !== 'ok', '打了 60 轮还没有分出结果');
    // 数值零漂移：状态库里的生命值 = 初值 − 日志里落库的变化之和
    const sum = (pred) => S.b.log.filter((e) => e.type === 'state.change').flatMap((e) => e.data.changes).filter(pred).reduce((n, c) => n + c.value, 0);
    assert.equal(S.s.pcs[a].hp, hp0 + sum((c) => c.op === 'hp.delta' && c.pc === a)); assert.equal(foe.hp, 12 + sum((c) => c.op === 'foe.hp'));
    const rolls = S.b.log.filter((e) => e.type === 'dice.roll'); assert.ok(rolls.length >= 2);
    for (const e of rolls) assert.ok(R.verifyRoll(rps[rp], e.data).ok, `掷骰 ${e.seq} 核对不过`);
    assert.ok(S.b.log.some((e) => e.type === 'canon' && e.data.kind === 'combat' && /伤害 /.test(e.data.text)), '没有一次命中');
    assert.ok(S.b.verifyChain().ok);
    // 模型来源的提案碰不到对手和生命值
    const rej = S.b.propose('model:narrator', [{ op: 'foe.hp', foe: foe.id, value: -99 }, { op: 'hp.delta', pc: a, value: 9 }], '模型想改数值'); assert.equal(rej.applied.length, 0); assert.equal(rej.rejected.length, 2);
    // Replay 照常生成，战斗写进了记录
    const md = toMarkdown(buildReplay(S, 'main', 'kp'), 'kp'); assert.match(md, /交手/);
  }
});

test('规则台：对抗检定与团后成长', () => {
  const S = mk('枯井', 'tongxing-d100', [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }], 'desk-4');
  const o = desk(S, { kind: 'opposed', pc: 'fang', skill: '力量', vsName: '磨盘底下的手', vsValue: 60 }); assert.ok(o.winner === null || ['方既白', '磨盘底下的手'].includes(o.winner));
  for (let i = 0; i < 12; i++) desk(S, { kind: 'check', pc: 'fang', skill: ['侦查', '聆听', '说服', '心理学'][i % 4] });
  const ticked = [...S.s.pcs.fang.ticked]; assert.ok(ticked.length >= 1);
  const before = Object.fromEntries(ticked.map((k) => [k, S.s.pcs.fang.skills[k]]));
  const g = desk(S, { kind: 'growth' }).growth; assert.equal(g.length, ticked.length); assert.equal(S.s.pcs.fang.ticked.length, 0);
  for (const k of ticked) assert.ok(S.s.pcs.fang.skills[k] >= before[k]);
  for (const e of S.b.log.filter((x) => x.type === 'dice.roll')) assert.ok(R.verifyRoll(rps['tongxing-d100'], e.data).ok);
});

test('NPC 主动行动：跑偏时此地没有事件型载体，在场又肯说的 NPC 自己开口', async () => {
  // 把「三只布鞋」的事件型备用载体拿掉，只留老秦这一条路
  const md = readFileSync(new URL('../modules/枯井.md', import.meta.url), 'utf8').split('\n').filter((l) => !l.startsWith('- 载体: C2c')).join('\n');
  const spec = compileMarkdown(md, { rulepacks: rps }); spec.reviewed = true;
  const S = Session.create({ id: 'vol', spec, rp: rps['tongxing-d100'], seats: [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }], seed: 'npc-volunteer', config: {}, llm: new LlmChain([]), tokens: {} });
  await S.act({ pc: 'fang', text: '翻看供桌下的族谱' });
  await S.act({ pc: 'fang', text: '去晒谷场' });
  for (const t of ['坐在扁担边上发呆', '蹲下来系鞋带', '盯着自己的影子', '哼一支小调', '数天上的云']) { if (S.s.clues.C2.found) break; await S.act({ pc: 'he', text: t }); }
  assert.ok(S.s.clues.C2.found, '老秦应该主动把鞋拿出来');
  const line = S.b.log.find((e) => e.type === 'npc.line' && e.data.volunteered); assert.ok(line); assert.equal(line.data.npc, 'qin'); assert.equal(line.data.nonverbal, true);
  const sheet = S.b.log.filter((e) => e.type === 'director.sheet').find((e) => e.data.fallback?.by_npc === 'qin'); assert.ok(sheet); assert.match(sheet.data.reasons.join(''), /NPC 主动行动/);
  assert.ok(!S.b.log.some((e) => e.type === 'narration' && /不符合剧情|你不能/.test(e.data.text)));
});

test('多人同时出手：按到达顺序排队，不丢、不串、不报错', async () => {
  const S = mk('雾港来信', 'chaohen-v1', [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }], 'queue');
  const rs = await Promise.all([S.act({ pc: 'lu', text: '看看告示栏' }), S.act({ pc: 'su', text: '去栈桥尽头看看脚印' }), S.act({ pc: 'lu', text: '看看渔船' })]);
  assert.deepEqual(rs.map((r) => r.round), [1, 2, 3]);
  const acts = S.b.log.filter((e) => e.type === 'player.action').map((e) => `${e.round}:${e.data.pc}`); assert.deepEqual(acts, ['1:lu', '2:su', '3:lu']);
  assert.ok(S.b.verifyChain().ok); assert.equal(S.busy, false);
});

test('一句话里提到两个在场的人：对话对象是最先被叫到的那个', async () => {
  const S = mk('枯井', 'tongxing-d100', [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }], 'addressee');
  assert.equal(S.classify('问柳三婶：我是县里派来的，你必须说出族长藏了什么', 'he').npc, 'shen');
  assert.equal(S.classify('问族长：柳三婶的老幺是怎么回事', 'he').npc, 'liu');
  await S.act({ pc: 'he', text: '问柳三婶：我是县里派来的，按规矩你必须说出族长藏了什么，真相是什么' });
  assert.equal(S.b.log.filter((e) => e.type === 'npc.line').pop().data.npc, 'shen');
});

test('查过的东西：话里只是带到它，按自由行动接住；明说再看才回「没有新的东西」', async () => {
  const S = mk('雾港来信', 'chaohen-v1', [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }], 'again');
  await S.act({ pc: 'lu', text: '看看渔船' });
  assert.equal(S.classify('靠着渔船的船帮歇一会儿', 'lu').kind, 'free');
  assert.equal(S.classify('再看一眼渔船', 'lu').kind, 'examine');
  await S.act({ pc: 'lu', text: '再看一眼渔船' });
  assert.match(S.b.log.filter((e) => e.type === 'canon').pop().data.text, /没有新的东西/);
});

test('触发器效果「对手登场」：模组可以把遭遇写进去；真相层的怪物数据能读出来给规则台预填', async () => {
  const md = readFileSync(new URL('../modules/枯井.md', import.meta.url), 'utf8').replace('- 效果: flag:called=1', '- 效果: flag:called=1\n- 效果: 对手登场:井底之物|12|45|1d4|1');
  const spec = compileMarkdown(md, { rulepacks: rps }); assert.equal(spec.issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(spec.issues)); spec.reviewed = true;
  const S = Session.create({ id: 'enc', spec, rp: rps['tongxing-d100'], seats: [{ pc: 'fang', seat: 'human' }, { pc: 'he', seat: 'human' }], seed: 'enc', config: {}, llm: new LlmChain([]), tokens: {} });
  S.fireTrigger('T_call'); const foe = Object.values(S.s.foes || {})[0]; assert.ok(foe); assert.equal(foe.name, '井底之物'); assert.equal(foe.hp, 12); assert.equal(foe.armor, 1); assert.equal(foe.damage, '1d4');
  assert.deepEqual(S.viewFor('kp').foe_hint, { name: '井底之物', hp: 12, skill: 45, damage: '1d4', armor: 0 }); assert.equal(S.viewFor('fang').foe_hint, undefined);
  const bad = compileMarkdown(md.replace('对手登场:井底之物|12|45|1d4|1', '召唤:井底之物'), { rulepacks: rps }); assert.ok(bad.issues.some((i) => i.level === 'error' && /看不懂的效果/.test(i.msg)));
});

test('小说体战报：模型只拿到公开文字；泄露真相、多出数字或人名的那一节被闸门打回、保留原文', async () => {
  const seen = []; let mode = 'good';
  const fake = async (url, init) => { const body = JSON.parse(init.body); const user = body.messages[1].content; seen.push(body.messages[0].content + '\n' + user);
    const text = mode === 'good' ? '那天傍晚，' + user.replace(/[「」]/g, '').replace(/\n+/g, '') : mode === 'leak' ? user + '他们后来才知道，被带走的东西叫深潜者。' : user + '这时来了37个陌生的访客。';
    return { ok: true, status: 200, headers: new Map(), json: async () => ({ choices: [{ message: { content: text } }], usage: { total_tokens: 10 } }) }; };
  const spec = compileMarkdown(readFileSync(new URL('../modules/雾港来信.md', import.meta.url), 'utf8'), { rulepacks: rps }); spec.reviewed = true;
  const S = Session.create({ id: 'nv', spec, rp: rps['chaohen-v1'], seats: [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }], seed: 'nv', config: { useModel: false }, llm: new LlmChain([{ name: 'fake', url: 'http://x', model: 'fake', key: '', perMinute: 600, timeoutMs: 5000 }], fake), tokens: {} });
  for (const [pc, t, secret] of [['lu', '看看告示栏'], ['su', '去栈桥尽头看看脚印', true], ['lu', '看看渔船']]) await S.act({ pc, text: t, secret: !!secret });
  S.cfg.useModel = true;
  const a = await S.polishNovel(); assert.equal(a.polished, a.sections); assert.ok(a.sections >= 1);
  // 交给模型的上下文里没有真相层，也没有苏幼宁私下看到的东西
  const secretText = spec.scenes[0].interactables.find((i) => i.id === 'pierend').text.slice(0, 12);
  for (const ctx of seen) { assert.ok(!ctx.includes('深潜者') && !ctx.includes('大衮')); assert.ok(!ctx.includes(secretText), '私下行动的所见不该进记录稿'); }
  assert.ok(S.b.log.filter((e) => e.type === 'context.audit' && e.data.role === 'novelist').every((e) => !e.data.leak));
  mode = 'leak'; const b = await S.polishNovel(); assert.equal(b.polished, 0); assert.match(b.kept[0].why, /泄露/);
  mode = 'number'; const c = await S.polishNovel(); assert.equal(c.polished, 0); assert.match(c.kept[0].why, /材料外的数字/);
  const rp = buildReplay(S, 'main', 'kp'); assert.ok(rp.novel_polished); assert.ok(!rp.novel_polished.text.includes('深潜者')); assert.ok(!rp.novel_polished.text.includes('37个'));
  assert.match(toMarkdown(rp, 'kp'), /小说体（模型润色）/); assert.ok(S.b.verifyChain().ok);
});

test('一句话带到几样东西：说得多的那样优先，不是 spec 里排在前面的那样', async () => {
  const S = mk('雾港来信', 'chaohen-v1', [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }], 'multi');
  await S.act({ pc: 'lu', text: '去灯塔' });
  // 亲手玩那一局里的原话：「灯室」是记录簿的叫法之一，但这句话要的是油柜
  assert.equal(S.classify('冲上旋梯到灯室，撬开油柜灌满鲸油', 'lu').it, 'oilcabinet');
  assert.equal(S.classify('冲上旋梯到灯室，撬开油柜灌满鲸油，把灯点起来', 'lu').it, 'lamp');
  assert.equal(S.classify('翻翻灯室里的簿子', 'lu').it, 'keeperbook');
});
