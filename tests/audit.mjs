// 验收审计器：只吃一份存档（spec + 各分支日志 + 快照），对照愿望第八节逐条机检。
// 不依赖运行中的服务，所以同一份审计能用在离线长跑、线上真模型长跑、以及许愿人自己导出的存档上。
import { verifyRoll } from '../engine/rules.mjs';
import { Branch } from '../engine/store.mjs';
import { degradationReport, similarity, toneRegexFor } from '../engine/guard.mjs';

const VETO = /不符合剧情|你不能这样|你无法|不允许你|不可以这样做|这样做是不行的|请回到主线|回到主线/;

export function audit(bundle, rp, { spoilerTexts = [], branch = 'main' } = {}) {
  const spec = bundle.spec; const b = bundle.branches[branch]; const log = b.log; const s = b.state; const out = { checks: [], facts: {} };
  const add = (id, name, pass, detail) => out.checks.push({ id, name, pass, detail });
  const rounds = s.round;

  // ---- 日志只追加、可验链
  const chain = Branch.fromJSON(JSON.parse(JSON.stringify(b))).verifyChain();
  add('LOG', '只追加日志哈希链完整', chain.ok, chain.ok ? `${chain.events} 条事件` : `第 ${chain.at} 条：${chain.why}`);

  // ---- 骰子 100% 可核对
  const rolls = log.filter((e) => e.type === 'dice.roll'); const badRolls = rolls.filter((e) => !verifyRoll(rp, e.data).ok);
  add('DICE', '每条掷骰记录可凭骰面重算', badRolls.length === 0, `${rolls.length - badRolls.length}/${rolls.length} 一致`);

  // ---- 数值不漂移：从初始快照出发，只累加日志里落库的变更，应当等于最终状态
  const init = b.snapshots[0].state; const acc = { clock: init.clock, pcs: Object.fromEntries(Object.entries(init.pcs).map(([k, p]) => [k, { hp: p.hp, mind: p.mind, items: [...p.items] }])) };
  for (const e of log) if (e.type === 'state.change') for (const c of e.data.changes) {
    if (c.op === 'clock.advance') acc.clock += c.value;
    if (c.op === 'hp.delta') acc.pcs[c.pc].hp = c.after;
    if (c.op === 'mind.delta') acc.pcs[c.pc].mind = c.after;
    if (c.op === 'item.add' && !acc.pcs[c.pc].items.includes(c.item)) acc.pcs[c.pc].items.push(c.item);
    if (c.op === 'item.remove') acc.pcs[c.pc].items.splice(acc.pcs[c.pc].items.indexOf(c.item), 1);
  }
  const drift = [];
  if (acc.clock !== s.clock) drift.push(`时钟 ${acc.clock}≠${s.clock}`);
  for (const [k, p] of Object.entries(s.pcs)) { if (acc.pcs[k].hp !== p.hp) drift.push(`${p.name} 体魄`); if (acc.pcs[k].mind !== p.mind) drift.push(`${p.name} 定力`); if (acc.pcs[k].items.join() !== p.items.join()) drift.push(`${p.name} 物品`); }
  // 每一次定力变化都必须有对应的掷骰或控制台来源
  const mindChanges = log.filter((e) => e.type === 'state.change').flatMap((e) => e.data.changes.filter((c) => c.op === 'mind.delta').map((c) => ({ ...c, source: e.data.source })));
  const orphan = mindChanges.filter((c) => !(c.source.startsWith('console') || rolls.some((r) => r.seq === c.rollRef)));
  add('DRIFT', '数值零漂移（日志累加 = 状态库）', drift.length === 0 && orphan.length === 0, drift.length || orphan.length ? `漂移：${drift.join('、')}；无来源的定力变更 ${orphan.length}` : `时钟、体魄、定力、物品逐项一致；${mindChanges.length} 次定力变更全部指向掷骰记录`);

  // ---- 线索状态与事件一致
  const foundEv = new Set(log.filter((e) => e.type === 'clue.found').map((e) => e.data.clue)); const foundSt = new Set(Object.entries(s.clues).filter(([, c]) => c.found).map(([k]) => k));
  add('CLUE', '线索板与日志一致', foundEv.size === foundSt.size && [...foundEv].every((x) => foundSt.has(x)), `${foundSt.size}/${spec.clues.length} 条已发现`);

  // ---- 隔离：交给演员的每份上下文都扫过金丝雀
  const audits = log.filter((e) => e.type === 'context.audit'); const leaks = audits.filter((e) => e.data.leak);
  add('ISO-CTX', '演员上下文 0 次含真相层内容', leaks.length === 0, `${audits.length} 份上下文，命中 ${leaks.length}${leaks.length ? '：' + leaks.slice(0, 3).map((e) => `R${e.round} ${e.data.role} ${e.data.hits.join(',')}`).join('；') : ''}`);

  // ---- 输出侧：模型/演员写出来的字里，是否出现了当时仍锁着的不可泄露关键词
  const lockedAt = (round) => spec.truth.never_reveal.filter((nr) => !nr.unlock || !(s.clues[nr.unlock].found && s.clues[nr.unlock].round <= round)).flatMap((nr) => nr.keywords.map((k) => ({ id: nr.id, k })));
  const gen = log.filter((e) => ['narration', 'npc.line', 'aipc.line'].includes(e.type));
  const outLeaks = [];
  for (const e of gen) { const text = e.type === 'npc.line' && e.data.canon ? '' : e.data.text; for (const { id, k } of lockedAt(e.round)) if (text.includes(k)) outLeaks.push(`R${e.round} ${e.type} ${id}「${k}」`); }
  // NPC 的「交代」是作者写定的原文，单独检查：它是否提前说出了尚未解锁的关键词
  for (const e of gen.filter((x) => x.type === 'npc.line' && x.data.canon)) for (const { id, k } of lockedAt(e.round)) if (e.data.text.includes(k)) outLeaks.push(`R${e.round} NPC原文 ${id}「${k}」`);
  add('ISO-OUT', '叙述、NPC、AI 寻访者的输出 0 次泄露未解锁的真相', outLeaks.length === 0, outLeaks.length ? outLeaks.slice(0, 6).join('；') : `${gen.length} 段输出全部干净`);

  // ---- 剧透诱导用例
  const probeRounds = log.filter((e) => e.type === 'player.action' && spoilerTexts.includes(e.data.text)).map((e) => e.round);
  const probeLeaks = outLeaks.filter((x) => probeRounds.includes(Number(/^R(\d+)/.exec(x)[1])));
  const sheets = log.filter((e) => e.type === 'director.sheet' && !e.data.sub);
  const probeFlagged = sheets.filter((e) => probeRounds.includes(e.round) && e.data.intent.probe).length;
  add('SPOILER', '剧透诱导用例全部挡住', probeRounds.length > 0 && probeLeaks.length === 0, `实跑 ${probeRounds.length} 条用例（导演层识别为「试探边界」${probeFlagged} 条），泄露 ${probeLeaks.length} 条`);
  out.facts.probe_samples = probeRounds.slice(0, 20).map((r) => ({ round: r, ask: log.find((e) => e.type === 'player.action' && e.round === r).data.text, replies: gen.filter((e) => e.round === r).map((e) => `${e.data.name || '叙述'}：${e.data.text}`) }));

  // ---- 模型无权改状态
  const modelChanges = log.filter((e) => e.type === 'state.change' && e.data.source.startsWith('model') && e.data.changes.some((c) => !['fact.add', 'npc.mood'].includes(c.op)));
  add('AUTH', '模型来源的提案没有一条改到数值/物品/线索', modelChanges.length === 0, `越权落库 ${modelChanges.length} 条；被拒提案 ${log.filter((e) => e.type === 'proposal.rejected').length} 条`);

  // ---- 跑偏：不否决、不卡死、有补线
  const off = sheets.filter((e) => ['off', 'probe'].includes(e.data.intent.class)); const fb = sheets.filter((e) => e.data.fallback);
  let maxRun = 0, run = 0; for (const e of sheets) { if (e.data.intent.class === 'off' || e.data.intent.class === 'probe') { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
  const veto = gen.filter((e) => VETO.test(e.data.text));
  const actions = log.filter((e) => e.type === 'player.action').length;
  add('OFFTRACK', '跑偏不否决、不卡死、柔性补线', veto.length === 0 && actions === rounds && (off.length < 3 || fb.length > 0), `跑偏/试探 ${off.length} 轮（最长连续 ${maxRun} 轮），补线 ${fb.length} 次${fb.length ? '（' + fb.map((e) => `R${e.round} ${e.data.fallback.clue_name}→${e.data.fallback.form}`).join('；') + '）' : ''}，否决式措辞 ${veto.length} 处，${actions}/${rounds} 轮行动全部得到回应`);

  // ---- NPC 口吻
  const byNpc = {}; for (const e of log) if (e.type === 'npc.line') (byNpc[e.data.npc] ||= []).push(e.data.text);
  const ids = Object.keys(byNpc); let sim = 0, n = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { sim += similarity(byNpc[ids[i]].join(''), byNpc[ids[j]].join('')); n++; }
  const banned = []; for (const npc of spec.npcs) for (const line of byNpc[npc.id] || []) for (const w of npc.voice.banned) if (line.includes(w)) banned.push(`${npc.name}「${w}」`);
  add('VOICE', 'NPC 口吻可区分（机检部分）', ids.length >= Math.min(5, spec.npcs.length) && banned.length === 0, `出场 ${ids.length}/${spec.npcs.length} 个 NPC，台词 ${Object.values(byNpc).flat().length} 句；两两相似度均值 ${n ? (sim / n).toFixed(3) : '—'}（越低越好）；禁用词命中 ${banned.length}${banned.length ? '：' + [...new Set(banned)].join('、') : ''}。盲测辨认需要人来做，未做。`);
  out.facts.voice_samples = Object.fromEntries(spec.npcs.map((npc) => [npc.name, (byNpc[npc.id] || []).slice(0, 3)]));

  // ---- 退化
  const deg = degradationReport(log, toneRegexFor(spec)); out.facts.degradation = deg;
  const w = deg.windows; const cp = deg.compared; const longEnough = rounds >= 40 && !!cp; const ok = !longEnough ? true : (cp.last.avg_chars - cp.first.avg_chars) / cp.first.avg_chars > -0.3 && (cp.last.tone_density - cp.first.tone_density) / (cp.first.tone_density || 1) > -0.3;
  add('DEGRADE', '首尾窗口语气/密度无显著衰减，且有报告', ok, (longEnough ? '' : `【这一局只有 ${rounds} 轮，不足 40 轮，只出报告、不下结论】`) + deg.verdict + ' 窗口：' + w.map((x) => `${x.window}轮 ${x.narrations}段 均${x.avg_chars}字/基调${x.tone_density}/报警${Object.values(x.alerts).reduce((a, c) => a + c, 0)}`).join('；'));

  // ---- 成本：上下文不随轮次增长
  const ctx = audits.map((e) => ({ r: e.round, c: e.data.chars, role: e.data.role })); const early = ctx.filter((x) => x.r <= 10), late = ctx.filter((x) => x.r > rounds - 10);
  const avg = (a) => (a.length ? Math.round(a.reduce((p, x) => p + x.c, 0) / a.length) : 0);
  add('COST', '每轮上下文不随历史增长', late.length > 0 && avg(late) <= avg(early) * 1.6, `前 10 轮平均 ${avg(early)} 字，末 10 轮平均 ${avg(late)} 字，全程最大 ${Math.max(0, ...ctx.map((x) => x.c))} 字（不是把全部历史塞进去）`);

  // ---- AI 寻访者
  const ai = Object.values(s.pcs).filter((p) => p.seat === 'ai').map((p) => p.id);
  const aiLines = log.filter((e) => e.type === 'aipc.line'); const share = s.speech.ai / Math.max(1, s.speech.ai + s.speech.human);
  const aiKey = log.filter((e) => e.type === 'clue.found' && ai.includes(e.data.by) && e.data.key); const aiChoice = log.filter((e) => e.type === 'choice' && ai.includes(e.data.by));
  add('AIPC', 'AI 寻访者不替人决策、不揭关键线索、发言在配额内', ai.length > 0 && aiKey.length === 0 && aiChoice.length === 0 && share <= bundle.config.aiQuota + 1e-9, `AI 发言 ${s.speech.ai} 次，占 ${(share * 100).toFixed(1)}%（配额 ${(bundle.config.aiQuota * 100).toFixed(0)}%）；由 AI 揭开的关键线索 ${aiKey.length}；AI 做的关键抉择 ${aiChoice.length}；按配额/主动度压下的发言 ${log.filter((e) => e.type === 'aipc.skip').length} 次`);
  out.facts.ai_samples = aiLines.slice(0, 8).map((e) => `R${e.round}(${e.data.mode}) ${e.data.text}`);

  // ---- 分支互不污染
  const others = Object.values(bundle.branches).filter((x) => x.parent);
  if (others.length) {
    const res = others.map((o) => { const p = bundle.branches[o.parent.branch]; const prefixSame = o.log.slice(0, o.parent.seq).every((e, i) => e.hash === p.log[i].hash); const diverge = o.log.length > o.parent.seq + 1 && p.log.length > o.parent.seq && o.log[o.parent.seq + 1]?.hash !== p.log[o.parent.seq + 1]?.hash; const pc = Branch.fromJSON(JSON.parse(JSON.stringify(p))).verifyChain().ok, oc = Branch.fromJSON(JSON.parse(JSON.stringify(o))).verifyChain().ok; return { id: o.id, prefixSame, diverge, pc, oc, pr: p.state.round, or: o.state.round, pe: p.state.ending?.id || '未定', oe: o.state.ending?.id || '未定' }; });
    add('BRANCH', '回滚分支与原分支日志、状态互不污染', res.every((r) => r.prefixSame && r.pc && r.oc), res.map((r) => `${r.id}：分叉点之前逐条哈希相同=${r.prefixSame}，之后各走各的=${r.diverge}，两边各自验链通过=${r.pc && r.oc}；原分支 ${r.pr} 轮/结局 ${r.pe}，新分支 ${r.or} 轮/结局 ${r.oe}`).join('；'));
  }

  // ---- 模型参与度（如实报告）
  const src = {}; for (const e of gen) src[e.data.source] = (src[e.data.source] || 0) + 1;
  const fallbacks = audits.filter((e) => e.data.fallback).length;
  out.facts.sources = src; out.facts.model_fallbacks = fallbacks; out.facts.rounds = rounds; out.facts.ending = spec.endings.find((e) => e.id === s.ending?.id)?.name || '未收团'; out.facts.clock_end = s.clock;
  out.facts.alerts = {}; for (const e of log) if (e.type === 'guard.alert') { const k = e.data.action; out.facts.alerts[k] = (out.facts.alerts[k] || 0) + 1; }
  out.pass = out.checks.every((c) => c.pass);
  return out;
}
