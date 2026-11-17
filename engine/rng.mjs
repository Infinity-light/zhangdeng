// 可配种子、可序列化状态的随机源（mulberry32）。
// 引擎里所有随机都从这里来；状态存进快照，回滚后骰序可复现。
export function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export class Rng {
  constructor(seed, state) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    this.state = state == null ? this.seed : state >>> 0;
    this.draws = 0;
  }
  next() {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.draws++;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  snapshot() { return { seed: this.seed, state: this.state, draws: this.draws }; }
  static restore(s) { const r = new Rng(s.seed, s.state); r.draws = s.draws || 0; return r; }
}
