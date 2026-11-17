// 掌灯人 · 零依赖 Node 服务（Node ≥ 20）。node server.mjs 即可启动；数据全在 ./data 下，都是 JSON / JSONL。
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { compileMarkdown, looksStructured, validateSpec, specSummary } from './engine/compiler.mjs';
import { compileFreeText } from './engine/extract.mjs';
import { loadRulepack } from './engine/rules.mjs';
import { Session } from './engine/session.mjs';
import { LlmChain, providersFromEnv, byoProvider } from './engine/llm/index.mjs';
import { buildReplay, toMarkdown, toHTML, sheetsMarkdown, stateMarkdown } from './engine/replay.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
// 读 .env（不引入依赖）
if (existsSync(join(ROOT, '.env'))) for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }

const PORT = Number(process.env.PORT || 8787);
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const PUBLIC = process.env.PUBLIC_DEPLOY === '1';
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 300);
mkdirSync(join(DATA, 'sessions'), { recursive: true });

const rulepacks = {};
for (const d of readdirSync(join(ROOT, 'rulepacks'))) { const p = join(ROOT, 'rulepacks', d, 'rulepack.json'); if (existsSync(p)) rulepacks[d] = loadRulepack(p); }
const sharedLlm = new LlmChain(providersFromEnv());
const sessions = new Map();
let compiling = false;
const tok = () => randomBytes(9).toString('base64url');

function persist(s) {
  const dir = join(DATA, 'sessions', s.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ ...s.exportBundle(), tokens: s.tokens }));
}
function attachJsonl(s) {
  const dir = join(DATA, 'sessions', s.id); mkdirSync(dir, { recursive: true });
  for (const b of Object.values(s.branches)) if (!b._jsonl) { b._jsonl = true; const f = join(dir, `log.${b.id}.jsonl`); if (!existsSync(f)) writeFileSync(f, b.log.map((e) => JSON.stringify(e)).join('\n') + (b.log.length ? '\n' : '')); b.listeners.push((ev) => appendFileSync(f, JSON.stringify(ev) + '\n')); }
}
function load(id) {
  if (sessions.has(id)) return sessions.get(id);
  if (!/^[\w-]{6,40}$/.test(id)) return null;
  const f = join(DATA, 'sessions', id, 'session.json'); if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8')); const rp = rulepacks[j.rulepack] || rulepacks['chaohen-v1'];
  const s = Session.fromBundle(j, { rp, llm: sharedLlm, tokens: j.tokens, id }); attachJsonl(s); sessions.set(id, s); return s;
}
function sweep() {
  const dir = join(DATA, 'sessions'); const list = readdirSync(dir).map((id) => ({ id, t: statSync(join(dir, id)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const x of list.slice(MAX_SESSIONS)) { rmSync(join(dir, x.id), { recursive: true, force: true }); sessions.delete(x.id); }
}

function sampleModules() {
  const dir = join(ROOT, 'modules'); if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(md|txt)$/i.test(f)).map((f) => { const text = readFileSync(join(dir, f), 'utf8'); return { file: f, title: ((/^#\s+(.+)$/m.exec(text) || [])[1] || f).trim(), text }; });
}
let demoPath;
function demoArchive() {
  if (demoPath && existsSync(demoPath)) return demoPath;
  const dir = join(ROOT, 'examples'); if (!existsSync(dir)) return null;
  const exact = join(dir, '示例存档-雾港来信.json'); if (existsSync(exact)) return (demoPath = exact);
  // 文件名被解成乱码时：找内容是一份《雾港来信》存档的那个 json
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { const head = readFileSync(join(dir, f), 'utf8').slice(0, 400); if (head.includes('"format":"zhangdeng.session/1"') && head.includes('"title":"雾港来信"')) return (demoPath = join(dir, f)); }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8', '.zip': 'application/zip', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(code, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(buf); };
const bad = (res, code, msg) => send(res, code, { error: msg });
async function body(req, limit = 600_000) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error('请求体过大'), { code: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('不是合法 JSON'), { code: 400 }); }
}
const who = (s, t) => (t && t === s.tokens.kp ? 'kp' : Object.entries(s.tokens.seats).find(([, v]) => v === t)?.[0] || null);
const download = (name) => ({ 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const path = url.pathname; const q = url.searchParams;
  try {
    if (path === '/api/health') return send(res, 200, { ok: true, name: '掌灯人', version: process.env.APP_VERSION || 'dev', model: sharedLlm.enabled ? sharedLlm.describe() : [], llm_stats: sharedLlm.stats, rulepacks: Object.values(rulepacks).map((r) => ({ id: r.id, name: r.name, note: r.note, terms: r.terms, skills: r.skills.map((k) => k.name) })), sessions: sessions.size, byo: true });
    if (path === '/api/sample') {
      // 按「文件里的标题」找示例模组，而不是按文件名：有些解压工具会把中文文件名解成乱码，服务不该因此找不到示例
      const mods = sampleModules(); const want = String(q.get('name') || '雾港来信').replace(/\.(md|txt)$/i, '');
      const m = mods.find((x) => x.file === q.get('name')) || mods.find((x) => x.title === want) || mods.find((x) => x.title === '雾港来信') || mods[0];
      if (!m) return bad(res, 404, 'modules/ 目录里没有示例模组');
      return send(res, 200, { name: `${m.title}.md`, text: m.text, list: mods.map((x) => x.title) });
    }

    if (path === '/api/compile' && req.method === 'POST') {
      const j = await body(req); const text = String(j.text || '');
      if (text.trim().length < 80) return bad(res, 400, '模组文本太短，认不出骨架');
      let spec;
      if (looksStructured(text)) spec = compileMarkdown(text, { sourceName: j.name || 'module.md', rulepacks });
      else if (sharedLlm.enabled) { if (compiling) return bad(res, 429, '有另一份自由文本正在编译（一次要调四段模型，同一时间只跑一份）。过一两分钟再试。'); compiling = true; try { spec = await compileFreeText(text, sharedLlm, { sourceName: j.name || 'module.txt', rulepacks, rulepack: rulepacks[j.rulepack] ? j.rulepack : 'tongxing-d100' }); } catch (e) { return bad(res, 502, `这份文本不是结构化写法，交给模型抽取时失败了：${e.message}。可以稍后再试，或按 docs/模组写法.md 整理后再导入。`); } finally { compiling = false; } }
      else return bad(res, 422, '这份文本不是结构化写法（缺少「## 场景 / ## 线索 / ## NPC」等章节），而当前没有配置模型来做自由文本抽取。请按 docs/模组写法.md 整理，或在 .env 里配置模型后重试。');
      return send(res, 200, { spec, summary: specSummary(spec) });
    }
    if (path === '/api/validate' && req.method === 'POST') { const j = await body(req); if (j.spec?.meta?.rulepack && !rulepacks[j.spec.meta.rulepack]) return bad(res, 400, `没有规则包 ${j.spec.meta.rulepack}（可用：${Object.keys(rulepacks).join('、')}）`); const issues = validateSpec(j.spec, rulepacks[j.spec?.meta?.rulepack]); return send(res, 200, { issues, summary: specSummary({ ...j.spec, issues }) }); }

    if (path === '/api/sessions' && req.method === 'POST') {
      const j = await body(req); const spec = j.spec;
      if (!spec?.reviewed) return bad(res, 400, '这份 spec 还没有经过审阅确认，不能开团');
      const issues = validateSpec(spec, rulepacks[spec.meta.rulepack]); if (issues.some((i) => i.level === 'error')) return bad(res, 400, '这份 spec 还有错误没有修正：' + issues.filter((i) => i.level === 'error').map((i) => `${i.where}：${i.msg}`).join('；'));
      spec.issues = issues;
      const rp = rulepacks[spec.meta.rulepack] || rulepacks['chaohen-v1'];
      const seats = (j.seats || []).filter((x) => ['human', 'ai', 'empty'].includes(x.seat)).slice(0, 6);
      if (!seats.some((x) => x.seat === 'human')) return bad(res, 400, '至少要有一个人类席位');
      let llm = sharedLlm;
      if (j.byo?.key && j.byo?.model && j.byo?.baseUrl) llm = new LlmChain([byoProvider(j.byo, { restrict: PUBLIC })]);
      const id = tok(); const tokens = { kp: tok(), seats: Object.fromEntries(seats.filter((x) => x.seat !== 'empty').map((x) => [x.pc, tok()])) };
      const s = Session.create({ id, spec, rp, seats, seed: String(j.seed || tok()).slice(0, 40), config: { ...(j.config || {}), useModel: j.config?.useModel !== false }, llm, tokens });
      sessions.set(id, s); attachJsonl(s); persist(s); sweep();
      return send(res, 200, { id, tokens });
    }
    if (path === '/api/import' && req.method === 'POST') {
      const j = await body(req, 12_000_000); const bundle = j.bundle;
      if (bundle?.format !== 'zhangdeng.session/1' || !bundle.branches || !bundle.spec) return bad(res, 400, '不是掌灯人的存档文件');
      const id = tok(); const pcs = Object.keys(Object.values(bundle.branches)[0].state.pcs);
      const tokens = { kp: tok(), seats: Object.fromEntries(pcs.map((p) => [p, tok()])) };
      const s = Session.fromBundle(bundle, { rp: rulepacks[bundle.rulepack] || rulepacks['chaohen-v1'], llm: sharedLlm, tokens, id });
      for (const b of Object.values(s.branches)) { const v = b.verifyChain(); if (!v.ok) return bad(res, 400, `存档日志验链失败（分支 ${b.id} 第 ${v.at} 条：${v.why}）`); }
      sessions.set(id, s); attachJsonl(s); persist(s);
      return send(res, 200, { id, tokens, title: s.title, round: s.s.round });
    }

    const m = /^\/api\/s\/([\w-]+)\/(\w+)$/.exec(path);
    if (m) {
      const s = load(m[1]); if (!s) return bad(res, 404, '没有这局团（可能已过期）');
      const j = req.method === 'POST' ? await body(req) : {}; const viewer = who(s, q.get('t') || j.t);
      if (!viewer) return bad(res, 403, '席位凭证不对');
      const kpOnly = () => { if (viewer !== 'kp') throw Object.assign(new Error('只有掌灯人能做这件事'), { code: 403 }); };
      const op = m[2];
      if (op === 'view') return send(res, 200, { viewer, ...s.viewFor(viewer), seat_tokens: viewer === 'kp' ? s.tokens.seats : undefined });
      if (op === 'events') return send(res, 200, { events: s.events(viewer, Number(q.get('since') || 0)), seq: s.b.seq, busy: s.busy, branch: s.current });
      if (op === 'act') { if (viewer === 'kp') return bad(res, 400, '掌灯人不占席位，请切到一个寻访者席位再行动'); if (s.s.pcs[viewer]?.seat !== 'human') return bad(res, 400, '这个席位由 AI 扮演'); const r = await s.act({ pc: viewer, text: j.text, secret: !!j.secret }); persist(s); return send(res, 200, r); }
      if (op === 'xcard') { const r = s.xcard(viewer, j.mode); persist(s); return send(res, 200, r); }
      if (op === 'console') { kpOnly(); const r = s.console(j.action); persist(s); return send(res, 200, r || { ok: true }); }
      if (op === 'novel') { kpOnly(); const r = await s.polishNovel(); persist(s); return send(res, 200, r); }
      if (op === 'rewrite') { kpOnly(); const r = await s.rewriteLast(); persist(s); return send(res, 200, r); }
      if (op === 'save') { kpOnly(); const r = s.save(String(j.name || `第 ${s.s.round} 轮`).slice(0, 30)); persist(s); return send(res, 200, r); }
      if (op === 'rollback') { kpOnly(); const r = s.rollback(Number(j.round), String(j.name || '').slice(0, 30)); attachJsonl(s); persist(s); return send(res, 200, r); }
      if (op === 'branch') { kpOnly(); s.switchBranch(j.id); persist(s); return send(res, 200, { ok: true }); }
      if (op === 'spec') { kpOnly(); return send(res, 200, s.specForKp); }
      if (op === 'replay') {
        const view = q.get('view') === 'kp' ? 'kp' : 'player'; if (view === 'kp') kpOnly();
        const br = q.get('branch') && s.branches[q.get('branch')] ? q.get('branch') : s.current;
        const rp = buildReplay(s, br, view === 'kp' ? 'kp' : viewer === 'kp' ? '__public__' : viewer); const fmt = q.get('format') || 'json'; const name = `${s.title}-replay-${br}-${view === 'kp' ? '掌灯人视角' : '玩家视角'}`;
        const dl = q.get('dl') ? 1 : 0;
        if (fmt === 'md') return send(res, 200, toMarkdown(rp, view), 'text/markdown; charset=utf-8', dl ? download(name + '.md') : {});
        if (fmt === 'html') return send(res, 200, toHTML(rp, view), 'text/html; charset=utf-8', dl ? download(name + '.html') : {});
        return send(res, 200, rp, undefined, dl ? download(name + '.json') : {});
      }
      if (op === 'export') {
        kpOnly(); const what = q.get('what') || 'bundle'; const base = `${s.title}-${s.current}`;
        if (what === 'bundle') return send(res, 200, JSON.stringify(s.exportBundle(), null, 1), undefined, download(`${base}-存档.json`));
        if (what === 'state') return send(res, 200, JSON.stringify(s.s, null, 1), undefined, download(`${base}-状态库.json`));
        if (what === 'state_md') return send(res, 200, stateMarkdown(s), 'text/markdown; charset=utf-8', download(`${base}-状态库.md`));
        if (what === 'log') return send(res, 200, s.b.log.map((e) => JSON.stringify(e)).join('\n'), 'application/x-ndjson; charset=utf-8', download(`${base}-日志.jsonl`));
        if (what === 'sheets') return send(res, 200, sheetsMarkdown(s), 'text/markdown; charset=utf-8', download(`${base}-角色卡.md`));
        if (what === 'sheets_json') return send(res, 200, JSON.stringify(s.s.pcs, null, 1), undefined, download(`${base}-角色卡.json`));
        if (what === 'spec') return send(res, 200, JSON.stringify(s.specForKp, null, 1), undefined, download(`${s.title}-module.spec.json`));
        return bad(res, 400, '未知的导出项');
      }
      return bad(res, 404, '没有这个接口');
    }

    // 静态文件
    let rel = decodeURIComponent(path === '/' ? '/index.html' : path);
    // 源码包里没有 web/download：示例存档直接从 examples/ 取
    if (rel === '/download/示例存档-雾港来信.json' && !existsSync(join(ROOT, 'web', rel))) { const f = demoArchive(); if (f) return send(res, 200, readFileSync(f), MIME['.json'], download('示例存档-雾港来信.json')); }
    const file = normalize(join(ROOT, 'web', rel));
    if (!file.startsWith(join(ROOT, 'web')) || !existsSync(file) || statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    const buf = readFileSync(file), type = MIME[extname(file)] || 'application/octet-stream';
    const cache = { 'Cache-Control': /\.(png|jpg|webp|woff2|mp3)$/.test(file) || /[\\/]vendor[\\/]/.test(file) ? 'public, max-age=86400' : 'no-cache' };
    // 音频：Safari 的 <audio> 要先拿到一段字节范围才肯播
    if (/^audio\//.test(type)) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        const a = m[1] ? Number(m[1]) : Math.max(0, buf.length - Number(m[2])), b = m[1] && m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
        if (a > b || a >= buf.length) return send(res, 416, '', 'text/plain; charset=utf-8', { 'Content-Range': `bytes */${buf.length}` });
        return send(res, 206, buf.subarray(a, b + 1), type, { ...cache, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${buf.length}` });
      }
      return send(res, 200, buf, type, { ...cache, 'Accept-Ranges': 'bytes' });
    }
    return send(res, 200, buf, type, cache);
  } catch (e) {
    if (!e.code || typeof e.code !== 'number') console.error(new Date().toISOString(), path, e.stack || e);
    return bad(res, typeof e.code === 'number' ? e.code : 400, e.message || '出错了');
  }
});
server.listen(PORT, () => console.log(`掌灯人已启动：http://localhost:${PORT}　模型：${sharedLlm.enabled ? sharedLlm.describe().join(' → ') : '未配置（离线演员）'}　数据目录：${DATA}`));
