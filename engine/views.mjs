// 信息物理隔离。开团时把 spec 切成几份互不相通的切片：
//   director  —— 完整 spec，只交给导演层（确定性代码）；
//   world     —— 公开世界：场景的公开描述、NPC 的公开身份；
//   npcCards  —— 每个 NPC 一张卡：人设 + 口吻 + 「可以说出口的」知识。真实身份、绝不分享项根本不在卡里；
//   pcCards   —— 每个寻访者的个人卡。
// 演员池（actors.mjs）的构造函数只收后三份，它的代码路径上不存在真相层这个对象。
// 另外，每一次交给演员（离线或模型）的上下文都会过 auditContext()：拿真相层的「金丝雀」去扫，命中即记为泄露。
const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const clone = (o) => JSON.parse(JSON.stringify(o));

export function splitSpec(spec) {
  const world = {
    title: spec.meta.title, constitution: clone(spec.constitution),
    scenes: Object.fromEntries(spec.scenes.map((s) => [s.id, { id: s.id, name: s.name, aliases: s.aliases, exits: s.exits, public_desc: s.public_desc, obvious: s.interactables.filter((i) => i.obvious).map((i) => i.name) }])),
    npcs: Object.fromEntries(spec.npcs.map((n) => [n.id, { id: n.id, name: n.name, public_identity: n.public_identity }])),
  };
  const npcCards = Object.fromEntries(spec.npcs.map((n) => [n.id, {
    id: n.id, name: n.name, public_identity: n.public_identity, motive: n.motive, voice: clone(n.voice), redlines: [...n.redlines], nonverbal: !!n.nonverbal, repeat: [...(n.repeat || [])],
    greet: [...n.greet], smalltalk: [...n.smalltalk], deflect: [...n.deflect],
    // 只带「随口」与「信任」两类；「绝不」类连标题都不进卡。信任类是否解锁由导演单逐轮决定。
    knowledge: n.knowledge.filter((k) => k.share !== 'never').map((k) => ({ id: k.id, title: k.title, share: k.share, say: k.say })),
  }]));
  const pcCards = Object.fromEntries(spec.pregens.map((p) => [p.id, { id: p.id, name: p.name, role: p.role, background: p.background, drive: p.drive, fear: p.fear, relations: p.relations, ai: clone(p.ai) }]));
  return { director: freeze(clone(spec)), world: freeze(world), npcCards: freeze(npcCards), pcCards: freeze(pcCards) };
}

// 金丝雀：真相层里所有不该出现在演员上下文里的字符串。
export function canaries(spec, state) {
  const list = [];
  for (const nr of spec.truth.never_reveal || []) {
    const locked = !nr.unlock || !state.clues[nr.unlock]?.found;
    if (locked) for (const k of nr.keywords) list.push({ id: nr.id, kw: k });
  }
  // 真相摘要与真实身份的整句：任何时候都不该原样出现在演员上下文里
  const sentences = (t) => String(t || '').split(/[。；：]/).map((x) => x.trim()).filter((x) => x.length >= 12);
  for (const s of sentences(spec.truth.summary)) list.push({ id: 'truth.summary', kw: s });
  for (const n of spec.npcs) for (const s of sentences(n.true_identity)) list.push({ id: `true_identity:${n.id}`, kw: s });
  for (const n of spec.npcs) for (const k of n.knowledge) if (k.share === 'never' && k.say.length >= 8) list.push({ id: `never:${k.id}`, kw: k.say });
  return list;
}

// 扫一份即将交给演员的上下文。playerText 是玩家自己打的字，不算系统泄露，先挖掉再扫。
export function auditContext(role, ctxText, canaryList, playerTexts = []) {
  let t = ctxText; for (const p of playerTexts) if (p) t = t.split(p).join('');
  const hits = canaryList.filter((c) => t.includes(c.kw)).map((c) => c.id + ':' + c.kw.slice(0, 12));
  return { role, chars: ctxText.length, leak: hits.length > 0, hits };
}
