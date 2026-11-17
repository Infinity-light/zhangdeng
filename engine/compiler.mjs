// L0 模组编译器：模组文本 → module.spec（机器可读）+ 审阅问题清单。
// 两条路：
//   1) 结构化 Markdown（docs/模组写法.md 的写法）→ 确定性解析，不用模型；
//   2) 自由文本 → extract.mjs：模型分三段只做「读」，编号与引用由确定性代码组装，再走同一套校验。
// 无论哪条路，产物都带 reviewed:false，必须经审阅页确认后才允许开团。

const splitList = (s) => String(s || '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
const yes = (s) => /^(是|true|yes|主)$/i.test(String(s || '').trim());

export function parseTree(md) {
  const root = { level: 0, title: '', props: {}, body: [], children: [] };
  const stack = [root];
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length; let title = h[2].trim(); let id = null;
      const idm = /\{#([\w-]+)\}\s*$/.exec(title); if (idm) { id = idm[1]; title = title.replace(idm[0], '').trim(); }
      let kind = null; const km = /^(可调查|知道)\s*[:：]\s*(.*)$/.exec(title); if (km) { kind = km[1]; title = km[2].trim(); }
      const node = { level, title, id, kind, props: {}, body: [], children: [] };
      while (stack[stack.length - 1].level >= level) stack.pop();
      stack[stack.length - 1].children.push(node); stack.push(node);
      continue;
    }
    const cur = stack[stack.length - 1];
    if (/^\s*>/.test(line)) continue;
    const p = /^\s*-\s*([^:：|]{1,12})[:：]\s*(.*)$/.exec(line);
    if (p) { (cur.props[p[1].trim()] ||= []).push(p[2].trim()); continue; }
    if (line.trim()) cur.body.push(line.trim());
  }
  return root;
}

export function parseClock(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
export const fmtClock = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${min >= 1440 ? '次日 ' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

// "flag:x & !flag:y & 时间>=23:30 & 场景:dock & 物品:钥匙 & 线索:C1" → 原子数组
export function parseCond(s) {
  if (!s || !String(s).trim()) return null;
  return String(s).split('&').map((a) => a.trim()).filter(Boolean).map((a) => {
    let neg = false; if (a.startsWith('!')) { neg = true; a = a.slice(1).trim(); }
    let m;
    if ((m = /^flag[:：](\w+)$/.exec(a))) return { t: 'flag', k: m[1], neg };
    if ((m = /^线索[:：](\w+)$/.exec(a))) return { t: 'clue', k: m[1], neg };
    if ((m = /^物品[:：](.+)$/.exec(a))) return { t: 'item', k: m[1].trim(), neg };
    if ((m = /^场景[:：](\w+)$/.exec(a))) return { t: 'scene', k: m[1], neg };
    if ((m = /^时间\s*(>=|<)\s*(\d{1,2}:\d{2})$/.exec(a))) return { t: 'time', op: m[1], v: parseClock(m[2]), neg };
    return { t: 'bad', raw: a };
  });
}
export const condText = (c) => !c ? '' : c.map((a) => (a.neg ? '!' : '') + (a.t === 'flag' ? `flag:${a.k}` : a.t === 'clue' ? `线索:${a.k}` : a.t === 'item' ? `物品:${a.k}` : a.t === 'scene' ? `场景:${a.k}` : a.t === 'time' ? `时间${a.op}${fmtClock(a.v).replace('次日 ', '').replace(/^(\d\d)/, (h) => (a.v >= 1440 ? String(Number(h) + 24) : h))}` : a.raw)).join(' & ');

export const AI_DEFAULTS = () => ({ voice: '话不多，先看别人的反应再开口；害怕的时候句子会变短。', misread: ['会不会只是凑巧。', '这个……我说不好，也许是我想多了。', '我见过差不多的事，后来发现是人干的。'], retreat: ['你们拿主意，我跟着。', '我在后面看着。我不往前了。', '我有点喘不上气。等我一下。'], chatter: ['这地方太静了。', '我的手是凉的。', '刚才那一下，你们也听见了吧。'], dunno: [] });
const p1 = (n, k, d = '') => (n.props[k] && n.props[k][0]) ?? d;
const pall = (n, k) => n.props[k] || [];
const sec = (root, name) => root.children.find((c) => c.title.replace(/\s/g, '').startsWith(name));

// 检定的几种通行写法都认：「侦查/困难」「困难侦查」「侦查（困难）」「侦查检定 困难」「侦查/普通/奖励骰1」「聆听，惩罚骰」
export function parseCheck(s, extra = {}) {
  if (!s || !String(s).trim()) return null;
  let t = String(s).trim().replace(/／/g, '/'); let tier = '普通', bonus = Number(extra.bonus) || 0, penalty = Number(extra.penalty) || 0;
  const num = (x) => (x === undefined || x === '' ? 1 : ({ 一: 1, 两: 2, 二: 2 }[x] || Number(x) || 1));
  t = t.replace(/[,，/、 ]*(?:(\d|一|两|二)?[个枚颗]?)(奖励骰|顺势骰|惩罚骰|逆势骰)[x×*]?(\d)?/g, (_, a, k, b) => { const n = num(a ?? b); if (/奖励|顺势/.test(k)) bonus += n; else penalty += n; return ''; });
  const tm = /(普通|常规|困难|极难|极限)(?:难度|成功)?/.exec(t);
  if (tm) { tier = { 常规: '普通', 极限: '极难' }[tm[1]] || tm[1]; t = t.replace(tm[0], ''); }
  const skill = t.replace(/检定|[()（）/,，、:：]|\s/g, '').trim();
  if (!skill) return null;
  const out = { skill, tier }; if (bonus) out.bonus = bonus; if (penalty) out.penalty = penalty; return out;
}
// 心智损失的通行记法「成功损失/失败损失」：「0/1d3」「1/1D6」「SC 1/1d6」「理智检定 1d2/1d8」都认
export function parseMind(s) {
  if (!s) return null; const m = /(\d+(?:d\d+)?(?:[+-]\d+)?)\s*[/／]\s*(\d+(?:d\d+)?(?:[+-]\d+)?)/i.exec(String(s).replace(/D/g, 'd'));
  return m ? { success: m[1].toLowerCase(), fail: m[2].toLowerCase() } : null;
}
const MIND_KEYS = ['定力', '理智', '理智检定', 'SAN', 'SAN检定', 'san', 'San', 'SAN值', 'SC', '定力检定'];
const pAny = (n, keys) => { for (const k of keys) if (n.props[k]?.[0]) return n.props[k][0]; return ''; };
function parseAttitude(s) { if (!s) return null; const [npc, d] = s.split(':'); return { npc: npc.trim(), delta: Number(d) }; }
function parseKV(s) { const out = {}; for (const part of splitList(s)) { const m = /^(.+?)\s+(\d+)$/.exec(part); if (m) out[m[1].trim()] = Number(m[2]); } return out; }

export function compileMarkdown(md, opts = {}) {
  const { sourceName = 'module.md' } = opts;
  const tree = parseTree(md);
  const top = tree.children[0];
  if (!top) throw new Error('没有找到一级标题，无法识别为模组');
  const S = (name) => sec(top, name) || { props: {}, body: [], children: [] };
  const meta = S('元数据'), con = S('宪法');
  const spec = {
    spec_version: '1', reviewed: false, source: { name: sourceName, chars: md.length, compiler: 'markdown' },
    meta: {
      title: top.title, players: p1(meta, '推荐人数'), era: p1(meta, '时代'), place: p1(meta, '地点'), duration: p1(meta, '预计时长'),
      rulepack: p1(meta, '规则包', 'chaohen-v1'), horror_level: p1(meta, '恐怖尺度'), content_warnings: splitList(p1(meta, '内容提示')),
      start_clock: parseClock(p1(meta, '开场时间', '16:00')) ?? 960, start_scene: p1(meta, '开场场景'), opening: p1(meta, '开场白'),
    },
    constitution: { tone: p1(con, '基调'), style_bans: pall(con, '语气禁令'), immutable_facts: pall(con, '不可变事实'), travel: pall(con, '路上'), free: pall(con, '无回应'), probe: pall(con, '无人应答') },
    scenes: [], clues: [], npcs: [], truth: {}, triggers: [], endings: [], key_choices: [], pregens: [],
  };

  for (const n of S('场景').children) {
    spec.scenes.push({
      id: n.id, name: n.title, kind: yes(p1(n, '类型', '主')) ? 'main' : 'side', aliases: splitList(p1(n, '别名')),
      exits: splitList(p1(n, '出口')), npcs: splitList(p1(n, '在场')), goal: p1(n, '幕目标'),
      public_desc: n.body.join('\n'), beats: pall(n, '氛围'), press_beats: pall(n, '加压氛围'),
      interactables: n.children.filter((c) => c.kind === '可调查').map((c) => ({
        id: c.id, name: c.title, keywords: splitList(p1(c, '关键词')), obvious: yes(p1(c, '明显')),
        requires: parseCond(p1(c, '需要')), blocked_text: p1(c, '受阻'), bypass_check: parseCheck(p1(c, '绕行检定')), bypass_flag: p1(c, '绕行置flag') || null,
        clue: p1(c, '线索') || null, carrier: p1(c, '载体') || null,
        check: parseCheck(p1(c, '检定'), { bonus: pAny(c, ['奖励骰', '顺势骰']), penalty: pAny(c, ['惩罚骰', '逆势骰']) }), fail_text: p1(c, '失败'), fail_attitude: parseAttitude(p1(c, '失败态度')),
        mind: parseMind(pAny(c, MIND_KEYS)), phase_floor: p1(c, '阶段') || null, set_flag: p1(c, '置flag') || null, give_item: p1(c, '给物品') || null,
        minutes: Number(p1(c, '耗时', '15')), text: c.body.join('\n'),
      })),
    });
  }

  for (const n of S('线索').children) {
    spec.clues.push({
      id: n.id, name: n.title, content: p1(n, '内容'), scene: p1(n, '所在'), points_to: p1(n, '指向'), key: yes(p1(n, '关键')),
      give_item: p1(n, '给物品') || null,
      carriers: pall(n, '载体').map((s) => { const [id, form, where, via, ...t] = s.split('|').map((x) => x.trim()); const [v, cond] = String(via || '').split('@'); return { id, form, where, via: v.trim(), when: parseCond(cond), text: /^（见/.test(t.join('|')) ? '' : t.join('|') }; }),
    });
  }

  for (const n of S('NPC').children) {
    spec.npcs.push({
      id: n.id, name: n.title, aliases: splitList(p1(n, '别名')), public_identity: p1(n, '公开身份'), true_identity: p1(n, '真实身份'),
      motive: p1(n, '动机'), home: p1(n, '常驻'), attitude_init: Number(p1(n, '初始态度', '0')), mood_init: p1(n, '初始情绪'),
      voice: { style: p1(n, '口吻'), catchphrases: pall(n, '口头禅'), lexicon: splitList(p1(n, '常用词')), banned: splitList(p1(n, '禁用词')) },
      nonverbal: /动作|不说话|哑/.test(p1(n, '表达')), repeat: pall(n, '重复'), redlines: pall(n, '红线'), greet: pall(n, '招呼'), smalltalk: pall(n, '闲谈'), deflect: pall(n, '推脱'),
      knowledge: n.children.filter((c) => c.kind === '知道').map((c) => ({
        id: c.id, title: c.title, topics: splitList(p1(c, '话题')), share: { 随口: 'free', 信任: 'trust', 绝不: 'never' }[p1(c, '分享', '随口')] || 'free',
        trust_min: Number(p1(c, '信任门槛', '0')), show_clue: p1(c, '出示') || null, gives_clue: p1(c, '给线索') || null, carrier: p1(c, '载体') || null,
        set_flag: p1(c, '置flag') || null, give_item: p1(c, '给物品') || null, say: c.body.join('\n'),
      })),
    });
  }

  const tr = S('真相层');
  spec.truth = {
    summary: p1(tr, '幕后真相'), entity: p1(tr, '存在'),
    timeline: pall(tr, '时间线').map((s) => { const [when, what] = s.split(/[｜|]/).map((x) => x.trim()); return { when, what }; }),
    never_reveal: pall(tr, '不可泄露').map((s) => { const [id, text, kw, unlock] = s.split('|').map((x) => x.trim()); return { id, text, keywords: splitList(kw), unlock: unlock === '永不' ? null : unlock }; }),
  };

  for (const n of S('触发器').children) {
    spec.triggers.push({ id: n.id, name: n.title, when: parseCond(p1(n, '条件')), once: true, effects: pall(n, '效果'), public_text: n.body.join('\n'), kp_note: p1(n, '导演注') });
  }
  for (const n of S('结局').children) {
    spec.endings.push({ id: n.id, name: n.title, when_any: pall(n, '条件').map(parseCond), text: n.body.join('\n') });
  }
  for (const n of S('关键抉择').children) {
    spec.key_choices.push({ id: n.id, name: n.title, requires: parseCond(p1(n, '需要')), hint: p1(n, '提示') || '', options: pall(n, '选项').map((s) => { const [id, kw, flag, label] = s.split('|').map((x) => x.trim()); return { id, keywords: splitList(kw), set_flag: flag === '-' ? null : flag, label }; }) });
  }
  for (const n of (sec(top, '预设寻访者') || sec(top, '预设调查员') || sec(top, '预设角色') || sec(top, '调查员') || { children: [] }).children) {
    spec.pregens.push({
      id: n.id, name: n.title, role: p1(n, '身份'), attrs_named: parseKV(p1(n, '属性')), skills_named: parseKV(p1(n, '技能')),
      background: p1(n, '背景'), drive: p1(n, '执念'), fear: p1(n, '恐惧源'), relations: p1(n, '关系'), items: splitList(p1(n, '物品')),
      // 模组没给 AI 席位写台词时的兜底：够离线演员用，也够当模型的口吻参照
      ai: { authored: !!p1(n, 'AI口吻'), ...AI_DEFAULTS(), ...Object.fromEntries(Object.entries({ voice: p1(n, 'AI口吻'), misread: pall(n, 'AI误读'), retreat: pall(n, 'AI退缩'), chatter: pall(n, 'AI闲话'), dunno: pall(n, 'AI不知道') }).filter(([, v]) => v && v.length)) },
    });
  }
  spec.issues = validateSpec(spec, opts.rulepacks?.[spec.meta.rulepack]);
  return spec;
}

// 校验：悬空引用、关键线索载体不足、够不到的场景、坏条件……都列出来给人看，不默默放过。
// rp 可选：给了规则包，就顺带核对检定里写的技能名、预设角色的属性与技能名在这个规则包里认不认得。
export const FOE_RE = /^对手登场[:：]\s*([^|｜]+)[|｜]\s*(\d+)\s*[|｜]\s*(\d+)\s*[|｜]\s*([0-9dD+\-]+)\s*(?:[|｜]\s*(\d+))?\s*$/;
const EFFECT_RE = [/^flag[:：]\w+=\w+$/, /^阶段[:：](探索|调查|加压|对抗|揭示|收束)$/, /^(?:定力|理智|SAN|san)\s*检定[:：]全体[:：].+\/.+$/, FOE_RE];
// 从「存在」那段文字里读出怪物的战斗数据（给规则台预填用）：生命值/体魄 12，斗殴/搏击/攻击 45，伤害 1d4，护甲 1
export function foeHint(entity) {
  const t = String(entity || ''); if (!t) return null; const n = (re) => (re.exec(t) || [])[1];
  const hp = n(/(?:生命值|生命|体魄|HP)\s*(\d+)/i), skill = n(/(?:斗殴|搏击|格斗|攻击|战斗)\s*(\d+)/), damage = n(/伤害\s*([0-9dD+\-]+(?:\s*\+\s*[0-9dD]+)?)/), armor = n(/护甲\s*(\d+)/);
  if (!hp || !skill) return null;
  return { name: t.split(/[。（(，,：:]/)[0].trim().slice(0, 12), hp: Number(hp), skill: Number(skill), damage: (damage || '1d3').replace(/\s+/g, '').toLowerCase(), armor: Number(armor || 0) };
}
export function validateSpec(spec, rp = null) {
  const issues = []; const add = (level, where, msg) => issues.push({ level, where, msg });
  for (const n of spec.assembly_notes || []) add('warn', '自由文本组装', n);
  const norm = (s) => String(s).trim().toLowerCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
  const skillOk = (name) => !rp || !!rp.skillIdByName?.[norm(name)] || !!rp.attrIdByName?.[norm(name)];
  if (rp) {
    for (const p of spec.pregens || []) {
      for (const k of Object.keys(p.attrs_named || {})) if (!rp.attrIdByName?.[norm(k)]) add('warn', `预设「${p.name}」`, `属性「${k}」不在规则包「${rp.name}」里，会被忽略（按 50 计）`);
      for (const k of Object.keys(p.skills_named || {})) if (!skillOk(k)) add('warn', `预设「${p.name}」`, `技能「${k}」不在规则包「${rp.name}」里，会被忽略`);
    }
  }
  const sceneIds = new Set(spec.scenes.map((s) => s.id)), clueIds = new Set(spec.clues.map((c) => c.id)), npcIds = new Set(spec.npcs.map((n) => n.id));
  if (!spec.meta?.title) add('error', '元数据', '缺少标题');
  if (!spec.scenes.length) add('error', '场景', '一个场景也没有解析出来');
  if (!spec.endings.length) add('error', '结局', '没有结局条件；结局判定只认 spec，没有就永远收不了团');
  if (!spec.truth?.summary) add('warn', '真相层', '没有幕后真相。没有真相层就没有需要隔离的东西');
  if (spec.meta.start_scene && !sceneIds.has(spec.meta.start_scene)) add('error', '元数据', `开场场景 ${spec.meta.start_scene} 不存在`);
  const badCond = (c, where) => (c || []).forEach((a) => {
    if (a.t === 'bad') add('error', where, `看不懂的条件「${a.raw}」`);
    if (a.t === 'clue' && !clueIds.has(a.k)) add('error', where, `条件引用了不存在的线索 ${a.k}`);
    if (a.t === 'scene' && !sceneIds.has(a.k)) add('error', where, `条件引用了不存在的场景 ${a.k}`);
  });
  const carrierIds = new Set();
  for (const s of spec.scenes) {
    if (!s.id) add('error', `场景「${s.name}」`, '缺少 {#id}');
    for (const e of s.exits) if (!sceneIds.has(e)) add('error', `场景「${s.name}」`, `出口 ${e} 不存在`);
    for (const n of s.npcs) if (!npcIds.has(n)) add('error', `场景「${s.name}」`, `在场 NPC ${n} 不存在`);
    if (!s.public_desc) add('warn', `场景「${s.name}」`, '没有公开描述');
    if (s.beats.length < 2) add('warn', `场景「${s.name}」`, '氛围句少于 2 条，长团里容易重复');
    for (const it of s.interactables) {
      badCond(it.requires, `场景「${s.name}」· ${it.name}`);
      if (it.clue && !clueIds.has(it.clue)) add('error', `场景「${s.name}」· ${it.name}`, `引用了不存在的线索 ${it.clue}`);
      for (const ck of [it.check, it.bypass_check]) if (ck && !skillOk(ck.skill)) add('warn', `场景「${s.name}」· ${it.name}`, `检定技能「${ck.skill}」不在规则包「${rp.name}」里，开团后会按基础值 10 掷；请改成规则包里的技能名或它的别名`);
      if (it.check && !['普通', '困难', '极难'].includes(it.check.tier)) add('error', `场景「${s.name}」· ${it.name}`, `看不懂的难度「${it.check.tier}」`);
      if (it.phase_floor && !['探索', '调查', '加压', '对抗', '揭示', '收束'].includes(it.phase_floor)) add('error', `场景「${s.name}」· ${it.name}`, `看不懂的阶段「${it.phase_floor}」`);
      if (it.check && !it.fail_text) add('warn', `场景「${s.name}」· ${it.name}`, '有检定却没有写失败后果');
      if (!it.keywords.length) add('warn', `场景「${s.name}」· ${it.name}`, '没有关键词，玩家的话里认不出它');
    }
  }
  const reach = new Set([spec.meta.start_scene]); let grew = true;
  while (grew) { grew = false; for (const s of spec.scenes) if (reach.has(s.id)) for (const e of s.exits) if (!reach.has(e)) { reach.add(e); grew = true; } }
  for (const s of spec.scenes) if (!reach.has(s.id)) add('warn', `场景「${s.name}」`, '从开场场景走不到这里');
  for (const c of spec.clues) {
    if (!sceneIds.has(c.scene)) add('error', `线索 ${c.id}`, `所在场景 ${c.scene} 不存在`);
    if (c.points_to && !sceneIds.has(c.points_to)) add('warn', `线索 ${c.id}`, `指向 ${c.points_to} 不是一个场景`);
    if (c.key && c.carriers.length < 2) add('warn', `线索 ${c.id}`, '关键线索只有一种载体：漏掉就是死局，请至少补一种备用投放');
    if (c.key && !c.carriers.some((k) => k.via === '事件')) add('warn', `线索 ${c.id}`, '关键线索没有「事件」型备用载体，玩家跑偏时无法柔性补线');
    for (const k of c.carriers) {
      if (carrierIds.has(k.id)) add('error', `线索 ${c.id}`, `载体编号 ${k.id} 重复`); carrierIds.add(k.id);
      if (k.where !== 'any' && !sceneIds.has(k.where)) add('error', `线索 ${c.id}`, `载体 ${k.id} 的地点 ${k.where} 不存在`);
      if (k.via === '事件' && !k.text) add('error', `线索 ${c.id}`, `事件型载体 ${k.id} 没有写文本`);
      badCond(k.when, `线索 ${c.id} 载体 ${k.id}`);
    }
  }
  for (const n of spec.npcs) {
    if (n.home && !sceneIds.has(n.home)) add('error', `NPC「${n.name}」`, `常驻场景 ${n.home} 不存在`);
    if (!n.voice.style) add('warn', `NPC「${n.name}」`, '没有口吻锚，容易串味');
    if (n.deflect.length < 2) add('warn', `NPC「${n.name}」`, '推脱句少于 2 条');
    for (const k of n.knowledge) if (k.gives_clue && !clueIds.has(k.gives_clue)) add('error', `NPC「${n.name}」· ${k.title}`, `给出的线索 ${k.gives_clue} 不存在`);
  }
  for (const t of spec.triggers) { badCond(t.when, `触发器「${t.name}」`); for (const e of t.effects || []) if (!EFFECT_RE.some((re) => re.test(e))) add('error', `触发器「${t.name}」`, `看不懂的效果「${e}」。可用：flag:名=1｜阶段:加压｜理智检定:全体:0/1d4｜对手登场:名称|生命|战斗技能|伤害|护甲`); }
  for (const e of spec.endings) { if (!e.when_any.length) add('error', `结局「${e.name}」`, '没有达成条件'); e.when_any.forEach((c) => badCond(c, `结局「${e.name}」`)); }
  for (const nr of spec.truth?.never_reveal || []) { if (nr.unlock && !clueIds.has(nr.unlock)) add('error', `不可泄露 ${nr.id}`, `解锁线索 ${nr.unlock} 不存在`); if (!nr.keywords.length) add('warn', `不可泄露 ${nr.id}`, '没有关键词，泄露过滤器拦不住它'); }
  return issues;
}

export function specSummary(spec) {
  return {
    title: spec.meta.title, scenes: spec.scenes.length, main_scenes: spec.scenes.filter((s) => s.kind === 'main').length,
    clues: spec.clues.length, key_clues: spec.clues.filter((c) => c.key).length, carriers: spec.clues.reduce((n, c) => n + c.carriers.length, 0),
    npcs: spec.npcs.length, truth: spec.truth?.summary ? 1 : 0, never_reveal: spec.truth?.never_reveal?.length || 0,
    triggers: spec.triggers.length, endings: spec.endings.length, checks: spec.scenes.reduce((n, s) => n + s.interactables.filter((i) => i.check || i.mind).length, 0),
    immutable_facts: spec.constitution.immutable_facts.length, errors: spec.issues.filter((i) => i.level === 'error').length, warns: spec.issues.filter((i) => i.level === 'warn').length,
  };
}

// 自由文本这条路在 extract.mjs：分三段小抽取，由确定性代码组装成同一种 spec。
export const looksStructured = (md) => /^##\s*场景/m.test(md) && /^##\s*线索/m.test(md) && /^##\s*(NPC|结局)/m.test(md);
