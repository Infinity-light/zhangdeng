// L0 模组编译器 · 自由文本这条路。
// 不让模型一口气写出整份 spec（弱一点的模型会把编号、层级、引用写乱），而是拆成三段小抽取，每段只回答一类问题、只输出一小块 JSON：
//   A 世界与场景（含每个场景里能调查的东西）  →  B 人物（NPC 卡、预设角色）  ∥  C 线索、真相、定时事件、结局
// 模型只管「读」，而且只用名字互相指；编号、引用、载体、关键抉择、结局条件全部由下面的确定性代码组装。
// 组装完照样过 validateSpec()，照样 reviewed:false，照样要人在审阅页点头。
import { validateSpec, parseCheck, parseMind, parseClock, AI_DEFAULTS } from './compiler.mjs';

const STYLE_BANS = ['不向玩家提建议，不说「你可以试试」「要不要」', '不总结已经发生的事，不替玩家推理，不解释谜底', '不安慰、不鼓励、不夸奖玩家', '不跳出故事说话，不提「模组」「剧情」「线索」「检定」这些桌面之外的词', '不写明亮、轻快、俏皮的句子；不用感叹号'];
const arr = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]).filter((v) => v != null && v !== '');
const str = (x) => (x == null ? '' : typeof x === 'string' ? x.trim() : Array.isArray(x) ? x.map(str).join('；') : typeof x === 'object' ? Object.values(x).map(str).join('；') : String(x));
const strs = (x) => arr(x).map(str).filter(Boolean);
const NONE = /^(无|没有|空|null|none|-|—|暂无|不适用)$/i;
const val = (x) => { const s = str(x); return NONE.test(s) ? '' : s; };
// 理智损失：先按「a/b」认；模型写成一句话（「成功不损失，失败损失 1d4」）也救回来
const DICE = /(\d+d\d+(?:[+-]\d+)?|\d+)/.source;
export function sanOf(x) {
  const t = val(x).replace(/D/g, 'd'); if (!t) return null; const m = parseMind(t); if (m) return m;
  const f = new RegExp('失败[^0-9]{0,8}' + DICE).exec(t); if (!f) return null;
  const ok = new RegExp('成功[^0-9不无]{0,8}' + DICE).exec(t);
  return { success: ok ? ok[1] : '0', fail: f[1] };
}

// 模型吐出来的 JSON 常见的毛病：包在 ``` 里、前后带解释、尾逗号、中文引号。尽量救回来。
export function looseJson(text) {
  let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('模型没有输出 JSON');
  t = t.slice(a, b + 1);
  const tries = [t, t.replace(/,\s*([}\]])/g, '$1'), t.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"'), t.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' ')];
  for (const s of tries) { try { return JSON.parse(s); } catch { /* 换下一种修法 */ } }
  // 被截断：从后往前找一个能闭合的位置
  for (let cut = t.length - 1; cut > t.length * 0.5; cut--) {
    if (!'}]"'.includes(t[cut])) continue; const head = t.slice(0, cut + 1).replace(/,\s*$/, '');
    let stack = [], inS = false, esc = false;
    for (const ch of head) { if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inS = false; } else if (ch === '"') inS = true; else if (ch === '{' || ch === '[') stack.push(ch); else if (ch === '}' || ch === ']') stack.pop(); }
    if (inS) continue;
    try { return JSON.parse(head + stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('')); } catch { /* 再往前 */ }
  }
  throw new Error('模型输出的 JSON 解析不了');
}

const SYS = '你是跑团模组的结构化抽取器。只做抽取和必要的转述，不添加原文没有的设定，不改动原文的人名、地名、时间和数字。只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。';

const promptA = (text) => `下面是一份跑团模组的原文。请抽出「世界与场景」。

输出 JSON，键名必须与下面一致：
{
 "title": "模组标题",
 "players": "推荐人数，如 2-3",
 "era": "时代", "place": "地点", "duration": "预计时长",
 "horror_level": "恐怖尺度", "content_warnings": ["内容提示"],
 "start_time": "开场时刻，HH:MM 24小时制",
 "start_scene": "开场所在的场景名",
 "opening": "开场白：两三句，第二人称「你们」，只写玩家一到场就知道的事，不含任何秘密",
 "tone": "一句话的基调",
 "immutable_facts": ["4 到 8 条公开的、绝不会变的事实：地名、人名与身份、已经发生的公开事件、时间。不含任何秘密"],
 "people": ["原文中出现的每个可以对话的人物的名字"],
 "scenes": [
  {
   "name": "场景名",
   "aliases": ["玩家可能用的别的叫法"],
   "description": "玩家一进来就能看见的公开描写，两三句。提到这里每一样可以调查的东西，但不写调查之后才知道的内容，不写秘密",
   "beats": ["3 条环境氛围短句，每条一句话，只写声音、光线、气味这类，不含新事实"],
   "people": ["平时待在这里的人物名"],
   "things": [
    { "name": "可以调查的东西", "keywords": ["玩家提到它时可能用的词"], "reveals": "调查之后看到、读到的具体内容，按原文写全", "check": "需要的检定，写成 技能/难度（难度只能是 普通、困难、极难）；原文没说就留空字符串", "fail": "检定失败时看到什么；没有检定就留空", "san": "看到它要过的理智检定，写成 成功损失/失败损失，如 0/1d3；原文没有就留空" }
   ]
  }
 ]
}

【原文】
${text}`;

const promptB = (text, A, rp) => `下面是一份跑团模组的原文。请抽出「人物」。

已知场景：${A.scenes.map((s) => s.name).join('、')}
已知人物：${A.people.join('、') || '（请从原文找）'}

输出 JSON，键名必须与下面一致：
{
 "npcs": [
  {
   "name": "姓名（与上面的已知人物一致）",
   "aliases": ["玩家可能用的称呼"],
   "public_identity": "公开身份，玩家一眼能知道的",
   "true_identity": "只有主持人知道的真实身份或秘密；没有就留空",
   "motive": "他此刻想要什么",
   "location": "他平时待在哪个场景（用已知场景名）",
   "attitude": 0,
   "voice": "说话的样子：句子长短、用词、称呼、语气，写具体",
   "catchphrases": ["口头禅"],
   "banned_words": ["这个人绝不会用的词，3 到 5 个"],
   "nonverbal": false,
   "redlines": ["他绝不会做的事"],
   "greet": ["第一次见面时说的话，2 条"],
   "smalltalk": ["不涉及任何秘密的闲话，3 条"],
   "deflect": ["被问到不想说的事时的推脱，3 条"],
   "knows": [
    { "title": "他知道的一件事", "topics": ["玩家问到这些词时会引出这件事"], "share": "随口 / 信任 / 绝不", "says": "他会怎么说，用他自己的口吻写成台词" }
   ]
  }
 ],
 "pregens": [
  { "name": "姓名", "role": "身份", "attrs": { "属性名": 50 }, "skills": { "技能名": 50 }, "background": "背景", "drive": "执念", "fear": "恐惧源", "items": ["随身物品"] }
 ]
}

要求：
- attitude 是对玩家的初始态度，整数，-1 戒备、0 中立、1 友善。
- share：谁问都会说的填「随口」；要先取得信任才说的填「信任」；绝不会对外人说的秘密填「绝不」。
- nonverbal：这个人不会说话（哑、只会比划）就填 true，这时 greet/smalltalk/deflect/says 都写成对他动作的第三人称描写，不写台词。
- 原文没有给出玩家角色时，pregens 按时代和地点编 2 到 3 位合适的普通人。属性只能用：${rp.attributes.map((a) => a.name).join('、')}（30 到 80 之间）；技能只能用：${rp.skills.map((k) => k.name).join('、')}（每人 5 到 7 项，30 到 70 之间）。

【原文】
${text}`;

const promptC = (text, A, rp) => `下面是一份跑团模组的原文。请抽出「线索与真相」。

已知场景和其中可以调查的东西：
${A.scenes.map((s) => `- ${s.name}：${s.things.map((t) => t.name).join('、') || '（无）'}`).join('\n')}
已知人物：${A.people.join('、') || '（请从原文找）'}

输出 JSON，键名必须与下面一致：
{
 "truth": "幕后真相，把原文交代的写全",
 "entity": "怪物或神话存在的描述与数据；没有就留空",
 "timeline": [ { "when": "时间", "what": "真正发生了什么" } ],
 "secrets": [
  { "text": "一条在玩家自己查出来之前绝不能泄露的事实", "keywords": ["如果泄露，文字里一定会出现的 2 到 4 个短词，每个 2 到 8 个字；不要用人名、地名、物件名本身"], "revealed_by": "哪条线索被发现后它就不再是秘密（写线索名）；永远不能说就写 永不" }
 ],
 "clues": [
  {
   "name": "线索名，短",
   "content": "玩家由此得知了什么，一两句",
   "key": true,
   "found_at": "所在场景名",
   "points_to": "它把玩家引向哪个场景名；没有就留空",
   "gives_item": "发现时玩家拿到的关键物品名；没有就留空",
   "via": [ { "type": "thing 或 npc", "name": "对应的东西名或人物名（用上面已知的名字）", "form": "载体形式，如 供桌下的族谱", "topics": ["type 是 npc 时：玩家问到哪些词他会说"], "share": "type 是 npc 时：随口 或 信任", "says": "type 是 npc 时：他怎么说或怎么做" } ],
   "backup_event": "备用投放：如果玩家一直没发现这条线索，用一个小事件把它主动送到玩家面前。写成两三句可以直接念出来的描写，要包含线索的内容"
  }
 ]
}

要求：
- 线索 3 到 7 条。key：漏掉就无法走到好结局的线索填 true。每条 key 线索必须写 backup_event。
- 原文说做成某件事需要某样东西（一页纸、一把钥匙、一段文字），给出它的那条线索要写 gives_item。
- secrets 3 到 6 条，覆盖：幕后真相、怪物或器物的真面目、每个人物的真实身份。

【原文】
${text}`;

const promptD = (text, A, C) => `下面是一份跑团模组的原文。请抽出「定时事件与结局」。

已知场景：${A.scenes.map((s) => s.name).join('、')}
已知线索：${(C.clues || []).map((c) => c.name).filter(Boolean).join('、') || '（无）'}
已知关键物品：${(C.clues || []).map((c) => c.gives_item).filter((x) => x && !/^(无|没有)$/.test(x)).join('、') || '（无）'}

输出 JSON，键名必须与下面一致：
{
 "timed_events": [
  { "name": "事件名", "time": "HH:MM", "text": "到点时所有人看到、听到的公开描写，两三句，不解释原因", "san": "理智检定 成功损失/失败损失，如 0/1d4；没有就留空", "phase": "加压 / 对抗 / 揭示 之一" }
 ],
 "endings": [
  {
   "name": "结局名", "text": "结局文本，三四句，第二人称「你们」",
   "conditions": [
    { "type": "action", "keywords": ["玩家说出这些词就算做了这件事，4 到 6 个动作性的说法"], "needs_item": "需要持有的关键物品（用上面已知关键物品的名字）；没有就留空", "at_scene": "必须在哪个场景；不限就留空" },
    { "type": "deadline", "time": "HH:MM，到这个时刻还没有达成别的结局就触发" }
   ]
  }
 ]
}

要求：
- timed_events 只收原文明确写了「几点发生什么」的事件，时间用 24 小时制。
- 每个结局至少一条 conditions，任意一条满足即达成；玩家主动做某事达成的用 action，时间到了自动发生的用 deadline。午夜写 24:00。原文里一个结局有几种达成方式，就写几条。
- action 的 keywords 必须是「动作」的说法（如 封井、念镇井文、把磨盘推回去、下井、把钟砸了），不能只是一个东西或人的名字。
- 理智（定力、SAN）检定的写法：「成功不损失，失败损失 1d4」写成 0/1d4；「1/1D6」写成 1/1d6。原文提到了就必须写上，数字照原文。

【原文】
${text}`;

async function ask(llm, user, log, stage, maxTokens) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await llm.complete({ role: 'compiler', system: SYS, user, maxTokens, temperature: i ? 0 : 0.2, timeoutMs: 150_000, maxWaitMs: 40_000 });
      const j = looseJson(r.text); log.push({ stage, provider: r.provider, ms: r.ms, chars: r.text.length, attempt: i + 1, usage: r.usage || null }); return j;
    } catch (e) { lastErr = e; log.push({ stage, attempt: i + 1, error: String(e.message).slice(0, 160) }); }
  }
  throw new Error(`第 ${stage} 段抽取失败：${lastErr.message}`);
}

export async function compileFreeText(text, llm, opts = {}) {
  const rp = opts.rulepacks?.[opts.rulepack] || Object.values(opts.rulepacks || {})[0];
  if (!rp) throw new Error('没有可用的规则包');
  const src = text.slice(0, 24000); const log = [];
  const A0 = await ask(llm, promptA(src), log, 'A 世界与场景', 3800);
  const A = { ...A0, scenes: arr(A0.scenes).filter((s) => val(s?.name)).map((s) => ({ ...s, name: val(s.name), things: arr(s.things).filter((t) => val(t?.name)) })), people: strs(A0.people) };
  if (!A.scenes.length) throw new Error('模型没有从这份文本里读出任何场景');
  for (const s of A.scenes) for (const p of strs(s.people)) if (!A.people.includes(p)) A.people.push(p);
  const [B, C] = await Promise.all([
    ask(llm, promptB(src, A, rp), log, 'B 人物', 5000),
    ask(llm, promptC(src, A, rp), log, 'C 线索与真相', 4500).then(async (C1) => ({ ...C1, ...(await ask(llm, promptD(src, A, C1), log, 'D 定时事件与结局', 2500)) })),
  ]);
  const spec = assemble(A, B, C, rp, opts);
  spec.source = { name: opts.sourceName || 'module.txt', chars: text.length, compiler: `model:${[...new Set(log.filter((l) => l.provider).map((l) => l.provider))].join('+')}`, stages: log, raw: { A: A0, B, C } };
  spec.issues = validateSpec(spec, rp);
  return spec;
}

// 确定性组装：编号、引用、载体、关键抉择、结局条件都在这里生成。模型给的只是名字和文字。
const nrm = (s) => String(s).trim().toLowerCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
export function assemble(A, B, C, rp, opts = {}) {
  const notes = [];   // 组装时替模型补的、改的，都记下来放进审阅页
  const same = (a, b) => { a = str(a); b = str(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
  const scenes = A.scenes.map((s, i) => ({
    id: `s${i + 1}`, name: s.name, kind: 'main', aliases: [...new Set(strs(s.aliases).filter((x) => x !== s.name))], exits: [], npcs: [], goal: '',
    public_desc: val(s.description), beats: strs(s.beats), press_beats: [],
    interactables: s.things.map((t, k) => thing(`s${i + 1}_t${k + 1}`, t)),
  }));
  function thing(id, t) {
    const name = val(t.name); const check = parseCheck(val(t.check));
    if (check && !rp.skillIdByName[nrm(check.skill)] && !rp.attrIdByName[nrm(check.skill)]) { const hit = [...rp.skills.flatMap((k) => [k.name, ...(k.aliases || [])]), ...rp.attributes.map((a) => a.name)].filter((n) => check.skill.includes(n)).sort((a, b) => check.skill.indexOf(a) - check.skill.indexOf(b) || b.length - a.length)[0]; if (hit) { notes.push(`「${name}」的检定写的是「${check.skill}」，按规则包取了「${hit}」`); check.skill = hit; } }
    return { id, name, keywords: [...new Set([name, ...strs(t.keywords)])].filter((x) => x.length >= 1), obvious: true, requires: null, blocked_text: '', bypass_check: null, bypass_flag: null, clue: null, carrier: null,
      check, fail_text: check ? (val(t.fail) || `你在${name}上没有看出什么。`) : '', fail_attitude: null, mind: sanOf(t.san), phase_floor: null, set_flag: null, give_item: null, minutes: 15, text: val(t.reveals) || `${name}没有什么特别的。` };
  }
  for (const s of scenes) { s.exits = scenes.filter((x) => x.id !== s.id).map((x) => x.id); if (s.beats.length < 2) { s.beats.push('四下里很静。', '没有人说话。'); notes.push(`场景「${s.name}」的氛围句不足，补了两条中性的`); } }
  const sceneOf = (name) => { const n = val(name); if (!n) return null; return scenes.find((s) => s.name === n || s.aliases.includes(n)) || scenes.find((s) => same(s.name, n) || s.aliases.some((a) => same(a, n))) || null; };

  // 人物
  const npcs = arr(B?.npcs).filter((n) => val(n?.name)).map((n, i) => {
    const nonverbal = n.nonverbal === true || /不会说话|哑/.test(str(n.voice));
    const home = sceneOf(n.location) || scenes.find((s) => strs(A.scenes[scenes.indexOf(s)].people).some((p) => same(p, n.name))) || scenes[0];
    if (!sceneOf(n.location)) notes.push(`人物「${val(n.name)}」的所在地「${str(n.location)}」对不上场景，放在了「${home.name}」`);
    const fill = (list, d) => (strs(list).length ? strs(list) : d);
    return {
      id: `n${i + 1}`, name: val(n.name), aliases: [...new Set(strs(n.aliases).filter((x) => x !== val(n.name)))], public_identity: val(n.public_identity), true_identity: val(n.true_identity), motive: val(n.motive), home: home.id,
      attitude_init: Math.max(-2, Math.min(2, Math.round(Number(n.attitude) || 0))), mood_init: val(n.mood) || '平常',
      voice: { style: val(n.voice), catchphrases: strs(n.catchphrases), lexicon: strs(n.lexicon), banned: strs(n.banned_words) }, nonverbal, repeat: [],
      redlines: strs(n.redlines), greet: fill(n.greet, [nonverbal ? `${val(n.name)}抬头看了你们一眼。` : '你们是外头来的。']),
      smalltalk: fill(n.smalltalk, [nonverbal ? `${val(n.name)}没有什么表示。` : '没什么好说的。']),
      deflect: fill(n.deflect, nonverbal ? [`${val(n.name)}摇了摇头。`, `${val(n.name)}把脸转开了。`] : ['这个我不知道。', '别问我这个。']),
      knowledge: arr(n.knows).filter((k) => val(k?.title) || val(k?.says)).map((k, j) => ({ id: `n${i + 1}_k${j + 1}`, title: val(k.title) || val(k.says).slice(0, 12), topics: strs(k.topics), share: { 随口: 'free', 信任: 'trust', 绝不: 'never' }[val(k.share)] || (/绝不|秘密/.test(str(k.share)) ? 'never' : 'free'), trust_min: val(k.share) === '信任' ? 1 : 0, show_clue: null, gives_clue: null, carrier: null, set_flag: null, give_item: null, say: val(k.says) })),
    };
  });
  for (const n of npcs) scenes.find((s) => s.id === n.home).npcs.push(n.id);
  const npcOf = (name) => { const x = val(name); if (!x) return null; return npcs.find((n) => n.name === x || n.aliases.includes(x)) || npcs.find((n) => same(n.name, x) || n.aliases.some((a) => same(a, x))) || null; };
  const thingOf = (name, scene) => { const x = val(name); if (!x) return null; const pool = [...(scene ? scene.interactables : []), ...scenes.flatMap((s) => s.interactables)]; return pool.find((t) => t.name === x) || pool.find((t) => same(t.name, x) || t.keywords.some((k) => k.length >= 2 && same(k, x))) || null; };

  // 线索与载体
  const clues = arr(C?.clues).filter((c) => val(c?.name) && val(c?.content)).map((c, i) => {
    const id = `C${i + 1}`; const scene = sceneOf(c.found_at) || scenes[0]; const carriers = []; const cid = () => `${id}${String.fromCharCode(97 + carriers.length)}`;
    for (const v of arr(c.via)) {
      const type = /npc|人/i.test(str(v?.type)) ? 'npc' : 'thing';
      if (type === 'npc') {
        const n = npcOf(v.name); if (!n) { notes.push(`线索「${val(c.name)}」说由「${str(v.name)}」给出，但人物里没有这个人，这种载体略过`); continue; }
        const car = cid(); const kid = `${n.id}_k${n.knowledge.length + 1}`;
        const dup = n.knowledge.find((k) => !k.gives_clue && k.share !== 'never' && (same(k.title, c.name) || (val(v.says) && same(k.say, v.says))));
        const k = dup || { id: kid, title: val(c.name), topics: [], share: 'free', trust_min: 0, show_clue: null, gives_clue: null, carrier: null, set_flag: null, give_item: null, say: '' };
        k.topics = [...new Set([...k.topics, ...strs(v.topics)])]; if (!k.topics.length) k.topics = [val(c.name)];
        if (/信任/.test(str(v.share))) { k.share = 'trust'; k.trust_min = Math.max(1, k.trust_min); }
        k.say = val(v.says) || k.say || val(c.content); k.gives_clue = id; k.carrier = car; if (!dup) n.knowledge.push(k);
        carriers.push({ id: car, form: val(v.form) || `${n.name}说的话`, where: n.home, via: `NPC:${n.id}`, when: null, text: '' });
      } else {
        let t = thingOf(v?.name, scene);
        if (t && t.clue) { notes.push(`「${t.name}」上已经挂了另一条线索，「${val(c.name)}」没有再挂上去`); continue; }
        if (!t) { t = thing(`${scene.id}_t${scene.interactables.length + 1}`, { name: val(v?.name) || val(c.name), reveals: val(c.content) }); scene.interactables.push(t); notes.push(`线索「${val(c.name)}」的载体「${t.name}」不在场景的可调查物里，已在「${scene.name}」补了一项`); }
        const where = scenes.find((s) => s.interactables.includes(t)); const car = cid();
        t.clue = id; t.carrier = car; carriers.push({ id: car, form: val(v?.form) || t.name, where: where.id, via: `可调查:${t.id}`, when: null, text: '' });
      }
    }
    if (!carriers.length) { const t = thing(`${scene.id}_t${scene.interactables.length + 1}`, { name: val(c.name), reveals: val(c.content) }); scene.interactables.push(t); const car = cid(); t.clue = id; t.carrier = car; carriers.push({ id: car, form: t.name, where: scene.id, via: `可调查:${t.id}`, when: null, text: '' }); notes.push(`线索「${val(c.name)}」没有给出载体，已在「${scene.name}」补了一个可调查项`); }
    if (val(c.backup_event)) carriers.push({ id: cid(), form: '一件找上门来的小事', where: 'any', via: '事件', when: null, text: val(c.backup_event) });
    return { id, name: val(c.name), content: val(c.content), scene: scene.id, points_to: sceneOf(c.points_to)?.id || '', key: c.key === true || /^(是|true)$/i.test(str(c.key)), give_item: val(c.gives_item) || null, carriers };
  });
  const clueOf = (name) => { const x = val(name); if (!x || /永不|永远/.test(x)) return null; return clues.find((c) => c.name === x || c.id === x) || clues.find((c) => same(c.name, x)) || null; };

  // 真相层
  const publicText = [val(A.opening), ...strs(A.immutable_facts), ...scenes.flatMap((s) => [s.name, ...s.aliases, s.public_desc, ...s.beats, ...s.interactables.map((t) => t.name)]), ...npcs.flatMap((n) => [n.name, ...n.aliases, n.public_identity, ...n.greet, ...n.smalltalk, ...n.deflect])].join('\n');
  const secretKw = (sec) => { const all = strs(sec.keywords).filter((k) => k.length >= 2 && k.length <= 12); const keep = all.filter((k) => !publicText.includes(k)); if (keep.length < all.length) notes.push(`不可泄露项「${val(sec.text).slice(0, 14)}…」的关键词里去掉了公开信息里本来就有的词：${all.filter((k) => !keep.includes(k)).join('、')}`); return keep; };
  const truth = {
    summary: val(C?.truth), entity: val(C?.entity),
    timeline: arr(C?.timeline).map((t) => ({ when: val(t?.when), what: val(t?.what) })).filter((t) => t.what),
    never_reveal: arr(C?.secrets).filter((s) => val(s?.text)).map((s, i) => ({ id: `T${i + 1}`, text: val(s.text), keywords: secretKw(s), unlock: clueOf(s.revealed_by)?.id || null })),
  };

  // 结局：玩家主动做的事 → 关键抉择 + flag；到点自动发生的 → 时间条件（并排除已达成的主动结局）
  const startClock = parseClock(val(A.start_time)) ?? 18 * 60;
  const clock = (s) => { const m = /(\d{1,2})[:：](\d{2})/.exec(str(s)); if (!m) return /午夜|子时|半夜/.test(str(s)) ? 1440 : null; let v = Number(m[1]) * 60 + Number(m[2]); if (v <= startClock) v += 1440; return v; };
  const endings = [], key_choices = [], actionFlags = [];
  arr(C?.endings).filter((e) => val(e?.name)).forEach((e, i) => {
    const id = `E${i + 1}`; const when_any = []; const deadlines = [];
    arr(e.conditions).forEach((c, k) => {
      if (/dead|时间|到点/i.test(str(c?.type)) || (!strs(c?.keywords).length && val(c?.time))) { const v = clock(c.time); if (v != null) deadlines.push(v); return; }
      // 抉择的关键词不能是场上现成的名词（「磨盘」「族谱」）：玩家只是提到它就会被当成做了决定。只留动作性的说法。
      const nouns = new Set([...scenes.flatMap((s) => [s.name, ...s.aliases, ...s.interactables.flatMap((t) => [t.name, ...t.keywords])]), ...npcs.flatMap((n) => [n.name, ...n.aliases]), ...clues.flatMap((x) => [x.name, x.give_item].filter(Boolean))]);
      const all = strs(c?.keywords).filter((x) => x.length >= 2); let kws = all.filter((x) => !nouns.has(x));
      if (!kws.length && all.length) { kws = [val(e.name)].filter((x) => x.length >= 2 && !nouns.has(x)); notes.push(`结局「${val(e.name)}」的达成说法全是场上现成的名词（${all.join('、')}），已改成只认「${kws.join('、') || '—'}」，请在审阅页的完整 JSON 里补上动作性的说法`); }
      else if (kws.length < all.length) notes.push(`结局「${val(e.name)}」的达成说法里去掉了现成的名词：${all.filter((x) => nouns.has(x)).join('、')}`);
      if (!kws.length) return;
      const flag = `end_${i + 1}_${k + 1}`; actionFlags.push(flag); when_any.push([{ t: 'flag', k: flag, neg: false }]);
      const requires = []; const item = val(c.needs_item); const sc = sceneOf(c.at_scene);
      if (item) { requires.push({ t: 'item', k: item, neg: false }); if (!clues.some((x) => x.give_item === item)) notes.push(`结局「${val(e.name)}」需要物品「${item}」，但没有哪条线索会给出它——请在线索上补「给物品」，或去掉这个条件`); }
      if (sc) requires.push({ t: 'scene', k: sc.id, neg: false });
      key_choices.push({ id: `K${key_choices.length + 1}`, name: val(e.name), requires: requires.length ? requires : null, options: [{ id: 'do', keywords: kws, set_flag: flag, label: kws[0] }] });
    });
    endings.push({ id, name: val(e.name), when_any, text: val(e.text), _deadlines: deadlines });
  });
  for (const e of endings) { for (const v of e._deadlines) e.when_any.push([{ t: 'time', op: '>=', v, neg: false }, ...actionFlags.filter((f) => !e.when_any.some((c) => c.length === 1 && c[0].k === f)).map((f) => ({ t: 'flag', k: f, neg: true }))]); delete e._deadlines; }

  const PH = ['加压', '对抗', '揭示'];
  const triggers = arr(C?.timed_events).filter((t) => val(t?.name) && clock(t.time) != null).map((t, i) => {
    const effects = [`flag:event_${i + 1}=1`]; const m = sanOf(t.san); if (m) effects.push(`理智检定:全体:${m.success}/${m.fail}`); const ph = PH.find((p) => str(t.phase).includes(p)); if (ph) effects.push(`阶段:${ph}`);
    return { id: `T_${i + 1}`, name: val(t.name), when: [{ t: 'time', op: '>=', v: clock(t.time), neg: false }, ...actionFlags.map((f) => ({ t: 'flag', k: f, neg: true }))], once: true, effects, public_text: val(t.text), kp_note: '' };
  }).sort((a, b) => a.when[0].v - b.when[0].v).filter((t) => { const dl = Math.min(...endings.flatMap((e) => e.when_any.flatMap((c) => c.filter((a) => a.t === 'time').map((a) => a.v))), Infinity); if (t.when[0].v < dl) return true; notes.push(`定时事件「${t.name}」与到点结局同时或更晚，已略去`); return false; });

  // 预设角色
  const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '');
  let pregens = arr(B?.pregens).filter((p) => val(p?.name)).map((p, i) => {
    const attrs_named = {}, skills_named = {};
    for (const [k, v] of [...Object.entries(p.attrs || {}), ...Object.entries(p.skills || {})]) { const n = Math.round(Number(v)); if (!Number.isFinite(n)) continue; if (rp.attrIdByName[norm(k)]) attrs_named[k] = Math.max(15, Math.min(90, n)); else if (rp.skillIdByName[norm(k)]) skills_named[k] = Math.max(1, Math.min(90, n)); }
    return { id: `p${i + 1}`, name: val(p.name), role: val(p.role), attrs_named, skills_named, background: val(p.background), drive: val(p.drive), fear: val(p.fear), relations: val(p.relations), items: strs(p.items), ai: AI_DEFAULTS() };
  });
  if (pregens.length < 2) {
    notes.push('原文和模型都没有给出足够的预设角色，补了两位属性居中的普通人，请在审阅页改成你要的');
    const sk = rp.skills.filter((k) => k.base >= 10).slice(0, 12);
    for (const [i, nm] of ['甲', '乙'].entries()) pregens.push({ id: `p${pregens.length + 1}`, name: `来客${nm}`, role: '外来的调查者', attrs_named: Object.fromEntries(rp.attributes.map((a) => [a.name, 50 + (i ? 5 : 0)])), skills_named: Object.fromEntries(sk.filter((_, j) => j % 2 === i).slice(0, 6).map((k) => [k.name, 50])), background: '', drive: '', fear: '', relations: '', items: [], ai: AI_DEFAULTS() });
  }

  const facts = strs(A.immutable_facts); if (facts.length < 3) notes.push('不可变事实少于 3 条，防漂移的锚点偏少，请在审阅页补上人名、地名、已发生的公开事件');
  const start = sceneOf(A.start_scene) || scenes[0];
  return {
    spec_version: '1', reviewed: false,
    meta: { title: val(A.title) || '未命名模组', players: val(A.players), era: val(A.era), place: val(A.place), duration: val(A.duration), rulepack: rp.id, horror_level: val(A.horror_level), content_warnings: strs(A.content_warnings), start_clock: startClock, start_scene: start.id, opening: val(A.opening) || `你们来到了${start.name}。` },
    constitution: { tone: val(A.tone) || '克制、压抑；恐惧来自对不上的细节。', style_bans: STYLE_BANS, immutable_facts: facts, travel: [], free: [], probe: [] },
    scenes, clues, npcs, truth, triggers, endings, key_choices, pregens, assembly_notes: notes,
  };
}
