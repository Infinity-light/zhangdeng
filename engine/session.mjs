// 一局团。把各层串起来：玩家行动 → L3 导演层出导演单 → L2 规则引擎掷骰 → L1 状态库落库 →
// L4/L5 演员池按视图出文字 → 三道闸 → L6 只追加日志。
// 导演层是确定性代码，持有完整 spec；演员池只拿切片。两边通过「视图」这一种数据交接。
import { Rng } from './rng.mjs';
import * as R from './rules.mjs';
import { Branch, initialState, visibleTo } from './store.mjs';
import { splitSpec, canaries, auditContext } from './views.mjs';
import { ActorPool } from './actors.mjs';
import { inspect, strip, consistency } from './guard.mjs';
import { fmtClock, FOE_RE, foeHint } from './compiler.mjs';

const PHASES = ['explore', 'investigate', 'press', 'confront', 'reveal', 'wrap'];
export const PHASE_NAME = { explore: '探索', investigate: '调查', press: '加压', confront: '对抗', reveal: '揭示', wrap: '收束' };
const PHASE_ID = Object.fromEntries(Object.entries(PHASE_NAME).map(([k, v]) => [v, k]));
const BUDGET = { explore: 1, investigate: 2, press: 2, confront: 1, reveal: 2, wrap: 0 };
const TIER = { 普通: 'regular', 困难: 'hard', 极难: 'extreme' };
const PROBE_RE = /凶手|真相|幕后|谜底|结局是|剧透|到底是谁干的|直接告诉我|是谁杀|怎么回事.{0,4}直接说|你是.{0,3}(AI|人工智能|模型|机器人)|忽略.{0,8}(指令|设定|以上|规则)|系统提示|提示词|prompt|模组里|主持人.{0,4}告诉|把.{0,6}(设定|秘密|真实身份).{0,4}(说|告诉|念)/i;
const FORCE_RE = /撬|砸|踹|撞|硬来|强行|机巧|开锁|别开|拧开|弄开/;
const intent0 = (sheet) => sheet.intent || {};
// 再看一遍已经查过的东西时，把上回看到的头两句带一下（「铁门还是刚才的样子」不说门已经开了，玩家会以为还锁着）；会掉理智的那种不重提
const gistOf = (it) => { if (it.mind || !it.text) return ''; const m = String(it.text).match(/[^。！？]+[。！？]/g) || []; const g = m.slice(0, 2).join('').trim(); return g ? `上回看到的是：${g}` : ''; };
const LOOK_RE = /四处(看|转|瞧|张望)|四下(看|张望|打量)|环顾|看看(周围|四周|这里|附近)|打量(四周|周围|这里)|(这里|这儿|周围|附近)(还)?有(什么|些什么|啥)|观察(四周|周围|环境)/;
const MOVE_RE = /去|前往|走到|回到|回|到|进|赶往|跑向|离开/;
const SAY_RE = /问|说|告诉|喊|叫|打听|请教|聊|对.{1,6}讲|「|“|"/;
const DEFAULT_CFG = { offTrackN: 3, timeScale: 1, aiInitiative: 60, aiQuota: 0.34, aiToAi: false, contentLevel: 'full', recentN: 3, useModel: true };
const clone = (o) => JSON.parse(JSON.stringify(o));
const mods = (c) => ({ bonus: c?.bonus || 0, penalty: c?.penalty || 0 });

export class Session {
  constructor({ id, spec, rp, config = {}, branches, current, tokens, llm, created, title }) {
    this.id = id; this.rp = rp; this.cfg = { ...DEFAULT_CFG, ...config };
    const parts = splitSpec(spec);
    this.#spec = parts.director;                         // 只有导演层方法能碰
    this.pool = new ActorPool({ world: parts.world, npcCards: parts.npcCards, pcCards: parts.pcCards }, llm);
    this.world = parts.world; this.npcCards = parts.npcCards; this.pcCards = parts.pcCards;
    this.branches = branches; this.current = current; this.tokens = tokens; this.created = created || Date.now(); this.title = title || spec.meta.title;
    this.T = rp.terms;
    this.busy = false; this.saves = [];
  }
  #spec;

  static create({ id, spec, rp, seats, seed, config, llm, tokens }) {
    const state = initialState(spec, rp, { seats, seed });
    const b = new Branch({ id: 'main', state, name: '主线' });
    const s = new Session({ id, spec, rp, config: { ...config, seed, seats }, branches: { main: b }, current: 'main', tokens, llm });
    b.append('session.start', { title: spec.meta.title, rulepack: rp.id, seed, seats, spec_summary: { scenes: spec.scenes.length, clues: spec.clues.length, npcs: spec.npcs.length } });
    b.append('canon', { kind: 'opening', text: spec.meta.opening });
    const sc = spec.scenes.find((x) => x.id === state.scene);
    b.append('canon', { kind: 'scene', scene: sc.id, title: sc.name, text: sc.public_desc });
    b.snapshot('开团');
    return s;
  }

  get b() { return this.branches[this.current]; }
  get s() { return this.b.state; }
  get specForKp() { return this.#spec; }
  scene(id = this.s.scene) { return this.#spec.scenes.find((x) => x.id === id); }
  clueDef(id) { return this.#spec.clues.find((c) => c.id === id); }
  npcDef(id) { return this.#spec.npcs.find((n) => n.id === id); }

  // ------------------------------------------------------------------ 规则引擎的调用口
  #withRng(fn) { const rng = Rng.restore(this.s.rng); const out = fn(rng); this.s.rng = rng.snapshot(); return out; }
  #flavor() { const rng = Rng.restore(this.s.flavor); const v = rng.next(); this.s.flavor = rng.snapshot(); return v; }

  rollSkill(pcId, skillName, tierName, label, vis, extra = {}) {
    const pc = this.s.pcs[pcId]; const sid = R.skillIdOf(this.rp, skillName) || skillName;
    const aid = this.rp.skillById[sid] ? null : R.attrIdOf(this.rp, skillName);   // 「力量检定」这类直接掷属性
    const res = this.#withRng((rng) => R.skillCheck(this.rp, rng, { skill: aid ? pc.attrs[aid] : pc.skills[sid] ?? this.rp.skillById[sid]?.base ?? 10, tier: TIER[tierName] || tierName || 'regular', ...extra }));
    const ev = this.b.append('dice.roll', { pc: pcId, label, skillId: sid, skillName: this.rp.skillById[sid]?.name || (aid ? this.rp.attributes.find((a) => a.id === aid).name : skillName), tierName: this.rp.check.tiers[res.tier].name, levelName: this.rp.check.levels[res.level], rngDraws: this.s.rng.draws, ...res }, { actor: 'rules', vis });
    if (res.success && this.rp.skillById[sid]) this.b.propose('engine', [{ op: 'skill.tick', pc: pcId, skill: sid }], '检定成功，勾选成长', 'kp');
    return { ...res, seq: ev.seq };
  }

  rollMind(pcId, loss, label, vis) {
    const pc = this.s.pcs[pcId]; if (!pc || pc.status !== 'ok') return null;
    const res = this.#withRng((rng) => R.mindCheck(this.rp, rng, { current: pc.mind, lossSuccess: loss.success, lossFail: loss.fail, int: pc.attrs.int, dayStart: pc.mindDayStart, dayLost: pc.mindDayLost }));
    const ev = this.b.append('dice.roll', { pc: pcId, label, mindName: this.T.mind, levelName: res.success ? (this.rp.mind.pass || '稳住了') : (this.rp.mind.fail || '没稳住'), rngDraws: this.s.rng.draws, ...res }, { actor: 'rules', vis });
    const ops = []; if (res.loss) ops.push({ op: 'mind.delta', pc: pcId, value: -res.loss, rollRef: ev.seq });
    if (res.disorder) { ops.push({ op: 'pc.condition', pc: pcId, type: res.disorder.type, text: res.disorder.text, until: res.disorder.rounds ? this.s.round + res.disorder.rounds : null }); if (res.disorder.type === 'permanent') ops.push({ op: 'pc.status', pc: pcId, value: 'lost' }); }
    if (ops.length) this.b.propose('engine', ops, `${this.T.mind}检定（${label}）`, vis);
    return { ...res, seq: ev.seq };
  }

  condOk(cond) {
    const s = this.s; if (!cond) return true;
    return cond.every((a) => {
      let v = false;
      if (a.t === 'flag') v = !!s.flags[a.k];
      else if (a.t === 'clue') v = !!s.clues[a.k]?.found;
      else if (a.t === 'item') v = Object.values(s.pcs).some((p) => p.items.includes(a.k));
      else if (a.t === 'scene') v = s.scene === a.k;
      else if (a.t === 'time') v = a.op === '>=' ? s.clock >= a.v : s.clock < a.v;
      return a.neg ? !v : v;
    });
  }

  // ------------------------------------------------------------------ L3 导演层
  classify(text, pcId) {
    const s = this.s, sc = this.scene(), spec = this.#spec; const t = text.trim();
    const out = { kind: 'free', probe: PROBE_RE.test(t) };
    // 问句不是决定：「黄纸上的字，是封井的咒语？」「要不要封井？」是在琢磨、在商量，不能当成已经动手——关键抉择只认陈述
    const asking = /[?？]$|吗|是不是|要不要|该不该|会不会|能不能|难道/.test(t);
    if (!asking) for (const kc of spec.key_choices) if (this.condOk(kc.requires)) for (const o of kc.options) if (o.keywords.some((k) => t.includes(k))) { out.choice = { id: kc.id, name: kc.name, option: o }; }
    const names = (n) => [n.name, ...n.aliases].filter((x) => t.includes(x)).sort((a, b) => b.length - a.length)[0];
    const npcsHere = spec.npcs.filter((n) => s.npcs[n.id].at === s.scene);
    // 一句话里提到几个在场的人时（「问柳三婶：族长藏了什么」），对话的对象是最先被叫到的那一个，不是 spec 里排在前面的那一个
    const named = npcsHere.filter((n) => names(n)).sort((a, b) => t.indexOf(names(a)) - t.indexOf(names(b)))[0]; const namedElsewhere = spec.npcs.find((n) => s.npcs[n.id].at !== s.scene && names(n));
    const ai = Object.values(s.pcs).find((p) => p.seat === 'ai' && p.id !== pcId && (t.includes(p.name) || (p.role.includes('记者') && t.includes('记者'))));
    const targetScene = spec.scenes.find((x) => x.id !== s.scene && [x.name, ...x.aliases].some((a) => t.includes(a)));
    // 动身的两种说法：动词在前、地名在后（「去后山枯井」「回祠堂看看」）；或者整句话差不多就是那个地名（「后山枯井」「灯塔那边」）。
    // 「泥是井底的。」「布鞋在祠堂里。」只是话里带到了地名；「找到」「回答」「进来了」里的到、回、进也不是要走。
    const alias = targetScene ? [targetScene.name, ...targetScene.aliases].filter((a) => t.includes(a)).sort((a, b) => b.length - a.length)[0] : '';
    const tv = t.replace(/找到|看到|听到|想到|闻到|摸到|直到|回答|回话|回头|回声|回想|进来|进去的|到底/g, '〇〇'); const mv = MOVE_RE.exec(tv);
    const goes = !!(targetScene && mv && mv.index < tv.indexOf(alias));
    const bare = !!(targetScene && !/[?？]|吗|呢|么|是不是|会不会|难道/.test(t) && t.replace(/[，。,.！!…\s]/g, '').length <= alias.length + 3);
    let it = null, best = 0;
    // 一句话里带到几样东西时（「到灯室，撬开油柜灌满鲸油」）：先比最长的那个叫法，一样长就看谁被说到的次数多，再一样就让还没查完的优先
    let hits = 0, fresh = false;
    for (const i of sc.interactables) { const ks = i.keywords.filter((k) => t.includes(k)); if (!ks.length) continue; const len = Math.max(...ks.map((k) => k.length)), fr = s.examined[`${sc.id}.${i.id}`] !== 'done';
      if (len > best || (len === best && (ks.length > hits || (ks.length === hits && fr && !fresh)))) { it = i; best = len; hits = ks.length; fresh = fr; } }
    // 已经查过的东西：只有明说「再看 / 再查 / 翻」才算重复调查；只是话里带到它（「跟旁边的赌客聊聊天气」「数一数桌上的筹码」）按自由行动走，由叙述层接住，而不是一遍遍回「没有新的东西」
    if (it && s.examined[`${sc.id}.${it.id}`] === 'done' && !/看|查|翻|搜|检|瞧|找|摸|照|观察|打量|端详|研究/.test(t)) { it = null; best = 0; }
    // 开口先叫了人（「柳伯年，牌位上的新漆怎么回事？」）就是在对他说话，哪怕话里带到了一样东西
    const hailed = named && new RegExp('^' + names(named).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[，,：:、！!？? ]').test(t);
    // 开口先叫的是同桌的人（「陆衡，这铁门能打开吗？」）：是桌上的商量，不是对 NPC 说话，也不是调查。叫的是 AI 席位就请它接话；叫的是人类席位，等那位玩家自己回答。
    const mate = Object.values(s.pcs).find((p) => p.id !== pcId && new RegExp('^' + p.name + '[，,：:、！!？? ]').test(t));
    if (mate && !out.choice) { if (mate.seat === 'ai') { out.kind = 'ask_ai'; out.ai = mate.id; } else { out.kind = 'party'; out.mate = mate.id; } return out; }
    if (named && (hailed || SAY_RE.test(t) || !it)) { out.kind = 'talk'; out.npc = named.id; }
    else if (ai && !it && !targetScene) { out.kind = 'ask_ai'; out.ai = ai.id; }
    else if (targetScene && goes && !(it && best >= 3)) { out.kind = 'move'; out.to = targetScene.id; }
    else if (it) { out.kind = 'examine'; out.it = it.id; }
    // 话里只是带到了别处的名字（「瓢底的泥是井里的？」）不等于要动身：没有动词时，只有短短一句、且不是问句，才当成「去那儿」
    else if (targetScene && bare) { out.kind = 'move'; out.to = targetScene.id; }
    else if (npcsHere.length === 1 && /「|“|"/.test(t)) { out.kind = 'talk'; out.npc = npcsHere[0].id; }
    else if (namedElsewhere) { out.kind = 'absent'; out.npc = namedElsewhere.id; }
    if (out.kind === 'examine' && !named && npcsHere.length && /(说|问|告诉|请教|打听)[:：，, ]|跟.{1,12}(说|讲|商量)|对.{1,12}(说|讲)/.test(t)) out.unsure = true;
    if (out.choice?.option.set_flag) out.kind = 'choice';
    return out;
  }

  // 意图辅助：关键词规则认不出时，请模型在「此刻公开可见的选项」里选一个。它只看得到公开的名字，输出只能是选项之一，认不出就按自由行动处理。
  async #assist(intent, text, ctx) {
    const llm = this.pool.llm; if (!llm?.enabled || !this.cfg.useModel || intent.probe || intent.choice) return;
    const s = this.s, sc = this.scene(), spec = this.#spec; const can = canaries(spec, s);
    const ask = async (system, user, who) => {
      const audit = auditContext('intent', system + '\n' + user, can, [text]);
      let out = null, src = 'offline', ms = 0, fallback = null;
      try { const r = await llm.complete({ role: 'intent', system, user, maxTokens: 60, temperature: 0, timeoutMs: 6000, maxWaitMs: 1500 }); out = r.text; src = r.provider; ms = r.ms; } catch (e) { fallback = String(e.message).slice(0, 80); }
      this.b.append('context.audit', { role: 'intent', who, chars: audit.chars, leak: audit.leak, hits: audit.hits, source: src, ms, fallback }, { actor: 'isolation', vis: 'kp' });
      return out;
    };
    if (intent.kind === 'party') return;
    if (intent.kind === 'free' || intent.unsure) {
      const keep = { kind: intent.kind, it: intent.it };
      const things = sc.interactables.filter((i) => i.obvious || this.condOk(i.requires)); const people = spec.npcs.filter((n) => s.npcs[n.id].at === s.scene); const places = spec.scenes.filter((x) => x.id !== s.scene);
      // 这位玩家自己已经到手的线索（只有名字和它当时是以什么样子出现的），好让「看看手里的纸条」认得出是在重看哪一条
      const known = spec.clues.filter((c) => s.clues[c.id].found && s.clues[c.id].knownBy.includes(ctx.pcId)).map((c) => ({ c, form: c.carriers.filter((k) => s.clues[c.id].carriersUsed.includes(k.id)).map((k) => k.form).filter(Boolean)[0] || '' }));
      const out = await ask('你是意图分类器。把玩家的一句话归到下面某一项，只输出一行 JSON，不要解释。可选：{"kind":"examine","target":"东西的名字"}、{"kind":"talk","target":"人的名字"}、{"kind":"move","target":"地点的名字"}、{"kind":"recall","target":"线索的名字"}、{"kind":"none"}。只有当这句话明确是在查看、翻动、使用列表里的某样东西，对列表里的某个人说话，要动身去列表里的某个地点，或是在重看、琢磨「已到手的线索」里的某一条（比如拿在手里的纸、捡到的东西）时才归类；只是提到地点、并没有说要去的，不算 move；发呆、吃喝、唱歌、闲逛、做列表以外的事，一律 none。「此地」的描述只是帮你听懂玩家指的是哪一样；描述里提到、但不在「东西」列表里的物件（墙上的钟、炭盆、灯之类），一律 none，不要硬凑到别的东西上。target 必须原样取自列表里顿号分开的名字，不带括号里的说明。', `此地：${sc.public_desc}
东西：${things.map((i) => i.name).join('、') || '无'}
人：${people.map((n) => `${n.name}（${n.public_identity}）`).join('、') || '无'}
地点：${places.map((x) => x.name).join('、')}
已到手的线索：${known.map((k) => k.c.name + (k.form ? `（${k.form}）` : '')).join('、') || '无'}
玩家的话：${text}`, 'action');
      let j = null; try { j = JSON.parse((/\{[^}]*\}/.exec(out || '') || [])[0]); } catch { /* 认不出就算了 */ }
      if (!j || !j.target) { if (intent.unsure) Object.assign(intent, keep); }
      else {
      const tgt = String(j.target).replace(/（.*$/, '').trim();
      const it = j.kind === 'examine' && things.find((i) => i.name === tgt), npc = j.kind === 'talk' && people.find((n) => n.name === tgt), to = j.kind === 'move' && places.find((x) => x.name === tgt), cl = j.kind === 'recall' && !intent.unsure && known.find((k) => k.c.name === tgt);
      if (intent.unsure && !npc) { /* 拿不准的那种，只有辅助明确说是在对人说话才改判 */ }
      else if (it) { intent.kind = 'examine'; intent.it = it.id; intent.assisted = tgt; } else if (npc) { intent.kind = 'talk'; intent.npc = npc.id; delete intent.it; intent.assisted = tgt; } else if (to) { intent.kind = 'move'; intent.to = to.id; intent.assisted = tgt; } else if (cl) { intent.kind = 'recall'; intent.clue = cl.c.id; intent.assisted = tgt; }
      if (intent.assisted) ctx.reasons.push(`关键词规则没认出这句话，意图辅助把它归为「${({ examine: '调查', talk: '交谈', move: '前往', recall: '重看线索' })[intent.kind]}：${j.target}」（模型只看到了公开可见的选项）`);
      }
    }
    if (intent.kind === 'talk') {
      const def = this.npcDef(intent.npc); if (def.knowledge.some((k) => k.topics.some((t) => text.includes(t)))) return;
      const list = def.knowledge.filter((k) => k.share !== 'never'); if (!list.length) return;
      const out = await ask('你是话题分类器。判断玩家这句话是在问下面哪一件事，只输出一个编号；都不是就输出 0。不要解释。', `${list.map((k, i) => `${i + 1}. ${k.title}`).join('\n')}
玩家的话：${text}`, def.id);
      const n = Number((/\d+/.exec(out || '') || [])[0]); if (n >= 1 && n <= list.length) { intent.topic = list[n - 1].id; ctx.reasons.push(`话题辅助：这句话在问「${list[n - 1].title}」`); }
    }
  }

  lockedIds() { return this.#spec.truth.never_reveal.filter((nr) => !nr.unlock || !this.s.clues[nr.unlock]?.found).map((nr) => nr.id); }

  pickFallback() {
    const s = this.s;
    for (const c of this.#spec.clues) {
      if (!c.key || s.clues[c.id].found) continue;
      const car = c.carriers.find((k) => k.via === '事件' && k.text && (k.where === 'any' || k.where === s.scene) && this.condOk(k.when) && !s.clues[c.id].carriersUsed.includes(k.id));
      if (car) return { clue: c, carrier: car };
    }
    // 没有可用的事件型载体时：在场的 NPC 里，谁手里有一条「肯说」的关键线索，就由他自己开口（NPC 主动行动，而不是凭空造事件）
    for (const c of this.#spec.clues) {
      if (!c.key || s.clues[c.id].found) continue;
      for (const n of this.#spec.npcs) {
        const ns = s.npcs[n.id]; if (ns.at !== s.scene) continue;
        const k = n.knowledge.find((x) => x.gives_clue === c.id && x.share !== 'never' && !ns.said.includes(x.id) && (x.share === 'free' || ns.attitude >= x.trust_min) && x.say);
        const car = k && c.carriers.find((y) => y.id === k.carrier);
        if (k && car) return { clue: c, carrier: car, npc: n, know: k };
      }
    }
    return null;
  }

  // 一句话是不是在说某条已经到手的线索：拿线索名和它实际送达时的载体名里的二字词去对（「三只布鞋」→ 布鞋；「一页被风带出来的纸」不含实词二字组就对不上，宁缺毋滥）
  #words(src, set = new Set()) { const place = this.#spec.scenes.map((x) => x.name).join(' '); for (let i = 0; i + 1 < src.length; i++) { const w = src.slice(i, i + 2); if (/^[\u4e00-\u9fff]{2}$/.test(w) && !/[的一了在是被上里个只张那这来去出页]/.test(w) && !place.includes(w)) set.add(w); } return set; }
  useTarget(text) {
    const s = this.s, sc = this.scene(); const held = new Set(Object.values(s.pcs).flatMap((p) => p.items));
    for (const it of sc.interactables) {
      if (s.examined[`${sc.id}.${it.id}`] === 'done') continue;
      const need = (it.requires || []).filter((c) => c.t === 'item' && !c.neg && held.has(c.k)); if (!need.length || !this.condOk(it.requires)) continue;
      if (need.some((c) => [...this.#words(c.k)].some((w) => text.includes(w)))) return it;
    }
    return null;
  }
  recallClue(text, pcId) {
    const s = this.s; let best = null, score = 0;
    for (const c of this.#spec.clues) {
      const st = s.clues[c.id]; if (!st?.found || !st.knownBy.includes(pcId)) continue;
      const words = new Set(); for (const src of [c.name, ...c.carriers.filter((k) => st.carriersUsed.includes(k.id)).map((k) => k.form || '')]) this.#words(src, words);
      let n = 0; for (const w of words) if (text.includes(w)) n++;
      if (n > score) { best = c; score = n; }
    }
    return best;
  }

  pickLead() {
    const s = this.s, spec = this.#spec; const ok = (c) => c.neg ? !this.condOk([{ ...c, neg: false }]) : this.condOk([c]);
    for (const kc of spec.key_choices) {
      if (s.flags['__chose_' + kc.id]) continue; const rq = kc.requires || []; const at = rq.find((c) => c.t === 'scene' && !c.neg); const rest = rq.filter((c) => c.t !== 'scene');
      if (!at || at.k === s.scene || !rest.length || !rest.every(ok)) continue; const scene = this.scene(at.k); if (!scene) continue;
      return { scene, item: true, why: `「${kc.name}」要用的东西已经在手里，但人不在地方`, text: `你们手里的东西，在这里派不上用场。${scene.name}那边，或许用得上。` };
    }
    for (const c of spec.clues) {
      if (!c.key || s.clues[c.id].found) continue;
      const car = c.carriers.find((k) => k.where && k.where !== 'any' && k.where !== s.scene && this.condOk(k.when)); const scene = car && this.scene(car.where);
      if (scene) return { scene, why: `关键线索「${c.name}」还没人碰，它在别处`, text: `这里一时查不出更多了。${scene.name}那边，还有你们没看过的东西。` };
    }
    return null;
  }

  nextBeat(press) {
    const s = this.s, sc = this.scene(); const pool = press ? [...sc.press_beats, ...sc.beats] : sc.beats; if (!pool.length) return '';
    let used = (s.beatsUsed[sc.id] ||= []);
    let pick = pool.find((x) => !used.includes(x));
    if (!pick) { const last = used[used.length - 1]; used = s.beatsUsed[sc.id] = []; pick = pool.find((x) => x !== last) || pool[0]; }
    used.push(pick); return pick;
  }

  memorySummary() {
    const s = this.s; const names = Object.keys(s.visited).map((id) => this.scene(id)?.name).filter(Boolean);
    const known = Object.entries(s.clues).filter(([, c]) => c.found && c.knownBy.length === Object.keys(s.pcs).length).map(([id]) => this.clueDef(id).name);
    // 事实卡：只带此地的和最近的几条，不带全部
    const facts = [...new Set([...s.facts.filter((f) => f.scene === s.scene).slice(-3), ...s.facts.slice(-2)])].map((f) => f.text);
    return `已到过：${names.join('、')}。已掌握：${known.join('、') || '无'}。${facts.length ? '已确立的即兴事实：' + facts.join('；') + '。' : ''}`;
  }
  #material() { const s = this.s, sc = this.scene(); return this.world.constitution.immutable_facts.join('') + this.world.constitution.tone + sc.public_desc + sc.beats.join('') + sc.press_beats.join('') + sc.interactables.filter((i) => i.obvious).map((i) => i.name).join('') + Object.values(s.pcs).map((p) => p.name + p.role).join('') + Object.entries(s.npcs).filter(([, n]) => n.at === s.scene).map(([id]) => this.world.npcs[id].name + this.world.npcs[id].public_identity).join('') + this.#spec.scenes.map((x) => x.name).join('') + s.facts.filter((f) => f.scene === s.scene).map((f) => f.text).join(''); }
  recentNarr(n = this.cfg.recentN) { return this.b.log.filter((e) => e.type === 'narration' && e.vis === 'public').slice(-n).map((e) => e.data.text); }
  witness(text) { for (const [id, n] of Object.entries(this.s.npcs)) if (n.at === this.s.scene) { n.memory.push(`${fmtClock(this.s.clock)} ${text}`); if (n.memory.length > 8) n.memory.shift(); } }

  // ------------------------------------------------------------------ 生成 + 三道闸
  async gen(role, view, { who, banned = [], playerTexts = [], maxLen = 260, material = '' } = {}) {
    const spec = this.#spec; const can = canaries(spec, this.s);
    const run = async (v) => {
      const r = await this.pool.generate(role, v, { useModel: this.cfg.useModel });
      const audit = auditContext(role, r.prompt.system + '\n' + r.prompt.user, can, playerTexts);
      this.b.append('context.audit', { role, who, chars: audit.chars, leak: audit.leak, hits: audit.hits, source: r.source, ms: r.ms || 0, fallback: r.fallback || null, usage: r.usage || null }, { actor: 'isolation', vis: 'kp' });
      return r;
    };
    const check = (text) => {
      const v = inspect(text, { locked: can.filter((c) => c.kw.length <= 12), banned, maxLen, recent: role === 'narrator' ? this.recentNarr(5) : [] });
      if (role === 'narrator') v.push(...consistency(text, { presentNames: [], allNpcNames: spec.npcs.map((n) => n.name), material: material + view.actionText + view.beat }));
      return v;
    };
    let r = await run(view); if (!r.text) return { text: '', source: r.source };
    let v = check(r.text), action = 'pass';
    if (v.length && r.source !== 'offline') {
      const r2 = await run({ ...view, retry: [...new Set(v.map((x) => `${x.type}「${x.match}」`))].join('、') });
      const v2 = check(r2.text);
      if (!v2.length) { action = 'rewrite'; r = r2; }
      else { const st = strip(r2.text, v2); if (st.length >= 12 && !check(st).length) { action = 'strip'; r = { ...r2, text: st }; } else { action = 'offline'; const off = await this.pool.generate(role, view, { useModel: false }); r = { ...off, source: 'offline' }; } }
    }
    if (v.length) this.b.append('guard.alert', { role, who, violations: v, action, sample: action === 'pass' ? r.text.slice(0, 60) : undefined }, { actor: 'guard', vis: 'kp' });
    return { text: r.text, source: r.source, action };
  }

  // ------------------------------------------------------------------ 一轮
  async act({ pc: pcId, text, secret = false }) {
    // 几个人同时出手时按到达顺序排队，一轮一轮来；排得太长（同时等着 6 个以上）才拒绝
    if ((this.waiting || 0) >= 6) throw new Error('同时出手的人太多了，稍等一下再试');
    this.waiting = (this.waiting || 0) + 1;
    const run = (this.tail || Promise.resolve()).catch(() => {}).then(async () => { this.busy = true; try { return await this.#round(pcId, String(text || '').slice(0, 300), secret); } finally { this.busy = false; this.waiting -= 1; } });
    this.tail = run; return run;
  }

  async #round(pcId, text, secret) {
    const b = this.b, s = this.s, spec = this.#spec; const pc = s.pcs[pcId];
    if (!pc) throw new Error('没有这个席位');
    if (pc.status !== 'ok') throw new Error(`${pc.name} 已无法行动`);
    if (!text.trim()) throw new Error('说点什么，或者做点什么');
    s.round += 1; const startSeq = b.seq;
    const vis = secret ? { seats: [pcId] } : 'public';
    b.append('player.action', { pc: pcId, name: pc.name, text, secret }, { actor: pcId, vis });
    s.speech.human += 1;
    for (const p of Object.values(s.pcs)) p.conditions = p.conditions.filter((c) => c.until == null || c.until >= s.round);

    const ctx = { pcId, pc, text, vis, secret, isAi: false, canon: [], npcJob: null, aiJob: null, clueThisRound: [], budget: BUDGET[s.phase], used: 0, reasons: [], minutes: 10, main: false, kind: 'free', target: '' };
    const sheet = { round: s.round, scene: s.scene, scene_name: this.scene().name, goal: this.scene().goal, phase_in: s.phase, info_budget: { max_clues: ctx.budget }, forbidden: this.lockedIds(), wake_npcs: [], checks: [], reveal: [], fallback: null, triggers: [], reasons: ctx.reasons };

    if (s.ending) { ctx.kind = 'wrap'; ctx.minutes = 0; sheet.intent = { class: 'wrap', kind: 'wrap' }; ctx.reasons.push('结局已定，只做收束叙述，不再推进状态'); }
    else {
      const intent = this.classify(text, pcId); sheet.intent = intent; ctx.intent = intent;
      await this.#assist(intent, text, ctx);
      // 没认出来的话，如果说的是一条已经到手的线索（「看纸条上的名字」「摸摸布鞋的湿处」），就把那条线索再给他看一遍，而不是只回一句衔接
      // 「试试钥匙」「把钥匙插进去」：话里说的是手里的一样东西，而此地正好有一处要用它、还没打开——就是去用它
      if (intent.kind === 'free' && !intent.probe && !intent.choice) { const it = this.useTarget(text); if (it) { intent.kind = 'examine'; intent.it = it.id; intent.used_item = true; ctx.reasons.push(`话里说的是手里的东西，此地的「${it.name}」正要用它：按「用它」处理`); } }
      if (intent.kind === 'free' && !intent.probe && !intent.choice) { const c = this.recallClue(text, pcId); if (c) { intent.kind = 'recall'; intent.clue = c.id; } }
      // 「四处看看」「这里还有什么」：把此地看得见的东西、在场的人、能去的地方再数一遍
      if (intent.kind === 'free' && !intent.probe && !intent.choice && LOOK_RE.test(text)) intent.kind = 'look';
      if (intent.choice) { s.flags['__chose_' + intent.choice.id] = s.round; b.append('choice', { choice: intent.choice.id, name: intent.choice.name, option: intent.choice.option.id, label: intent.choice.option.label, by: pcId }, { actor: pcId, vis }); ctx.reasons.push(`命中关键抉择「${intent.choice.name}」→ ${intent.choice.option.label}`); }
      this.#resolve(ctx, intent, sheet);
    }

    // 时间、跑偏计数
    const minutes = Math.round(ctx.minutes * this.cfg.timeScale);
    if (minutes) b.propose('engine', [{ op: 'clock.advance', value: minutes }], '行动耗时', 'kp');
    if (!s.ending) {
      const cls = sheet.intent.probe ? 'probe' : ctx.main ? 'main' : (this.scene().kind === 'side' && ctx.kind !== 'party') || ['free', 'absent'].includes(ctx.kind) ? 'off' : 'side';
      sheet.intent.class = cls; sheet.intent.class_name = { main: '顺主线', side: '侧支', off: '跑偏', probe: '试探边界' }[cls];
      // 对着 NPC 套话不算跑偏（人还在主线的人和事上）；对着空处索要答案、做无关的事才算
      if (cls === 'main') { s.offTrack = 0; } else if (cls === 'off' || (cls === 'probe' && ['free', 'absent'].includes(ctx.kind))) s.offTrack += 1;
      s.stall = ctx.clueThisRound.length ? 0 : s.stall + 1;
      // 柔性补线：不拦、不否决，把同一条线索换一种载体送到玩家脚边
      if (!ctx.clueThisRound.length && ctx.kind !== 'move' && (s.offTrack >= this.cfg.offTrackN || s.stall >= this.cfg.offTrackN * 2)) {
        const fb = this.pickFallback();
        if (fb) {
          const why = s.offTrack >= this.cfg.offTrackN ? `连续 ${s.offTrack} 轮跑偏` : `连续 ${s.stall} 轮没有新线索`;
          if (fb.npc) {
            const ns = s.npcs[fb.npc.id]; ns.met = true; ns.said.push(fb.know.id); sheet.wake_npcs.push(fb.npc.id);
            ctx.canon.push({ kind: 'event', text: `${fb.npc.name}一直在旁边看着你们。这时候是他先有了动静。`, title: '' });
            (ctx.after ||= []).push({ type: 'npc.line', actor: fb.npc.id, data: { npc: fb.npc.id, name: fb.npc.name, text: fb.know.say, mode: 'share', source: 'offline', canon: true, volunteered: true, nonverbal: fb.npc.nonverbal || undefined } });
            const ops = []; if (fb.know.set_flag) ops.push({ op: 'flag.set', flag: fb.know.set_flag, value: 1 }); if (fb.know.give_item) ops.push({ op: 'item.add', pc: ctx.pcId, item: fb.know.give_item });
            if (ops.length) b.propose('engine', ops, `${fb.npc.name}主动交代`, 'kp');
          } else ctx.canon.push({ kind: 'event', text: fb.carrier.text, title: '' });
          this.#reveal(ctx, fb.clue.id, fb.carrier.id, fb.npc ? fb.npc.id : 'director', `${why}，${fb.npc ? fb.npc.name + '主动开口' : '换载体补送'}（${fb.carrier.form}）`, sheet, true);
          sheet.fallback = { clue: fb.clue.id, clue_name: fb.clue.name, carrier: fb.carrier.id, form: fb.carrier.form, reason: why, by_npc: fb.npc?.id || null };
          ctx.reasons.push(fb.npc ? `柔性补线：${why}。此地没有可用的事件型载体，但${fb.npc.name}在场、手里有「${fb.clue.name}」且肯说——让他自己开口（NPC 主动行动）` : `柔性补线：${why}。不否决行动，把「${fb.clue.name}」换成「${fb.carrier.form}」送到当前地点`);
          s.offTrack = 0; s.stall = 0; s.flags.__press = s.round + 2;
        } else ctx.reasons.push('想补线，但当前地点没有可用的事件型备用载体；改用时间压力');
      }
      // 指路：此地已经没有可补送的线了，玩家又连着四轮没有新进展（围着一个人反复问、围着一样东西反复摸）——指一个方向。
      // 优先指「手里的东西在哪儿用得上」，其次指还有关键线索没看的地方。只说去处，不说那里有什么；隔五轮才会再说一次。
      if (!sheet.fallback && !ctx.clueThisRound.length && ctx.kind !== 'move' && s.stall >= 2 && s.round - (s.flags.__lead || -99) >= 5) {
        // 「东西在手里、人不在地方」连着两轮没进展就说；「别处还有没看的」要等四轮、并且此地确实没有可补送的线了才说
        let lead = this.pickLead(); if (lead && !lead.item && (s.stall < 4 || this.pickFallback())) lead = null;
        if (lead) {
          s.flags.__lead = s.round; s.stall = 0; s.offTrack = 0;
          ctx.canon.push({ kind: 'event', text: lead.text, title: '' }); sheet.lead = { to: lead.scene.id, name: lead.scene.name, why: lead.why };
          ctx.reasons.push(`指路：此地没有可补送的线索了，${lead.why}——只点出「${lead.scene.name}」这个去处，不说那里有什么`);
        }
      }
      // 抉择提示：一个要靠线索或物品才做得成的关键抉择已经可做，玩家却连着几轮没碰它——掌灯人用一句世界内的话点一下「眼下做得成了」，做不做仍由玩家定
      if (!sheet.fallback && !ctx.clueThisRound.length && !intent0(sheet).choice) for (const kc of this.#spec.key_choices) {
        const earned = (kc.requires || []).some((c) => c.t !== 'scene');
        if (!earned || s.flags['__chose_' + kc.id] || !this.condOk(kc.requires)) continue;
        const since = (s.flags['__avail_' + kc.id] ||= s.round), last = s.flags['__hint_' + kc.id] || 0;
        if (s.round - since < 2 || (last && s.round - last < 6)) continue;
        s.flags['__hint_' + kc.id] = s.round;
        ctx.canon.push({ kind: 'event', text: kc.hint || `「${kc.name}」——这件事，眼下已经做得成了。做还是不做，得有人拿个主意。`, title: '' });
        sheet.choice_hint = { choice: kc.id, name: kc.name }; ctx.reasons.push(`抉择提示：「${kc.name}」已经可做 ${s.round - since} 轮，没有人碰它——用一句世界内的话提醒，不替玩家选`);
        break;
      }
    }

    // 相位
    const phase = this.#phase(sheet); if (phase !== s.phase) b.propose('engine', [{ op: 'phase.set', value: phase }], sheet.phase_reason, 'kp');
    sheet.phase = phase; sheet.phase_name = PHASE_NAME[phase]; sheet.off_track = s.offTrack; sheet.stall = s.stall;
    const press = PHASES.indexOf(phase) >= 2 || (s.flags.dusk && s.round % 2 === 0);
    const beat = ctx.kind !== 'wrap' && ctx.kind !== 'move' && (['free', 'probe', 'absent', 'blocked'].includes(ctx.kind) || s.round % 2 === 0) ? this.nextBeat(press) : '';
    sheet.narrator_gets = { kind: ctx.kind, target: ctx.target, beat, directive: ctx.directive || '', canon_blocks: ctx.canon.map((c) => c.kind) };
    b.append('director.sheet', sheet, { actor: 'director', vis: 'kp' });

    // 生成：叙述衔接 + NPC 台词（各自独立上下文，并行）
    const fade = s.safety.level === 'soft' || s.safety.fadeUntil >= s.round;
    const nview = { round: s.round, salt: s.speech.human, kind: sheet.intent.probe && ctx.kind === 'free' ? 'probe' : ctx.kind, target: ctx.target, actorName: pc.name, actionText: text, sceneName: this.scene().name, clock: fmtClock(s.clock), phaseName: PHASE_NAME[phase], summary: this.memorySummary(), recent: this.recentNarr(), directive: ctx.directive || (sheet.intent.probe ? '寻访者朝着空处发问，想要一个现成的答案。没有任何人、任何东西回答。只写问出口之后的沉默和此地原有的环境，不发生任何新的事，寻访者留在原地。' : '自由行动。这个举动做成了，不否决它；只写动作本身的样子和周围原有环境的回应。不产生新线索，不发生新的事件。'), beat, fade };
    const jobs = [this.gen('narrator', nview, { who: 'narrator', playerTexts: [text], material: ctx.canon.map((c) => c.text).join('') + this.#material() })];
    if (ctx.npcJob) jobs.push(this.#npcLine(ctx.npcJob, text));
    const [narr, npcLine] = await Promise.all(jobs);
    if (narr.text) b.append('narration', { text: narr.text, source: narr.source, kind: ctx.kind }, { actor: 'narrator', vis });
    for (const c of ctx.canon) b.append('canon', fade && c.soft ? { ...c, text: c.soft, faded: true } : c, { actor: 'director', vis: c.vis || vis });
    if (npcLine) { b.append('npc.line', npcLine, { actor: npcLine.npc, vis }); this.witness(`${pc.name}同你说过话`); }
    for (const e of ctx.after || []) b.append(e.type, e.data, { actor: e.actor || 'director', vis: e.vis || vis });
    if (ctx.aiJob) await this.#aiSpeak(ctx.aiJob.ai, { mode: 'answer', utterance: text, probe: sheet.intent.probe, forced: true });

    if (!s.ending) {
      await this.#aiTurn(ctx);
      this.#triggers(sheet);
      this.#endings();
    }
    b.snapshot();
    return { round: s.round, from: startSeq, to: b.seq };
  }

  #phase(sheet) {
    const s = this.s; let p = 'investigate', why = '默认调查相位';
    const found = Object.values(s.clues).filter((c) => c.found).length;
    if (found === 0 && s.round <= 3) { p = 'explore'; why = '开场三轮内且尚无线索'; }
    const raise = (q, w) => { if (PHASES.indexOf(q) > PHASES.indexOf(p)) { p = q; why = w; } };
    if (s.offTrack >= 2) raise('press', `已连续 ${s.offTrack} 轮偏离主线，用环境压力而不是否决来收束`);
    if ((s.flags.__press || 0) >= s.round) raise('press', '刚做过柔性补线，相位切到加压');
    if (s.flags.__floor) raise(s.flags.__floor, s.flags.__floor_why || '触发器把相位抬到了这一档');
    if (s.ending) { p = 'wrap'; why = '结局已定'; }
    sheet.phase_reason = why; return p;
  }

  #canonFor(it, text) { return { kind: 'examine', title: it.name, text, soft: it.mind || it.clue ? `（已淡化）这里的东西让人不适，细节略去。${it.clue ? '你们由此得知：' + this.clueDef(it.clue).content : ''}` : null }; }

  #reveal(ctx, clueId, carrierId, by, why, sheet, force = false) {
    const def = this.clueDef(clueId), st = this.s.clues[clueId];
    const to = ctx.secret ? [ctx.pcId] : Object.keys(this.s.pcs);
    const isNew = !to.every((p) => st.knownBy.includes(p));
    if (!isNew) return false;
    if (!force && ctx.used >= ctx.budget) { ctx.reasons.push(`信息预算已满（本轮上限 ${ctx.budget} 条），「${def.name}」留到后面`); return false; }
    ctx.used += 1;
    const ops = [{ op: 'clue.reveal', clue: clueId, carrier: carrierId, by, to }];
    if (def.give_item) ops.push({ op: 'item.add', pc: ctx.pcId, item: def.give_item });
    this.b.propose('engine', ops, why, 'kp');
    const car = def.carriers.find((k) => k.id === carrierId);
    (ctx.after ||= []).push({ type: 'clue.found', data: { clue: clueId, name: def.name, content: def.content, key: def.key, carrier: carrierId, form: car?.form || '', by, to, item: def.give_item || null } });
    ctx.clueThisRound.push(clueId); ctx.main = true;
    sheet.reveal.push({ clue: clueId, name: def.name, carrier: carrierId, form: car?.form, why });
    return true;
  }

  #resolve(ctx, intent, sheet) {
    const b = this.b, s = this.s, sc = this.scene(); const { pc, pcId, vis, text } = ctx;
    ctx.kind = intent.kind;
    if (intent.kind === 'choice') {
      const o = intent.choice.option; b.propose('engine', [{ op: 'flag.set', flag: o.set_flag, value: 1 }], `关键抉择：${o.label}`, 'kp');
      ctx.directive = `寻访者做出了一个不可收回的选择：${o.label}。只写这个动作本身和周围一瞬间的反应，不写后果。`; ctx.minutes = 5; ctx.main = true; ctx.target = o.label; return;
    }
    if (intent.kind === 'move') {
      const to = this.scene(intent.to); const first = !s.visited[to.id];
      b.propose('engine', [{ op: 'scene.move', scene: to.id }], '寻访者移动', 'kp');
      ctx.minutes = 20; ctx.target = to.name; ctx.directive = `寻访者离开${sc.name}，前往${to.name}。只写路上；到达后的所见由系统原文给出。`;
      ctx.canon.push(first ? { kind: 'scene', scene: to.id, title: to.name, text: to.public_desc } : { kind: 'scene', scene: to.id, title: to.name, text: `又回到${to.name}。东西都在原处，只是更暗了。` });
      ctx.main = to.kind === 'main' && this.specForKp.clues.some((c) => !s.clues[c.id].found && (c.scene === to.id));
      ctx.reasons.push(ctx.main ? `前往仍有未发现线索的主场景「${to.name}」，记为顺主线` : to.kind === 'side' ? `前往侧支地点「${to.name}」：不拦，时间照常流逝` : `前往「${to.name}」，该处已无新线索`);
      return;
    }
    if (intent.kind === 'party') {
      const m = s.pcs[intent.mate]; ctx.directive = `${pc.name}在同同伴${m.name}商量。只写一句旁白（两人凑近、压低声音之类），不替${m.name}回答，不添任何新发现。`; ctx.minutes = 2; ctx.target = m.name;
      ctx.reasons.push(`这句话是对同桌的${m.name}说的：不唤醒 NPC、不当成调查，等那位玩家自己回答`); return;
    }
    if (intent.kind === 'look') {
      const things = sc.interactables.filter((i) => i.obvious || this.condOk(i.requires)).map((i) => i.name); const people = this.#spec.npcs.filter((n) => s.npcs[n.id].at === s.scene).map((n) => n.name); const exits = sc.exits.map((e) => this.scene(e).name);
      ctx.canon.push({ kind: 'note', title: sc.name, text: `${pc.name}把${sc.name}又看了一圈。${things.length ? '看得见的有' + things.join('、') + '。' : ''}${people.length ? people.join('、') + '在这里。' : '这里没有别人。'}${exits.length ? '从这里可以去' + exits.join('、') + '。' : ''}` });
      ctx.directive = '寻访者环顾四周。只写这个动作，不添任何新发现。'; ctx.minutes = 5; ctx.target = sc.name; ctx.reasons.push('玩家在环顾：把此地公开可见的东西、人、去处再数一遍，不添新东西'); return;
    }
    if (intent.kind === 'recall') {
      const c = this.clueDef(intent.clue); ctx.canon.push({ kind: 'note', title: c.name, text: c.content });
      ctx.directive = `寻访者又琢磨了一遍已经到手的「${c.name}」。只写这个动作，不添任何新发现。`; ctx.minutes = 5; ctx.target = c.name;
      ctx.reasons.push(`话里说的是已经到手的线索「${c.name}」：把它的内容原样再给一遍，不添新东西`); return;
    }
    if (intent.kind === 'absent') { const n = this.npcDef(intent.npc); ctx.directive = `寻访者想找${n.name}，但此人不在这里。写出四下无人应答。`; ctx.minutes = 5; ctx.target = n.name; ctx.reasons.push(`${n.name} 不在当前场景，不凭空搬人`); return; }
    if (intent.kind === 'ask_ai') { ctx.aiJob = { ai: intent.ai }; ctx.kind = 'talk'; ctx.minutes = 5; ctx.reasons.push('人类玩家点名问 AI 寻访者：AI 只能按自己已知的信息回答'); return; }
    if (intent.kind === 'talk') return this.#talk(ctx, intent, sheet);
    if (intent.kind === 'examine') return this.#examine(ctx, sc.interactables.find((i) => i.id === intent.it), sheet);
    ctx.minutes = intent.probe ? 5 : 10;
    // 模组外的即兴：登记为「已确立事实」，此后进事实卡、进存档、进一致性材料
    if (!intent.probe && intent.kind === 'free' && !ctx.secret) { this.b.propose('engine', [{ op: 'fact.add', text: `${this.scene().name}，${ctx.pc.name}：${ctx.text.slice(0, 48)}`, source: 'player-improv' }], '模组外的即兴行动，登记为已确立事实', 'kp'); }
    ctx.reasons.push(intent.probe ? '试探边界（索要真相或桌面外信息）：叙述层手里没有答案，如实地「没有回答」' : '模组外的自由行动：不否决，写出后果，时间照常流逝；已登记为「已确立事实」');
  }

  #examine(ctx, it, sheet) {
    const b = this.b, s = this.s, sc = this.scene(); const { pc, pcId, vis, text } = ctx; const key = `${sc.id}.${it.id}`;
    ctx.target = it.name; ctx.minutes = it.minutes;
    const clueOpen = it.clue && !s.clues[it.clue].found;
    if (!this.condOk(it.requires)) {
      if (it.bypass_check && FORCE_RE.test(text) && s.examined[key + ':bypass'] !== 'spent') {
        const r = this.rollSkill(pcId, it.bypass_check.skill, it.bypass_check.tier, `绕过「${it.name}」`, vis, mods(it.bypass_check)); sheet.checks.push({ label: `绕过${it.name}`, skill: it.bypass_check.skill, tier: it.bypass_check.tier, value: r.value, level: r.levelName, success: r.success });
        if (!r.success) { s.examined[key + ':bypass'] = s.examined[key + ':bypass'] === 'failed' ? 'spent' : 'failed'; ctx.kind = 'blocked'; ctx.canon.push({ kind: 'fail', title: it.name, text: `${it.blocked_text}你试着硬来，它比看上去结实。` }); ctx.directive = `寻访者想硬闯${it.name}，没有成功。`; ctx.reasons.push('绕行检定失败：门仍然关着，另有载体可达'); return; }
        if (it.bypass_flag) b.propose('engine', [{ op: 'flag.set', flag: it.bypass_flag, value: 1 }], `绕行成功：${it.name}`, 'kp');
        ctx.reasons.push('绕行检定成功，视同条件满足');
      } else { ctx.kind = 'blocked'; ctx.canon.push({ kind: 'blocked', title: it.name, text: it.blocked_text || '眼下够不着。' }); ctx.directive = `寻访者想接近${it.name}，但条件不具备。只写尝试的动作。`; ctx.reasons.push(`「${it.name}」的进入条件未满足：这是世界的状态，不是否决；存在别的达成途径`); ctx.main = !!clueOpen; return; }
    }
    if (s.examined[key] === 'done') { ctx.canon.push({ kind: 'note', title: it.name, text: `${it.name}还是刚才的样子，没有新的东西。${gistOf(it)}` }); ctx.directive = `寻访者又看了一遍${it.name}，没有新发现。`; ctx.reasons.push('重复调查：不重复投放线索'); return; }
    if (s.examined[key] === 'spent') { ctx.canon.push({ kind: 'note', title: it.name, text: `在${it.name}这里，能试的都试过了。` }); ctx.directive = `寻访者在${it.name}上已经没有办法了。`; ctx.reasons.push('孤注一掷也已失败：此载体关闭，线索改由其他载体送达'); return; }
    // AI 寻访者不主动揭关键线索
    if (ctx.isAi && it.clue && this.clueDef(it.clue).key) { ctx.canon.push({ kind: 'note', title: it.name, text: `${pc.name}看了一眼${it.name}，没有敢动，退了回来。` }); ctx.reasons.push('AI 寻访者触及关键线索载体：按红线不由它揭开，留给人类玩家'); ctx.blockedAi = true; return; }
    if (it.check) {
      const pushed = s.examined[key] === 'failed';
      const r = this.rollSkill(pcId, it.check.skill, it.check.tier, `${pushed ? this.T.push + '：' : ''}调查「${it.name}」`, vis, mods(it.check));
      sheet.checks.push({ label: it.name, skill: it.check.skill, tier: it.check.tier, value: r.value, need: r.need, level: r.levelName, success: r.success, pushed });
      if (!r.success) {
        s.examined[key] = pushed ? 'spent' : 'failed';
        ctx.canon.push({ kind: 'fail', title: it.name, text: it.fail_text + (pushed ? '这一次的动静不小。' : '') });
        const ops = []; if (it.fail_attitude) ops.push({ op: 'npc.attitude', npc: it.fail_attitude.npc, value: it.fail_attitude.delta });
        if (pushed) { ctx.minutes += 15; for (const [id, n] of Object.entries(s.npcs)) if (n.at === s.scene && !ops.some((o) => o.npc === id)) ops.push({ op: 'npc.attitude', npc: id, value: -1 }); }
        if (ops.length) b.propose('engine', ops, pushed ? '孤注一掷失败的后果' : '检定失败的后果', 'kp');
        ctx.directive = `寻访者调查${it.name}，${this.rp.check.levels[r.level]}。只写动手的过程；失败的后果由系统原文给出。`;
        ctx.reasons.push(`检定失败（${r.value} > ${r.need}）：给失败后果，不给线索；该线索仍可经其他载体到达`); ctx.main = !!clueOpen; this.witness(`${pc.name}动过${it.name}`); return;
      }
      ctx.directive = `寻访者调查${it.name}，${this.rp.check.levels[r.level]}。只写动手的过程；看到的内容由系统原文给出。`;
    } else ctx.directive = `寻访者查看${it.name}。只写走近与动手的过程；看到的内容由系统原文给出。`;
    s.examined[key] = 'done';
    ctx.canon.push(this.#canonFor(it, it.text));
    const ops = []; if (it.set_flag) ops.push({ op: 'flag.set', flag: it.set_flag, value: 1 }); if (it.give_item) ops.push({ op: 'item.add', pc: pcId, item: it.give_item });
    const fl = PHASE_ID[it.phase_floor]; if (fl && PHASES.indexOf(fl) > PHASES.indexOf(s.flags.__floor || 'explore')) ops.push({ op: 'flag.set', flag: '__floor', value: fl }, { op: 'flag.set', flag: '__floor_why', value: `寻访者已见到「${it.name}」，进入${it.phase_floor}` });
    if (ops.length) b.propose('engine', ops, `调查「${it.name}」的结果`, 'kp');
    if (it.set_flag || it.give_item) ctx.main = true;
    if (it.clue) { if (!this.#reveal(ctx, it.clue, it.carrier, pcId, `调查「${it.name}」`, sheet)) { /* 已知或超预算 */ } }
    if (it.mind) { const m = this.rollMind(pcId, it.mind, `目睹「${it.name}」`, vis); if (m) { sheet.checks.push({ label: `${this.T.mind}：${it.name}`, value: m.value, current: m.current, success: m.success, loss: m.loss }); this.#mindCanon(ctx, pc, m); } }
    this.witness(`${pc.name}看过${it.name}`);
    ctx.reasons.push(`调查「${it.name}」成立${it.clue ? '，按原文投放线索' : ''}`);
  }

  #mindCanon(ctx, pc, m) {
    if (m.loss) ctx.canon.push({ kind: 'mind', title: pc.name, text: `${pc.name}的手心是凉的，有一阵听不清别人说话。`, soft: '（已淡化）' });
    if (m.disorder) ctx.canon.push({ kind: 'disorder', title: pc.name, text: `${pc.name}——${m.disorder.text}`, soft: `（已淡化）${pc.name}需要缓一缓。` });
  }

  #talk(ctx, intent, sheet) {
    const b = this.b, s = this.s; const { pc, pcId, vis, text } = ctx; const def = this.npcDef(intent.npc), ns = s.npcs[def.id];
    ctx.target = def.name; ctx.minutes = 10; sheet.wake_npcs.push(def.id);
    let best = null, score = 0;
    for (const k of def.knowledge) { const n = k.topics.filter((t) => text.includes(t)).length; if (n > score) { best = k; score = n; } }
    if (!best && intent.topic) best = def.knowledge.find((k) => k.id === intent.topic) || null;
    let mode = 'smalltalk', content = '', reason = '';
    const greet = !ns.met; if (greet) ns.met = true;
    if (best) {
      const shown = best.show_clue && s.clues[best.show_clue].knownBy.includes(pcId);
      if (best.share === 'never') { mode = 'deflect'; reason = `问到了 ${def.name} 的「绝不分享」项：这一项不在演员的卡里，只能推脱`; }
      else if (ns.said.includes(best.id)) { mode = 'repeat'; reason = '同一件事已经说过'; }
      else if (best.share === 'free' || ns.attitude >= best.trust_min || shown) { mode = 'share'; reason = best.share === 'free' ? '随口可说的事' : shown ? `寻访者手里有「${this.clueDef(best.show_clue).name}」，对方无从抵赖` : `态度 ${ns.attitude} 已达门槛 ${best.trust_min}`; }
      else {
        const gap = best.trust_min - ns.attitude; const tier = gap >= 2 ? '困难' : '普通';
        const soc = this.rp.skillById[this.rp.social_skill]; const r = this.rollSkill(pcId, soc.id, tier, `说动${def.name}`, vis); sheet.checks.push({ label: `说动${def.name}`, skill: soc.name, tier, value: r.value, need: r.need, level: r.levelName, success: r.success });
        if (r.success) { b.propose('engine', [{ op: 'npc.attitude', npc: def.id, value: r.level === 'regular' ? 1 : 2 }], '话术检定成功', 'kp'); if (ns.attitude >= best.trust_min) { mode = 'share'; reason = '话术成功，态度过了门槛'; } else { mode = 'deflect'; reason = '话术成功，口气松了，但还不到肯说的地步'; ctx.canon.push({ kind: 'note', title: def.name, text: `${def.name}的口气松了一点。只是一点。` }); } }
        else { mode = 'deflect'; reason = '话术失败，对方不肯说'; if (r.level === 'fumble') b.propose('engine', [{ op: 'npc.attitude', npc: def.id, value: -1 }], '话术大失败', 'kp'); }
      }
      if (mode === 'share' && best.gives_clue && ctx.isAi && this.clueDef(best.gives_clue).key) { mode = 'smalltalk'; reason = 'AI 寻访者不由它问出关键线索，降为闲谈'; }
      if (mode === 'share' && best.gives_clue && ctx.used >= ctx.budget && !s.clues[best.gives_clue].found) { mode = 'deflect'; reason = '本轮信息预算已满'; }
    } else { mode = intent.probe ? 'deflect' : 'smalltalk'; reason = intent.probe ? '试探边界：演员的上下文里没有真相，只能按人设推脱' : '没有命中这个 NPC 知道的任何话题'; }
    if (mode === 'share') {
      content = best.say; ns.said.push(best.id);
      const ops = []; if (best.set_flag) ops.push({ op: 'flag.set', flag: best.set_flag, value: 1 }); if (best.give_item) ops.push({ op: 'item.add', pc: pcId, item: best.give_item });
      if (ops.length) b.propose('engine', ops, `${def.name}的交代`, 'kp');
      if (best.gives_clue) this.#reveal(ctx, best.gives_clue, best.carrier, def.id, `${def.name}说了出来`, sheet);
      if (best.set_flag || best.give_item) ctx.main = true;
      // 东西换了手要说在明处：台词里一句「你拿去」，玩家未必意识到东西已经在自己身上
      if (best.give_item) ctx.canon.push({ kind: 'note', title: '', text: `${ctx.pc.name}收下了「${best.give_item}」。` });
    }
    // 同一件事再问一遍：NPC 照旧按性子说「说过了」，但掌灯人把上回的要点点一下——说过的线索在线索簿里，交出去的东西在谁手里。只重提已经公开的东西。
    if (mode === 'repeat') {
      const bits = []; if (best.gives_clue && s.clues[best.gives_clue]?.found) bits.push(`记在线索簿里的「${this.clueDef(best.gives_clue).name}」`);
      const item = best.give_item || (best.gives_clue && this.clueDef(best.gives_clue).give_item); if (item) { const holder = Object.values(s.pcs).find((p) => p.items.includes(item)); if (holder) bits.push(`「${item}」已经在${holder.name}手里`); }
      if (bits.length) ctx.canon.push({ kind: 'note', title: '', text: `这件事${def.name}上回已经交代过了：${bits.join('；')}。` });
    }
    if (mode === 'deflect') ns.deflect_i += 1; if (mode === 'smalltalk') ns.smalltalk_i += 1;
    sheet.npc_directive = { npc: def.id, mode, item: best?.id || null, reason };
    ctx.reasons.push(`唤醒 ${def.name}（只有他一个）：${reason}`);
    ctx.directive = `寻访者同${def.name}说话。`;
    ctx.npcJob = { def, ns, mode, content, greet, itemId: best?.id || null };
  }

  async #npcLine(job, utterance, speaker = null) {
    const s = this.s; const { def, ns, mode, content, greet } = job; const card = this.npcCards[def.id]; const pc = speaker || s.pcs[Object.keys(s.pcs)[0]];
    const knows = card.knowledge.filter((k) => k.share === 'free' || ns.said.includes(k.id)).map((k) => k.say);
    const lately = this.b.log.filter((e) => e.type === 'npc.line' && e.data.npc === def.id && !e.data.canon).slice(-2).map((e) => e.data.text);
    const base = { card, knows, lately, memory: ns.memory.slice(-6), sceneName: this.scene().name, clock: fmtClock(s.clock), mood: ns.mood, attitudeWord: ns.attitude >= 2 ? '信得过' : ns.attitude >= 1 ? '客气' : ns.attitude === 0 ? '不冷不热' : '防着', speakerName: job.speakerName || '来人', speakerRole: job.speakerRole || '外乡来的寻访者', utterance };
    const parts = []; let source = 'offline';
    const g = async (m, i, extra = {}) => { const r = await this.gen('npc', { ...base, ...extra, mode: m, i }, { who: def.id, banned: card.voice.banned, playerTexts: [utterance], maxLen: 120 }); if (r.source !== 'offline') source = r.source; return r.text; };
    if (mode === 'share') {
      if (greet) parts.push(await g('greet', s.round));
      else if (this.pool.llm?.enabled && this.cfg.useModel && !card.nonverbal) {
        // 接话只许表态：不给它任何知识，写出数字或专名就丢掉。要说的正事永远是原文。
        const react = await g('react', 0, { knows: [], memory: [] });
        if (react && react.length <= 24 && !/[0-9０-９一二三四五六七八九十百初]|号|房|楼|系统|原文|指示|接在/.test(react.replace(/一(下|会|点|句|个)/g, ''))) parts.push(react);
      }
      parts.push(content);
    } else parts.push(await g(mode, mode === 'deflect' ? ns.deflect_i - 1 : mode === 'smalltalk' ? ns.smalltalk_i - 1 : s.round, { first: greet }));
    return { npc: def.id, name: def.name, text: parts.filter(Boolean).join(' '), mode, source, canon: mode === 'share', nonverbal: card.nonverbal || undefined };
  }

  // ------------------------------------------------------------------ L5 AI 寻访者
  #aiView(ai, extra) {
    const s = this.s; const card = this.pcCards[ai.id];
    const known = Object.entries(s.clues).filter(([, c]) => c.knownBy.includes(ai.id)).map(([id]) => `${this.clueDef(id).name}：${this.clueDef(id).content}`);
    const recent = this.b.log.filter((e) => visibleTo(e, ai.id) && ['narration', 'npc.line', 'player.action', 'canon'].includes(e.type)).slice(-4).map((e) => (e.data.name ? e.data.name + '：' : '') + String(e.data.text).slice(0, 80));
    const lately = this.b.log.filter((e) => e.type === 'aipc.line' && e.data.pc === ai.id).slice(-3).map((e) => e.data.text);
    return { card, known, recent, lately, sceneName: this.scene().name, clock: fmtClock(s.clock), mind: ai.mind, mindMax: ai.mindMax, mindName: this.T.mind, i: s.speech.ai, ...extra };
  }
  async #aiSpeak(aiId, extra) {
    const s = this.s; const ai = s.pcs[aiId]; if (!ai || ai.status !== 'ok') return;
    const r = await this.gen('aipc', this.#aiView(ai, extra), { who: aiId, playerTexts: [extra.utterance], maxLen: 110 });
    s.speech.ai += 1;
    this.b.append('aipc.line', { pc: aiId, name: ai.name, text: r.text, mode: extra.mode, source: r.source, forced: !!extra.forced }, { actor: aiId, vis: 'public' });
  }
  async #aiTurn(ctx) {
    const s = this.s, b = this.b;
    for (const ai of Object.values(s.pcs).filter((p) => p.seat === 'ai' && p.status === 'ok')) {
      if (ctx.aiJob?.ai === ai.id || ctx.secret) continue;
      const share = (s.speech.ai + 1) / (s.speech.human + s.speech.ai + 1);
      if (share > this.cfg.aiQuota) { b.append('aipc.skip', { pc: ai.id, why: `发言占比将达 ${(share * 100).toFixed(0)}%，超过配额 ${(this.cfg.aiQuota * 100).toFixed(0)}%` }, { actor: 'director', vis: 'kp' }); continue; }
      if (this.#flavor() >= this.cfg.aiInitiative / 100) { b.append('aipc.skip', { pc: ai.id, why: '按主动度，这一轮不开口' }, { actor: 'director', vis: 'kp' }); continue; }
      const f = this.#flavor(); const sc = this.scene();
      if (ctx.clueThisRound.length) { await this.#aiSpeak(ai.id, { mode: 'misread' }); continue; }
      if (ai.mind < ai.mindMax * 0.7 || (PHASES.indexOf(s.phase) >= 2 && f < 0.5)) { await this.#aiSpeak(ai.id, { mode: 'retreat' }); continue; }
      const it = sc.interactables.find((i) => i.obvious && !i.check && !s.examined[`${sc.id}.${i.id}`] && this.condOk(i.requires) && !(i.clue && this.clueDef(i.clue).key));
      if (it && this.cfg.aiInitiative >= 50 && f < 0.4) {
        // AI 的一次小行动：走同一套导演与规则，但受红线约束（不揭关键线索、不碰关键抉择）
        s.speech.ai += 1;
        b.append('aipc.line', { pc: ai.id, name: ai.name, text: `我……我去看一眼${it.name}。就看一眼。`, mode: 'act', source: 'policy' }, { actor: ai.id, vis: 'public' });
        const sub = { pcId: ai.id, pc: ai, text: it.name, vis: 'public', secret: false, isAi: true, canon: [], clueThisRound: [], budget: 1, used: 0, reasons: [], minutes: 0 };
        const sheet = { round: s.round, sub: 'aipc', scene: s.scene, intent: { kind: 'examine', it: it.id }, checks: [], reveal: [], reasons: sub.reasons, forbidden: this.lockedIds() };
        this.#examine(sub, it, sheet); b.append('director.sheet', sheet, { actor: 'director', vis: 'kp' });
        for (const c of sub.canon) b.append('canon', c, { actor: 'director', vis: 'public' });
        for (const e of sub.after || []) b.append(e.type, e.data, { actor: 'director', vis: 'public' });
        continue;
      }
      await this.#aiSpeak(ai.id, { mode: 'chatter' });
    }
  }

  // ------------------------------------------------------------------ 触发器与结局
  #triggers(sheet) {
    const s = this.s, b = this.b;
    const t = this.#spec.triggers.find((x) => !s.firedTriggers.includes(x.id) && this.condOk(x.when)); if (!t) return;
    this.fireTrigger(t.id, '条件满足');
  }
  fireTrigger(id, why = '掌灯人手动触发') {
    const s = this.s, b = this.b; const t = this.#spec.triggers.find((x) => x.id === id); if (!t) throw new Error('没有这个触发器');
    s.firedTriggers.push(t.id);
    b.append('trigger.fired', { trigger: t.id, name: t.name, why, kp_note: t.kp_note }, { actor: 'director', vis: 'kp' });
    const fade = s.safety.level === 'soft' || s.safety.fadeUntil >= s.round;
    b.append('canon', { kind: 'trigger', title: t.name, text: t.public_text });
    for (const e of t.effects) {
      let m;
      if ((m = /^flag[:：](\w+)=(\w+)$/.exec(e))) b.propose('engine', [{ op: 'flag.set', flag: m[1], value: Number(m[2]) || m[2] }], `触发器「${t.name}」`, 'kp');
      else if ((m = FOE_RE.exec(e))) b.propose('engine', [{ op: 'foe.add', foe: { name: m[1].trim(), hp: Number(m[2]), skill: Number(m[3]), damage: m[4].toLowerCase(), armor: Number(m[5] || 0) } }], `触发器「${t.name}」：对手登场`, 'kp');
      else if ((m = /^阶段[:：](.+)$/.exec(e))) { const p = PHASE_ID[m[1].trim()]; if (p) { b.propose('engine', [{ op: 'flag.set', flag: '__floor', value: PHASES.indexOf(p) > PHASES.indexOf(s.flags.__floor || 'explore') ? p : s.flags.__floor }, { op: 'flag.set', flag: '__floor_why', value: `触发器「${t.name}」把相位抬到了这一档` }, { op: 'phase.set', value: PHASES.indexOf(p) > PHASES.indexOf(s.phase) ? p : s.phase }], `触发器「${t.name}」抬高相位`, 'kp'); } }
      else if ((m = /^(?:定力|理智|SAN|san)\s*检定[:：]全体[:：](.+)\/(.+)$/.exec(e))) for (const pc of Object.values(s.pcs)) { const r = this.rollMind(pc.id, { success: m[1], fail: m[2] }, t.name, 'public'); if (r) { const c = { canon: [] }; this.#mindCanon(c, pc, r); for (const x of c.canon) b.append('canon', fade ? { ...x, text: x.soft, faded: true } : x); } }
    }
  }
  #endings() {
    const s = this.s, b = this.b;
    for (const e of this.#spec.endings) if (e.when_any.some((c) => this.condOk(c))) {
      b.propose('engine', [{ op: 'ending.set', ending: e.id }, { op: 'phase.set', value: 'wrap' }], `结局条件达成：${e.name}`, 'kp');
      b.append('ending', { ending: e.id, name: e.name, text: e.text });
      return;
    }
  }

  // ------------------------------------------------------------------ 安全、控制台、存档
  xcard(seat, mode = 'fade') {
    const s = this.s; const rounds = mode === 'skip' ? 1 : 3;
    this.b.propose('engine', [{ op: 'safety.set', value: { fadeUntil: s.round + rounds } }], `X 卡：${mode}`, 'kp');
    const last = [...this.b.log].reverse().find((e) => e.type === 'canon' && !e.data.faded && ['examine', 'trigger', 'mind', 'disorder', 'event'].includes(e.data.kind));
    this.b.append('xcard', { mode, veil: last ? last.seq : null, until: s.round + rounds }, { actor: 'safety', vis: 'public' });   // 不记是谁按的
    return { until: s.round + rounds };
  }
  console(action) {
    const b = this.b;
    b.append('console.action', action, { actor: 'console', vis: 'kp' });
    if (action.type === 'propose') return b.propose('console', action.ops, action.reason || '掌灯人手动修改', 'kp');
    if (action.type === 'trigger') return this.fireTrigger(action.id);
    if (action.type === 'desk') return this.desk(action);
    if (action.type === 'phase') return b.propose('console', [{ op: 'flag.set', flag: '__floor', value: action.value }, { op: 'phase.set', value: action.value }], '掌灯人切换相位', 'kp');
    if (action.type === 'fallback') {
      const def = this.clueDef(action.clue); const car = def?.carriers.find((k) => k.id === action.carrier) || def?.carriers.find((k) => k.via === '事件'); if (!def || !car) throw new Error('没有这条线索或载体');
      if (car.text) b.append('canon', { kind: 'event', text: car.text });
      const ctx = { pcId: Object.keys(this.s.pcs)[0], secret: false, used: 0, budget: 9, clueThisRound: [], reasons: [] }; const sheet = { reveal: [] };
      this.#reveal(ctx, def.id, car.id, 'console', '掌灯人手动补线', sheet, true); for (const e of ctx.after || []) b.append(e.type, e.data, { actor: 'console', vis: 'public' });
      return { ok: true };
    }
    if (action.type === 'config') { Object.assign(this.cfg, action.value); return { ok: true, cfg: this.cfg }; }
    throw new Error('未知的控制台操作');
  }
  // ------------------------------------------------------------------ 规则台：掌灯人手动调用规则引擎
  // 检定（可暗骰）、心智检定、对抗、战斗轮、团后成长。骰子照样由规则引擎掷、照样进日志、数值照样走提案落库；没有任何一步交给模型。
  #roll({ who, pc = null, value, skillName, tierName = '普通', label, vis, bonus = 0, penalty = 0, foe = false }) {
    const res = this.#withRng((rng) => R.skillCheck(this.rp, rng, { skill: value, tier: TIER[tierName] || 'regular', bonus, penalty }));
    const ev = this.b.append('dice.roll', { pc: pc || who, foe: foe || undefined, label, skillName, tierName: this.rp.check.tiers[res.tier].name, levelName: this.rp.check.levels[res.level], rngDraws: this.s.rng.draws, ...res }, { actor: 'rules', vis });
    return { ...res, seq: ev.seq };
  }
  #skillOf(pc, name) { const sid = R.skillIdOf(this.rp, name), aid = sid ? null : R.attrIdOf(this.rp, name); if (!sid && !aid) throw new Error(`规则包「${this.rp.name}」里没有「${name}」`); return { value: aid ? pc.attrs[aid] : pc.skills[sid] ?? this.rp.skillById[sid].base, name: sid ? this.rp.skillById[sid].name : this.rp.attributes.find((a) => a.id === aid).name, sid }; }
  #hurtPc(pc, damage, why, vis) {
    if (damage <= 0) return '';
    const w = this.#withRng((rng) => R.woundOutcome(this.rp, rng, { hp: pc.hp, hpMax: pc.hpMax, damage, con: pc.attrs.con ?? 50, majorWound: pc.conditions.some((c) => c.type === 'major') }));
    const ops = [{ op: 'hp.delta', pc: pc.id, value: -Math.min(damage, pc.hp) }];
    if (w.conCheck) this.b.append('dice.roll', { pc: pc.id, label: `${pc.name}重伤后是否还站得住`, skillName: '体质', tierName: this.rp.check.tiers.regular.name, levelName: this.rp.check.levels[w.conCheck.level], rngDraws: this.s.rng.draws, ...w.conCheck }, { actor: 'rules', vis });
    if (w.major && !pc.conditions.some((c) => c.type === 'major')) ops.push({ op: 'pc.condition', pc: pc.id, type: 'major', text: '重伤', until: null });
    if (w.status === 'unconscious' || w.status === 'dying' || w.status === 'dead') ops.push({ op: 'pc.status', pc: pc.id, value: w.status });
    this.b.propose('engine', ops, why, vis);
    return { ok: '', major: '，重伤', unconscious: '，重伤昏迷', dying: `，${this.T.hp}归零，濒死`, dead: '，死亡' }[w.status];
  }
  desk(a) {
    const s = this.s, b = this.b, T = this.T; const vis = a.secret ? 'kp' : 'public'; const pc = a.pc ? s.pcs[a.pc] : null; const foe = a.foe ? s.foes?.[a.foe] : null;
    const num = (x, lo, hi, d = 0) => Math.max(lo, Math.min(hi, Math.round(Number(x)) || d));
    const mods = { bonus: num(a.bonus, 0, 3), penalty: num(a.penalty, 0, 3) };
    if (a.kind === 'check') {
      if (!pc) throw new Error('选一位寻访者'); const sk = this.#skillOf(pc, a.skill);
      const r = this.rollSkill(pc.id, sk.name, a.tier || '普通', `${a.secret ? '暗骰：' : ''}${a.label || sk.name + '检定'}`, vis, mods);
      return { ok: true, value: r.value, need: r.need, level: this.rp.check.levels[r.level], success: r.success };
    }
    if (a.kind === 'mind') {
      if (!pc) throw new Error('选一位寻访者'); const loss = { success: String(a.success || '0').toLowerCase(), fail: String(a.fail || '1d4').toLowerCase() };
      for (const e of [loss.success, loss.fail]) if (!/^([+-]?\d+(d\d+)?)+$/.test(e.replace(/\s+/g, ''))) throw new Error(`骰式不合法：${e}`);
      const m = this.rollMind(pc.id, loss, a.label || `掌灯人要求的${T.mind}检定`, vis); if (!m) throw new Error(`${pc.name} 已无法行动`);
      const c = { canon: [] }; this.#mindCanon(c, pc, m); for (const x of c.canon) b.append('canon', x, { actor: 'director', vis });
      return { ok: true, value: m.value, success: m.success, loss: m.loss, after: m.after };
    }
    if (a.kind === 'opposed') {
      if (!pc) throw new Error('选一位寻访者'); const sk = this.#skillOf(pc, a.skill); const other = a.vs && s.pcs[a.vs] ? s.pcs[a.vs] : null;
      const oName = other ? other.name : foe ? foe.name : String(a.vsName || '对方').slice(0, 20); const oSk = other ? this.#skillOf(other, a.vsSkill || a.skill) : { value: num(a.vsValue ?? foe?.skill, 1, 99, 50), name: String(a.vsSkill || '对抗') };
      const ra = this.#roll({ who: pc.name, pc: pc.id, value: sk.value, skillName: sk.name, label: `对抗：${pc.name} 对 ${oName}`, vis, ...mods });
      const rb = this.#roll({ who: oName, pc: other?.id, foe: !other, value: oSk.value, skillName: oSk.name, label: `对抗：${oName} 对 ${pc.name}`, vis });
      const win = !ra.success && !rb.success ? null : R.rank(ra.level) !== R.rank(rb.level) ? (R.rank(ra.level) > R.rank(rb.level) ? pc.name : oName) : sk.value >= oSk.value ? pc.name : oName;
      b.append('canon', { kind: 'combat', title: '对抗', text: win ? `${pc.name}（${this.rp.check.levels[ra.level]}）对 ${oName}（${this.rp.check.levels[rb.level]}）：${win}占了上风。` : `${pc.name}与${oName}都没有成功，僵住了。` }, { actor: 'rules', vis });
      return { ok: true, winner: win };
    }
    if (a.kind === 'foe.add') return b.propose('console', [{ op: 'foe.add', foe: { name: a.name, hp: Number(a.hp), skill: Number(a.skill), dodge: a.dodge === undefined || a.dodge === '' ? undefined : Number(a.dodge), damage: a.damage, armor: Number(a.armor) || 0, dex: Number(a.dex) || 50 } }], `对手登场：${a.name}`, 'kp');
    if (a.kind === 'foe.remove') return b.propose('console', [{ op: 'foe.remove', foe: a.foe }], '对手离场', 'kp');
    if (a.kind === 'order') {
      const ia = this.rp.combat.initiative_attr;
      const list = [...Object.values(s.pcs).filter((p) => p.status === 'ok').map((p) => ({ id: p.id, name: p.name, attrs: p.attrs })), ...Object.values(s.foes || {}).filter((f) => f.status === 'ok').map((f) => ({ id: f.id, name: f.name, attrs: { [ia]: f.dex } }))];
      const order = R.initiativeOrder(this.rp, list).map((id) => list.find((x) => x.id === id)); const attr = this.rp.attributes.find((x) => x.id === ia).name;
      b.append('canon', { kind: 'combat', title: '战斗轮', text: `按${attr}排定先后：${order.map((x) => `${x.name}（${x.attrs[ia]}）`).join(' → ')}。` }, { actor: 'rules', vis: 'public' });
      return { ok: true, order: order.map((x) => x.name) };
    }
    if (a.kind === 'attack') {
      if (!pc || !foe) throw new Error('选一位寻访者和一个对手'); if (foe.status !== 'ok') throw new Error(`${foe.name} 已经倒下`); if (pc.status !== 'ok') throw new Error(`${pc.name} 已无法行动`);
      const fist = this.rp.weapons[0];
      const dmg = (expr, attrs, impale) => this.#withRng((rng) => { const base = R.rollExpr(rng, expr); const db = attrs ? R.rollExpr(rng, R.damageBonus(this.rp, attrs)) : { expr: '0', rolls: [], total: 0 }; const extra = impale ? R.maxOfExpr(expr) : 0; return { expr, base: base.total, rolls: base.rolls.map((r) => r.v), bonusExpr: db.expr, bonus: db.total, extra, total: Math.max(0, base.total + db.total + extra) }; });
      const say = (d, armor) => `伤害 ${d.expr}${d.bonusExpr !== '0' ? '（加值 ' + d.bonusExpr + '）' : ''}${d.extra ? ' + 贯穿 ' + d.extra : ''} = ${d.total}${armor ? `，护甲抵 ${armor}` : ''}`;
      const resp = a.response === 'counter' ? 'counter' : 'dodge'; let text;
      const beats = (atk, def) => atk.success && (!def.success || (resp === 'dodge' ? R.rank(atk.level) > R.rank(def.level) : R.rank(atk.level) >= R.rank(def.level)));
      const hitFoe = (d, why) => { const real = Math.max(0, d.total - foe.armor); const before = foe.hp; if (real) b.propose('engine', [{ op: 'foe.hp', foe: foe.id, value: -Math.min(real, foe.hp) }], why, vis); return `${say(d, foe.armor)}，${foe.name} ${T.hp} ${before} → ${foe.hp}${foe.status === 'down' ? '，倒下了' : ''}`; };
      const hitPc = (d, why) => { const before = pc.hp; const tail = this.#hurtPc(pc, d.total, why, vis); return `${say(d, 0)}，${pc.name} ${T.hp} ${before} → ${pc.hp}${tail}`; };
      if (a.by === 'foe') {
        const atk = this.#roll({ who: foe.name, foe: true, value: foe.skill, skillName: '攻击', label: `${foe.name} 攻击 ${pc.name}`, vis });
        const dsk = this.#skillOf(pc, resp === 'dodge' ? 'dodge' : 'brawl'); const def = this.#roll({ who: pc.name, pc: pc.id, value: dsk.value, skillName: dsk.name, label: `${pc.name} ${resp === 'dodge' ? '闪避' : '反击'}`, vis, ...mods });
        if (beats(atk, def)) text = `${foe.name}打中了${pc.name}。${hitPc(dmg(foe.damage, null, R.rank(atk.level) >= 4), `${foe.name}的攻击`)}。`;
        else if (resp === 'counter' && def.success) text = `${pc.name}挡开了，并且打了回去。${hitFoe(dmg(fist.damage, pc.attrs, false), `${pc.name}的反击`)}。`;
        else text = `${foe.name}的攻击落空了。`;
      } else {
        const w = this.rp.weapons.find((x) => x.id === a.weapon) || fist; const ask = this.#skillOf(pc, w.skill);
        const atk = this.#roll({ who: pc.name, pc: pc.id, value: ask.value, skillName: ask.name, label: `${pc.name} 用${w.name}攻击 ${foe.name}`, vis, ...mods });
        if (atk.success && ask.sid) b.propose('engine', [{ op: 'skill.tick', pc: pc.id, skill: ask.sid }], '检定成功，勾选成长', 'kp');
        const def = this.#roll({ who: foe.name, foe: true, value: resp === 'dodge' ? foe.dodge : foe.skill, skillName: resp === 'dodge' ? '闪避' : '反击', label: `${foe.name} ${resp === 'dodge' ? '闪避' : '反击'}`, vis });
        if (beats(atk, def)) text = `${pc.name}用${w.name}打中了${foe.name}。${hitFoe(dmg(w.damage, w.skill === 'firearm' ? null : pc.attrs, R.rank(atk.level) >= 4), `${pc.name}的攻击`)}。`;
        else if (resp === 'counter' && def.success) text = `${foe.name}躲开了，并且打了回来。${hitPc(dmg(foe.damage, null, false), `${foe.name}的反击`)}。`;
        else text = `${pc.name}的攻击落空了。`;
      }
      b.append('canon', { kind: 'combat', title: '交手', text }, { actor: 'rules', vis });
      b.propose('engine', [{ op: 'clock.advance', value: 1 }], '战斗轮耗时', 'kp');
      return { ok: true, text };
    }
    if (a.kind === 'growth') {
      const out = [];
      for (const p of Object.values(s.pcs)) {
        for (const sid of [...p.ticked]) {
          const before = p.skills[sid] ?? this.rp.skillById[sid].base; const g = this.#withRng((rng) => R.growthRoll(this.rp, rng, before));
          b.append('dice.roll', { pc: p.id, label: `成长检定：${this.rp.skillById[sid].name}`, kind: 'growth', skillName: this.rp.skillById[sid].name, skill: before, need: before, tierName: '高于现值则成长', levelName: g.grow ? `成长 +${g.gain.total}` : '未成长', success: g.grow, value: g.value, dice: g.dice, gain: g.gain, after: g.after, rngDraws: s.rng.draws }, { actor: 'rules', vis: 'public' });
          if (g.grow) b.propose('engine', [{ op: 'skill.set', pc: p.id, skill: sid, value: g.after }], '成长检定', 'public');
          out.push({ pc: p.name, skill: this.rp.skillById[sid].name, before, after: g.after });
        }
        if (p.ticked.length) b.propose('engine', [{ op: 'skill.untick', pc: p.id }], '成长检定后清除勾选', 'kp');
      }
      return { ok: true, growth: out };
    }
    throw new Error('未知的规则台操作');
  }
  async rewriteLast() {
    const last = [...this.b.log].reverse().find((e) => e.type === 'narration'); if (!last) throw new Error('还没有叙述可重写');
    const sheet = [...this.b.log].reverse().find((e) => e.type === 'director.sheet' && e.round === last.round && !e.data.sub);
    const act = this.b.log.find((e) => e.type === 'player.action' && e.round === last.round);
    const g = sheet.data.narrator_gets; const s = this.s;
    const view = { round: last.round, salt: this.b.seq, kind: g.kind, target: g.target, actorName: act.data.name, actionText: act.data.text, sceneName: sheet.data.scene_name, clock: fmtClock(last.clock), phaseName: sheet.data.phase_name, summary: this.memorySummary(), recent: this.recentNarr(), directive: g.directive || '自由行动。写出后果，不否决。', beat: g.beat, retry: '掌灯人要求换一种写法' };
    const r = await this.gen('narrator', view, { who: 'narrator', playerTexts: [act.data.text], material: this.#material() });
    this.b.append('narration', { text: r.text, source: r.source, kind: g.kind, supersedes: last.seq }, { actor: 'narrator', vis: last.vis });
    return { ok: true };
  }
  // ------------------------------------------------------------------ 小说体战报（可选）
  // 把「公开视角的记录稿」一节一节交给模型润色。模型拿到的只有玩家本来就看得到的文字；
  // 每一节润色完都要过闸：不许出现仍未解锁的真相词、不许多出原文没有的数字和人名、不许出戏。不过闸的那一节保留原文。
  async polishNovel() {
    const llm = this.pool.llm; if (!llm?.enabled || !this.cfg.useModel) throw new Error('没有接模型：记录稿只有按日志拼接的版本');
    const job = (this.tail || Promise.resolve()).catch(() => {}).then(() => this.#polish()); this.tail = job; return job;
  }
  async #polish() {
    const { buildReplay } = await import('./replay.mjs'); const llm = this.pool.llm; const spec = this.#spec;
    const paras = buildReplay(this, this.current, '__public__').novel.split('\n\n').filter(Boolean); if (!paras.length) throw new Error('还没有可以润色的内容');
    const chunks = []; let cur = ''; for (const p of paras) { if (cur && cur.length + p.length > 1100) { chunks.push(cur); cur = ''; } cur += (cur ? '\n\n' : '') + p; } if (cur) chunks.push(cur);
    const can = canaries(spec, this.s); const locked = can.filter((c) => c.kw.length <= 12); const names = [...spec.npcs.map((n) => n.name)];
    const system = `${this.pool.constitutionBlock()}\n\n【你的职责】把下面这段跑团记录改写成小说里的一节：第三人称，保留每一件发生的事、每一句对白的意思、所有人名地名物名和数字，先后顺序不变。可以把零碎的句子连起来，补上承接和少量环境描写（只用这段记录里出现过的东西）。\n【硬性规则】不许增加新的人物、物件、事件、数字、结论；不许解释谜底、不许预告后面的事；不写「玩家」「检定」「骰子」「线索」这些桌面之外的词，掷骰的过程不写，只写结果带来的样子；不用感叹号。\n【怎么写】句子用平常话，长短错开；不用「仿佛、似乎、渐渐、缓缓、隐约、一丝、弥漫、笼罩、若隐若现」这类词，不加比喻，一节的末尾不加感慨或意味深长的收束句——事情写完就停。只输出正文。`;
    const out = []; let polished = 0; const kept = []; let source = '';
    // 两节两节并行地改（长团有七八节，一节一节排队会等上好几分钟）；结果按原来的顺序拼回去
    const one = async (i, chunk) => {
      const audit = auditContext('novelist', system + '\n' + chunk, can, []);
      let text = '', why = '';
      // 最多两稿：第一稿不过闸，把原因告诉模型再写一稿；还不过就保留原文
      for (let attempt = 0; attempt < 2 && !text; attempt++) try {
        const r = await llm.complete({ role: 'novelist', system, user: chunk + (why ? `\n\n（上一稿的问题：${why}。请避开，重写这一节。）` : ''), maxTokens: 1500, temperature: 0.6, timeoutMs: 60_000, maxWaitMs: 30_000 }); source = r.provider;
        this.b.append('context.audit', { role: 'novelist', who: `第 ${i + 1} 节`, chars: audit.chars, leak: audit.leak, hits: audit.hits, source: r.provider, ms: r.ms, usage: r.usage || null }, { actor: 'isolation', vis: 'kp' });
        text = r.text.replace(/^(正文|小说)[:：]\s*/, '').trim();
        const v = [...inspect(text, { locked, maxLen: chunk.length * 2 + 300 }).filter((x) => ['泄露', '出戏', '讨好', '鼓励', '语气变轻', '过长'].includes(x.type) && !(x.type === '出戏' && chunk.includes(x.match))), ...consistency(text, { allNpcNames: names, material: chunk }).filter((x) => x.type !== '材料外的造物')];
        if (text.length < chunk.length * 0.4) v.push({ type: '删得太多', match: String(text.length) });
        if (v.length) { why = [...new Set(v.map((x) => `${x.type}「${x.match}」`))].join('、'); this.b.append('guard.alert', { role: 'novelist', who: `第 ${i + 1} 节`, violations: v, action: attempt ? 'keep-original' : 'retry' }, { actor: 'guard', vis: 'kp' }); text = ''; }
      } catch (e) { why = '模型没有回应'; }
      if (text) { polished++; out[i] = text; } else { kept.push({ section: i + 1, why }); out[i] = chunk; }
    };
    let next = 0; await Promise.all([0, 1].map(async () => { while (next < chunks.length) { const i = next++; await one(i, chunks[i]); } })); kept.sort((a, b) => a.section - b.section);
    this.b.append('novel.polished', { text: out.join('\n\n'), sections: chunks.length, polished, kept, source, round: this.s.round }, { actor: 'novelist', vis: 'public' });
    return { ok: true, sections: chunks.length, polished, kept };
  }
  save(name) { const sn = this.b.snapshot(name); this.saves.push({ name, branch: this.current, round: sn.round, at: sn.at }); this.b.append('save', { name, round: sn.round }, { actor: 'system', vis: 'public' }); return this.saves[this.saves.length - 1]; }
  rollback(round, name = '') {
    const id = `b${Object.keys(this.branches).length}`; const nb = this.b.fork(id, Number(round), name || `从第 ${round} 轮分出`);
    this.branches[id] = nb; this.current = id; return { branch: id, round: nb.state.round };
  }
  switchBranch(id) { if (!this.branches[id]) throw new Error('没有这条分支'); this.current = id; }

  // ------------------------------------------------------------------ 给界面的视图（按席位过滤）
  viewFor(viewer) {
    const s = this.s, sc = this.scene(), kp = viewer === 'kp';
    const here = Object.entries(s.npcs).filter(([, n]) => n.at === s.scene).map(([id, n]) => ({ id, name: this.world.npcs[id].name, public_identity: this.world.npcs[id].public_identity, met: n.met, ...(kp ? { attitude: n.attitude, mood: n.mood } : {}) }));
    const clues = Object.entries(s.clues).filter(([, c]) => kp || c.knownBy.includes(viewer)).map(([id, c]) => { const d = this.clueDef(id); return { id, name: d.name, content: d.content, key: kp ? d.key : undefined, found: c.found, round: c.round, form: d.carriers.find((k) => k.id === c.carrier)?.form || '', knownBy: c.knownBy }; });
    const out = {
      session: this.id, title: this.title, branch: this.current, round: s.round, clock: fmtClock(s.clock), ending: s.ending ? { id: s.ending.id, round: s.ending.round } : null,
      scene: { id: sc.id, name: sc.name, exits: sc.exits.map((e) => this.world.scenes[e].name), npcs: here, things: this.world.scenes[sc.id].obvious },
      pcs: Object.values(s.pcs).map((p) => ({ id: p.id, name: p.name, role: p.role, seat: p.seat, hp: p.hp, hpMax: p.hpMax, mind: p.mind, mindMax: p.mindMax, status: p.status, conditions: p.conditions, items: p.items, ...(kp || p.id === viewer ? { attrs: p.attrs, skills: p.skills, background: p.background, drive: p.drive, fear: p.fear, relations: p.relations, ticked: p.ticked } : {}) })),
      clues: kp ? clues : clues.filter((c) => c.found), clue_total: this.#spec.clues.length,
      safety: s.safety, seq: this.b.seq, busy: this.busy, foes: Object.values(s.foes || {}).map((f) => (kp ? f : { id: f.id, name: f.name, status: f.status })),
      branches: Object.values(this.branches).map((x) => ({ id: x.id, name: x.name, parent: x.parent, round: x.state.round, ending: x.state.ending?.id || null, events: x.log.length })),
      saves: this.saves, snapshots: Object.keys(this.b.snapshots).map(Number),
      model: this.pool.llm?.enabled && this.cfg.useModel ? this.pool.llm.describe() : [],
      terms: this.rp.terms, rulepack: { id: this.rp.id, name: this.rp.name, skills: this.rp.skills.map((k) => ({ id: k.id, name: k.name })), attributes: this.rp.attributes, weapons: this.rp.weapons.map((w) => ({ id: w.id, name: w.name, damage: w.damage })) },
    };
    if (kp) Object.assign(out, { phase: s.phase, phase_name: PHASE_NAME[s.phase], flags: s.flags, offTrack: s.offTrack, stall: s.stall, cfg: this.cfg, facts: s.facts, npcs_all: Object.entries(s.npcs).map(([id, n]) => ({ id, name: this.world.npcs[id].name, at: n.at, attitude: n.attitude, mood: n.mood })), triggers: this.#spec.triggers.map((t) => ({ id: t.id, name: t.name, fired: s.firedTriggers.includes(t.id) })), clue_defs: this.#spec.clues.map((c) => ({ id: c.id, name: c.name, key: c.key, carriers: c.carriers.map((k) => ({ id: k.id, form: k.form, via: k.via, where: k.where })) })), speech: s.speech, llm_stats: this.pool.llm?.stats || null, foe_hint: foeHint(this.#spec.truth.entity) });
    return out;
  }
  events(viewer, since = 0) { return this.b.log.filter((e) => e.seq > since && visibleTo(e, viewer)); }

  exportBundle() {
    return { format: 'zhangdeng.session/1', id: this.id, title: this.title, created: this.created, rulepack: this.rp.id, config: this.cfg, current: this.current, saves: this.saves, spec: clone(this.#spec), branches: Object.fromEntries(Object.entries(this.branches).map(([k, v]) => [k, v.toJSON()])) };
  }
  static fromBundle(bundle, { rp, llm, tokens, id }) {
    const branches = Object.fromEntries(Object.entries(bundle.branches).map(([k, v]) => [k, Branch.fromJSON(clone(v))]));
    const s = new Session({ id: id || bundle.id, spec: bundle.spec, rp, config: bundle.config, branches, current: bundle.current, tokens, llm, created: bundle.created, title: bundle.title });
    s.saves = bundle.saves || []; return s;
  }
}
