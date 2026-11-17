// 模型接入：OpenAI 兼容的 chat/completions。按顺序试上游，谁先成谁用；全失败由调用方落回离线演员。
// 密钥只从环境变量读，或由开团的人在界面里临时填（只放内存，不落盘、不进日志）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ZHIPU = { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', extra: { thinking: { type: 'disabled' } }, perMinute: 24, timeoutMs: 9_000 };

export function providersFromEnv(env = process.env) {
  const list = [];
  if ((env.LLM_MODE || 'auto') === 'offline') return list;
  if (env.LLM_BASE_URL && env.LLM_MODEL) {
    list.push({ name: env.LLM_MODEL, url: env.LLM_BASE_URL.replace(/\/+$/, '') + '/chat/completions', model: env.LLM_MODEL, key: (env.LLM_API_KEY || '').trim(), perMinute: Number(env.LLM_PER_MINUTE || 60), timeoutMs: Number(env.LLM_TIMEOUT_MS || 40_000), extra: env.LLM_EXTRA ? JSON.parse(env.LLM_EXTRA) : {} });
  }
  const zk = (env.ZHIPU_API_KEY || '').trim();
  if (zk) for (const model of (env.ZHIPU_MODELS || 'glm-4.5-flash,glm-4-flash-250414,glm-4.7-flash').split(',')) list.push({ ...ZHIPU, name: model.trim(), model: model.trim(), key: zk });
  return list;
}

// 线上允许访客自带密钥时，只放行这些主机，避免把服务端当成任意请求的跳板。
export const BYO_HOSTS = ['api.openai.com', 'api.deepseek.com', 'open.bigmodel.cn', 'dashscope.aliyuncs.com', 'api.moonshot.cn', 'api.siliconflow.cn', 'openrouter.ai', 'ark.cn-beijing.volces.com', 'api.anthropic.com'];
export function byoProvider({ baseUrl, model, key }, { restrict = true } = {}) {
  const u = new URL(String(baseUrl).replace(/\/+$/, '') + '/chat/completions');
  if (restrict && (u.protocol !== 'https:' || !BYO_HOSTS.includes(u.hostname))) throw new Error(`线上只允许这些接口主机：${BYO_HOSTS.join('、')}。本地运行不受此限。`);
  return { name: `byo:${model}`, url: u.toString(), model, key: String(key || '').trim(), perMinute: 60, timeoutMs: 40_000, extra: {} };
}

export class LlmChain {
  constructor(providers = [], fetchImpl = fetch) {
    this.providers = providers.map((p) => ({ ...p, _slots: [], _blockedUntil: 0 }));
    this.fetch = fetchImpl; this.stats = { ok: 0, fail: 0, byProvider: {}, last: null };
  }
  get enabled() { return this.providers.length > 0; }
  describe() { return this.providers.map((p) => p.name); }

  #reserve(p, maxWait) {
    const now = Date.now(); p._slots = p._slots.filter((t) => t > now - 60_000);
    let at = Math.max(now, p._blockedUntil);
    if (p._slots.length >= p.perMinute) at = Math.max(at, p._slots[p._slots.length - p.perMinute] + 60_000);
    if (at - now > maxWait) return -1;
    p._slots.push(at); return at - now;
  }

  async complete({ role = '', system, user, maxTokens = 400, temperature = 0.8, maxWaitMs = 4000, timeoutMs = 0 }) {
    const errors = [];
    for (const p of this.providers) {
      const wait = this.#reserve(p, maxWaitMs); if (wait < 0) { errors.push(`${p.name}:busy`); continue; }
      if (wait) await sleep(wait);
      const t0 = Date.now();
      try {
        const res = await this.fetch(p.url, {
          method: 'POST', signal: AbortSignal.timeout(timeoutMs || p.timeoutMs),
          headers: { 'Content-Type': 'application/json', ...(p.key ? { Authorization: `Bearer ${p.key}` } : {}) },
          body: JSON.stringify({ model: p.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature, ...(p.extra || {}) }),
        });
        if (!res.ok) {
          if ([429, 402, 403].includes(res.status)) p._blockedUntil = Date.now() + Math.min(Number(res.headers.get('retry-after')) || 45, 600) * 1000;
          throw new Error(`http_${res.status}`);
        }
        const j = await res.json(); const text = (j?.choices?.[0]?.message?.content || '').trim();
        if (!text) throw new Error('empty');
        const ms = Date.now() - t0; this.stats.ok++; this.stats.byProvider[p.name] = (this.stats.byProvider[p.name] || 0) + 1; this.stats.last = p.name;
        return { text, provider: p.name, ms, usage: j.usage || null, role };
      } catch (e) { errors.push(`${p.name}:${e.name === 'TimeoutError' ? 'timeout' : e.message}`); }
    }
    this.stats.fail++;
    const err = new Error('all_providers_failed: ' + errors.join(', ')); err.errors = errors; throw err;
  }
}
