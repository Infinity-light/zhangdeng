// 三道闸里的第三道：泄露过滤 + 退化检测 + 一致性校验。
// 作用在「模型写出来的每一段文字」上；离线演员的文字同样过一遍，结果进日志，Replay 里出报告。

const PATTERNS = [
  ['讨好', /你(们)?可以(试试|试着|考虑|去|先)|要不要|不妨|建议你|或许(你|可以)|也许你(们)?(可以|应该)|需要我|提示[:：]|小提示|你(们)?或许该/],
  ['出戏', /作为(一个)?(AI|人工智能|语言模型|主持人|叙述者|KP)|模组|剧情|检定结果|玩家们?|系统(提示|会)|原文接|导演(指示|单)|【|】|游戏(里|中|规则)|骰子|投掷|本轮|跑团|台词/],
  ['总结癖', /总之|综上|总结一下|到目前为止|目前(为止)?你们已经|回顾一下|简而言之|由此可见|这说明|显然/],
  ['鼓励', /做得(好|不错)|很棒|真聪明|聪明的(选择|做法)|不错的(选择|想法|主意)|加油|干得漂亮|好主意/],
  ['语气变轻', /[!！]|哈哈|嘻嘻|~|～|呢～|吧～|😀|😊|✨|🙂/],
  ['陈词', /若隐若现|时隐时现|蜿蜒|崎岖|在脚下延伸|向(远处|前方?|深处)延伸|通向[^，。]{0,6}深处|仿佛|宛如|犹如|仿若|好似|弥漫|笼罩|不禁|涌上心头|不寒而栗|毛骨悚然|令人(不安|窒息|心悸|胆寒)|诡异|诉说着|低语着|窃窃私语|映照|交织|吹拂|的轮廓|一丝|一抹|缓缓|渐渐|隐约|似乎|显得(格外|更加|有些|愈发)|格外|愈发|空气中|死寂|寂静无声|神秘的|未知的|深邃|无尽的|带着(一股|咸|腥|潮|寒)[^，。]{0,3}(气息|味道?|意)|在[^，。]{1,8}中回(响|荡)/],
  ['代打', /你(们)?(决定|选择|打算)(去|先|要)|你(们)?意识到(这|真相|原来)|你(们)?(推断|推测|明白了|恍然)|真相(是|就是|大白)|凶手(是|就是)/],
];
// 基调词：一批常见的感官/氛围用字。每个模组只取其中在它自己的「基调 + 氛围句」里出现过的那些，
// 这样海边的团量的是「雾、潮、咸」，山里的团量的是「干、裂、静」，而不是拿同一把尺子量所有题材。
const TONE_POOL = '雾潮湿暗冷黑咸锈水静沉灯影凉声干裂枯尘灰寂空旧朽腥冰阴风哑死停香井灭闷甜白';
const TONE = /雾|潮|湿|暗|冷|黑|咸|锈|水|静|沉|灯|影|凉|声/g;
export function toneRegexFor(spec) {
  const src = [spec?.constitution?.tone || '', ...(spec?.scenes || []).flatMap((s) => [...(s.beats || []), ...(s.press_beats || [])])].join('');
  const hit = [...TONE_POOL].filter((ch) => src.includes(ch));
  return hit.length >= 5 ? new RegExp(hit.join('|'), 'g') : TONE;
}

export function inspect(text, { locked = [], banned = [], maxLen = 400, minLen = 0, recent = [] } = {}) {
  const v = [];
  for (const c of locked) if (text.includes(c.kw)) v.push({ type: '泄露', match: c.kw.slice(0, 12), id: c.id });
  for (const [type, re] of PATTERNS) { const m = re.exec(text); if (m) v.push({ type, match: m[0] }); }
  for (const b of banned) if (b && text.includes(b)) v.push({ type: '禁用词', match: b });
  if (text.length > maxLen) v.push({ type: '过长', match: String(text.length) });
  if (text.length < minLen) v.push({ type: '信息密度低', match: String(text.length) });
  for (const r of recent) if (r && similarity(text, r) > 0.6) { v.push({ type: '桥段重复', match: r.slice(0, 10) }); break; }
  return v;
}

export function toneDensity(text, re = TONE) { const m = text.match(re); return text.length ? (m ? m.length : 0) / text.length : 0; }

// 字二元组的 Jaccard 相似度：量桥段重复和 NPC 口吻趋同
export function bigrams(t) { const s = new Set(); const x = t.replace(/[\s，。、！？；：“”「」…—\-,.!?]/g, ''); for (let i = 0; i < x.length - 1; i++) s.add(x.slice(i, i + 2)); return s; }
export function similarity(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let n = 0; for (const g of A) if (B.has(g)) n++; return n / (A.size + B.size - n); }

// 把违规的句子剔掉（模型重写仍不过关时的最后一手）
export function strip(text, violations) {
  const bad = violations.map((x) => x.match).filter(Boolean);
  const parts = text.split(/(?<=[。！？!?])/);
  const kept = parts.filter((s) => !bad.some((b) => s.includes(b)) && !PATTERNS.some(([, re]) => re.test(s)));
  return kept.join('').trim();
}

// 一致性校验：叙述里出现了「不在场的 NPC 名」「不存在的场景名」「材料里没有的阿拉伯数字」→ 记冲突。
export function consistency(text, { presentNames = [], allNpcNames = [], material = '' }) {
  const out = [];
  for (const n of allNpcNames) if (text.includes(n) && !presentNames.includes(n) && !material.includes(n)) out.push({ type: '不在场的人物', match: n });
  for (const d of text.match(/\d+/g) || []) if (!material.includes(d)) out.push({ type: '材料外的数字', match: d });
  // 幻觉造物：材料里没有的人物与建筑结构，一出现就打回
  for (const w of text.match(/警长|警察|巡捕|医生|神父|牧师|道士|和尚|陌生人|黑影|人影|身影|老人|老妇|女人|男人|孩子|小孩|渔夫|水手|地道|密道|暗门|地下室|密室|暗格|手枪|尸体|血迹|耳语|低语|雕像/g) || []) if (!material.includes(w)) out.push({ type: '材料外的造物', match: w });
  return out;
}

// 退化报告：按 10 轮一窗，比较语气密度、平均长度、各类违规次数。
export function degradationReport(log, toneRe = TONE) {
  const wins = {};
  for (const ev of log) {
    if (ev.type !== 'narration' && ev.type !== 'npc.line') continue;
    const w = Math.floor(Math.max(0, ev.round - 1) / 10); const o = (wins[w] ||= { window: `${w * 10 + 1}-${w * 10 + 10}`, narr: 0, chars: 0, tone: 0, npcLines: 0, alerts: {}, rewrites: 0 });
    const text = ev.data.text || '';
    if (ev.type === 'narration') { o.narr++; o.chars += text.length; o.tone += toneDensity(text, toneRe); } else o.npcLines++;
  }
  for (const ev of log) if (ev.type === 'guard.alert') { const w = Math.floor(Math.max(0, ev.round - 1) / 10); const o = wins[w]; if (!o) continue; for (const v of ev.data.violations) o.alerts[v.type] = (o.alerts[v.type] || 0) + 1; if (ev.data.action !== 'pass') o.rewrites++; }
  const rows = Object.values(wins).map((o) => ({ window: o.window, narrations: o.narr, avg_chars: o.narr ? Math.round(o.chars / o.narr) : 0, tone_density: o.narr ? +(o.tone / o.narr).toFixed(3) : 0, npc_lines: o.npcLines, alerts: o.alerts, rewrites: o.rewrites }));
  // 只拿叙述段数够多的窗口来比（不足 5 段的尾窗样本太少，单列出来不参与结论）
  const full = rows.filter((r) => r.narrations >= 5); const first = full[0], last = full[full.length - 1]; let verdict = '样本不足两个完整窗口，无法比较';
  const tail = rows[rows.length - 1] && rows[rows.length - 1].narrations < 5 ? rows[rows.length - 1] : null;
  if (full.length >= 2 && first.avg_chars) {
    const dLen = (last.avg_chars - first.avg_chars) / first.avg_chars, dTone = first.tone_density ? (last.tone_density - first.tone_density) / first.tone_density : 0;
    verdict = `末窗对首窗：平均长度 ${(dLen * 100).toFixed(0)}%，基调词密度 ${(dTone * 100).toFixed(0)}%。` + (dLen < -0.3 || dTone < -0.3 ? '有衰减迹象。' : '未见显著衰减。') + `（比较的是 ${first.window} 轮与 ${last.window} 轮）` + (tail ? `尾窗 ${tail.window} 轮只有 ${tail.narrations} 段叙述，样本太少未计入：平均 ${tail.avg_chars} 字，基调词密度 ${tail.tone_density}。` : '');
  }
  // NPC 口吻趋同度：不同 NPC 台词之间的平均相似度
  const byNpc = {}; for (const ev of log) if (ev.type === 'npc.line') (byNpc[ev.data.npc] ||= []).push(ev.data.text);
  const ids = Object.keys(byNpc); let s = 0, n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { s += similarity(byNpc[ids[i]].join(''), byNpc[ids[j]].join('')); n++; }
  return { windows: rows, verdict, compared: full.length >= 2 ? { first, last } : null, npc_cross_similarity: n ? +(s / n).toFixed(3) : null };
}
