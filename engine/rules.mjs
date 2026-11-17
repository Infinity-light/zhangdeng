// L2 规则引擎：独立代码执行，模型碰不到。读规则包、掷骰、判定；每一次掷骰都返回完整的原始骰面，
// 由调用方写进只追加日志。verifyRoll() 可以只凭日志里的记录重算结果。
import { readFileSync } from 'node:fs';

export function loadRulepack(path) {
  const rp = JSON.parse(readFileSync(path, 'utf8'));
  return indexRulepack(rp);
}
// 名字解析表：正名 + 别名（+ id 本身）→ id。模组里写「侦查」还是「察觉」、「理智」还是「定力」，都认。
export function indexRulepack(rp) {
  rp.skillById = Object.fromEntries(rp.skills.map((s) => [s.id, s]));
  rp.skillIdByName = {}; for (const s of rp.skills) for (const n of [s.id, ...(s.aliases || []), s.name]) rp.skillIdByName[norm(n)] = s.id;
  rp.attrIdByName = {}; for (const a of rp.attributes) for (const n of [a.id, ...(a.aliases || []), a.name]) rp.attrIdByName[norm(n)] = a.id;
  rp.social_skill ||= 'talk';
  return rp;
}
const norm = (s) => String(s).trim().toLowerCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
export const skillIdOf = (rp, name) => rp.skillIdByName[norm(name)] || null;
export const attrIdOf = (rp, name) => rp.attrIdByName[norm(name)] || null;

// "2d6+1" / "1d3" / "4" / "-1" → { total, rolls, expr }
export function rollExpr(rng, expr) {
  const src = String(expr).replace(/\s+/g, '');
  const rolls = []; let total = 0;
  const re = /([+-]?)(\d+)(?:d(\d+))?/g; let m;
  if (!/^([+-]?\d+(d\d+)?)+$/.test(src)) throw new Error(`骰式不合法: ${expr}`);
  while ((m = re.exec(src))) {
    const sign = m[1] === '-' ? -1 : 1; const n = Number(m[2]);
    if (m[3]) { for (let i = 0; i < n; i++) { const v = rng.int(1, Number(m[3])); rolls.push({ d: Number(m[3]), v }); total += sign * v; } }
    else total += sign * n;
  }
  return { expr: src, rolls, total };
}

export function maxOfExpr(expr) {
  let total = 0; const re = /([+-]?)(\d+)(?:d(\d+))?/g; let m; const src = String(expr).replace(/\s+/g, '');
  while ((m = re.exec(src))) { const sign = m[1] === '-' ? -1 : 1; total += sign * Number(m[2]) * (m[3] ? Number(m[3]) : 1); }
  return total;
}

// 百分骰：个位骰 0-9，十位骰 0-9；00+0 记 100。顺势/逆势骰多掷十位骰，取优/取劣，互相抵消。
export function rollD100(rng, bonus = 0, penalty = 0) {
  const net = bonus - penalty;
  const units = rng.int(0, 9);
  const tens = [rng.int(0, 9)];
  for (let i = 0; i < Math.abs(net); i++) tens.push(rng.int(0, 9));
  const val = (t) => (t === 0 && units === 0 ? 100 : t * 10 + units);
  const candidates = tens.map(val);
  const value = net > 0 ? Math.min(...candidates) : net < 0 ? Math.max(...candidates) : candidates[0];
  return { units, tens, net, value };
}

export function levelOf(rp, value, skill) {
  const c = rp.check;
  const fumbleMin = skill < c.fumble_min_when_target_below.target ? c.fumble_min_when_target_below.min : c.fumble_min;
  if (value <= c.crit_max) return 'crit';
  if (value >= fumbleMin) return 'fumble';
  if (value <= Math.floor(skill * c.tiers.extreme.factor)) return 'extreme';
  if (value <= Math.floor(skill * c.tiers.hard.factor)) return 'hard';
  if (value <= skill) return 'regular';
  return 'fail';
}
const RANK = { fumble: 0, fail: 1, regular: 2, hard: 3, extreme: 4, crit: 5 };
export const rank = (lv) => RANK[lv];

// 技能检定。skill 是该角色的技能值；tier 是要求的难度等级。
export function skillCheck(rp, rng, { skill, tier = 'regular', bonus = 0, penalty = 0 }) {
  const dice = rollD100(rng, bonus, penalty);
  const level = levelOf(rp, dice.value, skill);
  const need = Math.floor(skill * rp.check.tiers[tier].factor);
  const success = level === 'crit' || (level !== 'fumble' && RANK[level] >= RANK[tier === 'regular' ? 'regular' : tier]);
  return { kind: 'skill', skill, tier, need, bonus, penalty, dice, value: dice.value, level, success };
}

// 组合检定：一次掷骰对多个技能值。mode: all（都过）/ any（过一个）
export function combinedCheck(rp, rng, { skills, tier = 'regular', mode = 'all' }) {
  const dice = rollD100(rng);
  const parts = skills.map((skill) => { const level = levelOf(rp, dice.value, skill); return { skill, level, success: level === 'crit' || (level !== 'fumble' && RANK[level] >= RANK[tier]) }; });
  const success = mode === 'all' ? parts.every((p) => p.success) : parts.some((p) => p.success);
  return { kind: 'combined', mode, tier, dice, value: dice.value, parts, success };
}

// 对抗检定：比成功等级，等级相同比技能值，再相同算防守方（b）胜。
export function opposedCheck(rp, rng, a, b) {
  const ra = skillCheck(rp, rng, a), rb = skillCheck(rp, rng, b);
  let winner;
  if (!ra.success && !rb.success) winner = 'none';
  else if (RANK[ra.level] !== RANK[rb.level]) winner = RANK[ra.level] > RANK[rb.level] ? 'a' : 'b';
  else winner = a.skill > b.skill ? 'a' : 'b';
  return { kind: 'opposed', a: ra, b: rb, winner };
}

// 定力检定：与当前定力比较；成功/失败各自的损失骰式；大失败取失败损失的最大值。
export function mindCheck(rp, rng, { current, lossSuccess = '0', lossFail = '1d4', cap = null, int = 50, dayStart = current, dayLost = 0 }) {
  const dice = rollD100(rng);
  const level = levelOf(rp, dice.value, current);
  const success = dice.value <= current && level !== 'fumble';
  let lossRoll;
  if (level === 'fumble') lossRoll = { expr: lossFail, rolls: [], total: maxOfExpr(lossFail), maxed: true };
  else lossRoll = rollExpr(rng, success ? lossSuccess : lossFail);
  let loss = Math.max(0, lossRoll.total);
  if (cap != null) loss = Math.min(loss, cap);
  loss = Math.min(loss, current);
  const after = current - loss;
  const out = { kind: 'mind', current, dice, value: dice.value, level, success, lossExpr: success ? lossSuccess : lossFail, lossRoll, loss, after, disorder: null };
  if (after === 0) out.disorder = { type: 'permanent', text: rp.mind.permanent_text || '定力归零。这位寻访者不再属于这张桌子。' };
  else if (loss >= rp.mind.bout_threshold) {
    const intDice = rollD100(rng);
    const understood = intDice.value <= int;
    out.intCheck = { dice: intDice, value: intDice.value, target: int, success: understood };
    if (understood) {
      const idx = rng.int(1, rp.disorder_short.length);
      const dur = rollExpr(rng, rp.mind.bout_duration);
      out.disorder = { type: 'short', tableIndex: idx, text: rp.disorder_short[idx - 1], rounds: dur.total, durRoll: dur };
    }
  }
  if (!out.disorder && dayLost + loss >= Math.max(1, Math.floor(dayStart * rp.mind.long_fraction))) {
    const idx = rng.int(1, rp.disorder_long.length);
    out.disorder = { type: 'long', tableIndex: idx, text: rp.disorder_long[idx - 1] };
  }
  return out;
}

// 伤害加值：按规则包指定的属性之和查表（默认只看力量）。传整张属性表，或直接传一个数。
export function damageBonus(rp, attrs) {
  const sum = typeof attrs === 'number' ? attrs : (rp.combat.damage_bonus_attrs || ['str']).reduce((n, k) => n + (attrs[k] ?? 50), 0);
  const row = rp.combat.damage_bonus.find((b) => sum <= (b.max ?? b.str_max)) || rp.combat.damage_bonus[rp.combat.damage_bonus.length - 1];
  return row.bonus;
}

// 一次攻击交换：攻击方出手，防守方选择闪避(dodge)或反击(counter)。返回完整骰面与伤害。
export function attackExchange(rp, rng, { attacker, defender, weapon, response = 'dodge' }) {
  const w = rp.weapons.find((x) => x.id === weapon) || rp.weapons[0];
  const atk = skillCheck(rp, rng, { skill: attacker.skills[w.skill] ?? rp.skillById[w.skill].base });
  const defSkillId = response === 'dodge' ? 'dodge' : 'brawl';
  const def = skillCheck(rp, rng, { skill: defender.skills[defSkillId] ?? rp.skillById[defSkillId].base });
  const out = { kind: 'attack', weapon: w.id, response, atk, def, hit: false, counterHit: false, damage: 0, counterDamage: 0 };
  const dmg = (who, wp, impale) => {
    const base = rollExpr(rng, wp.damage); const db = rollExpr(rng, damageBonus(rp, who.attrs));
    let total = base.total + db.total; if (impale) total += maxOfExpr(wp.damage);
    return { base, db, total: Math.max(0, total) };
  };
  if (response === 'dodge') {
    // 闪避：平手归防守方
    if (atk.success && (!def.success || RANK[atk.level] > RANK[def.level])) out.hit = true;
  } else {
    // 反击：平手归攻击方；防守方胜出则打回去
    if (atk.success && (!def.success || RANK[atk.level] >= RANK[def.level])) out.hit = true;
    else if (def.success) out.counterHit = true;
  }
  if (out.hit) { const d = dmg(attacker, w, atk.level === 'extreme' || atk.level === 'crit'); out.damageRoll = d; out.damage = Math.max(0, d.total - (defender.armor || 0)); out.armor = defender.armor || 0; }
  if (out.counterHit) { const d = dmg(defender, rp.weapons[0], false); out.counterRoll = d; out.counterDamage = Math.max(0, d.total - (attacker.armor || 0)); }
  return out;
}

// 伤害后果：单次伤害达到体魄上限一半 → 重伤，过体质检定否则昏迷；体魄归零 → 濒死；重伤且归零 → 死亡。
export function woundOutcome(rp, rng, { hp, hpMax, damage, con, majorWound = false }) {
  const after = Math.max(0, hp - damage);
  const out = { before: hp, damage, after, major: majorWound, status: 'ok' };
  if (damage >= Math.ceil(hpMax * rp.combat.major_wound_fraction)) {
    out.major = true;
    const c = skillCheck(rp, rng, { skill: con }); out.conCheck = c;
    out.status = c.success ? 'major' : 'unconscious';
  }
  if (after === 0) out.status = out.major ? 'dead' : 'dying';
  return out;
}

export function initiativeOrder(rp, combatants) {
  const a = rp.combat.initiative_attr;
  return [...combatants].sort((x, y) => (y.attrs[a] - x.attrs[a]) || String(x.id).localeCompare(String(y.id))).map((c) => c.id);
}

// 团后成长：勾选过的技能掷 d100，高于当前值则 +gain。
export function growthRoll(rp, rng, skillValue) {
  const dice = rollD100(rng); const grow = dice.value > skillValue || dice.value >= 96;
  const gain = grow ? rollExpr(rng, rp.growth.gain) : null;
  return { kind: 'growth', dice, value: dice.value, before: skillValue, grow, gain, after: Math.min(99, skillValue + (gain ? gain.total : 0)) };
}

export function derive(rp, attrs) {
  const f = (expr) => Function(...Object.keys(attrs), 'round', 'floor', 'ceil', `return ${expr}`)(...Object.values(attrs), Math.round, Math.floor, Math.ceil);
  return { hpMax: f(rp.derived.hp_max), mindStart: f(rp.derived.mind_start) };
}

// 只凭日志里的一条掷骰记录重算，核对结论是否与骰面一致（Replay 里“100% 可核对”靠这个）。
export function verifyRoll(rp, rec) {
  const d = rec.dice; if (!d) return { ok: true };
  const val = (t) => (t === 0 && d.units === 0 ? 100 : t * 10 + d.units);
  const cs = d.tens.map(val);
  const value = d.net > 0 ? Math.min(...cs) : d.net < 0 ? Math.max(...cs) : cs[0];
  if (value !== rec.value) return { ok: false, why: `骰面合成值 ${value} ≠ 记录值 ${rec.value}` };
  if (rec.kind === 'skill') {
    const level = levelOf(rp, value, rec.skill);
    const success = level === 'crit' || (level !== 'fumble' && RANK[level] >= RANK[rec.tier]);
    if (level !== rec.level || success !== rec.success) return { ok: false, why: '成功等级与骰面不符' };
  }
  if (rec.kind === 'growth') { const grow = value > rec.skill || value >= 96; if (grow !== rec.success) return { ok: false, why: '成长检定结论与骰面不符' }; }
  if (rec.kind === 'mind') {
    const success = value <= rec.current && levelOf(rp, value, rec.current) !== 'fumble';
    if (success !== rec.success) return { ok: false, why: '定力检定成败与骰面不符' };
    if (rec.after !== rec.current - rec.loss) return { ok: false, why: '定力前后值与损失不符' };
    if (!rec.lossRoll.maxed && rec.lossRoll.rolls.length) {
      const sum = rec.lossRoll.rolls.reduce((s, r) => s + r.v, 0);
      if (!/[+-]\d+$/.test(rec.lossRoll.expr) && sum !== rec.lossRoll.total) return { ok: false, why: '损失骰合计不符' };
    }
  }
  return { ok: true };
}
