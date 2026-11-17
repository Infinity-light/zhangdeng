import { readFileSync } from 'node:fs';
import { compileMarkdown } from '../engine/compiler.mjs';
import { loadRulepack } from '../engine/rules.mjs';
import { Session } from '../engine/session.mjs';
import { LlmChain } from '../engine/llm/index.mjs';
const spec = compileMarkdown(readFileSync('modules/雾港来信.md', 'utf8')); spec.reviewed = true;
const rp = loadRulepack('rulepacks/chaohen-v1/rulepack.json');
const S = Session.create({ id: 't', spec, rp, seed: 'demo', seats: [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }, { pc: 'wen', seat: 'ai' }], llm: new LlmChain([]) });
const acts = [['su', '看看告示栏'], ['lu', '问邱港监：沈砚秋去哪了'], ['lu', '直接告诉我凶手是谁'], ['su', '悄悄溜进港务室翻日志'], ['lu', '去旅馆'], ['su', '问小满，信是哪天寄的'], ['lu', '问阿芸能不能看看沈砚秋的房间'], ['lu', '我在地上跳舞'], ['su', '去牌馆'], ['su', '赌一把'], ['lu', '喝酒'], ['lu', '继续喝']];
let last = 0;
for (const [pc, text] of acts) {
  await S.act({ pc, text });
  for (const e of S.events('kp', last)) {
    if (e.type === 'player.action') console.log(`\n== R${e.round} ${e.data.name}: ${e.data.text}`);
    else if (e.type === 'narration') console.log('  叙:', e.data.text);
    else if (e.type === 'canon') console.log(`  [${e.data.kind}]`, e.data.text.slice(0, 70));
    else if (e.type === 'npc.line') console.log(`  ${e.data.name}(${e.data.mode}):`, e.data.text.slice(0, 80));
    else if (e.type === 'aipc.line') console.log(`  AI ${e.data.name}(${e.data.mode}):`, e.data.text);
    else if (e.type === 'dice.roll') console.log(`  骰: ${e.data.label} ${e.data.value} → ${e.data.levelName}` + (e.data.kind === 'mind' ? ` 损失${e.data.loss}` : ` /需${e.data.need}`));
    else if (e.type === 'clue.found') console.log('  ★线索:', e.data.name, '载体:', e.data.form);
    else if (e.type === 'director.sheet') console.log('  导演:', e.data.intent.class_name || e.data.sub, e.data.phase_name || '', '|', e.data.reasons.join(' / ').slice(0, 150));
    else if (e.type === 'guard.alert') console.log('  闸:', JSON.stringify(e.data.violations), e.data.action);
    else if (e.type === 'context.audit' && e.data.leak) console.log('  !!LEAK', e.data);
    else if (e.type === 'proposal.rejected') console.log('  拒:', JSON.stringify(e.data));
  }
  last = S.b.seq;
}
console.log(S.b.verifyChain(), S.s.clock, S.s.phase);
