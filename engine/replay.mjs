// L7 Replay 生成器：只读日志与快照，不读模型。九项内容，双视角，可导出 Markdown / HTML / JSON。
import { verifyRoll } from './rules.mjs';
import { degradationReport, toneRegexFor } from './guard.mjs';
import { fmtClock, condText } from './compiler.mjs';
import { visibleTo } from './store.mjs';
import { PHASE_NAME } from './session.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 规则术语跟着规则包走：输出文本里的「定力/体魄/失序」换成这局团的规则包的叫法。
const loc = (text, terms) => (!terms || terms.mind === '定力' ? text : text.split('定力').join(terms.mind).split('体魄').join(terms.hp).split('失序').join(terms.disorder));
export function buildReplay(session, branchId = session.current, viewer = 'kp') {
  const rp = buildReplayRaw(session, branchId, viewer); const terms = session.rp.terms;
  rp.terms = terms; rp.rulepack = { id: session.rp.id, name: session.rp.name };
  for (const t of rp.timeline || []) if (t.result) t.result = loc(t.result, terms);
  return rp;
}
function buildReplayRaw(session, branchId = session.current, viewer = 'kp') {
  const b = session.branches[branchId], spec = session.specForKp, rp = session.rp, s = b.state; const kpView = viewer === 'kp';
  // 只追加日志按查看者过滤一次，后面每一项都从过滤后的日志里出：别人的私下行动、掌灯人侧的事件，玩家视角里根本不存在
  const full = b.log; const log = kpView ? full : full.filter((e) => visibleTo(e, viewer));
  const sceneName = (id) => spec.scenes.find((x) => x.id === id)?.name || id;
  const pcName = (id) => s.pcs[id]?.name || id;

  // 1 逐轮回放（玩家视角 / 掌灯人视角）
  const rounds = [];
  for (const ev of log) {
    const r = (rounds[ev.round] ||= { round: ev.round, clock: fmtClock(ev.clock), scene: sceneName(ev.scene), public: [], kp: [] });
    const pub = ev.vis !== 'kp';
    const item = { seq: ev.seq, type: ev.type, actor: ev.actor, private: typeof ev.vis === 'object', data: ev.data };
    if (['player.action', 'narration', 'canon', 'npc.line', 'aipc.line', 'dice.roll', 'clue.found', 'ending', 'xcard', 'choice', 'branch.fork', 'save'].includes(ev.type) && pub) r.public.push(item);
    if (['director.sheet', 'trigger.fired', 'guard.alert', 'proposal.rejected', 'console.action', 'aipc.skip', 'state.change'].includes(ev.type)) r.kp.push(item);
  }
  const roundList = rounds.filter(Boolean);

  // 2 时间线
  const timeline = [];
  for (const ev of log) {
    const base = { round: ev.round, clock: fmtClock(ev.clock), scene: sceneName(ev.scene) };
    if (ev.type === 'player.action') timeline.push({ ...base, who: ev.data.name, what: ev.data.text, result: '' });
    else if (ev.type === 'dice.roll') timeline.push({ ...base, who: pcName(ev.data.pc), what: `掷骰：${ev.data.label}`, result: ev.data.kind === 'mind' ? `${ev.data.value} 对 ${ev.data.current}，${ev.data.levelName}，定力 ${ev.data.current}→${ev.data.after}` : `${ev.data.value} 对 ${ev.data.need}，${ev.data.levelName}` });
    else if (ev.type === 'clue.found') timeline.push({ ...base, who: ev.data.by === 'director' ? '（世界）' : pcName(ev.data.by) || ev.data.by, what: `得到线索「${ev.data.name}」`, result: `载体：${ev.data.form}` });
    else if (ev.type === 'trigger.fired') timeline.push({ ...base, who: '（世界）', what: `事件：${ev.data.name}`, result: ev.data.why });
    else if (ev.type === 'ending') timeline.push({ ...base, who: '（世界）', what: `结局：${ev.data.name}`, result: '' });
    else if (ev.type === 'branch.fork') timeline.push({ ...base, who: '（存档）', what: `从分支 ${ev.data.from} 第 ${ev.data.round} 轮分出`, result: ev.data.name });
  }

  // 3 线索发现率
  const clueList = spec.clues.map((c) => { const st = s.clues[c.id]; const car = c.carriers.find((k) => k.id === st.carrier); const mine = kpView ? st.found : (viewer === '__public__' ? st.found && st.knownBy.length === Object.keys(s.pcs).length : st.knownBy.includes(viewer)); if (!mine && !kpView) return { id: null, name: '（未发现）', key: undefined, content: '', found: false, round: null, form: '', by: '', carriers_unused: [] }; return { id: c.id, name: c.name, key: kpView ? c.key : undefined, content: c.content, found: st.found, round: st.round, form: car?.form || '', by: st.by ? (s.pcs[st.by]?.name || spec.npcs.find((n) => n.id === st.by)?.name || (st.by === 'director' ? '柔性补线' : st.by)) : '', carriers_unused: c.carriers.filter((k) => !st.carriersUsed.includes(k.id)).map((k) => k.form) }; });
  const found = clueList.filter((c) => c.found).length;   // 玩家视角下 clueList 已按「这位玩家知道的」裁过

  // 4 骰子日志 + 数值曲线
  const rolls = log.filter((e) => e.type === 'dice.roll').map((e) => ({ seq: e.seq, round: e.round, pc: pcName(e.data.pc), label: e.data.label, kind: e.data.kind, value: e.data.value, target: e.data.kind === 'mind' ? e.data.current : e.data.need, level: e.data.levelName, success: e.data.success, loss: e.data.loss, tens: e.data.dice.tens, units: e.data.dice.units, private: typeof e.vis === 'object', verify: verifyRoll(rp, e.data) }));
  const skillRolls = rolls.filter((r) => r.kind === 'skill');
  const curves = Object.values(s.pcs).map((p) => ({ id: p.id, name: p.name, hpMax: p.hpMax, mindMax: p.mindMax, points: Object.values(b.snapshots).sort((a, c) => a.round - c.round).map((sn) => ({ round: sn.round, hp: sn.state.pcs[p.id]?.hp, mind: sn.state.pcs[p.id]?.mind })) }));

  // 5 关键抉择点与分支
  const reachable = (state) => spec.endings.filter((e) => e.when_any.some((c) => c.every((a) => !(a.t === 'flag' && a.neg && state.flags[a.k]) && !(a.t === 'time' && a.op === '<' && state.clock >= a.v)))).map((e) => e.name);
  const choices = [];
  for (const ev of log) {
    if (ev.type === 'choice') { const kc = spec.key_choices.find((k) => k.id === ev.data.choice); const sn = b.snapshots[ev.round - 1] || b.snapshots[ev.round]; choices.push({ round: ev.round, kind: '关键抉择', name: ev.data.name, taken: ev.data.label, alternatives: kc.options.filter((o) => o.id !== ev.data.option).map((o) => o.label), reachable_before: sn ? reachable(sn.state) : [] }); }
    if (ev.type === 'director.sheet' && ev.data.fallback) choices.push({ round: ev.round, kind: '柔性补线点', name: `跑偏后被送回：${ev.data.fallback.clue_name}`, taken: `接到了「${ev.data.fallback.form}」`, alternatives: ['若此前留在主线，该线索会以原载体被发现'], reachable_before: b.snapshots[ev.round] ? reachable(b.snapshots[ev.round].state) : [] });
    if (ev.type === 'dice.roll' && ev.data.kind === 'skill' && !ev.data.success && /调查|绕过|说动/.test(ev.data.label)) choices.push({ round: ev.round, kind: '检定分岔', name: ev.data.label, taken: `失败（${ev.data.value}）`, alternatives: ['若成功，直接得到该处内容'], reachable_before: [] });
  }
  const takenChoiceIds = new Set(log.filter((e) => e.type === 'choice').map((e) => e.data.choice));
  const unreached = spec.key_choices.filter((k) => !takenChoiceIds.has(k.id)).map((k) => ({ name: k.name, requires: condText(k.requires), options: k.options.map((o) => o.label) }));
  const unreachedEndings = spec.endings.filter((e) => e.id !== s.ending?.id).map((e) => ({ name: e.name, conditions: e.when_any.map(condText) }));
  const tree = Object.values(session.branches).map((x) => ({ id: x.id, name: x.name, parent: x.parent, rounds: x.state.round, ending: spec.endings.find((e) => e.id === x.state.ending?.id)?.name || null, clues: Object.values(x.state.clues).filter((c) => c.found).length }));

  // 6 NPC 出场与态度
  const npcs = spec.npcs.map((n) => {
    const lines = log.filter((e) => e.type === 'npc.line' && e.data.npc === n.id);
    const att = [{ round: 0, value: n.attitude_init }];
    for (const e of log) if (e.type === 'state.change') for (const c of e.data.changes) if (c.op === 'npc.attitude' && c.npc === n.id) att.push({ round: e.round, value: c.after, why: e.data.reason });
    return { id: n.id, name: n.name, public_identity: n.public_identity, rounds: [...new Set(lines.map((e) => e.round))], lines: lines.length, shared: kpView ? s.npcs[n.id].said.map((id) => n.knowledge.find((k) => k.id === id)?.title) : [], withheld: kpView ? n.knowledge.filter((k) => !s.npcs[n.id].said.includes(k.id)).map((k) => k.title) : [], attitude: kpView ? att : [], sample: lines.slice(0, 2).map((e) => e.data.text) };
  });

  // 7 导演决策注解
  const notes = log.filter((e) => e.type === 'director.sheet' && !e.data.sub).map((e) => ({ round: e.round, intent: e.data.intent?.class_name, phase: e.data.phase_name, phase_reason: e.data.phase_reason, budget: e.data.info_budget?.max_clues, reveal: e.data.reveal, fallback: e.data.fallback, forbidden: e.data.forbidden, reasons: e.data.reasons }));

  // 8 记录稿（由日志拼接；不经模型润色）
  const novel = [];
  for (const r of roundList) {
    const parts = [];
    for (const it of r.public) {
      const d = it.data;
      if (it.type === 'player.action') parts.push(`${d.name}：「${d.text}」`);
      else if (it.type === 'narration' && !log.some((e) => e.type === 'narration' && e.data.supersedes === it.seq)) parts.push(d.text);
      else if (it.type === 'canon') parts.push(d.text);
      else if (it.type === 'npc.line') parts.push(d.nonverbal ? d.text : `${d.name}说：「${d.text}」`);
      else if (it.type === 'aipc.line') parts.push(`${d.name}小声说：「${d.text}」`);
      else if (it.type === 'ending') parts.push(`\n——${d.name}——\n${d.text}`);
    }
    if (parts.length) novel.push(parts.join('\n'));
  }

  // 隔离与成本审计
  const audits = full.filter((e) => e.type === 'context.audit');
  const byRole = {}; for (const a of audits) { const o = (byRole[a.data.role] ||= { calls: 0, chars: 0, max: 0, model: 0 }); o.calls++; o.chars += a.data.chars; o.max = Math.max(o.max, a.data.chars); if (a.data.source !== 'offline') o.model++; }
  const ctxByRound = {}; for (const a of audits) (ctxByRound[a.round] ||= []).push(a.data.chars);
  const isolation = { contexts: audits.length, leaks: audits.filter((a) => a.data.leak).length, leak_samples: audits.filter((a) => a.data.leak).slice(0, 5).map((a) => ({ round: a.round, ...a.data })), by_role: Object.fromEntries(Object.entries(byRole).map(([k, o]) => [k, { calls: o.calls, avg_chars: Math.round(o.chars / o.calls), max_chars: o.max, model_calls: o.model }])), ctx_max_by_round: Object.entries(ctxByRound).map(([r, a]) => ({ round: Number(r), max: Math.max(...a) })), rejected_proposals: full.filter((e) => e.type === 'proposal.rejected').length };
  if (!kpView) { isolation.by_role = {}; isolation.leak_samples = []; isolation.ctx_max_by_round = []; }

  return {
    format: 'zhangdeng.replay/1', generated: new Date().toISOString(),
    meta: { title: spec.meta.title, session: session.id, branch: branchId, branch_name: b.name, parent: b.parent, rounds: s.round, clock_start: fmtClock(spec.meta.start_clock), clock_end: fmtClock(s.clock), ending: spec.endings.find((e) => e.id === s.ending?.id)?.name || '未收团', seed: session.cfg.seed, rulepack: rp.name, seats: Object.values(s.pcs).map((p) => ({ name: p.name, role: p.role, seat: p.seat })), chain: b.verifyChain() },
    rounds: roundList, timeline,
    clues: { found, total: clueList.length, rate: `${found}/${clueList.length}`, list: clueList, missed: clueList.filter((c) => !c.found) },
    dice: { rolls, total: rolls.length, skill_success_rate: skillRolls.length ? +(skillRolls.filter((r) => r.success).length / skillRolls.length).toFixed(2) : null, crits: rolls.filter((r) => r.level === '大成功').length, fumbles: rolls.filter((r) => r.level === '大失败').length, verified: rolls.filter((r) => r.verify.ok).length, verify_failed: rolls.filter((r) => !r.verify.ok) },
    curves, choices, unreached: kpView ? unreached : [], unreached_endings: kpView ? unreachedEndings : [], tree, npcs, director_notes: notes, novel: novel.join('\n\n'), novel_polished: (() => { const e = [...log].reverse().find((x) => x.type === 'novel.polished'); return e ? { text: e.data.text, sections: e.data.sections, polished: e.data.polished, kept: (e.data.kept || []).length, source: e.data.source, round: e.data.round } : null; })(),
    degradation: kpView ? degradationReport(full, toneRegexFor(session.specForKp)) : { windows: [], verdict: '', npc_cross_similarity: null }, isolation, viewer,
    speech: { human: s.speech.human, ai: s.speech.ai, ai_share: s.speech.human + s.speech.ai ? +(s.speech.ai / (s.speech.human + s.speech.ai)).toFixed(3) : 0, quota: session.cfg.aiQuota },
    facts: kpView ? s.facts : [],
  };
}

function lineOf(it, kp) {
  const d = it.data;
  switch (it.type) {
    case 'player.action': return `**${d.name}**${d.secret ? '（私下）' : ''}：${d.text}`;
    case 'narration': return (it.private ? '（私下）' : '') + (d.supersedes ? `> （重写稿）${d.text}` : `> ${d.text}`);
    case 'canon': return (d.title ? `> 【${d.title}】` : '> ') + d.text.replace(/\n/g, '\n> ');
    case 'npc.line': return d.nonverbal ? `**${d.name}**：${d.text}` : `**${d.name}**：「${d.text}」`;
    case 'aipc.line': return `**${d.name}**（AI 席位）：「${d.text}」`;
    case 'dice.roll': return d.kind === 'mind' ? `\`骰\` ${d.label}：${d.value} 对 当前定力 ${d.current} → ${d.levelName}，损失 ${d.loss}（${d.lossExpr}），定力 ${d.current}→${d.after}${d.disorder ? '；' + d.disorder.text : ''}` : `\`骰\` ${d.label}：${d.skillName} ${d.skill}（${d.tierName}，需 ≤${d.need}）掷出 ${d.value} → ${d.levelName}`;
    case 'clue.found': return `\`线索\` **${d.name}**（${d.form}）：${d.content}`;
    case 'ending': return `### 结局 · ${d.name}\n\n${d.text}`;
    case 'choice': return `\`抉择\` ${d.name} → ${d.label}`;
    case 'xcard': return '`X 卡` 有人按下了 X 卡，随后的描写已淡化。';
    case 'save': return `\`存档\` ${d.name}`;
    case 'branch.fork': return `\`分支\` 自 ${d.from} 第 ${d.round} 轮分出`;
    default: return '';
  }
}
function kpLine(it) {
  const d = it.data;
  if (it.type === 'director.sheet') return d.sub ? `- 导演单（AI 席位的小行动）：${d.reasons.join('；')}` : `- **导演单** 意图=${d.intent?.class_name}；相位=${d.phase_name}（${d.phase_reason}）；信息预算=${d.info_budget?.max_clues} 条；禁止泄露=${d.forbidden.join(',') || '无'}${d.fallback ? `；补线=${d.fallback.clue_name}→${d.fallback.form}` : ''}\n  - 理由：${d.reasons.join('；')}`;
  if (it.type === 'trigger.fired') return `- 触发器「${d.name}」：${d.why}。${d.kp_note || ''}`;
  if (it.type === 'guard.alert') return `- 闸门报警（${d.role}）：${d.violations.map((v) => `${v.type}「${v.match}」`).join('、')} → ${({ pass: '仅记录', rewrite: '已重写', strip: '已剔除违规句', offline: '改用离线稿' })[d.action]}`;
  if (it.type === 'proposal.rejected') return `- **提案被拒**（来源 ${d.source}）：${d.rejected.map((r) => `${r.op.op}：${r.why}`).join('；')}`;
  if (it.type === 'state.change') return `- 落库（${d.reason}）：${d.changes.map((c) => c.op + (c.before !== undefined && c.after !== undefined ? ` ${c.before}→${c.after}` : c.flag ? ` ${c.flag}` : c.clue ? ` ${c.clue}` : c.item ? ` ${c.item}` : '')).join('，')}`;
  if (it.type === 'console.action') return `- 控制台操作：${d.type}`;
  if (it.type === 'aipc.skip') return `- AI 席位未发言：${d.why}`;
  return '';
}

export function toMarkdown(rp, view = 'kp') {
  const kp = view === 'kp'; const o = [];
  o.push(`# ${rp.meta.title} · Replay（${kp ? '掌灯人全知视角' : '玩家视角'}）`, '');
  o.push(`- 分支：${rp.meta.branch}（${rp.meta.branch_name}）　轮数：${rp.meta.rounds}　故事时间：${rp.meta.clock_start} → ${rp.meta.clock_end}`, `- 结局：${rp.meta.ending}`, `- 席位：${rp.meta.seats.map((s) => `${s.name}（${s.role}，${s.seat === 'ai' ? 'AI' : '人类'}）`).join('、')}`, `- 规则包：${rp.meta.rulepack}　随机种子：${rp.meta.seed}　日志验链：${rp.meta.chain.ok ? `通过（${rp.meta.chain.events} 条）` : '失败'}`, '');
  o.push('## 一、逐轮回放', '');
  for (const r of rp.rounds) {
    o.push(`### 第 ${r.round} 轮 · ${r.scene} · ${r.clock}`, '');
    for (const it of r.public) { const l = lineOf(it, kp); if (l) o.push(l, ''); }
    if (kp && r.kp.length) { o.push('<details><summary>掌灯人侧</summary>', ''); for (const it of r.kp) { const l = kpLine(it); if (l) o.push(l); } o.push('', '</details>', ''); }
  }
  o.push('## 二、时间线', '', '| 轮 | 时间 | 地点 | 谁 | 做了什么 | 结果 |', '|---|---|---|---|---|---|');
  for (const t of rp.timeline) o.push(`| ${t.round} | ${t.clock} | ${t.scene} | ${t.who} | ${String(t.what).replace(/\|/g, '/')} | ${t.result} |`);
  o.push('', `## 三、线索发现率：${rp.clues.rate}`, '', '| 线索 | 发现于 | 载体 | 经由 |', '|---|---|---|---|');
  for (const c of rp.clues.list) if (c.found) o.push(`| ${c.name} | 第 ${c.round} 轮 | ${c.form} | ${c.by} |`);
  if (rp.clues.missed.length) { o.push('', '遗漏：'); for (const c of rp.clues.missed) o.push(`- ${c.name}${kp ? `（未用过的载体：${c.carriers_unused.join('、')}）` : ''}`); }
  o.push('', '## 四、骰子日志与数值', '', `共 ${rp.dice.total} 次掷骰，技能检定成功率 ${rp.dice.skill_success_rate ?? '—'}，大成功 ${rp.dice.crits}，大失败 ${rp.dice.fumbles}；逐条重算核对 ${rp.dice.verified}/${rp.dice.total} 一致。`, '', '| 轮 | 谁 | 事由 | 十位骰 | 个位骰 | 值 | 对 | 结果 |', '|---|---|---|---|---|---|---|---|');
  for (const r of rp.dice.rolls) o.push(`| ${r.round} | ${r.pc} | ${r.label} | ${r.tens.join('/')} | ${r.units} | ${r.value} | ${r.target} | ${r.level}${r.loss ? `，-${r.loss}` : ''} |`);
  o.push('', '数值曲线（每轮末）：', '');
  for (const c of rp.curves) o.push(`- ${c.name}　定力：${c.points.map((p) => p.mind).join(' ')}　体魄：${c.points.map((p) => p.hp).join(' ')}`);
  o.push('', '## 五、关键抉择点与分支', '');
  for (const c of rp.choices) o.push(`- 第 ${c.round} 轮 · ${c.kind} · ${c.name} → ${c.taken}。另一条：${c.alternatives.join(' / ')}${c.reachable_before.length ? `。当时仍可达的结局：${c.reachable_before.join('、')}` : ''}`);
  if (kp) { o.push('', '未走到的分支点：'); for (const u of rp.unreached) o.push(`- ${u.name}（出现条件：${u.requires || '无'}；选项：${u.options.join(' / ')}）`); for (const u of rp.unreached_endings) o.push(`- 未达成的结局「${u.name}」：${u.conditions.join(' 或 ')}`); }
  o.push('', '分支树：'); for (const t of rp.tree) o.push(`- ${t.id}「${t.name}」${t.parent ? `← ${t.parent.branch} 第 ${t.parent.round} 轮` : '（根）'}：${t.rounds} 轮，线索 ${t.clues}，结局 ${t.ending || '未定'}`);
  o.push('', '## 六、NPC 出场记录', '');
  for (const n of rp.npcs) o.push(`- **${n.name}**（${n.public_identity}）：出场 ${n.rounds.length} 轮（${n.rounds.join('、') || '—'}），台词 ${n.lines} 句；${n.attitude.length ? '态度 ' + n.attitude.map((a) => a.value).join(' → ') : ''}${kp ? `；说出口的：${n.shared.join('、') || '无'}；没说的：${n.withheld.join('、') || '无'}` : ''}`);
  if (kp) {
    o.push('', '## 七、导演决策注解', '');
    for (const n of rp.director_notes) o.push(`- 第 ${n.round} 轮｜${n.intent}｜${n.phase}：${n.reasons.join('；')}${n.fallback ? `【补线：${n.fallback.clue_name} → ${n.fallback.form}】` : ''}`);
    o.push('', '### 退化检测报告', '', rp.degradation.verdict, '', '| 轮次窗 | 叙述段数 | 平均字数 | 基调词密度 | 报警 | 重写 |', '|---|---|---|---|---|---|');
    for (const w of rp.degradation.windows) o.push(`| ${w.window} | ${w.narrations} | ${w.avg_chars} | ${w.tone_density} | ${Object.entries(w.alerts).map(([k, v]) => `${k}×${v}`).join(' ') || '—'} | ${w.rewrites} |`);
    o.push('', `NPC 口吻交叉相似度（越低越不串味）：${rp.degradation.npc_cross_similarity ?? '—'}`);
    o.push('', '### 隔离与成本审计', '', `交给演员的上下文共 ${rp.isolation.contexts} 份，命中真相层金丝雀 ${rp.isolation.leaks} 份；被拒绝的状态提案 ${rp.isolation.rejected_proposals} 份。`, '');
    for (const [k, v] of Object.entries(rp.isolation.by_role)) o.push(`- ${k}：${v.calls} 次，平均 ${v.avg_chars} 字，最大 ${v.max_chars} 字，其中模型生成 ${v.model_calls} 次`);
    o.push(`- AI 席位发言占比：${(rp.speech.ai_share * 100).toFixed(1)}%（配额 ${(rp.speech.quota * 100).toFixed(0)}%）`);
  }
  const pol = rp.novel_polished ? ['### 小说体（模型润色）', '', `> 写到第 ${rp.novel_polished.round} 轮为止，共 ${rp.novel_polished.sections} 节，其中 ${rp.novel_polished.polished} 节由 ${rp.novel_polished.source || '模型'} 润色并通过校验（不泄露未解锁的真相、不多出原文没有的数字和人名），${rp.novel_polished.kept} 节没过校验、保留了原文。`, '', rp.novel_polished.text, '', '### 原始记录（按日志拼接，未润色）', ''] : [];
  o.push('', '## 八、记录稿', '', ...pol, rp.novel, '', '## 九、全量数据', '', '同名 JSON 文件含日志、快照与状态，可在「导入存档」里再导入续团。', '');
  return loc(o.join('\n'), rp.terms);
}

function curveSvg(rp) {
  const W = 720, H = 220, P = 34; const maxR = Math.max(1, rp.meta.rounds); const maxV = Math.max(...rp.curves.map((c) => c.mindMax), 10);
  const x = (r) => P + (W - P * 1.5) * (r / maxR), y = (v) => H - P - (H - P * 1.6) * (v / maxV);
  const colors = ['#e8b65a', '#8fc7c0', '#d98f7a', '#b9a7d6'];
  let g = `<svg viewBox="0 0 ${W} ${H}" class="curve" role="img" aria-label="定力曲线">`;
  for (let v = 0; v <= maxV; v += 20) g += `<line x1="${P}" x2="${W - P / 2}" y1="${y(v)}" y2="${y(v)}" stroke="#2a3b3d" stroke-width="1"/><text x="${P - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#7d9391">${v}</text>`;
  for (let r = 0; r <= maxR; r += Math.max(1, Math.ceil(maxR / 10))) g += `<text x="${x(r)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="#7d9391">${r}</text>`;
  rp.curves.forEach((c, i) => {
    const pts = c.points.filter((p) => p.mind != null);
    g += `<polyline fill="none" stroke="${colors[i % 4]}" stroke-width="2" points="${pts.map((p) => `${x(p.round).toFixed(1)},${y(p.mind).toFixed(1)}`).join(' ')}"/>`;
    g += `<polyline fill="none" stroke="${colors[i % 4]}" stroke-width="1" stroke-dasharray="3 4" opacity=".6" points="${pts.map((p) => `${x(p.round).toFixed(1)},${y(p.hp).toFixed(1)}`).join(' ')}"/>`;
    const last = pts[pts.length - 1]; if (last) g += `<text x="${Math.min(W - 60, x(last.round) + 4)}" y="${y(last.mind) - 6 - i * 2}" font-size="11" fill="${colors[i % 4]}">${esc(c.name)} ${last.mind}</text>`;
  });
  return g + `<text x="${P}" y="14" font-size="10" fill="#7d9391">实线：定力　虚线：体魄　横轴：轮</text></svg>`;
}
export { curveSvg };

export function toHTML(rp, view = 'kp') {
  const kp = view === 'kp';
  const row = (it) => {
    const d = it.data;
    if (it.type === 'player.action') return `<p class="pa"><b>${esc(d.name)}</b>${d.secret ? '<i>（私下）</i>' : ''}　${esc(d.text)}</p>`;
    if (it.type === 'narration') return `<p class="na">${esc(d.text)}</p>`;
    if (it.type === 'canon') return `<p class="ca">${d.title ? `<span>${esc(d.title)}</span>` : ''}${esc(d.text)}</p>`;
    if (it.type === 'npc.line') return d.nonverbal ? `<p class="np"><b>${esc(d.name)}</b>${esc(d.text)}</p>` : `<p class="np"><b>${esc(d.name)}</b>「${esc(d.text)}」</p>`;
    if (it.type === 'aipc.line') return `<p class="np ai"><b>${esc(d.name)} · AI</b>「${esc(d.text)}」</p>`;
    if (it.type === 'ending') return `<div class="end"><h4>结局 · ${esc(d.name)}</h4><p>${esc(d.text)}</p></div>`;
    const l = lineOf(it, kp); return l ? `<p class="sys">${esc(l.replace(/[`*]/g, ''))}</p>` : '';
  };
  const h = [];
  h.push(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rp.meta.title)} · Replay</title><style>
body{margin:0;background:#0b1416;color:#cfd9d6;font:16px/1.85 "Source Han Serif SC","Noto Serif SC","Songti SC",STSong,SimSun,serif}main{max-width:820px;margin:0 auto;padding:48px 22px 96px}
h1{font-size:30px;letter-spacing:.12em;margin:0 0 6px;color:#f1e6cf}h2{margin:56px 0 14px;font-size:19px;color:#e8b65a;letter-spacing:.2em;border-bottom:1px solid #22393b;padding-bottom:8px}h3{font-size:14px;color:#7d9391;margin:34px 0 8px;letter-spacing:.1em;font-weight:400}
.meta{color:#7d9391;font-size:13px}.pa{color:#f1e6cf;margin:10px 0 4px}.pa b{color:#8fc7c0;font-weight:400}.na{margin:4px 0;text-indent:2em}.ca{margin:6px 0;padding-left:14px;border-left:2px solid #2f4a4c}.ca span{color:#7d9391;font-size:12px;margin-right:8px}
.np{margin:6px 0}.np b{color:#e8b65a;font-weight:400;margin-right:6px}.np.ai b{color:#b9a7d6}.sys{font:12px/1.7 ui-monospace,Consolas,monospace;color:#7d9391;margin:2px 0}
.kp{font:12px/1.75 ui-monospace,Consolas,monospace;color:#c9a45c;background:#141f1f;border-left:2px solid #e8b65a;padding:8px 12px;margin:8px 0;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #1d3032;padding:5px 8px;text-align:left;vertical-align:top}th{color:#7d9391;font-weight:400}
.end{margin:28px 0;padding:18px 20px;border:1px solid #e8b65a55}.end h4{margin:0 0 8px;color:#e8b65a;letter-spacing:.2em}.novel{white-space:pre-wrap}.curve{width:100%;background:#0f1b1d;margin:10px 0}
@media print{body{background:#fff;color:#111}.kp{background:#f5f0e4;color:#553}h1,h2,.pa{color:#111}.curve{background:#fff}}
</style><main>`);
  h.push(`<h1>${esc(rp.meta.title)}</h1><p class="meta">Replay · ${kp ? '掌灯人全知视角' : '玩家视角'}　分支 ${esc(rp.meta.branch)}（${esc(rp.meta.branch_name)}）　${rp.meta.rounds} 轮　${rp.meta.clock_start} → ${rp.meta.clock_end}　结局：${esc(rp.meta.ending)}<br>${rp.meta.seats.map((s) => `${esc(s.name)}（${s.seat === 'ai' ? 'AI' : '人类'}）`).join('、')}　${esc(rp.meta.rulepack)}　种子 ${esc(rp.meta.seed)}　日志验链${rp.meta.chain.ok ? '通过' : '失败'}</p>`);
  h.push('<h2>一　逐轮回放</h2>');
  for (const r of rp.rounds) {
    h.push(`<h3>第 ${r.round} 轮 · ${esc(r.scene)} · ${r.clock}</h3>`);
    for (const it of r.public) h.push(row(it));
    if (kp && r.kp.length) h.push(`<div class="kp">${esc(r.kp.map(kpLine).filter(Boolean).join('\n').replace(/\*\*/g, ''))}</div>`);
  }
  h.push('<h2>二　时间线</h2><table><tr><th>轮</th><th>时间</th><th>地点</th><th>谁</th><th>做了什么</th><th>结果</th></tr>' + rp.timeline.map((t) => `<tr><td>${t.round}</td><td>${t.clock}</td><td>${esc(t.scene)}</td><td>${esc(t.who)}</td><td>${esc(t.what)}</td><td>${esc(t.result)}</td></tr>`).join('') + '</table>');
  h.push(`<h2>三　线索发现率 ${rp.clues.rate}</h2><table><tr><th>线索</th><th>状态</th><th>载体</th><th>经由</th></tr>` + rp.clues.list.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.found ? `第 ${c.round} 轮` : '遗漏'}</td><td>${esc(c.form)}</td><td>${esc(c.by)}</td></tr>`).join('') + '</table>');
  h.push(`<h2>四　骰子日志与数值曲线</h2>${curveSvg(rp)}<p class="meta">共 ${rp.dice.total} 次掷骰；技能检定成功率 ${rp.dice.skill_success_rate ?? '—'}；大成功 ${rp.dice.crits}，大失败 ${rp.dice.fumbles}；逐条重算核对 ${rp.dice.verified}/${rp.dice.total} 一致。</p><table><tr><th>轮</th><th>谁</th><th>事由</th><th>骰面</th><th>值</th><th>对</th><th>结果</th></tr>` + rp.dice.rolls.map((r) => `<tr><td>${r.round}</td><td>${esc(r.pc)}</td><td>${esc(r.label)}</td><td>${r.tens.join('/')}·${r.units}</td><td>${r.value}</td><td>${r.target}</td><td>${esc(r.level)}${r.loss ? ` −${r.loss}` : ''}</td></tr>`).join('') + '</table>');
  h.push('<h2>五　关键抉择点与分支</h2>' + (rp.choices.map((c) => `<p>第 ${c.round} 轮 · ${esc(c.kind)} · ${esc(c.name)} → ${esc(c.taken)}<br><span class="meta">另一条：${esc(c.alternatives.join(' / '))}${c.reachable_before.length ? `　当时仍可达：${esc(c.reachable_before.join('、'))}` : ''}</span></p>`).join('') || '<p class="meta">本分支没有记录到抉择点。</p>'));
  if (kp) h.push('<p class="meta">未走到的分支点：</p>' + rp.unreached.map((u) => `<p>${esc(u.name)} <span class="meta">出现条件 ${esc(u.requires)}；选项 ${esc(u.options.join(' / '))}</span></p>`).join('') + rp.unreached_endings.map((u) => `<p>未达成的结局「${esc(u.name)}」 <span class="meta">${esc(u.conditions.join(' 或 '))}</span></p>`).join(''));
  h.push('<table><tr><th>分支</th><th>来自</th><th>轮数</th><th>线索</th><th>结局</th></tr>' + rp.tree.map((t) => `<tr><td>${esc(t.id)} ${esc(t.name)}</td><td>${t.parent ? `${t.parent.branch} 第 ${t.parent.round} 轮` : '根'}</td><td>${t.rounds}</td><td>${t.clues}</td><td>${esc(t.ending || '未定')}</td></tr>`).join('') + '</table>');
  h.push('<h2>六　NPC 出场记录</h2><table><tr><th>NPC</th><th>出场轮</th><th>台词</th><th>态度变化</th>' + (kp ? '<th>说出口的 / 没说的</th>' : '') + '</tr>' + rp.npcs.map((n) => `<tr><td>${esc(n.name)}</td><td>${n.rounds.join('、') || '—'}</td><td>${n.lines}</td><td>${n.attitude.map((a) => a.value).join(' → ')}</td>${kp ? `<td>${esc(n.shared.join('、') || '无')} / ${esc(n.withheld.join('、') || '无')}</td>` : ''}</tr>`).join('') + '</table>');
  if (kp) {
    h.push('<h2>七　导演决策注解</h2>' + rp.director_notes.map((n) => `<p class="sys">第 ${n.round} 轮｜${esc(n.intent)}｜${esc(n.phase)}　${esc(n.reasons.join('；'))}</p>`).join(''));
    h.push(`<h3>退化检测报告</h3><p>${esc(rp.degradation.verdict)}</p><table><tr><th>轮次窗</th><th>叙述段</th><th>平均字数</th><th>基调词密度</th><th>报警</th><th>重写</th></tr>` + rp.degradation.windows.map((w) => `<tr><td>${w.window}</td><td>${w.narrations}</td><td>${w.avg_chars}</td><td>${w.tone_density}</td><td>${esc(Object.entries(w.alerts).map(([k, v]) => `${k}×${v}`).join(' ') || '—')}</td><td>${w.rewrites}</td></tr>`).join('') + '</table>');
    h.push(`<h3>隔离与成本审计</h3><p>交给演员的上下文 ${rp.isolation.contexts} 份，命中真相层金丝雀 ${rp.isolation.leaks} 份；被拒绝的状态提案 ${rp.isolation.rejected_proposals} 份；AI 席位发言占比 ${(rp.speech.ai_share * 100).toFixed(1)}%（配额 ${(rp.speech.quota * 100).toFixed(0)}%）。</p>`);
  }
  h.push(`<h2>八　记录稿</h2>${rp.novel_polished ? `<h3>小说体（模型润色）</h3><p class="meta">共 ${rp.novel_polished.sections} 节，${rp.novel_polished.polished} 节润色并通过校验，${rp.novel_polished.kept} 节保留原文。</p><div class="novel">${esc(rp.novel_polished.text)}</div><h3>原始记录（按日志拼接，未润色）</h3>` : ''}<div class="novel">${esc(rp.novel)}</div><h2>九　全量数据</h2><p class="meta">同名 JSON 文件含日志、快照与状态，可再导入续团。本页用浏览器「打印 → 另存为 PDF」即得 PDF。</p></main></html>`);
  return loc(h.join('\n'), rp.terms);
}

// 角色卡导出（Markdown）
export function sheetsMarkdown(session) {
  const s = session.s, rp = session.rp; const o = [`# 角色卡 · ${session.title}`, ''];
  for (const p of Object.values(s.pcs)) {
    o.push(`## ${p.name}（${p.role}，${p.seat === 'ai' ? 'AI 席位' : '人类席位'}）`, '', `- ${rp.terms.hp} ${p.hp}/${p.hpMax}　${rp.terms.mind} ${p.mind}/${p.mindMax}　状态 ${p.status}`, `- 属性：${rp.attributes.map((a) => `${a.name} ${p.attrs[a.id]}`).join('、')}`, `- 技能：${rp.skills.filter((k) => p.skills[k.id] !== k.base).map((k) => `${k.name} ${p.skills[k.id]}${p.ticked.includes(k.id) ? '✓' : ''}`).join('、')}`, `- 物品：${p.items.join('、') || '无'}`, `- 背景：${p.background}`, `- 执念：${p.drive}`, `- 恐惧源：${p.fear}`, `- 关系：${p.relations}`, p.conditions.length ? `- ${rp.terms.disorder}：${p.conditions.map((c) => c.text).join('；')}` : '', '');
  }
  return o.filter((x) => x !== '').join('\n\n').replace(/\n\n- /g, '\n- ');
}

export function stateMarkdown(session) {
  const s = session.s, spec = session.specForKp; const o = [`# 状态库快照 · ${session.title}`, '', `- 分支 ${session.current}　第 ${s.round} 轮　${fmtClock(s.clock)}　场景 ${spec.scenes.find((x) => x.id === s.scene).name}　相位 ${PHASE_NAME[s.phase]}`, `- 结局：${s.ending ? spec.endings.find((e) => e.id === s.ending.id).name : '未定'}`, '', '## 寻访者', ''];
  for (const p of Object.values(s.pcs)) o.push(`- ${p.name}：体魄 ${p.hp}/${p.hpMax}，定力 ${p.mind}/${p.mindMax}，物品 ${p.items.join('、')}`);
  o.push('', '## 线索', ''); for (const c of spec.clues) o.push(`- ${s.clues[c.id].found ? '✓' : '·'} ${c.name}${s.clues[c.id].found ? `（第 ${s.clues[c.id].round} 轮）` : ''}`);
  o.push('', '## NPC', ''); for (const n of spec.npcs) o.push(`- ${n.name}：在 ${spec.scenes.find((x) => x.id === s.npcs[n.id].at)?.name}，态度 ${s.npcs[n.id].attitude}，情绪 ${s.npcs[n.id].mood}`);
  o.push('', '## flag', '', Object.entries(s.flags).map(([k, v]) => `- ${k} = ${v}`).join('\n') || '（无）', '', '## 已确立的即兴事实', '', s.facts.map((f) => `- ${f.id}（第 ${f.round} 轮）${f.text}`).join('\n') || '（无）');
  return loc(o.join('\n'), session.rp.terms);
}
