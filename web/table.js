// 掌灯人 · 桌面、掌灯人控制台、Replay 页
import { $, h, api, toast, app, go, store, remember } from '/app.js';
import { sfx, unlock, soundOn, setSound, music, musicIsOn, setMusic } from '/fx.js';
import { preloadDice, rollDice3D } from '/dice3d.js';

// 规则术语跟着这局团的规则包走（潮痕规则叫「定力/体魄」，通行规则叫「理智/生命值」）
const TT = { pc: '寻访者', mind: '定力', hp: '体魄', disorder: '失序', bonus: '顺势骰', penalty: '逆势骰' };
const setTerms = (v) => { if (v?.terms) Object.assign(TT, v.terms); };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(9).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
const LEVEL_OK = (d) => d.success;
// 轮次用汉字数：第三轮、第十二轮、第三十轮
const cnNum = (n) => { const d = '零一二三四五六七八九'; if (n < 10) return d[n]; if (n < 20) return '十' + (n % 10 ? d[n % 10] : ''); if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : ''); return String(n); };
const srcName = (s) => (s === 'offline' ? '离线演员' : s === 'policy' ? '策略' : s);

// 场景图：web/img/scenes/manifest.json 里按「模组标题 → 场景名 → 文件名」登记。没有登记的模组、场景照常只用文字。
let SCENE_IMG = {}; let SCENE_OF = '';
const sceneImgReady = fetch('/img/scenes/manifest.json').then((r) => (r.ok ? r.json() : {})).then((j) => { SCENE_IMG = j || {}; }).catch(() => {});
const endImg = (name) => { const f = SCENE_IMG[SCENE_OF]?._endings?.[name]; return f ? `/img/scenes/${f}` : null; };
const nightOf = () => SCENE_IMG[SCENE_OF]?._night || null;
const sceneImg = (name) => { const f = SCENE_IMG[SCENE_OF]?.[name]; return f ? `/img/scenes/${f}` : null; };

// 掌灯人侧的记录分三层：玩家看得到的正文 → 每轮一行的导演摘要（灯亮才有）→ 点开才是整张导演单、落库与审计
const KP_TYPES = new Set(['director.sheet', 'state.change', 'proposal.rejected', 'guard.alert', 'context.audit', 'trigger.fired', 'aipc.skip', 'console.action']);
function kpNote(box, ev, el, state) {
  let n = state.note && state.note.round === ev.round && state.note.el.isConnected ? state.note : null;
  if (!n) { const sum = h('summary'), body = h('div', { class: 'body' }); n = state.note = { round: ev.round, sum, body, el: h('details', { class: 'kpnote' }, sum, body), sheet: null, audits: 0, leaks: 0, rejected: 0, alerts: 0, trig: [], console: 0 }; box.append(n.el); }
  const d = ev.data;
  if (ev.type === 'director.sheet' && !d.sub) n.sheet = d;
  if (ev.type === 'context.audit') { n.audits++; if (d.leak) n.leaks++; }
  if (ev.type === 'proposal.rejected') n.rejected++;
  if (ev.type === 'guard.alert' && d.action !== 'pass') n.alerts++;
  if (ev.type === 'trigger.fired') n.trig.push(d.name);
  if (ev.type === 'console.action') n.console++;
  n.body.append(el);
  const s = n.sheet; const parts = [];
  if (s) { parts.push(s.intent.class_name + (s.intent.probe ? ' · 试探边界' : ''), s.phase_name); if (s.reveal.length) parts.push('放线：' + s.reveal.map((r) => r.name).join('、')); if (s.fallback) parts.push('补线：' + s.fallback.clue_name); if (s.choice_hint) parts.push('抉择提示'); if (s.lead) parts.push('指路'); }
  for (const t of n.trig) parts.push('触发：' + t);
  if (n.console) parts.push('控制台 ' + n.console + ' 次');
  if (n.alerts) parts.push('闸门打回 ' + n.alerts + ' 次');
  if (n.rejected) parts.push('提案被拒 ' + n.rejected);
  if (n.audits) parts.push(`审计 ${n.audits} · 泄露 ${n.leaks}`);
  n.el.classList.toggle('bad', !!(n.leaks || n.rejected));
  fill(n.sum, h('b', {}, s ? '导演单' : '掌灯人侧'), parts.filter(Boolean).map((p) => h('span', {}, p)));
}

// 一条日志事件 → 一块界面。玩家视角与掌灯人视角用同一个函数，掌灯人专属的块带 .kp，灯灭时由 CSS 藏起来。
export function renderEvent(ev, ctx = {}) {
  const d = ev.data; const priv = typeof ev.vis === 'object' || ev.private ? h('span', { class: 'priv' }, '私') : null;
  switch (ev.type) {
    case 'player.action': return h('div', { class: 'ev pa' }, priv, h('span', { class: 'who' }, d.name), d.text);
    case 'narration': return h('p', { class: 'ev na', 'data-seq': ev.seq, 'data-sup': d.supersedes || '' }, priv, d.text, h('span', { class: 'src' }, srcName(d.source)));
    case 'canon': { const seen = (ctx.seenScenes ||= new Set()); const pic = d.kind === 'scene' && !seen.has(d.title) ? sceneImg(d.title) : null; if (d.kind === 'scene') seen.add(d.title); /* 场景图只在第一次到这个地方时出现 */ return h('div', { class: `ev ca ${d.kind}${d.faded ? ' faded' : ''}${pic ? ' shot' : ''}`, 'data-seq': ev.seq, onclick: (e) => e.currentTarget.classList.toggle('show') }, pic ? h('div', { class: 'pic', style: `background-image:url("${pic}")` }, h('span', {}, d.title)) : null, priv, d.title && d.kind !== 'opening' && !pic ? h('span', { class: 't' }, d.title) : null, d.text); }
    case 'npc.line': return h('div', { class: 'ev np' }, priv, h('span', { class: 'who' }, d.name), d.nonverbal ? d.text : `「${d.text}」`, h('span', { class: 'src' }, `${srcName(d.source)} · ${({ share: '交代', deflect: '推脱', smalltalk: '闲谈', greet: '招呼', repeat: '说过了' })[d.mode] || d.mode}`));
    case 'aipc.line': return h('div', { class: 'ev np ai' }, h('span', { class: 'who' }, d.name, ' · AI'), `「${d.text}」`, h('span', { class: 'src' }, srcName(d.source)));
    case 'dice.roll': {
      const mind = d.kind === 'mind';
      return h('div', {}, h('div', { class: 'ev dc ' + (d.success ? 'ok' : 'no'), title: `十位骰 ${d.dice.tens.join('、')}；个位骰 ${d.dice.units}；随机源已取 ${d.rngDraws} 次` }, priv,
        h('div', { class: 'num' }, h('b', { class: 'val' }, d.value), h('span', { class: 'res' }, d.levelName)),
        h('div', { class: 'what' }, h('b', {}, d.label), mind ? `${TT.mind} ${d.current}` : `${d.skillName} ${d.skill}　${d.tierName === '普通' ? '' : d.tierName + '　'}需 ≤ ${d.need}`),
        mind && d.loss ? h('div', { class: 'loss' }, `${TT.mind} ${d.current} → `, h('b', {}, d.after)) : null));
    }
    case 'clue.found': return h('div', { class: 'ev cl' }, priv, h('div', { class: 't' }, '线索'), h('b', {}, d.name), h('span', { class: 'dim small' }, d.form), h('p', {}, d.content), d.item ? h('p', { class: 'dim' }, `得到物品：${d.item}`) : null);
    case 'ending': { const pic = endImg(d.name); return h('div', { class: 'ev end' + (pic ? ' shot' : '') }, pic ? h('div', { class: 'pic', style: `background-image:url("${pic}")` }) : null, h('h3', {}, d.name), h('p', {}, d.text), ctx.replayHref ? h('div', { class: 'after' }, h('a', { href: ctx.replayHref }, '翻开这一夜')) : null); }
    case 'choice': return h('div', { class: 'ev sys' }, `抉择　${d.name} → ${d.label}`);
    case 'xcard': return h('div', { class: 'ev sys', 'data-veil': d.veil || '' }, `X 卡　有人按下了 X 卡。上一段描写已遮住，随后 ${d.mode === 'skip' ? '一' : '三'} 轮的描写会淡化。`);
    case 'save': return h('div', { class: 'ev sys' }, `存档　${d.name}`);
    case 'branch.fork': return h('div', { class: 'ev sys' }, `分支　从 ${d.from} 的第 ${d.round} 轮分出。此前的日志是原样带过来的副本，原分支没有被动过。`);
    case 'session.start': return h('div', { class: 'ev sys kponly' }, `开团　规则包 ${d.rulepack}　随机种子 ${d.seed}`);
    // ---- 以下只有掌灯人看得见
    case 'director.sheet': {
      if (d.sub) return h('div', { class: 'ev kp minor' }, `导演单（AI 席位的小行动）　${d.reasons.join('；')}`);
      const L = [
        ['决策理由', d.reasons.join('\n　　　　　')],
        ['场景与幕目标', `${d.scene_name}　${d.goal || ''}`],
        ['玩家意图', `${d.intent.class_name || ''}（${({ examine: '调查', talk: '交谈', move: '移动', free: '自由行动', recall: '重看已有线索', look: '环顾', party: '同桌商量', choice: '关键抉择', absent: '找不在场的人', ask_ai: '问 AI 同伴', wrap: '收束' })[d.intent.kind] || d.intent.kind}）${d.intent.probe ? '　试探边界' : ''}`],
        ['张力相位', `${d.phase_name}　${d.phase_reason}`],
        ['信息预算', `本轮最多 ${d.info_budget.max_clues} 条线索；已放 ${d.reveal.length} 条${d.reveal.length ? '：' + d.reveal.map((r) => `${r.name}（${r.form}）`).join('、') : ''}`],
        d.wake_npcs.length ? ['唤醒 NPC', d.wake_npcs.join('、') + (d.npc_directive ? `　指示：${({ share: '交代', deflect: '推脱', smalltalk: '闲谈', repeat: '说过了' })[d.npc_directive.mode]}——${d.npc_directive.reason}` : '')] : null,
        d.checks.length ? ['检定', d.checks.map((c) => `${c.label} ${c.value}${c.need != null ? '/' + c.need : ''} ${c.level || (c.success ? '稳住' : '没稳住')}`).join('；')] : null,
        d.fallback ? ['柔性补线', `${d.fallback.reason} → 把「${d.fallback.clue_name}」换成「${d.fallback.form}」送达`] : null,
        ['禁止泄露项', d.forbidden.join(' ') || '无'],
        ['跑偏计数', `${d.off_track} 轮；无新线索 ${d.stall} 轮`],
        ['交给叙述层的', `类型 ${d.narrator_gets.kind}；氛围句 ${d.narrator_gets.beat ? '1 条' : '无'}；原文块 ${d.narrator_gets.canon_blocks.join('、') || '无'}`],
      ].filter(Boolean);
      return h('div', { class: 'ev kp' }, h('b', {}, `导演单 · 第 ${d.round} 轮\n`), L.map(([k, v]) => [h('b', {}, k.padEnd(6, '　') + '　'), v + '\n']));
    }
    case 'state.change': return h('div', { class: 'ev kp minor' }, `落库　${d.reason}：${d.changes.map((c) => c.op + (c.pc ? ' ' + c.pc : '') + (c.npc ? ' ' + c.npc : '') + (c.before !== undefined && c.after !== undefined ? ` ${c.before}→${c.after}` : c.flag ? ` ${c.flag}=${c.value}` : c.clue ? ` ${c.clue}` : c.item ? ` ${c.item}` : c.scene ? ` ${c.scene}` : c.value !== undefined ? ` ${typeof c.value === 'object' ? Object.entries(c.value).map(([k, v]) => k + '=' + v).join(' ') : c.value}` : c.text ? ` ${c.text}` : '')).join('，')}`);
    case 'proposal.rejected': return h('div', { class: 'ev kp bad' }, `提案被拒　来源 ${d.source}：${d.rejected.map((r) => `${r.op.op} —— ${r.why}`).join('；')}`);
    case 'guard.alert': return h('div', { class: 'ev kp minor' }, `闸门　${d.role}${d.who && d.who !== d.role ? '/' + d.who : ''}：${d.violations.map((v) => `${v.type}「${v.match}」`).join('、')} → ${({ pass: '仅记录', rewrite: '已打回重写', strip: '已剔除违规句', offline: '改用离线稿' })[d.action]}`);
    case 'context.audit': return h('div', { class: 'ev kp minor' + (d.leak ? ' bad' : '') }, `隔离审计　交给 ${d.role}${d.who && d.who !== d.role ? '/' + d.who : ''} 的上下文 ${d.chars} 字，真相层金丝雀命中 ${d.leak ? d.hits.join(',') : '0'}　${srcName(d.source)}${d.ms ? ' ' + d.ms + 'ms' : ''}${d.fallback ? '（模型失败，落回离线：' + d.fallback + '）' : ''}`);
    case 'trigger.fired': return h('div', { class: 'ev kp' }, h('b', {}, '触发器　'), `${d.name}（${d.why}）${d.kp_note ? '\n' + d.kp_note : ''}`);
    case 'aipc.skip': return h('div', { class: 'ev kp minor' }, `AI 席位未发言　${d.why}`);
    case 'console.action': return h('div', { class: 'ev kp minor' }, `控制台　${d.type}${d.reason ? '：' + d.reason : ''}`);
    default: return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
function hurt() { const t = document.querySelector('.table'); if (!t) return; t.classList.remove('hurt'); void t.offsetWidth; t.classList.add('hurt'); setTimeout(() => t.classList.remove('hurt'), 1700); }
// 掷骰：骰子跳到屏幕上滚、落定、亮出读数，然后才轮到后面的内容。3D 出不来时退回这张牌自己滚数字。
async function rollDice(el, d, fast) {
  const val = el.querySelector('.val'), dc = el.querySelector('.dc'); if (!val || !dc) return;
  const mind = d.kind === 'mind'; let did = false;
  const land = () => {
    if (did) return; did = true; val.textContent = d.value; dc.classList.remove('rolling'); dc.classList.add('landed');
    sfx(d.level === 'crit' || /大成功/.test(d.levelName) ? 'crit' : d.success ? 'ok' : 'fail');
    if (mind && d.loss) { hurt(); sfx('mind', 0.2); }
  };
  dc.classList.add('rolling'); val.textContent = '··';
  const sub = mind ? `${TT.mind} ${d.current}` : `${d.skillName ?? ''} ${d.skill ?? ''}${!d.tierName || d.tierName === '普通' ? '' : ' · ' + d.tierName}${d.need != null ? ' · 需 ≤ ' + d.need : ''}`;
  const played = await rollDice3D(d, { sub, loss: mind && d.loss ? `${TT.mind} ${d.current} → ${d.after}` : '', onLand: land, hold: fast ? 650 : 1200 });
  if (played) { land(); return; }
  sfx('dice'); const t0 = performance.now();
  while (performance.now() - t0 < 760) { val.textContent = String(1 + Math.floor(Math.random() * 100)).padStart(2, '0'); await sleep(55); }
  land(); await sleep(fast ? 300 : 800);
}
// 字一个一个洇出来。返回这一段要用的毫秒数；演完把零碎的 span 并回一段文字。
function inkIn(el, per = 15, cap = 1300) {
  if (calm) return 0;
  const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()); const total = nodes.reduce((a, n) => a + n.textContent.length, 0); if (!total) return 0;
  const step = Math.min(per, cap / total); let i = 0; const groups = [];
  for (const n of nodes) { const text = n.textContent, spans = []; for (const ch of text) { const sp = document.createElement('span'); sp.className = 'ch'; sp.style.animationDelay = Math.round(i++ * step) + 'ms'; sp.textContent = ch; spans.push(sp); } n.replaceWith(...spans); groups.push([spans, text]); }
  const ms = total * step + 380; setTimeout(() => { for (const [spans, text] of groups) if (spans[0].isConnected) { spans[0].before(text); spans.forEach((x) => x.remove()); } }, ms + 200);
  return ms;
}
function fogWipe() { const t = document.querySelector('.table'); if (!t || calm) return; const f = h('div', { class: 'fogwipe' }); t.append(f); setTimeout(() => f.remove(), 1700); }
// 新的一轮一块一块出来，一块演完才轮到下一块：骰子落定之前，后面的话不会把它顶走
async function reveal(el, ev, state) {
  if (!el.isConnected) return;
  const fast = state.pending > 7, w = (ms) => sleep(fast ? ms * 0.4 : ms), d = ev.data;
  el.classList.remove('wait'); state.follow?.(el);
  switch (ev.type) {
    case 'dice.roll': await rollDice(el, d, fast); state.follow?.(el); return w(260);
    case 'clue.found': sfx('clue'); if (d.item) sfx('item', 0.55); setTimeout(() => state.follow?.(el), 700); return w(1050);   // 卡是翻出来的，翻完再对一次位置，免得下半截压在输入栏后面
    case 'narration': return w(inkIn(el) + 160);
    case 'npc.line': case 'aipc.line': return w(inkIn(el, 15, 900) + 200);
    case 'canon':
      if (d.kind === 'scene') { sfx('scene'); fogWipe(); return w(1250); }
      if (d.kind === 'trigger' || d.kind === 'event') { sfx('omen'); return w(inkIn(el, 18, 1500) + 500); }
      return w(inkIn(el, 14, 1200) + 200);
    case 'ending': sfx('bell'); music('ending'); state.finale?.(d); return w(1400);
    default: return w(200);
  }
}
function stage(el, ev, state) {
  el.classList.add('wait'); state.pending = (state.pending || 0) + 1; state.onStage?.(true);
  state.q = (state.q || Promise.resolve()).then(() => reveal(el, ev, state)).catch(() => { el.classList.remove('wait'); }).then(() => { if (--state.pending <= 0) { state.pending = 0; state.onStage?.(false); } });
}
function paintStream(box, events, state, live) {
  let round = state.lastRound ?? -1;
  for (const ev of events) {
    if (ev.round !== round && ev.type !== 'session.start' && ev.round > 0) { round = ev.round; box.append(h('div', { class: 'rd' }, h('i', {}, '◆'), `第${cnNum(ev.round)}轮`, h('i', {}, '◆'))); }
    const el = renderEvent(ev, state); if (!el) continue;
    if (KP_TYPES.has(ev.type)) { kpNote(box, ev, el, state); continue; }
    box.append(el); if (live && ev.type !== 'player.action') stage(el, ev, state);
    if (ev.type === 'narration' && ev.data.supersedes) box.querySelector(`.na[data-seq="${ev.data.supersedes}"]`)?.classList.add('old');
    if (ev.type === 'xcard' && ev.data.veil) box.querySelector(`.ca[data-seq="${ev.data.veil}"]`)?.classList.add('veil');
  }
  state.lastRound = round;
}

// ------------------------------------------------------------ 桌面
export async function renderTable(id, tk) {
  const isKp = !!tk.kp; const S = { replayHref: `#/s/${id}/replay`, seat: null, lamp: false, seq: 0, lastRound: -1, view: null, busy: false, timer: null, dead: false, tab: 'c' };
  const token = () => (S.lamp && isKp ? tk.kp : isKp ? tk.seats[S.seat] : tk.join);
  const actToken = () => (isKp ? tk.seats[S.seat] : tk.join);
  let view;
  try { view = await api(`/api/s/${id}/view?t=${isKp ? tk.kp : tk.join}`); } catch (e) { toast(e.message); return go('#/'); }
  setTerms(view); SCENE_OF = view.title; await sceneImgReady;
  const humans = view.pcs.filter((p) => p.seat === 'human');
  S.seat = isKp ? (store.get('seat.' + id) && tk.seats[store.get('seat.' + id)] ? store.get('seat.' + id) : humans[0].id) : view.viewer;
  document.title = `${view.title} · 掌灯人`;

  const stream = h('div', { class: 'in' }), streamBox = h('div', { class: 'stream' }, stream);
  const left = h('aside', { class: 'side l' }), right = h('aside', { class: 'side r' });
  const clock = h('span', { class: 'clock' }), ttl = h('span', { class: 'ttl' }, view.title);
  const seatSel = h('select', { title: '当前操作的席位', onchange: (e) => { S.seat = e.target.value; store.set('seat.' + id, S.seat); reload(); } });
  const lampBtn = h('button', { class: 'lampbtn', title: '掌灯：切到掌灯人全知视角', onclick: () => { S.lamp = !S.lamp; sfx('lamp'); lampBtn.classList.toggle('on', S.lamp); root.classList.toggle('lamp-on', S.lamp); consoleBtn.style.display = S.lamp ? '' : 'none'; reload(); } }, h('i'), '掌灯');
  const consoleBtn = h('button', { style: 'display:none', onclick: () => openDrawer() }, '控制台');
  const ta = h('textarea', { placeholder: '说一句话，或者做一件事。', rows: 1, onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } } });
  const secret = h('input', { type: 'checkbox' });
  const whoLine = h('div', { class: 'who' });
  const sendBtn = h('button', { class: 'primary', type: 'submit' }, '行动');
  const reach = h('div', { class: 'reach' });
  // 点一下看得见的东西、人、去处，就把话起个头；说什么仍然由你
  const say = (text, typing) => { sfx('tap'); ta.value = text; if (typing || innerWidth > 1020) { ta.focus(); ta.setSelectionRange(text.length, text.length); } else sendBtn.classList.add('ready'); };
  const composer = h('div', { class: 'composer' }, h('div', { class: 'in' }, h('div', { class: 'thinking' }), h('div', { class: 'endrow' }, h('button', { class: 'primary', onclick: () => go(`#/s/${id}/replay`) }, '翻开这一夜'), h('button', { onclick: () => { const f = SCENE_IMG[SCENE_OF]?._file; go(f ? '#/go/' + encodeURIComponent(f) : '#/shelf'); } }, '再来一夜')), reach, whoLine, h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } }, ta, sendBtn)));
  const cols = h('div', { class: 'cols' }, left, h('div', { class: 'center' }, streamBox, composer), right);
  const mtabs = h('div', { class: 'mtabs' }, [['c', '叙述'], ['l', '人与地'], ['r', '线索']].map(([k, n]) => h('button', { class: k === 'c' ? 'on' : '', onclick: (e) => { S.tab = k; cols.className = 'cols' + (k === 'l' ? ' show-l' : k === 'r' ? ' show-r' : ''); mtabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); e.currentTarget.classList.remove('dot'); } }, n)));
  const drawer = h('div', { class: 'drawer' });
  const sndBtn = h('button', { onclick: () => { setSound(!soundOn()); unlock(); sndBtn.textContent = soundOn() ? '静音' : '出声'; } }, soundOn() ? '静音' : '出声');
  const musBtn = h('button', { title: '只关配乐，海声和提示音照常', onclick: () => { setMusic(!musicIsOn()); musBtn.textContent = musicIsOn() ? '关配乐' : '开配乐'; } }, musicIsOn() ? '关配乐' : '开配乐');
  const more = h('div', { class: 'more', onclick: (e) => { if (e.target.closest('button')) more.classList.remove('open'); } },
    isKp && humans.length > 1 ? seatSel : null, consoleBtn,
    h('button', { class: 'xbtn', title: 'X 卡：遮住上一段描写，并让随后几轮淡化。不记录是谁按的。', onclick: async () => { await api(`/api/s/${id}/xcard`, { t: actToken(), mode: 'fade' }); poll(); } }, 'X 卡'),
    isKp ? h('button', { onclick: async () => { const name = prompt('给这个存档起个名字', `第 ${S.view.round} 轮`); if (name == null) return; await api(`/api/s/${id}/save`, { t: tk.kp, name }); toast('已存档'); poll(); } }, '存档') : null,
    h('button', { onclick: () => go(`#/s/${id}/replay`) }, 'Replay'), musBtn, sndBtn);
  const moreBtn = h('button', { class: 'morebtn', 'aria-label': '更多', onclick: () => more.classList.toggle('open') }, '⋯');
  const night = h('div', { class: 'night' }, h('i'));
  // 此地的图虚在整张桌面后面，换场时交叠着换；上面浮一层慢慢走的雾
  const backdrop = h('div', { class: 'backdrop' }, h('i'), h('i'), h('b')); let bdK = 0, bdUrl;
  const setBackdrop = (url) => { if (url === bdUrl) return; bdUrl = url; const a = backdrop.children[(bdK ^= 1)], b = backdrop.children[bdK ^ 1]; if (url) a.style.backgroundImage = `url("${url}")`; a.classList.toggle('on', !!url); b.classList.remove('on'); };
  // 结局：整屏的一幕。图铺满，名字一个字一个字亮，正文完整摆出来
  S.finale = (d) => {
    root.querySelector('.finale')?.remove(); const pic = endImg(d.name);
    const f = h('div', { class: 'finale' }, h('div', { class: 'bg', style: pic ? `background-image:url("${pic}")` : null }),
      h('div', { class: 'box' }, h('small', {}, '这一夜的结局'), h('h2', {}, [...d.name].map((c, i) => h('span', { style: `animation-delay:${700 + i * 260}ms` }, c))), h('p', {}, d.text),
        h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: () => go(`#/s/${id}/replay`) }, '翻开这一夜'), h('button', { onclick: () => { f.classList.add('bye'); setTimeout(() => f.remove(), 600); } }, '回到桌边'))));
    root.append(f);
  };
  S.onStage = (on) => root.classList.toggle('staging', on);
  const root = h('div', { class: 'table' }, backdrop,
    h('header', { class: 'bar' }, h('a', { href: '#/', class: 'back', title: '回首页' }, '←'), ttl, clock, h('span', { class: 'sp' }),
      isKp ? lampBtn : null, more, moreBtn, night),
    cols, mtabs, drawer);
  app.replaceChildren(root);

  function paintSides() {
    const v = S.view; ttl.textContent = v.scene.name; { const c = `${v.clock}${S.lamp ? ` · 第 ${v.round} 轮${v.phase_name ? ' · ' + v.phase_name : ''}` : ''}`; if (clock.textContent !== c) { const first = !clock.textContent; clock.textContent = c; if (!first) { clock.classList.remove('tick'); void clock.offsetWidth; clock.classList.add('tick'); } } }
    setBackdrop(sceneImg(v.scene.name)); let nightP = 0;
    { const n = nightOf(), m = /(\d+):(\d+)\s*$/.exec(v.clock); if (n && m) { const toMin = (x) => { const [a, b] = x.split(':').map(Number); return a * 60 + b; }; const a = toMin(n[0]), b = toMin(n[1]); let c = Number(m[1]) * 60 + Number(m[2]); if (c < a) c += 1440; const p = Math.max(0, Math.min(1, (c - a) / (b - a))); nightP = p; night.style.display = ''; night.firstChild.style.width = (p * 100).toFixed(1) + '%'; night.classList.toggle('late', p > 0.75); } else night.style.display = 'none'; }
    // 配乐跟着夜走：前半夜一首，夜深了换一首，收团再换一首
    music(v.ending ? 'ending' : nightP > 0.55 || ['press', 'confront', 'reveal'].includes(v.phase) ? 'tense' : 'explore');
    if (S.reachAt !== v.scene.name) { S.reachAt = v.scene.name; reach.scrollLeft = 0; }
    fill(reach, v.ending ? null : [v.scene.things.map((t) => h('button', { type: 'button', onclick: () => say('看看' + t) }, t)), v.scene.npcs.map((n) => h('button', { type: 'button', class: 'p', onclick: () => say(`问${n.name}：`, true) }, n.name)), v.scene.exits.map((t) => h('button', { type: 'button', class: 'x', onclick: () => say('去' + t) }, t))]);
    if (isKp) seatSel.replaceChildren(...v.pcs.filter((p) => p.seat === 'human').map((p) => h('option', { value: p.id, selected: p.id === S.seat }, `席位：${p.name}`)));
    const me = v.pcs.find((p) => p.id === S.seat);
    fill(whoLine, h('b', { title: v.model?.length ? '叙述与扮演：' + v.model.join(' → ') : '' }, me?.name || ''), v.branch !== 'main' ? h('span', { class: 'dim' }, `分支 ${v.branch}`) : null, v.model?.length ? null : h('span', { class: 'dim' }, '离线演员'), h('label', { title: '只有你自己看得见这次行动、检定和得到的线索' }, secret, '私下行动'));
    const pic = sceneImg(v.scene.name);
    fill(left,
      v.pcs.map((p) => h('div', { class: 'pc' + (p.id === S.seat ? ' me' : ''), onclick: (e) => e.currentTarget.classList.toggle('open') },
        h('div', { class: 'n' }, h('span', {}, p.name), h('small', {}, `${p.role}${p.seat === 'ai' ? ' · AI' : ''}`)),
        h('div', { class: 'meter' }, v.terms.hp, h('i', {}, h('b', { style: `width:${(p.hp / p.hpMax) * 100}%` })), `${p.hp}/${p.hpMax}`),
        h('div', { class: 'meter mind' }, v.terms.mind, h('i', {}, h('b', { style: `width:${(p.mind / p.mindMax) * 100}%` })), `${p.mind}/${p.mindMax}`),
        p.conditions.map((c) => h('div', { class: 'cond' }, c.text)),
        h('div', { class: 'more' }, p.attrs ? [v.rulepack.attributes.map((a) => `${a.name} ${p.attrs[a.id]}`).join('　'), h('br'), v.rulepack.skills.filter((k) => p.skills[k.id] >= 25).map((k) => `${k.name} ${p.skills[k.id]}${p.ticked?.includes(k.id) ? '✓' : ''}`).join('　'), h('br'), '物品：' + p.items.join('、'), h('br'), '执念：' + p.drive, h('br'), '恐惧源：' + p.fear] : ['物品：' + p.items.join('、'), h('br'), '（别人的卡，只看得到这些）']))),
      h('div', { class: 'here' + (pic ? ' shot' : ''), style: pic ? `background-image:url("${pic}")` : null }, h('b', {}, v.scene.name)),
      h('div', { class: 'scenebox' },
        h('div', { class: 'chips' }, v.scene.things.map((t) => h('span', { onclick: () => say('看看' + t) }, t))),
        v.scene.npcs.map((n) => h('p', { class: 'who', onclick: () => say(`问${n.name}：`, true) }, h('b', {}, n.name), S.lamp && n.attitude !== undefined ? h('i', { class: 'mono', title: '态度' }, (n.attitude > 0 ? '+' : '') + n.attitude) : null, h('span', {}, n.public_identity))),
        h('div', { class: 'chips exits' }, v.scene.exits.map((t) => h('span', { onclick: () => say('去' + t) }, t)))),
    );
    const dice = S.dice.slice(-14).reverse(), tl = S.tl.slice(-16).reverse();
    const found = v.clues.filter((c) => c.found), unfound = v.clues.filter((c) => !c.found);
    const rt = S.rtab || 'clue'; const rtab = (k, n, c) => h('button', { class: rt === k ? 'on' : '', onclick: () => { S.rtab = k; paintSides(); } }, n, c != null ? h('i', {}, c) : null);
    fill(right,
      h('div', { class: 'rtabs' }, rtab('clue', '线索', `${found.length}/${v.clue_total}`), rtab('dice', '掷骰', S.dice.length || null), rtab('tl', '时间线')),
      rt === 'clue' ? [
        found.map((c) => h('div', { class: 'clue' }, h('b', {}, c.name, c.key ? h('span', { class: 'tag key' }, '关键') : null), h('span', {}, `第 ${c.round} 轮 · ${c.form}`), h('p', {}, c.content))),
        !found.length ? h('p', { class: 'dim small' }, '还没有。') : null,
        unfound.length ? h('p', { class: 'unfound', title: '只有掌灯人看得见' }, unfound.map((c) => h('span', { class: c.key ? 'key' : '' }, c.name))) : null,
      ] : rt === 'dice' ? (dice.length ? dice.map((d) => h('div', { class: 'dice' }, h('b', {}, d.label), h('span', { class: d.success ? 'ok' : 'no' }, d.levelName + (d.kind === 'mind' && d.loss ? ` −${d.loss}` : '')), h('br'), d.kind === 'mind' ? `${TT.mind} ${d.current} · 掷 ${d.value}` : `${d.skillName} ${d.skill} · 需 ≤${d.need} · 掷 ${d.value}`)) : h('p', { class: 'dim small' }, '还没有掷过骰。'))
        : tl.map((t) => h('div', { class: 'tl' }, h('span', { class: 'mono' }, t.clock + ' '), h('b', {}, t.who), ' ' + t.what)),
    );
    ta.disabled = sendBtn.disabled = S.busy; root.classList.toggle('busy', S.busy);
    composer.classList.toggle('over', !!v.ending);
  }
  const fmtClock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  function digest(events) {
    for (const ev of events) {
      if (ev.type === 'dice.roll') S.dice.push(ev.data);
      if (ev.type === 'player.action') S.tl.push({ clock: fmtClock(ev.clock), who: ev.data.name, what: ev.data.text.slice(0, 28) });
      if (ev.type === 'clue.found' && S.seq > 0 && S.tab !== 'r') mtabs.lastChild.classList.add('dot');
      if (ev.type === 'clue.found') S.tl.push({ clock: fmtClock(ev.clock), who: '线索', what: ev.data.name });
      if (ev.type === 'canon' && ev.data.kind === 'trigger') S.tl.push({ clock: fmtClock(ev.clock), who: '事件', what: ev.data.title });
      if (ev.type === 'ending') S.tl.push({ clock: fmtClock(ev.clock), who: '结局', what: ev.data.name });
    }
  }
  async function reload() { S.seq = 0; S.lastRound = -1; S.note = null; S.seenScenes = null; S.dice = []; S.tl = []; stream.replaceChildren(); await poll(true); }
  async function poll(force) {
    if (S.dead) return;
    try {
      const r = await api(`/api/s/${id}/events?t=${token()}&since=${S.seq}`);
      if (S.branch && r.branch !== S.branch) { S.branch = r.branch; return reload(); } S.branch = r.branch;
      r.events = r.events.filter((e) => e.seq > S.seq);
      if (r.events.length || force || !S.view) {
        const near = streamBox.scrollHeight - streamBox.scrollTop - streamBox.clientHeight < 240;
        const live = S.seq > 0 && r.events.length > 0;
        // 新的一轮一块一块出来：视线跟着刚出现的那一块走，不一下子拽到底
        S.follow = near || force ? (el) => { const b = el.getBoundingClientRect(), bb = streamBox.getBoundingClientRect(); if (b.height > bb.height - 40) streamBox.scrollTop += b.top - bb.top - 16; else if (b.bottom > bb.bottom - 16) streamBox.scrollTop += b.bottom - bb.bottom + 28; } : null;
        digest(r.events); paintStream(stream, r.events, S, S.seq > 0); S.seq = r.events.length ? r.events[r.events.length - 1].seq : S.seq;
        S.view = await api(`/api/s/${id}/view?t=${token()}`); remember(id, null, S.view.title, S.view.round); paintSides();
        if ((near || force) && !live) requestAnimationFrame(() => { streamBox.scrollTop = streamBox.scrollHeight; });
      }
      if (!S.sending && S.busy !== r.busy) { S.busy = r.busy; paintSides(); }
    } catch (e) { if (/过期|没有这局/.test(e.message)) { S.dead = true; toast(e.message); } else console.error('桌面刷新出错', e); }
  }
  async function submit() {
    const text = ta.value.trim(); if (!text || S.busy || !S.view) return;   // 此地的信息还没到（慢网络上头几秒）：先不收行动
    S.busy = S.sending = true; sendBtn.classList.remove('ready'); unlock(); sfx('send'); paintSides(); ta.value = '';
    try { await api(`/api/s/${id}/act`, { t: actToken(), text, secret: secret.checked }); }
    catch (e) { toast(e.message, 5000); ta.value = text; }
    S.busy = S.sending = false; secret.checked = false; await poll(true); ta.focus();
  }

  // ---- 掌灯人控制台
  async function openDrawer() {
    const v = await api(`/api/s/${id}/view?t=${tk.kp}`);
    const act = async (action, msg) => { try { await api(`/api/s/${id}/console`, { t: tk.kp, action }); toast(msg || '已执行，已记入日志'); await poll(true); openDrawer(); } catch (e) { toast(e.message, 5000); } };
    const prop = (ops, reason) => act({ type: 'propose', ops, reason }, '提案已校验落库');
    const fact = h('input', { placeholder: '登记一条即兴事实，例如：牌馆的庄家是个左撇子' });
    const flag = h('input', { placeholder: 'flag 名', style: 'width:9em' });
    const cfgNum = (label, key, step = 1) => h('div', { class: 'ln' }, h('span', {}, label), h('input', { type: 'number', step, value: v.cfg[key], style: 'width:6em', onchange: (e) => act({ type: 'config', value: { [key]: Number(e.target.value) } }, '设置已更新') }));
    const dt = S.dtab || 'state'; const dtab = (k, n) => h('button', { class: dt === k ? 'on' : '', onclick: () => { S.dtab = k; openDrawer(); } }, n);
    fill(drawer,
      h('h3', { title: '这里的每一次操作都以「控制台」为来源写进日志，Replay 里看得到。' }, '掌灯人控制台', h('button', { class: 'ghost', onclick: () => drawer.classList.remove('on') }, '收起')),
      h('div', { class: 'dtabs' }, dtab('state', '状态'), dtab('plot', '剧情'), dtab('desk', '规则台'), dtab('seat', '席位')),
      dt === 'state' ? [
      v.pcs.map((p) => h('div', { class: 'ln' }, h('span', {}, `${p.name}　${TT.hp} ${p.hp}　${TT.mind} ${p.mind}`), h('button', { onclick: () => prop([{ op: 'hp.delta', pc: p.id, value: -1 }], '手动') }, TT.hp + '−'), h('button', { onclick: () => prop([{ op: 'hp.delta', pc: p.id, value: 1 }], '手动') }, TT.hp + '+'), h('button', { onclick: () => prop([{ op: 'mind.delta', pc: p.id, value: -1 }], '手动') }, TT.mind + '−'), h('button', { onclick: () => prop([{ op: 'mind.delta', pc: p.id, value: 1 }], '手动') }, TT.mind + '+'))),
      v.npcs_all.map((n) => h('div', { class: 'ln' }, h('span', {}, `${n.name}　态度 ${n.attitude}　在 ${n.at}`), h('button', { onclick: () => prop([{ op: 'npc.attitude', npc: n.id, value: -1 }], '手动') }, '−'), h('button', { onclick: () => prop([{ op: 'npc.attitude', npc: n.id, value: 1 }], '手动') }, '+'))),
      h('div', { class: 'ln' }, flag, h('button', { onclick: () => flag.value.trim() && prop([{ op: 'flag.set', flag: flag.value.trim(), value: 1 }], '手动置 flag') }, '置 flag'), h('span', { class: 'dim small' }, Object.keys(v.flags).filter((k) => !k.startsWith('__')).join(' ') || '尚无 flag')),
      h('div', { class: 'ln' }, fact, h('button', { onclick: () => fact.value.trim() && prop([{ op: 'fact.add', text: fact.value.trim(), source: 'console' }], '登记即兴事实') }, '登记')),
      v.facts.length ? h('div', { class: 'dim small' }, v.facts.map((f) => h('div', {}, `${f.id} 第${f.round}轮：${f.text}`))) : null,
      ] : null,
      dt === 'desk' ? (() => {
        const sel = (opts, w = '7em') => h('select', { style: `width:${w}` }, opts.map(([val, n]) => h('option', { value: val }, n)));
        const pcSel = sel(v.pcs.map((p) => [p.id, p.name])), skSel = sel([...v.rulepack.skills.map((k) => [k.name, k.name]), ...v.rulepack.attributes.map((a) => [a.name, a.name + '（属性）'])], '9em'), tierSel = sel([['普通', '普通'], ['困难', '困难'], ['极难', '极难']], '5em');
        const bn = sel([[0, TT.bonus + ' 0'], [1, '+1'], [2, '+2']], '6.5em'), pn = sel([[0, TT.penalty + ' 0'], [1, '+1'], [2, '+2']], '6.5em');
        const desk = (a, msg) => act({ type: 'desk', pc: pcSel.value, ...a }, msg || '已掷，结果在叙述流里');
        const ms = h('input', { value: '0', style: 'width:4em', title: '成功时的损失' }), mf = h('input', { value: '1d4', style: 'width:5em', title: '失败时的损失' }), ml = h('input', { placeholder: '因为什么（可空）', style: 'width:10em' });
        const fn = h('input', { placeholder: '对手名', style: 'width:7em' }), fh = h('input', { type: 'number', value: 12, style: 'width:4.2em', title: TT.hp }), fs = h('input', { type: 'number', value: 45, style: 'width:4.2em', title: '战斗技能值' }), fd = h('input', { value: '1d6', style: 'width:5em', title: '伤害骰式' }), fa = h('input', { type: 'number', value: 0, style: 'width:3.6em', title: '护甲' });
        const wSel = sel(v.rulepack.weapons.map((w) => [w.id, `${w.name} ${w.damage}`]), '10em');
        return [
          h('div', { class: 'ln wrap' }, pcSel, skSel, tierSel, bn, pn, h('button', { onclick: () => desk({ kind: 'check', skill: skSel.value, tier: tierSel.value, bonus: bn.value, penalty: pn.value }) }, '掷检定'), h('button', { title: '只有掌灯人看得到结果', onclick: () => desk({ kind: 'check', skill: skSel.value, tier: tierSel.value, bonus: bn.value, penalty: pn.value, secret: true }, '暗骰已掷，只有你看得到') }, '暗骰')),
          h('div', { class: 'ln wrap' }, h('span', {}, `${TT.mind}检定　成功/失败损失`), ms, mf, ml, h('button', { onclick: () => desk({ kind: 'mind', success: ms.value, fail: mf.value, label: ml.value.trim() }) }, '掷')),
          h('div', { class: 'ln wrap' }, h('span', {}, '对手（名字 / ' + TT.hp + ' / 战斗技能 / 伤害 / 护甲）'), fn, fh, fs, fd, fa, v.foe_hint ? h('button', { title: '把真相层「存在」里写的战斗数据填进来', onclick: () => { fn.value = v.foe_hint.name; fh.value = v.foe_hint.hp; fs.value = v.foe_hint.skill; fd.value = v.foe_hint.damage; fa.value = v.foe_hint.armor; } }, '按真相层填') : null, h('button', { onclick: () => fn.value.trim() && desk({ kind: 'foe.add', name: fn.value.trim(), hp: fh.value, skill: fs.value, damage: fd.value, armor: fa.value }, '对手已登场') }, '登场'), (v.foes || []).length ? h('button', { onclick: () => desk({ kind: 'order' }, '已排定先后') }, '排先攻') : null),
          (v.foes || []).map((f) => h('div', { class: 'ln wrap' }, h('span', {}, `${f.name}　${TT.hp} ${f.hp}/${f.hpMax}　技能 ${f.skill}　伤害 ${f.damage}${f.armor ? '　护甲 ' + f.armor : ''}${f.status === 'down' ? '　已倒下' : ''}`),
            f.status === 'ok' ? [wSel, h('button', { title: `上面选中的${TT.pc}用选中的武器攻击它，它闪避`, onclick: () => desk({ kind: 'attack', by: 'pc', foe: f.id, weapon: wSel.value, bonus: bn.value, penalty: pn.value }) }, '寻访者攻击'), h('button', { title: '它攻击上面选中的寻访者，寻访者闪避', onclick: () => desk({ kind: 'attack', by: 'foe', foe: f.id, response: 'dodge' }) }, '它攻击·闪避'), h('button', { title: '它攻击上面选中的寻访者，寻访者反击', onclick: () => desk({ kind: 'attack', by: 'foe', foe: f.id, response: 'counter' }) }, '它攻击·反击')] : null,
            h('button', { onclick: () => desk({ kind: 'foe.remove', foe: f.id }, '已离场') }, '离场'))),
          h('div', { class: 'ln wrap' }, h('span', {}, `团后成长：已勾选 ${v.pcs.reduce((n, p) => n + (p.ticked || []).length, 0)} 项技能`), h('button', { onclick: () => desk({ kind: 'growth' }, '成长检定已掷') }, '掷成长检定')),
        ];
      })() : null,
      dt === 'plot' ? [
      h('h4', {}, '触发事件'),
      v.triggers.map((t) => h('div', { class: 'ln' }, h('span', {}, t.name, t.fired ? h('span', { class: 'dim' }, '　已触发') : null), h('button', { disabled: t.fired, onclick: () => act({ type: 'trigger', id: t.id }, `已触发「${t.name}」`) }, '触发'))),
      h('h4', {}, '相位'),
      h('div', { class: 'ln' }, [['explore', '探索'], ['investigate', '调查'], ['press', '加压'], ['confront', '对抗'], ['reveal', '揭示']].map(([k, n]) => h('button', { class: v.phase === k ? 'primary' : '', onclick: () => act({ type: 'phase', value: k }, `相位切到「${n}」`) }, n))),
      h('h4', {}, '补线'),
      v.clue_defs.filter((c) => !v.clues.find((x) => x.id === c.id)?.found).map((c) => h('div', { class: 'ln' }, h('span', {}, c.name, c.key ? h('span', { class: 'tag key', style: 'margin-left:6px' }, '关键') : null), c.carriers.filter((k) => k.via === '事件').map((k) => h('button', { title: k.form, onclick: () => act({ type: 'fallback', clue: c.id, carrier: k.id }, `已用「${k.form}」送出`) }, k.form.slice(0, 9))))),
      h('h4', {}, '重写'),
      h('div', { class: 'ln' }, h('span', {}, '把最近一段叙述打回去重写（旧稿留在日志里，划线显示）'), h('button', { onclick: async () => { try { await api(`/api/s/${id}/rewrite`, { t: tk.kp }); toast('已重写'); poll(true); } catch (e) { toast(e.message); } } }, '重写')),
      ] : null,
      dt === 'seat' ? [
      cfgNum('AI 主动度（0–100）', 'aiInitiative', 5), cfgNum('AI 发言配额（0–1）', 'aiQuota', 0.02), cfgNum('跑偏几轮后补线', 'offTrackN'), cfgNum('时间流速', 'timeScale', 0.25),
      h('div', { class: 'ln' }, h('span', {}, `玩家发言 ${v.speech.human}，AI 发言 ${v.speech.ai}（占 ${v.speech.human + v.speech.ai ? ((v.speech.ai / (v.speech.human + v.speech.ai)) * 100).toFixed(0) : 0}%）`)),
      h('div', { class: 'ln' }, h('span', {}, '使用模型'), h('button', { class: v.cfg.useModel ? 'primary' : '', onclick: () => act({ type: 'config', value: { useModel: !v.cfg.useModel } }, v.cfg.useModel ? '已切到离线演员' : '已切回模型') }, v.cfg.useModel ? '开' : '关'), h('span', { class: 'dim small' }, v.llm_stats ? `成功 ${v.llm_stats.ok} 次，失败 ${v.llm_stats.fail} 次` : '')),
      h('h4', {}, '席位链接'),
      Object.entries(v.seat_tokens || {}).map(([pc, t]) => { const p = v.pcs.find((x) => x.id === pc); return p.seat === 'human' ? h('div', { class: 'ln' }, h('span', {}, p.name), h('button', { onclick: () => { navigator.clipboard?.writeText(`${location.origin}/#/s/${id}?t=${t}`); toast('已复制这个席位的链接'); } }, '复制链接')) : null; }),
      ] : null,
    );
    drawer.classList.add('on');
  }

  S.dice = []; S.tl = []; preloadDice();
  await poll(true);
  S.timer = setInterval(() => { if (!document.hidden && !S.sending) poll(); }, 2500);
  window.__stopTable = () => { S.dead = true; clearInterval(S.timer); };
  if (innerWidth > 1020) ta.focus();
}

// ------------------------------------------------------------ Replay 页
export async function renderReplay(id, tk) {
  const isKp = !!tk.kp; let lamp = isKp && store.get('rplamp', false); let branch = null; let sec = 'play';
  const t = () => (isKp ? tk.kp : tk.join);
  const root = h('div', { class: 'page wide rp' }); app.replaceChildren(root);
  async function paint() {
    let rp, view;
    try { view = await api(`/api/s/${id}/view?t=${t()}`); setTerms(view); SCENE_OF = view.title; await sceneImgReady; branch ||= view.branch; rp = await api(`/api/s/${id}/replay?t=${t()}&view=${lamp ? 'kp' : 'player'}&branch=${branch}`); } catch (e) { toast(e.message); return go('#/'); }
    document.title = `Replay：${rp.meta.title} · 掌灯人`;
    const url = (fmt, v = lamp ? 'kp' : 'player') => `/api/s/${id}/replay?t=${t()}&view=${v}&format=${fmt}&branch=${branch}&dl=1`;
    const ex = (what) => `/api/s/${id}/export?t=${tk.kp}&what=${what}`;
    const streamIn = h('div', { class: 'in' }); const st = { lastRound: -1 };
    const evs = []; for (const r of rp.rounds) { const all = [...r.public, ...r.kp].sort((a, b) => a.seq - b.seq); for (const it of all) evs.push({ seq: it.seq, round: r.round, type: it.type, data: it.data, private: it.private }); }
    paintStream(streamIn, evs, st);
    const stat = (n, l) => h('div', {}, h('b', {}, n), h('span', {}, l));
    const lampBtn = isKp ? h('button', { class: 'lampbtn' + (lamp ? ' on' : ''), onclick: () => { lamp = !lamp; store.set('rplamp', lamp); paint(); } }, h('i'), lamp ? '掌灯人全知视角' : '玩家视角') : null;
    const snapSel = h('select', { style: 'width:auto' }, view.snapshots.map((r) => h('option', { value: r, selected: r === Math.max(0, view.round - 1) }, r === 0 ? '开团时' : `第 ${r} 轮结束时`)));
    root.className = 'page wide rp' + (lamp ? ' lamp-on' : '');
    fill(root, 
      h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), h('i'), h('a', { href: `#/s/${id}` }, '回到桌面'), h('i'), h('span', { class: 'on' }, 'Replay')),
      h('h1', {}, rp.meta.title),
      h('p', { class: 'lead' }, `${rp.meta.branch === 'main' ? '' : `分支「${rp.meta.branch_name}」　`}${rp.meta.rounds} 轮　${rp.meta.clock_start} → ${rp.meta.clock_end}　结局：${rp.meta.ending}`),
      h('div', { class: 'row', style: 'margin-bottom:8px' }, lampBtn, h('a', { href: url('md') }, '导出 Markdown'), h('a', { href: url('html') }, '导出 HTML'), h('a', { href: url('json') }, '导出 JSON'), h('a', { href: url('html').replace('&dl=1', ''), target: '_blank', title: '在浏览器里打印，另存为 PDF' }, '打印页')),
      h('div', { class: 'big', style: 'margin-top:26px' }, stat(rp.clues.rate, '线索发现率'), stat(rp.dice.total, '次掷骰'), stat(`${rp.dice.verified}/${rp.dice.total}`, '骰面重算一致'), stat(rp.isolation.leaks, '真相层泄露'), stat((rp.speech.ai_share * 100).toFixed(0) + '%', 'AI 发言占比')),
      (() => { if (sec === 'kp' && !lamp) sec = 'play'; return h('div', { class: 'tabs sec' }, [['play', '回放'], ['tl', '时间线'], ['clue', '线索'], ['dice', '骰子与曲线'], ['fork', '抉择与分支'], ['npc', 'NPC'], lamp ? ['kp', '导演注解'] : null, ['novel', '记录稿'], ['data', '数据']].filter(Boolean).map(([k, n]) => h('button', { class: sec === k ? 'on' : '', onclick: () => { sec = k; paint(); } }, n))); })(),

      sec === 'dice' ? [
      h('div', { html: curveSvg(rp) }),
      h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ['轮', '谁', '事由', '骰面', '值', '对', '结果', '核对'].map((x) => h('th', {}, x))), rp.dice.rolls.map((r) => h('tr', {}, h('td', {}, r.round), h('td', {}, r.pc), h('td', {}, r.label), h('td', { class: 'mono' }, `${r.tens.join('/')}·${r.units}`), h('td', { class: 'mono' }, r.value), h('td', { class: 'mono' }, r.target), h('td', {}, r.level + (r.loss ? ` −${r.loss}` : '')), h('td', { class: 'mono', style: r.verify.ok ? 'color:var(--tide)' : 'color:var(--blood)' }, r.verify.ok ? '一致' : r.verify.why))))),

      ] : null,
      sec === 'clue' ? [
      h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ['线索', '状态', '载体', '经由'].map((x) => h('th', {}, x))), rp.clues.list.map((c) => h('tr', {}, h('td', {}, c.name, c.key ? h('span', { class: 'tag key', style: 'margin-left:8px' }, '关键') : null), h('td', {}, c.found ? `第 ${c.round} 轮` : '遗漏'), h('td', {}, c.form || (c.carriers_unused ? '可用载体：' + c.carriers_unused.join('、') : '')), h('td', {}, c.by))))),

      ] : null,
      sec === 'fork' ? [
      rp.choices.length ? rp.choices.map((c) => h('p', {}, `第 ${c.round} 轮 · ${c.kind} · ${c.name} → ${c.taken}`, h('br'), h('span', { class: 'dim small' }, `另一条：${c.alternatives.join(' / ')}${c.reachable_before.length ? '　当时仍可达的结局：' + c.reachable_before.join('、') : ''}`))) : h('p', { class: 'dim' }, '这条分支还没有记录到抉择点。'),
      lamp ? [h('p', { class: 'dim small', style: 'letter-spacing:.2em;margin-top:18px' }, '未走到的分支点'), rp.unreached.map((u) => h('p', {}, u.name, h('span', { class: 'dim small' }, `　出现条件：${u.requires || '无'}　选项：${u.options.join(' / ')}`))), rp.unreached_endings.map((u) => h('p', {}, `未达成的结局「${u.name}」`, h('span', { class: 'dim small' }, '　' + u.conditions.join(' 或 '))))] : null,
      rp.tree.map((b) => h('div', { class: 'brow' }, h('b', {}, `${b.id}「${b.name}」`), h('span', { class: 'dim small' }, `${b.parent ? `← ${b.parent.branch} 第 ${b.parent.round} 轮` : '根'}　${b.rounds} 轮　线索 ${b.clues}　结局 ${b.ending || '未定'}`), b.id === view.branch ? h('span', { class: 'cur' }, '桌面当前') : isKp ? h('button', { onclick: async () => { await api(`/api/s/${id}/branch`, { t: tk.kp, id: b.id }); toast(`桌面已切到分支 ${b.id}`); branch = b.id; paint(); } }, '切到这条') : null, b.id !== branch ? h('button', { onclick: () => { branch = b.id; paint(); } }, '看它的 Replay') : h('span', { class: 'cur' }, '正在看'))),
      isKp ? h('div', { class: 'card', style: 'margin-top:18px' }, h('h3', {}, '回滚并开一条平行分支'),  h('div', { class: 'row' }, snapSel, h('button', { class: 'primary', onclick: async () => { const name = prompt('给新分支起个名字', '如果当时……'); if (name == null) return; const r = await api(`/api/s/${id}/rollback`, { t: tk.kp, round: Number(snapSel.value), name }); toast(`已开分支 ${r.branch}，回到第 ${r.round} 轮`); go(`#/s/${id}`); } }, '回滚到这里，开新分支'))) : null,

      ] : null,
      sec === 'tl' ? [
      h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ['轮', '时间', '地点', '谁', '做了什么', '结果'].map((x) => h('th', {}, x))), rp.timeline.map((x) => h('tr', {}, h('td', {}, x.round), h('td', { class: 'mono' }, x.clock), h('td', {}, x.scene), h('td', {}, x.who), h('td', {}, x.what), h('td', { class: 'dim' }, x.result))))),

      ] : null,
      sec === 'npc' ? [
      h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ['NPC', '出场轮', '台词', '态度变化', lamp ? '说出口的 / 没说的' : ''].map((x) => h('th', {}, x))), rp.npcs.map((n) => h('tr', {}, h('td', {}, n.name), h('td', {}, n.rounds.join('、') || '—'), h('td', {}, n.lines), h('td', { class: 'mono' }, n.attitude.map((a) => a.value).join(' → ')), lamp ? h('td', { class: 'small' }, (n.shared.join('、') || '无') + ' / ', h('span', { class: 'dim' }, n.withheld.join('、') || '无')) : null)))),

      ] : null,
      lamp && sec === 'kp' ? [
        h('p', {}, rp.degradation.verdict, rp.degradation.npc_cross_similarity != null ? `　NPC 口吻交叉相似度 ${rp.degradation.npc_cross_similarity}（越低越不串味）。` : ''),
        h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ['轮次窗', '叙述段', '平均字数', '基调词密度', '闸门报警', '重写'].map((x) => h('th', {}, x))), rp.degradation.windows.map((w) => h('tr', {}, h('td', {}, w.window), h('td', {}, w.narrations), h('td', {}, w.avg_chars), h('td', {}, w.tone_density), h('td', {}, Object.entries(w.alerts).map(([k, v]) => `${k}×${v}`).join(' ') || '—'), h('td', {}, w.rewrites))))),
        h('p', { class: 'small', style: 'margin-top:14px' }, `交给演员的上下文共 ${rp.isolation.contexts} 份，命中真相层金丝雀 ${rp.isolation.leaks} 份；被拒绝的状态提案 ${rp.isolation.rejected_proposals} 份。`, h('br'), Object.entries(rp.isolation.by_role).map(([k, v]) => `${k}：${v.calls} 次，平均 ${v.avg_chars} 字，最大 ${v.max_chars} 字，模型生成 ${v.model_calls} 次`).join('　｜　')),
        h('details', {}, h('summary', { style: 'cursor:pointer;color:var(--fog)' }, `逐轮决策理由（${rp.director_notes.length} 轮）`), rp.director_notes.map((n) => h('p', { class: 'small mono', style: 'color:var(--lamp2);margin:4px 0' }, `第 ${n.round} 轮｜${n.intent}｜${n.phase}　${n.reasons.join('；')}`))),
      ] : null,

      sec === 'play' ? [
      h('div', { class: 'stream' }, streamIn),

      ] : null,
      sec === 'novel' ? [
      isKp ? h('div', { class: 'row', style: 'margin-bottom:10px' }, (() => { const b = h('button', { onclick: async () => { b.disabled = true; b.textContent = '模型正在一节一节润色，约一两分钟…'; try { const r = await api(`/api/s/${id}/novel`, { t: tk.kp }); toast(`${r.sections} 节里 ${r.polished} 节润色并通过校验，${r.kept.length} 节保留原文`, 5000); paint(); } catch (e) { toast(e.message, 6000); b.disabled = false; b.textContent = '请模型润色成小说体'; } } }, rp.novel_polished ? '重新润色一遍' : '请模型润色成小说体'); return b; })(), ) : null,
      rp.novel_polished ? [h('p', { class: 'dim small' }, `小说体　写到第 ${rp.novel_polished.round} 轮　${rp.novel_polished.sections} 节里 ${rp.novel_polished.polished} 节由模型润色并通过校验，${rp.novel_polished.kept} 节保留原文`), h('div', { class: 'novel' }, rp.novel_polished.text), h('p', { class: 'dim small', style: 'margin-top:26px' }, '原始记录　由日志按顺序拼接，未经润色')] : h('p', { class: 'dim small' }, '由日志按顺序拼接，未经模型润色。'),
      h('div', { class: 'novel' }, rp.novel),

      ] : null,
      sec === 'data' ? [
      isKp ? h('div', { class: 'row' }, h('a', { href: ex('bundle') }, '存档（可再导入续团）.json'), h('a', { href: ex('state') }, '状态库.json'), h('a', { href: ex('state_md') }, '状态库.md'), h('a', { href: ex('log') }, '只追加日志.jsonl'), h('a', { href: ex('sheets') }, '角色卡.md'), h('a', { href: ex('sheets_json') }, '角色卡.json'), h('a', { href: ex('spec') }, 'module.spec.json'), h('a', { href: url('json', 'kp') }, 'Replay.json')) : h('p', { class: 'dim' }, '全量数据由掌灯人导出。'),
      h('p', { class: 'dim small', style: 'margin-top:14px' }, `日志哈希链：${rp.meta.chain.ok ? `通过（${rp.meta.chain.events} 条，逐条带前一条的哈希）` : '失败'}　·　规则包 ${rp.meta.rulepack}　·　随机种子 ${rp.meta.seed}`),
      ] : null,
    );
  }
  await paint();
}

function curveSvg(rp) {
  const W = 760, H = 230, P = 36; const maxR = Math.max(1, rp.meta.rounds); const maxV = Math.max(...rp.curves.map((c) => c.mindMax), 10);
  const x = (r) => P + (W - P * 3.2) * (r / maxR), y = (v) => H - P - (H - P * 1.7) * (v / maxV);
  const colors = ['#e8b65a', '#8fc7c0', '#b9a7d6', '#d98f7a']; let g = `<svg viewBox="0 0 ${W} ${H}" class="curve" role="img" aria-label="${TT.mind}与${TT.hp}曲线">`;
  for (let v = 0; v <= maxV; v += 20) g += `<line x1="${P}" x2="${W - P * 2.2}" y1="${y(v)}" y2="${y(v)}" stroke="#1d3032"/><text x="${P - 8}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#7d9391" font-family="monospace">${v}</text>`;
  for (let r = 0; r <= maxR; r += Math.max(1, Math.ceil(maxR / 12))) g += `<text x="${x(r)}" y="${H - 14}" text-anchor="middle" font-size="10" fill="#7d9391" font-family="monospace">${r}</text>`;
  const ends = [];
  rp.curves.forEach((c, i) => {
    const pts = c.points.filter((p) => p.mind != null); const col = colors[i % 4];
    g += `<polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" points="${pts.map((p) => `${x(p.round).toFixed(1)},${y(p.mind).toFixed(1)}`).join(' ')}"/><polyline fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="2 5" opacity=".7" points="${pts.map((p) => `${x(p.round).toFixed(1)},${y(p.hp).toFixed(1)}`).join(' ')}"/>`;
    const last = pts[pts.length - 1]; if (last) ends.push({ y: y(last.mind), x: x(last.round), t: `${c.name} ${last.mind}`, col });
  });
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) g += `<circle cx="${e.x}" cy="${e.y}" r="0"/><text x="${e.x + 8}" y="${e.y + 4}" font-size="12" fill="${e.col}">${e.t}</text>`;
  return g + `<text x="${P}" y="16" font-size="10" fill="#7d9391">实线 ${TT.mind}　虚线 ${TT.hp}　横轴 轮</text></svg>`;
}
