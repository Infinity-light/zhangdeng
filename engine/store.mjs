// L1 权威状态库 + L6 只追加日志 + 存档/分支。
// 全场唯一事实来源。任何改动都必须是一份「状态变更提案」，经 applyProposal 校验后落库；
// 来源是模型的提案只允许登记即兴事实，碰不到数值、物品、线索、flag。
import { createHash } from 'node:crypto';
import { Rng } from './rng.mjs';
import { derive, skillIdOf, attrIdOf } from './rules.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function buildPc(rp, pregen, seat) {
  const attrs = {}; for (const [k, v] of Object.entries(pregen.attrs_named || {})) { const id = attrIdOf(rp, k); if (id) attrs[id] = v; }
  for (const a of rp.attributes) attrs[a.id] ??= 50;
  const skills = Object.fromEntries(rp.skills.map((s) => [s.id, s.base]));
  for (const [k, v] of Object.entries(pregen.skills_named || {})) { const id = skillIdOf(rp, k); if (id) skills[id] = v; }
  const d = derive(rp, attrs);
  return {
    id: pregen.id, name: pregen.name, role: pregen.role, seat, attrs, skills,
    hp: d.hpMax, hpMax: d.hpMax, mind: d.mindStart, mindMax: d.mindStart, mindDayStart: d.mindStart, mindDayLost: 0,
    items: [...(pregen.items || [])], conditions: [], ticked: [], status: 'ok',
    background: pregen.background, drive: pregen.drive, fear: pregen.fear, relations: pregen.relations,
  };
}

export function initialState(spec, rp, { seats, seed }) {
  const pcs = {};
  for (const s of seats) { if (s.seat === 'empty') continue; const pg = spec.pregens.find((p) => p.id === s.pc); if (pg) pcs[pg.id] = buildPc(rp, { ...pg, name: s.name || pg.name }, s.seat); }
  return {
    round: 0, clock: spec.meta.start_clock, scene: spec.meta.start_scene || spec.scenes[0].id, phase: 'explore',
    pcs,
    npcs: Object.fromEntries(spec.npcs.map((n) => [n.id, { at: n.home, attitude: n.attitude_init, mood: n.mood_init, met: false, said: [], memory: [], smalltalk_i: 0, deflect_i: 0 }])),
    clues: Object.fromEntries(spec.clues.map((c) => [c.id, { found: false, round: null, carrier: null, by: null, knownBy: [], carriersUsed: [] }])),
    flags: {}, facts: [], visited: { [spec.meta.start_scene]: 1 }, examined: {}, beatsUsed: {}, firedTriggers: [],
    offTrack: 0, stall: 0, lastClueRound: 0, pendingPush: null, ending: null,
    safety: { fadeUntil: 0, level: 'full' }, speech: { human: 0, ai: 0 },
    rng: new Rng(seed).snapshot(), flavor: new Rng(`${seed}#flavor`).snapshot(),
  };
}

// 提案里允许的操作，以及谁能提。
const OPS = {
  'hp.delta': ['engine', 'console'], 'mind.delta': ['engine', 'console'], 'pc.condition': ['engine', 'console'], 'pc.status': ['engine', 'console'],
  'item.add': ['engine', 'console'], 'item.remove': ['engine', 'console'], 'skill.tick': ['engine'],
  'clue.reveal': ['engine', 'console'], 'flag.set': ['engine', 'console'], 'scene.move': ['engine', 'console'], 'clock.advance': ['engine', 'console'],
  'phase.set': ['engine', 'console'], 'npc.attitude': ['engine', 'console'], 'npc.mood': ['engine', 'console', 'model'], 'npc.move': ['engine', 'console'],
  'fact.add': ['engine', 'console', 'model'], 'foe.add': ['engine', 'console'], 'foe.hp': ['engine', 'console'], 'foe.remove': ['console'], 'skill.set': ['engine'], 'skill.untick': ['engine'], 'ending.set': ['engine'], 'safety.set': ['engine', 'console'],
};

export class Branch {
  constructor({ id, parent = null, state, log = [], snapshots = {}, created = Date.now(), name = '' }) {
    this.id = id; this.parent = parent; this.state = state; this.log = log; this.snapshots = snapshots; this.created = created; this.name = name;
    this.listeners = [];
  }
  get seq() { return this.log.length; }

  // 只追加：没有改、没有删。每条带上一条的哈希，事后能验链。
  append(type, data, { actor = 'system', vis = 'public' } = {}) {
    const prev = this.log.length ? this.log[this.log.length - 1].hash : 'genesis';
    const ev = { seq: this.log.length + 1, branch: this.id, round: this.state.round, clock: this.state.clock, scene: this.state.scene, ts: new Date().toISOString(), type, actor, vis, data: clone(data) };
    ev.prev = prev; ev.hash = sha(prev + JSON.stringify([ev.seq, ev.round, ev.type, ev.actor, ev.vis, ev.data]));
    this.log.push(ev);
    for (const l of this.listeners) l(ev);
    return ev;
  }

  verifyChain() {
    let prev = 'genesis';
    for (const ev of this.log) {
      if (ev.prev !== prev) return { ok: false, at: ev.seq, why: '链断了' };
      if (ev.hash !== sha(prev + JSON.stringify([ev.seq, ev.round, ev.type, ev.actor, ev.vis, ev.data]))) return { ok: false, at: ev.seq, why: '内容被改过' };
      prev = ev.hash;
    }
    return { ok: true, events: this.log.length };
  }

  // 状态变更提案 → 校验 → 落库 → 写日志。返回 { ok, applied, rejected }
  propose(source, ops, reason = '', vis = 'kp') {
    const kind = source.startsWith('model') ? 'model' : source.startsWith('console') ? 'console' : 'engine';
    const applied = [], rejected = [];
    for (const op of ops) {
      const allow = OPS[op.op];
      const err = !allow ? '未知操作' : !allow.includes(kind) ? `来源 ${kind} 无权执行 ${op.op}` : this.#validate(op);
      if (err) { rejected.push({ op, why: err }); continue; }
      applied.push(this.#apply(op));
    }
    if (applied.length) this.append('state.change', { source, reason, changes: applied }, { actor: source, vis });
    if (rejected.length) this.append('proposal.rejected', { source, reason, rejected }, { actor: source, vis: 'kp' });
    return { ok: !rejected.length, applied, rejected };
  }

  #validate(op) {
    const s = this.state;
    if (/^(hp|mind|item|pc|skill)\./.test(op.op) && !s.pcs[op.pc]) return `没有这个寻访者 ${op.pc}`;
    if (/^npc\./.test(op.op) && !s.npcs[op.npc]) return `没有这个 NPC ${op.npc}`;
    if ((op.op === 'hp.delta' || op.op === 'mind.delta' || op.op === 'clock.advance' || op.op === 'npc.attitude') && !Number.isInteger(op.value)) return '数值必须是整数';
    if (op.op === 'foe.add' && (!op.foe?.name || !(op.foe.hp > 0) || !(op.foe.skill >= 1 && op.foe.skill <= 99))) return '对手需要名字、生命值和 1–99 的战斗技能值';
    if ((op.op === 'foe.hp' || op.op === 'foe.remove') && !s.foes?.[op.foe]) return `没有这个对手 ${op.foe}`;
    if (op.op === 'foe.hp' && !Number.isInteger(op.value)) return '数值必须是整数';
    if (op.op === 'skill.set' && !(Number.isInteger(op.value) && op.value >= 0 && op.value <= 99)) return '技能值必须是 0–99 的整数';
    if (op.op === 'clock.advance' && op.value < 0) return '时间不能倒流（要回到过去请用回滚）';
    if (op.op === 'clue.reveal' && !s.clues[op.clue]) return `没有这条线索 ${op.clue}`;
    if (op.op === 'item.remove' && !s.pcs[op.pc].items.includes(op.item)) return `${op.pc} 身上没有 ${op.item}`;
    if (op.op === 'fact.add' && (!op.text || String(op.text).length > 200)) return '事实为空或过长';
    if (op.op === 'phase.set' && !['explore', 'investigate', 'press', 'confront', 'reveal', 'wrap'].includes(op.value)) return '未知相位';
    return null;
  }

  #apply(op) {
    const s = this.state; const pc = op.pc && s.pcs[op.pc]; const npc = op.npc && s.npcs[op.npc];
    switch (op.op) {
      case 'hp.delta': { const before = pc.hp; pc.hp = Math.max(0, Math.min(pc.hpMax, pc.hp + op.value)); return { ...op, before, after: pc.hp }; }
      case 'mind.delta': { const before = pc.mind; pc.mind = Math.max(0, Math.min(pc.mindMax, pc.mind + op.value)); if (op.value < 0) pc.mindDayLost += -op.value; return { ...op, before, after: pc.mind }; }
      case 'pc.condition': pc.conditions.push({ text: op.text, type: op.type, until: op.until ?? null }); return op;
      case 'pc.status': { const before = pc.status; pc.status = op.value; return { ...op, before }; }
      case 'item.add': if (!pc.items.includes(op.item)) pc.items.push(op.item); return op;
      case 'item.remove': pc.items.splice(pc.items.indexOf(op.item), 1); return op;
      case 'skill.tick': if (!pc.ticked.includes(op.skill)) pc.ticked.push(op.skill); return op;
      case 'clue.reveal': { const c = s.clues[op.clue]; const first = !c.found; if (first) { c.found = true; c.round = s.round; c.carrier = op.carrier; c.by = op.by; s.lastClueRound = s.round; } for (const p of op.to || Object.keys(s.pcs)) if (!c.knownBy.includes(p)) c.knownBy.push(p); if (op.carrier && !c.carriersUsed.includes(op.carrier)) c.carriersUsed.push(op.carrier); return { ...op, first }; }
      case 'flag.set': { const before = s.flags[op.flag] ?? null; s.flags[op.flag] = op.value ?? 1; return { ...op, before }; }
      case 'scene.move': { const before = s.scene; s.scene = op.scene; s.visited[op.scene] = (s.visited[op.scene] || 0) + 1; return { ...op, before }; }
      case 'clock.advance': { const before = s.clock; s.clock += op.value; return { ...op, before, after: s.clock }; }
      case 'phase.set': { const before = s.phase; s.phase = op.value; return { ...op, before }; }
      case 'npc.attitude': { const before = npc.attitude; npc.attitude = Math.max(-3, Math.min(4, npc.attitude + op.value)); return { ...op, before, after: npc.attitude }; }
      case 'npc.mood': { const before = npc.mood; npc.mood = String(op.value).slice(0, 12); return { ...op, before }; }
      case 'npc.move': { const before = npc.at; npc.at = op.scene; return { ...op, before }; }
      case 'fact.add': { const f = { id: `F${s.facts.length + 1}`, text: op.text, round: s.round, scene: op.scene || s.scene, source: op.source || 'improv' }; s.facts.push(f); return { ...op, id: f.id }; }
      case 'skill.set': { const before = pc.skills[op.skill] ?? null; pc.skills[op.skill] = op.value; return { ...op, before, after: op.value }; }
      case 'skill.untick': pc.ticked = []; return op;
      case 'foe.add': { s.foes ||= {}; const id = `foe${Object.keys(s.foes).length + 1}`; const f = op.foe; s.foes[id] = { id, name: String(f.name).slice(0, 20), hp: Math.round(f.hp), hpMax: Math.round(f.hp), skill: Math.round(f.skill), dodge: Math.round(f.dodge ?? f.skill / 2), damage: String(f.damage || '1d3'), armor: Math.round(f.armor || 0), dex: Math.round(f.dex || 50), scene: s.scene, status: 'ok' }; return { ...op, id }; }
      case 'foe.hp': { const f = s.foes[op.foe]; const before = f.hp; f.hp = Math.max(0, Math.min(f.hpMax, f.hp + op.value)); if (f.hp === 0) f.status = 'down'; return { ...op, before, after: f.hp }; }
      case 'foe.remove': { delete s.foes[op.foe]; return op; }
      case 'ending.set': s.ending = { id: op.ending, round: s.round }; return op;
      case 'safety.set': Object.assign(s.safety, op.value); return op;
    }
  }

  snapshot(label = '') {
    this.snapshots[this.state.round] = { round: this.state.round, seq: this.log.length, label, at: new Date().toISOString(), state: clone(this.state) };
    return this.snapshots[this.state.round];
  }

  // 从某一轮的快照分出一条新分支。原分支一个字节都不动；新分支拿到的是日志前缀的副本。
  fork(newId, round, name = '') {
    const snap = this.snapshots[round]; if (!snap) throw new Error(`第 ${round} 轮没有快照`);
    const b = new Branch({ id: newId, parent: { branch: this.id, round, seq: snap.seq }, state: clone(snap.state), log: clone(this.log.slice(0, snap.seq)), name });
    for (const [r, sn] of Object.entries(this.snapshots)) if (Number(r) <= round) b.snapshots[r] = clone(sn);
    b.append('branch.fork', { from: this.id, round, seq: snap.seq, name }, { actor: 'system', vis: 'public' });
    return b;
  }

  toJSON() { return { id: this.id, parent: this.parent, name: this.name, created: this.created, state: this.state, log: this.log, snapshots: this.snapshots }; }
  static fromJSON(j) { return new Branch(j); }
}

export const visibleTo = (ev, viewer) => viewer === 'kp' || ev.vis === 'public' || (ev.vis !== 'kp' && Array.isArray(ev.vis?.seats) && ev.vis.seats.includes(viewer));
