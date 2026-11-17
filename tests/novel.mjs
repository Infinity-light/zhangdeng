// 小说体战报实测：按剧本跑一段，然后请模型把记录稿润色成小说体，看几节过了闸、几节被打回。
// 用法：node tests/novel.mjs <baseUrl> [步数=16] [输出.md]      （服务端需要配了模型）
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.argv[2] || 'http://localhost:8787'; const steps = Number(process.argv[3] || 16); const out = process.argv[4];
const J = async (p, b) => { const r = await fetch(base + p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`); return j; };
const script = JSON.parse(readFileSync(new URL('./script-50.json', import.meta.url), 'utf8')).slice(0, steps);
const sample = await J('/api/sample'); const c = await J('/api/compile', { text: sample.text }); c.spec.reviewed = true;
const r = await J('/api/sessions', { spec: c.spec, seats: [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }, { pc: 'wen', seat: 'ai' }], seed: 'novel-demo', config: { timeScale: 0.7 } });
for (const [pc, text, secret] of script) { await J(`/api/s/${r.id}/act`, { t: r.tokens.seats[pc], text, secret: !!secret }); process.stdout.write('.'); await new Promise((x) => setTimeout(x, 2000)); }
const t0 = Date.now(); const res = await J(`/api/s/${r.id}/novel`, { t: r.tokens.kp });
console.log(`\n${res.sections} 节，${res.polished} 节润色并通过校验，${res.kept.length} 节保留原文，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const k of res.kept) console.log(`  第 ${k.section} 节被打回：${k.why}`);
const rp = await J(`/api/s/${r.id}/replay?t=${r.tokens.kp}&view=kp&format=json`);
const ev = (await J(`/api/s/${r.id}/events?t=${r.tokens.kp}&since=0`)).events;
const leaks = ev.filter((e) => e.type === 'context.audit' && e.data.role === 'novelist' && e.data.leak).length;
console.log(`交给润色模型的上下文 ${ev.filter((e) => e.type === 'context.audit' && e.data.role === 'novelist').length} 份，含真相层内容 ${leaks} 份`);
console.log('\n—— 小说体（前 600 字）——\n' + rp.novel_polished.text.slice(0, 600));
console.log('\n—— 原始记录（前 300 字）——\n' + rp.novel.slice(0, 300));
if (out) writeFileSync(out, `# 小说体战报 · 实测样例\n\n《雾港来信》按 \`tests/script-50.json\` 的前 ${steps} 步跑出来的一段。${res.sections} 节里 ${res.polished} 节由 ${rp.novel_polished.source} 润色并通过校验，${res.kept.length} 节保留原文${res.kept.length ? '（' + res.kept.map((k) => `第 ${k.section} 节：${k.why}`).join('；') + '）' : ''}。交给润色模型的上下文 ${ev.filter((e) => e.type === 'context.audit' && e.data.role === 'novelist').length} 份，含真相层内容 ${leaks} 份。\n\n## 小说体（模型润色）\n\n${rp.novel_polished.text}\n\n## 原始记录（按日志拼接）\n\n${rp.novel}\n`);
