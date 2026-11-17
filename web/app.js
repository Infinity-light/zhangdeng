// 掌灯人 · 前端入口：首屏、导入、审阅、排座。桌面与 Replay 在 table.js。
import { renderTable, renderReplay } from '/table.js';
import { sea, startSea } from '/sea.js';
import { unlock, sfx, music } from '/fx.js';

export const $ = (s, el = document) => el.querySelector(s);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'value') el.value = v; else if (k === 'checked') el.checked = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
export function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms); }
export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: `服务器没有回应（${res.status}）` }));
  if (!res.ok) throw new Error(j.error || `请求失败（${res.status}）`);
  return j;
}
export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('zd.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('zd.' + k, JSON.stringify(v)); } catch { /* 存不下就算了 */ } },
};
export const app = $('#app');
export const go = (hash) => { location.hash = hash; };
const draft = { spec: null, summary: null, text: '', name: '' };
let RULEPACKS = [];
api('/api/health').then((r) => { RULEPACKS = r.rulepacks || []; }).catch(() => {});
const termOf = (spec) => (RULEPACKS.find((r) => r.id === spec.meta.rulepack) || {}).terms || { mind: '定力', bonus: '顺势骰', penalty: '逆势骰' };

// ------------------------------------------------------------ 海与灯（背景，见 sea.js）
startSea($('#sea'));
export const dimSea = (v) => { sea.dim = v; };

// ------------------------------------------------------------ 首屏
// 自带的故事：标题 → 文件、一句话、封面图，登记在 /img/scenes/manifest.json 里（和场景图同一份）
let SHELF = null;
const shelfReady = fetch('/img/scenes/manifest.json').then((r) => (r.ok ? r.json() : {})).then((j) => { SHELF = j || {}; }).catch(() => { SHELF = {}; });
const stories = () => Object.entries(SHELF || {}).filter(([, v]) => v._file).map(([title, v]) => ({ title, file: v._file, hook: v._hook || '', cover: v._cover ? '/img/scenes/' + v._cover : null, line: v._line || '' }));
// 提前把故事编译好：点「下船」的时候不用等
const compiled = {};
const prepare = (file) => (compiled[file] ||= api('/api/sample?name=' + encodeURIComponent(file)).then((r) => api('/api/compile', { text: r.text, name: r.name })).then((r) => { r.spec.reviewed = true; return r.spec; }).catch((e) => { delete compiled[file]; throw e; }));

function landing() {
  dimSea(0); document.title = '掌灯人';
  const recent = store.get('recent', [])[0];
  const letter = h('p', { class: 'letter' }), go1 = h('button', { class: 'primary go', onclick: () => { unlock(); sfx('tap'); go('#/go'); } }, '下船');
  app.replaceChildren(
    h('section', { class: 'cover' },
      h('div', { class: 'cv' },
        h('h1', {}, '掌灯人'),
        letter,
        h('div', { class: 'cta' }, go1, recent ? h('button', { class: 'ghost', onclick: () => go(`#/s/${recent.id}`) }, `接着上一夜　${recent.title} · 第 ${recent.round || 0} 轮`) : null),
        h('nav', { class: 'sub' }, h('a', { href: '#/shelf' }, '换个故事'), h('a', { href: '#/import' }, '导入模组'), h('a', { href: '#/saves' }, '存档'), h('a', { href: '#/about' }, '这是什么')),
      ),
    ),
  );
  shelfReady.then(() => { const st = stories()[0]; if (!st) { go1.textContent = '导入模组'; go1.onclick = () => go('#/import'); return; } letter.textContent = st.line || st.hook; prepare(st.file).catch(() => {}); });
}

// 这是什么：给想知道桌子底下有什么的人
function aboutPage() {
  dimSea(0.82); document.title = '这是什么 · 掌灯人';
  app.replaceChildren(h('div', { class: 'page' }, h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), h('i'), h('span', { class: 'on' }, '这是什么')),
    h('section', { class: 'about' },
      h('h2', {}, '这张桌子上，模型碰不到的四样东西'),
      h('div', { class: 'four' },
        h('div', {}, h('h3', {}, '记忆'), h('p', {}, '数值、物品、时间、线索存在状态库里。模型每轮只拿到一张快照和几条事实卡，不负责记住任何事。')),
        h('div', {}, h('h3', {}, '骰子'), h('p', {}, '检定由规则引擎用可复现的随机种子掷出，每一颗骰面都进日志。模型只能把结果写成症状，改不了数字。')),
        h('div', {}, h('h3', {}, '真相'), h('p', {}, '真相层只在导演那一侧。每个 NPC、每个 AI 同伴拿到的是一张裁过的卡，卡上没有的事，问多少遍也答不出。')),
        h('div', {}, h('h3', {}, '导演权'), h('p', {}, '每一轮先出一张导演单：放几条线索、切什么相位、禁止说什么。你跑偏了不拦，换一种载体把线索送到脚边。')),
      ),
      h('p', { class: 'note' }, '桌面右上角有一盏灯。拧亮它，每一轮旁边会多出一行导演摘要，点开是整张导演单——同一段文字，灯亮前后是两个世界。'),
      h('p', { class: 'note' }, '一套适用于克苏鲁神话题材的调查恐怖跑团引擎，兼容通行的百分骰规则写成的模组。丢进自己的模组，编译、审阅、排座、开团；任意一轮可以回滚开平行分支；收团时出 Replay；所有数据都能导出带走。'),
      h('p', { class: 'note small' }, '配乐：Kevin MacLeod（incompetech.com）的 “Myst on the Moor”“Lightless Dawn”“Decline”，以 CC BY 4.0 授权使用。骰子、翻页、脚步、钟的采样来自 Kenney（kenney.nl，CC0）。掷骰动画用 three.js（MIT）。'),
      h('div', { class: 'row', style: 'margin-top:26px' }, h('button', { onclick: () => go('#/import') }, '导入模组'), h('button', { id: 'demo-btn', onclick: openDemo }, '看一局跑完的团')),
    ),
  ));
}

// 换个故事
async function shelfPage() {
  dimSea(0.78); document.title = '换个故事 · 掌灯人'; await shelfReady;
  app.replaceChildren(h('div', { class: 'page shelf' }, h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), h('i'), h('span', { class: 'on' }, '换个故事')),
    stories().map((st) => h('a', { class: 'story', href: '#/go/' + encodeURIComponent(st.file), style: st.cover ? `background-image:url("${st.cover}")` : null }, h('b', {}, st.title), h('span', {}, st.hook))),
    h('a', { class: 'story own', href: '#/import' }, h('b', {}, '带自己的模组来'), h('span', {}, '贴文本，或拖入 .md / .txt / .docx')),
  ));
}

// 你是谁：挑一个人下船，其余的座位由 AI 坐
async function pickPage(file) {
  dimSea(0.8); await shelfReady; const st = stories().find((x) => x.file === file) || stories()[0];
  if (!st) return go('#/import');
  document.title = `${st.title} · 掌灯人`;
  const box = h('div', { class: 'page pick' }, h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), h('i'), h('span', { class: 'on' }, st.title)), h('p', { class: 'wait' }, '……'));
  app.replaceChildren(box);
  let spec; try { spec = await prepare(st.file); } catch (e) { toast(e.message, 6000); return go('#/'); }
  if (!location.hash.startsWith('#/go')) return;
  const authored = spec.pregens.some((p) => p.ai?.authored);
  const mine = spec.pregens.filter((p, i) => (authored ? !p.ai?.authored : i < 2)), others = spec.pregens.filter((p) => !mine.includes(p));
  let busy = false;
  const start = async (p, card) => {
    if (busy) return; busy = true; unlock(); sfx('scene'); card.classList.add('chosen'); box.classList.add('leaving');
    try {
      const seats = spec.pregens.map((x) => ({ pc: x.id, seat: x.id === p.id ? 'human' : 'ai' }));
      const r = await api('/api/sessions', { spec, seats, seed: 'night-' + Math.random().toString(36).slice(2, 8), config: {} });
      remember(r.id, r.tokens, spec.meta.title); store.set('seat.' + r.id, p.id); go(`#/s/${r.id}`);
    } catch (e) { toast(e.message, 6000); busy = false; card.classList.remove('chosen'); box.classList.remove('leaving'); }
  };
  box.replaceChildren(
    h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), h('i'), h('span', { class: 'on' }, st.title)),
    h('h1', {}, '你是谁'),
    h('div', { class: 'who' }, mine.map((p) => h('button', { class: 'person', onclick: (e) => start(p, e.currentTarget) }, h('b', {}, p.name), h('i', {}, p.role), h('span', {}, p.background), h('em', {}, p.drive)))),
    others.length ? h('p', { class: 'with' }, '同行　', others.map((p) => `${p.name}（${p.role.replace(/（.*）/, '')}）`).join('、')) : null,
  );
}

// 不想自己跑的人：把示例存档导入成一局新团，直接看它的 Replay
async function openDemo() {
  const b = $('#demo-btn'); if (b) { b.disabled = true; b.textContent = '正在翻开记录…'; }
  try { const bundle = await (await fetch('/download/示例存档-雾港来信.json')).json(); const r = await api('/api/import', { bundle }); remember(r.id, r.tokens, r.title, r.round); go(`#/s/${r.id}/replay`); }
  catch (e) { toast('示例没能打开：' + e.message, 5000); if (b) { b.disabled = false; b.textContent = '看一局跑完的团 →'; } }
}

// ------------------------------------------------------------ 步骤条
const crumb = (step) => h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), ...['导入', '审阅', '排座', '开团'].flatMap((n, i) => [h('i'), h('span', { class: i === step ? 'on' : '' }, n)]));

// ------------------------------------------------------------ 导入
function importPage() {
  dimSea(0.72); document.title = '导入模组 · 掌灯人';
  const ta = h('textarea', { placeholder: '把模组贴在这里，或拖入 .md / .txt / .docx 文件。\n\n按 docs/模组写法.md 写的秒出；没按格式写的由模型分段读，约 2–3 分钟。编译完先给你审，点头之前不会开团。', spellcheck: 'false', value: draft.text });
  const drop = h('div', { class: 'drop' }, ta);
  const load = async (file) => {
    draft.name = file.name;
    try {
      if (/\.docx$/i.test(file.name)) ta.value = await docxToText(file);
      else if (/\.pdf$/i.test(file.name)) return toast('PDF 还读不了。请把正文复制出来贴进来，或另存为 Word（.docx）/ 文本再导入。', 6000);
      else ta.value = await file.text();
      toast(`已读入 ${file.name}（${ta.value.length} 字）`);
    } catch (e) { toast(`读不了这个文件：${e.message}`, 6000); }
  };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  const file = h('input', { type: 'file', accept: '.md,.txt,.markdown,.docx', style: 'display:none', onchange: (e) => e.target.files[0] && load(e.target.files[0]) });
  const btn = h('button', { class: 'primary', onclick: async () => {
    if (ta.value.trim().length < 80) return toast('先放一份模组进来');
    const structured = /^##\s*场景/m.test(ta.value) && /^##\s*线索/m.test(ta.value);
    btn.disabled = true; btn.textContent = structured ? '编译中…' : '自由文本：模型分四段抽取中，约需 2–3 分钟…';
    try { const r = await api('/api/compile', { text: ta.value, name: draft.name || 'module.md' }); draft.text = ta.value; draft.spec = r.spec; draft.summary = r.summary; go('#/review'); }
    catch (e) { toast(e.message, 6000); } finally { btn.disabled = false; btn.textContent = '编译成 spec'; }
  } }, '编译成 spec');
  app.replaceChildren(h('div', { class: 'page' }, crumb(0),
    h('h1', {}, '导入模组'),
    h('div', { class: 'row', style: 'margin-bottom:14px' },
      h('button', { onclick: async () => { const r = await api('/api/sample'); ta.value = r.text; draft.name = r.name; toast('已载入示例模组《雾港来信》'); } }, '载入示例《雾港来信》'),
      h('button', { title: '用通行的百分骰写法写的短模组：侦查、图书馆使用、理智 1/1d4、奖励骰/惩罚骰', onclick: async () => { const r = await api('/api/sample?name=' + encodeURIComponent('枯井.md')); ta.value = r.text; draft.name = r.name; toast('已载入示例模组《枯井》（通行百分骰写法）'); } }, '载入示例《枯井》'),
      h('button', { onclick: () => file.click() }, '选择文件'), file,
    ),
    drop,
    h('div', { class: 'row', style: 'margin-top:18px' }, btn),
  ));
}

// Word 文档（.docx）在浏览器里直接读：它是一个 zip，正文在 word/document.xml 里。不上传文件，不依赖任何库。
export async function docxToText(file) {
  const buf = new Uint8Array(await file.arrayBuffer()); const dv = new DataView(buf.buffer); const td = new TextDecoder();
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 .docx');
  let p = dv.getUint32(eocd + 16, true); const n = dv.getUint16(eocd + 10, true); let entry = null;
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    if (td.decode(buf.subarray(p + 46, p + 46 + nl)) === 'word/document.xml') { entry = { method, csize, off }; break; }
    p += 46 + nl + el + cl;
  }
  if (!entry) throw new Error('这个 .docx 里没有正文');
  const start = entry.off + 30 + dv.getUint16(entry.off + 26, true) + dv.getUint16(entry.off + 28, true); const raw = buf.subarray(start, start + entry.csize);
  let xml;
  if (entry.method === 0) xml = td.decode(raw);
  else { if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器不支持解压，请换新版 Chrome / Edge / Safari，或把正文贴进来'); xml = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); }
  const un = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  // 段落 → 一行；标题样式（Heading1-4 / 标题 1-4）转成 # 号，这样按格式写在 Word 里的模组也能走确定性解析
  const paras = xml.split(/<w:p[ >]/).slice(1).map((seg) => {
    const text = un([...seg.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? m[1] : m[0] === '<w:tab/>' ? '\t' : '\n')).join(''));
    const lv = /<w:pStyle w:val="(?:Heading|heading|标题\s?)(\d)"/.exec(seg) || /<w:outlineLvl w:val="(\d)"/.exec(seg);
    const level = lv ? (/outlineLvl/.test(lv[0]) ? Number(lv[1]) + 1 : Number(lv[1])) : 0;
    const bullet = /<w:numPr>/.test(seg) && !level;
    return (level >= 1 && level <= 4 && !/^#/.test(text) ? '#'.repeat(level) + ' ' : bullet && !/^[-*]\s/.test(text) ? '- ' : '') + text;
  });
  const out = paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (out.length < 20) throw new Error('这个 .docx 里几乎没有文字');
  return out;
}

// ------------------------------------------------------------ 审阅
const edit = (obj, key, opts = {}) => h('dd', { contenteditable: 'plaintext-only', spellcheck: 'false', onblur: (e) => { const v = e.target.textContent.trim(); obj[key] = opts.list ? v.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) : opts.num ? Number(v) || 0 : v; revalidate(); } }, opts.list ? (obj[key] || []).join('、') : obj[key] ?? '');
let revalT;
function revalidate() { clearTimeout(revalT); revalT = setTimeout(async () => { try { const r = await api('/api/validate', { spec: draft.spec }); draft.spec.issues = r.issues; draft.summary = r.summary; paintReviewHead(); } catch (e) { toast(e.message); } }, 350); }
function paintReviewHead() {
  const s = draft.summary, box = $('#rv-head'); if (!box) return;
  const st = (n, l) => h('div', {}, h('b', {}, n), h('span', {}, l));
  box.replaceChildren(
    h('div', { class: 'stats' }, st(s.scenes, '场景'), st(s.clues, '线索'), st(s.npcs, 'NPC'), st(s.truth, '真相层'), st(s.endings, '结局')),
    draft.spec.issues.length ? h('ul', { class: 'issues' }, draft.spec.issues.map((i) => h('li', { class: i.level }, h('b', {}, i.where), i.msg, i.level === 'error' ? '（必须修正）' : ''))) : null,
  );
  const ok = !draft.spec.issues.some((i) => i.level === 'error'); const b = $('#rv-go'); if (b) b.disabled = !ok || !$('#rv-ck').checked;
}
function reviewPage() {
  if (!draft.spec) return go('#/import');
  dimSea(0.86); document.title = `审阅：${draft.spec.meta.title} · 掌灯人`;
  const spec = draft.spec; let tab = store.get('rvtab', 'clues');
  const body = h('div'); const open = new Set();
  // 一张卡先给读的人看：标题、一句话、几个要点；点「改」才展开成可编辑的字段
  const fold = (key, head, brief, full, o = {}) => { const on = open.has(key); return h('div', { class: 'card fold' + (o.warn ? ' warn' : '') }, head, on ? full() : brief, h('div', { class: 'acts' }, h('button', { class: 'ghost', onclick: () => { if (on) open.delete(key); else open.add(key); paint(); } }, on ? '收起' : '改'), o.acts)); };
  const flagged = (id) => spec.issues.some((i) => String(i.where).includes(id));
  const sceneName = (id) => spec.scenes.find((x) => x.id === id)?.name || id;
  const panes = {
    clues: () => spec.clues.map((c) => fold('c' + c.id,
      h('h3', {}, c.name, c.key ? h('span', { class: 'tag key' }, '关键') : null, h('span', { class: 'tag' }, `${sceneName(c.scene)} → ${sceneName(c.points_to)}`)),
      [h('p', { class: 'sum' }, c.content), h('div', { class: 'list', title: '投放载体：第一种是原始载体，其余是备用' }, c.carriers.map((k) => h('span', {}, k.form || '（未填）')))],
      () => [h('dl', { class: 'kv' }, h('dt', {}, '内容'), edit(c, 'content')),
      c.carriers.map((k, i) => h('div', { class: 'carrier' },
        h('input', { value: k.id, title: '载体编号', onchange: (e) => { k.id = e.target.value.trim(); revalidate(); } }),
        h('input', { value: k.form, placeholder: '形式，例如：一通打错的电话', onchange: (e) => { k.form = e.target.value; } }),
        h('select', { onchange: (e) => { k.where = e.target.value; revalidate(); } }, [['any', '任何地点'], ...spec.scenes.map((s) => [s.id, s.name])].map(([v, n]) => h('option', { value: v, selected: k.where === v }, n))),
        h('input', { value: k.via, title: '途径：可调查:id / NPC:id / 事件', onchange: (e) => { k.via = e.target.value.trim(); revalidate(); } }),
        h('button', { class: 'x', title: '删除这种载体', onclick: () => { c.carriers.splice(i, 1); revalidate(); paint(); } }, '×'),
        k.via === '事件' ? h('textarea', { placeholder: '事件发生时原文投放的文字', value: k.text, onchange: (e) => { k.text = e.target.value; revalidate(); } }) : null,
      )),
      ], { warn: flagged(c.id), acts: !(flagged(c.id) || open.has('c' + c.id)) ? null : h('button', { class: 'ghost', title: '「事件」型的备用载体，可以在玩家跑偏时主动送到脚边', onclick: () => { open.add('c' + c.id); c.carriers.push({ id: `${c.id}${String.fromCharCode(97 + c.carriers.length)}${c.carriers.some((k) => k.id === c.id + String.fromCharCode(97 + c.carriers.length)) ? 'x' : ''}`, form: '', where: 'any', via: '事件', text: '' }); revalidate(); paint(); } }, '＋ 增加一种备用载体') })),
    scenes: () => spec.scenes.map((s) => fold('s' + s.id,
      h('h3', {}, s.name, s.kind === 'main' ? null : h('span', { class: 'tag' }, '侧支'), h('span', { class: 'tag' }, '→ ' + s.exits.map(sceneName).join('、'))),
      [h('p', { class: 'sum' }, s.goal || s.public_desc), h('div', { class: 'list' }, s.interactables.map((i) => h('span', {}, i.name + (i.check ? `（${i.check.skill}${i.check.tier === '普通' ? '' : '/' + i.check.tier}）` : ''))))],
      () => h('dl', { class: 'kv' }, h('dt', {}, '别名'), edit(s, 'aliases', { list: true }), h('dt', {}, '幕目标'), edit(s, 'goal'), h('dt', {}, '公开描述'), edit(s, 'public_desc'), h('dt', {}, '在场 NPC'), h('dd', {}, s.npcs.map((n) => spec.npcs.find((x) => x.id === n)?.name).join('、') || '无'),
        h('dt', {}, '可调查'), h('dd', {}, s.interactables.map((i) => h('div', { class: 'itrow' }, h('b', {}, i.name),
          h('input', { class: 'mini', title: '检定：技能/难度，例如 侦查/困难；留空 = 不用检定', placeholder: '检定：技能/难度', value: i.check ? `${i.check.skill}/${i.check.tier}` : '', onchange: (e) => { const [sk, tier] = e.target.value.split(/[\/／]/).map((x) => x.trim()); i.check = sk ? { ...(i.check || {}), skill: sk, tier: ['普通', '困难', '极难'].includes(tier) ? tier : '普通' } : null; if (i.check && !i.fail_text) i.fail_text = `你在${i.name}上没有看出什么。`; revalidate(); } }),
          h('input', { class: 'mini', style: 'width:7.5em', title: termOf(spec).mind + '检定：成功损失/失败损失，例如 0/1d3；留空 = 没有', placeholder: termOf(spec).mind + ' 0/1d3', value: i.mind ? `${i.mind.success}/${i.mind.fail}` : '', onchange: (e) => { const m = /^\s*(\d+(?:d\d+)?(?:[+-]\d+)?)\s*[\/／]\s*(\d+(?:d\d+)?(?:[+-]\d+)?)\s*$/i.exec(e.target.value); if (e.target.value.trim() && !m) { toast('写成 成功损失/失败损失，例如 0/1d3'); e.target.value = i.mind ? `${i.mind.success}/${i.mind.fail}` : ''; return; } i.mind = m ? { success: m[1].toLowerCase(), fail: m[2].toLowerCase() } : null; revalidate(); } }),
          i.check?.bonus ? h('span', { class: 'tag' }, termOf(spec).bonus + '×' + i.check.bonus) : null, i.check?.penalty ? h('span', { class: 'tag' }, termOf(spec).penalty + '×' + i.check.penalty) : null,
          i.clue ? h('span', { class: 'tag key' }, '线索 ' + i.clue) : null, i.requires ? h('span', { class: 'tag' }, '有前置条件') : null))),
        h('dt', {}, '氛围句'), h('dd', {}, `${s.beats.length} 条，加压 ${s.press_beats.length} 条`)))),
    npcs: () => spec.npcs.map((n) => fold('n' + n.id,
      h('h3', {}, n.name, h('span', { class: 'tag' }, sceneName(n.home))),
      [h('p', { class: 'sum' }, n.public_identity), h('div', { class: 'list' }, n.voice.style ? h('span', {}, n.voice.style) : null, n.knowledge.some((k) => k.share === 'never') ? h('span', { style: 'color:var(--blood)' }, `有 ${n.knowledge.filter((k) => k.share === 'never').length} 件事绝不分享`) : null)],
      () => h('dl', { class: 'kv' }, h('dt', {}, '公开身份'), edit(n, 'public_identity'), h('dt', { style: 'color:var(--blood)' }, '真实身份'), edit(n, 'true_identity'), h('dt', {}, '动机'), edit(n, 'motive'), h('dt', {}, '口吻锚'), edit(n.voice, 'style'), h('dt', {}, '口头禅'), edit(n.voice, 'catchphrases', { list: true }), h('dt', {}, '禁用词'), edit(n.voice, 'banned', { list: true }), h('dt', {}, '行为红线'), edit(n, 'redlines', { list: true }),
        h('dt', {}, '知识边界'), h('dd', {}, n.knowledge.map((k) => h('div', {}, k.title, ' ', h('span', { class: 'tag ' + (k.share === 'never' ? 'truth' : k.share === 'trust' ? 'key' : '') }, k.share === 'never' ? '绝不分享（不进演员上下文）' : k.share === 'trust' ? `信任 ≥ ${k.trust_min} 才说` : '随口可说'), k.gives_clue ? h('span', { class: 'tag key' }, '给出 ' + k.gives_clue) : null)))))),
    truth: () => [h('div', { class: 'card truthbox' },
      h('h3', {}, '真相层', h('span', { class: 'tag truth' }, '只有导演层能读')),
      h('dl', { class: 'kv' }, h('dt', {}, '幕后真相'), edit(spec.truth, 'summary'), h('dt', {}, '存在'), edit(spec.truth, 'entity'),
        h('dt', {}, '真实时间线'), h('dd', {}, spec.truth.timeline.map((t) => h('div', {}, h('span', { class: 'dim' }, t.when + '　'), t.what))),
        h('dt', {}, '不可泄露清单'), h('dd', {}, spec.truth.never_reveal.map((r) => h('div', { style: 'margin-bottom:6px' }, h('span', { class: 'mono dim small' }, r.id + ' '), r.text, h('br'), h('span', { class: 'dim small' }, `过滤关键词：${r.keywords.join('、')}　·　解锁于：${r.unlock ? '发现 ' + r.unlock + ' 之后' : '永不'}`))))),
    )],
    rules: () => [
      h('div', { class: 'card' }, h('h3', {}, '冻结宪法', h('span', { class: 'tag' }, '每轮固定注入在上下文最前')), h('dl', { class: 'kv' }, h('dt', {}, '基调'), edit(spec.constitution, 'tone'), h('dt', {}, '语气禁令'), h('dd', {}, spec.constitution.style_bans.map((x) => h('div', {}, '· ' + x))), h('dt', {}, '不可变事实'), h('dd', {}, spec.constitution.immutable_facts.map((x) => h('div', {}, '· ' + x))))),
      h('div', { class: 'card' }, h('h3', {}, '触发器'), spec.triggers.map((t) => h('dl', { class: 'kv' }, h('dt', {}, t.name), h('dd', {}, h('span', { class: 'mono small dim' }, condLabel(t.when) + ' → ' + t.effects.join('；')), h('br'), t.public_text, t.kp_note ? h('div', { class: 'dim small' }, '导演注：' + t.kp_note) : null)))),
      h('div', { class: 'card' }, h('h3', {}, '结局条件', h('span', { class: 'tag' }, '结局只认这里写的条件')), spec.endings.map((e) => h('dl', { class: 'kv' }, h('dt', {}, e.name), h('dd', {}, h('span', { class: 'mono small dim' }, e.when_any.map(condLabel).join('　或　')), h('br'), e.text)))),
      h('div', { class: 'card' }, h('h3', {}, '元数据'), h('dl', { class: 'kv' }, h('dt', {}, '标题'), edit(spec.meta, 'title'), h('dt', {}, '推荐人数'), edit(spec.meta, 'players'), h('dt', {}, '时代'), edit(spec.meta, 'era'), h('dt', {}, '地点'), edit(spec.meta, 'place'), h('dt', {}, '预计时长'), edit(spec.meta, 'duration'), h('dt', {}, '恐怖尺度'), edit(spec.meta, 'horror_level'), h('dt', {}, '内容提示'), edit(spec.meta, 'content_warnings', { list: true }), h('dt', {}, '规则包'), h('dd', {}, h('select', { id: 'rv-rp', onchange: (e) => { spec.meta.rulepack = e.target.value; revalidate(); } }, (RULEPACKS.length ? RULEPACKS : [{ id: spec.meta.rulepack, name: spec.meta.rulepack }]).map((r) => h('option', { value: r.id, selected: r.id === spec.meta.rulepack }, `${r.name}（${r.id}）`))), h('div', { class: 'dim small', style: 'margin-top:6px' }, (RULEPACKS.find((r) => r.id === spec.meta.rulepack) || {}).note || '')), h('dt', {}, '开场白'), edit(spec.meta, 'opening'))),
    ],
    json: () => { const ta = h('textarea', { style: 'min-height:420px;font:12px/1.6 var(--mono)', spellcheck: 'false', value: JSON.stringify(spec, null, 1) }); return [h('p', { class: 'dim small' }, '这里是完整的 module.spec.json。上面几页没有覆盖到的字段，可以直接在这里改。'), ta, h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { onclick: () => { try { draft.spec = JSON.parse(ta.value); revalidate(); toast('已应用'); setTimeout(reviewPage, 500); } catch (e) { toast('JSON 不合法：' + e.message, 5000); } } }, '应用修改'), h('button', { onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([ta.value], { type: 'application/json' })), download: 'module.spec.json' }); a.click(); } }, '下载 module.spec.json'))]; },
  };
  const tabs = h('div', { class: 'tabs' });
  const paint = () => { tabs.replaceChildren(...[['clues', '线索链'], ['scenes', '场景图'], ['npcs', 'NPC 卡'], ['truth', '真相层'], ['rules', '宪法 · 触发器 · 结局'], ['json', '完整 JSON']].map(([k, n]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; store.set('rvtab', k); paint(); } }, n))); body.replaceChildren(...panes[tab]()); };
  app.replaceChildren(h('div', { class: 'page' }, crumb(1),
    h('h1', {}, spec.meta.title),
    h('p', { class: 'lead' }, `${spec.meta.era}，${spec.meta.place}。${spec.meta.players} 人，${spec.meta.duration}。${spec.source.compiler.startsWith('model') ? '这份是模型从自由文本里抽出来的，请格外仔细看。' : ''}`),
    h('div', { id: 'rv-head' }), tabs, body,
    h('div', { class: 'confirm' },
      h('label', {}, h('input', { type: 'checkbox', id: 'rv-ck', onchange: paintReviewHead }), '我看过了，按这份 spec 开团'),
      h('button', { class: 'primary', id: 'rv-go', disabled: true, onclick: () => { draft.spec.reviewed = true; go('#/seats'); } }, '确认，去排座位'),
    ),
  ));
  paint(); paintReviewHead();
}
const condLabel = (c) => (c || []).map((a) => (a.neg ? '非 ' : '') + (a.t === 'flag' ? `flag ${a.k}` : a.t === 'clue' ? `线索 ${a.k}` : a.t === 'item' ? `持有 ${a.k}` : a.t === 'scene' ? `在 ${a.k}` : a.t === 'time' ? `时间 ${a.op} ${String(Math.floor(a.v / 60)).padStart(2, '0')}:${String(a.v % 60).padStart(2, '0')}` : a.raw)).join(' 且 ');

// ------------------------------------------------------------ 排座
function seatsPage() {
  if (!draft.spec?.reviewed) return go('#/import');
  dimSea(0.84); document.title = '排座 · 掌灯人';
  const spec = draft.spec; // 默认排法：模组作者给哪位写了 AI 口吻，哪位就默认交给 AI；一位都没写（比如自由文本抽出来的），前两位给人、其余给 AI。
  const authored = spec.pregens.some((p) => p.ai?.authored);
  const seats = spec.pregens.map((p, i) => ({ pc: p.id, seat: (authored ? p.ai?.authored : i >= 2) ? 'ai' : 'human' }));
  if (!seats.some((s) => s.seat === 'human') && seats[0]) seats[0].seat = 'human';
  const cfg = { aiInitiative: 60, aiQuota: 34, offTrackN: 3, timeScale: 1, contentLevel: 'full', seed: 'wugang-' + Math.random().toString(36).slice(2, 7), useModel: true };
  const byo = { baseUrl: '', model: '', key: '' };
  const grid = h('div', { class: 'seats' });
  const openSeat = new Set();
  const paint = () => grid.replaceChildren(...spec.pregens.map((p, i) => h('div', { class: 'seat ' + seats[i].seat + (openSeat.has(i) ? ' open' : '') },
    h('h3', { title: '点开看执念、恐惧源与技能', onclick: () => { if (openSeat.has(i)) openSeat.delete(i); else openSeat.add(i); paint(); } }, p.name), h('div', { class: 'role' }, p.role),
    h('p', {}, p.background), h('div', { class: 'more' }, h('p', { class: 'dim' }, '执念：' + p.drive), h('p', { class: 'dim' }, '恐惧源：' + p.fear),
    h('p', { class: 'small mono dim' }, Object.entries(p.skills_named).map(([k, v]) => `${k} ${v}`).join(' · '))),
    h('div', { class: 'seg' }, [['human', '人类'], ['ai', 'AI'], ['empty', '空']].map(([v, n]) => h('button', { class: seats[i].seat === v ? 'on' : '', onclick: () => { seats[i].seat = v; paint(); } }, n))),
  )));
  const range = (label, key, min, max, step, fmt = (v) => v) => { const b = h('b', {}, fmt(cfg[key])); return h('label', {}, label, b, h('input', { type: 'range', min, max, step, value: cfg[key], oninput: (e) => { cfg[key] = Number(e.target.value); b.textContent = fmt(cfg[key]); } })); };
  const health = h('span', { class: 'dim small' }, '');
  api('/api/health').then((r) => { health.textContent = r.model.length ? `服务端已接好模型：${r.model.join(' → ')}。任一上游失败会自动落回离线演员，不会卡住。` : '服务端没有配置模型：将用离线演员（确定性文本）跑通闭环。'; });
  const start = h('button', { class: 'primary', onclick: async () => {
    start.disabled = true; start.textContent = '点灯…';
    try {
      const r = await api('/api/sessions', { spec, seats, seed: cfg.seed, config: { aiInitiative: cfg.aiInitiative, aiQuota: cfg.aiQuota / 100, offTrackN: cfg.offTrackN, timeScale: cfg.timeScale, contentLevel: cfg.contentLevel, useModel: cfg.useModel }, byo: byo.key ? byo : undefined });
      remember(r.id, r.tokens, spec.meta.title); go(`#/s/${r.id}`);
    } catch (e) { toast(e.message, 6000); start.disabled = false; start.textContent = '开团'; }
  } }, '开团');
  app.replaceChildren(h('div', { class: 'page' }, crumb(2),
    h('h1', {}, '排座'),
    grid,
    h('details', { class: 'opt' }, h('summary', {}, '节奏与配额'), h('div', { class: 'opts', style: 'margin:0' },
      range('AI 寻访者主动度', 'aiInitiative', 0, 100, 5, (v) => v + '%'),
      range('AI 发言配额（占玩家发言的上限）', 'aiQuota', 10, 50, 2, (v) => v + '%'),
      range('跑偏几轮后柔性补线', 'offTrackN', 2, 8, 1, (v) => v + ' 轮'),
      range('故事时间流速', 'timeScale', 0.25, 2, 0.25, (v) => '×' + v),
      h('label', {}, '内容分级', h('select', { onchange: (e) => { cfg.contentLevel = e.target.value; } }, h('option', { value: 'full' }, '完整描写'), h('option', { value: 'soft' }, '全程淡化（略去躯体与失常细节）'))),
      h('label', {}, '随机种子（同种子同骰序，可复现）', h('input', { value: cfg.seed, oninput: (e) => { cfg.seed = e.target.value; } })),
    )),
    h('details', { class: 'opt' }, h('summary', {}, '模型'),
      h('p', { class: 'small' }, health),
      h('label', { class: 'small', style: 'display:flex;gap:8px;align-items:center;margin:8px 0' }, h('input', { type: 'checkbox', style: 'width:auto', checked: true, onchange: (e) => { cfg.useModel = e.target.checked; } }), '使用模型（取消勾选则全程离线演员）'),
      h('p', { class: 'small dim' }, '也可以临时用你自己的 OpenAI 兼容接口。密钥只在这局团的服务端内存里，不落盘、不进日志。'),
      h('div', { class: 'opts', style: 'margin:0' }, h('label', {}, '接口地址', h('input', { placeholder: 'https://api.deepseek.com/v1', oninput: (e) => { byo.baseUrl = e.target.value.trim(); } })), h('label', {}, '模型名', h('input', { placeholder: 'deepseek-chat', oninput: (e) => { byo.model = e.target.value.trim(); } })), h('label', {}, 'API Key', h('input', { type: 'password', autocomplete: 'off', oninput: (e) => { byo.key = e.target.value.trim(); } }))),
    ),
    h('div', { class: 'row', style: 'margin-top:26px' }, start),
  ));
  paint();
}

export function remember(id, tokens, title, round = 0) {
  const all = store.get('tokens', {}); if (tokens) { all[id] = tokens; store.set('tokens', all); }
  const recent = store.get('recent', []).filter((x) => x.id !== id); recent.unshift({ id, title, round, at: Date.now() }); store.set('recent', recent.slice(0, 12));
}

// ------------------------------------------------------------ 存档页
function savesPage() {
  dimSea(0.8); document.title = '存档 · 掌灯人';
  const recent = store.get('recent', []);
  const file = h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const bundle = JSON.parse(await f.text()); const r = await api('/api/import', { bundle }); remember(r.id, r.tokens, r.title, r.round); toast(`已导入《${r.title}》，从第 ${r.round} 轮续团`); go(`#/s/${r.id}`); } catch (err) { toast('导入失败：' + err.message, 6000); }
  } });
  app.replaceChildren(h('div', { class: 'page' }, h('nav', { class: 'crumb' }, h('a', { href: '#/' }, '掌灯人'), h('i'), h('span', { class: 'on' }, '存档')),
    h('h1', {}, '打开存档'),
    h('p', { class: 'lead' }, '存档文件是一份 JSON：spec、每条分支的只追加日志、每一轮的状态快照和随机源状态都在里面。导入时会先验日志的哈希链。'),
    h('div', { class: 'row', style: 'margin-bottom:26px' }, h('button', { class: 'primary', onclick: () => file.click() }, '导入存档文件（.json）'), file, h('a', { href: '/download/示例存档-雾港来信.json', download: '' }, '下载一份示例存档')),
    h('h2', { style: 'font-size:13px;letter-spacing:.34em;color:var(--fog);margin-bottom:8px' }, '这台设备上开过的团'),
    recent.length ? recent.map((r) => h('div', { class: 'brow' }, h('b', {}, r.title), h('span', { class: 'dim small' }, `第 ${r.round || 0} 轮 · ${new Date(r.at).toLocaleString('zh-CN')}`), h('button', { onclick: () => go(`#/s/${r.id}`) }, '回到桌面'), h('button', { onclick: () => go(`#/s/${r.id}/replay`) }, 'Replay'))) : h('p', { class: 'dim' }, '还没有。'),
  ));
}

// ------------------------------------------------------------ 路由
function route() {
  const hash = location.hash || '#/'; let m;
  window.scrollTo(0, 0);
  if (window.__stopTable) { window.__stopTable(); window.__stopTable = null; }
  if ((m = /^#\/s\/([\w-]+)(\/replay)?(?:\?(.*))?$/.exec(hash))) {
    const qs = new URLSearchParams(m[3] || ''); const all = store.get('tokens', {});
    if (qs.get('t')) { all[m[1]] = { ...(all[m[1]] || {}), join: qs.get('t') }; store.set('tokens', all); }
    const tk = all[m[1]]; if (!tk) { toast('这台设备上没有这局团的席位凭证'); return go('#/'); }
    dimSea(m[2] ? 0.9 : 0.8);
    return m[2] ? renderReplay(m[1], tk) : renderTable(m[1], tk);
  }
  music('explore');   // 桌面之外都放前半夜那一首；第一次点按之后才真的出声
  if ((m = /^#\/go(?:\/(.+))?$/.exec(hash))) return pickPage(m[1] ? decodeURIComponent(m[1]) : null);
  if (hash === '#/shelf') return shelfPage();
  if (hash === '#/about') return aboutPage();
  if (hash === '#/import') return importPage();
  if (hash === '#/review') return reviewPage();
  if (hash === '#/seats') return seatsPage();
  if (hash === '#/saves') return savesPage();
  landing();
}
addEventListener('hashchange', route); route();
