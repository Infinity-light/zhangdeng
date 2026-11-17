// 两个人类席位各拿自己的席位凭证，同时出手（走 HTTP）：两边都得到回应、按到达顺序各占一轮、各自只看得到自己该看的。
// 用法：node tests/concurrent.mjs <baseUrl>
const base = process.argv[2] || 'http://localhost:8787';
const J = async (p, b) => { const r = await fetch(base + p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`); return j; };
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✔' : '✘'} ${name}${extra ? ' —— ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sample = await J('/api/sample'); const c = await J('/api/compile', { text: sample.text }); c.spec.reviewed = true;
const r = await J('/api/sessions', { spec: c.spec, seats: [{ pc: 'lu', seat: 'human' }, { pc: 'su', seat: 'human' }, { pc: 'wen', seat: 'ai' }], seed: 'two-devices', config: {} });
const lu = r.tokens.seats.lu, su = r.tokens.seats.su, kp = r.tokens.kp;
const t0 = Date.now();
const res = await Promise.allSettled([
  J(`/api/s/${r.id}/act`, { t: lu, text: '看看告示栏' }),
  J(`/api/s/${r.id}/act`, { t: su, text: '去栈桥尽头看看脚印', secret: true }),
  J(`/api/s/${r.id}/act`, { t: lu, text: '问邱港监：沈砚秋去哪了' }),
  J(`/api/s/${r.id}/act`, { t: su, text: '看看渔船' }),
]);
ok('四次同时到达的行动全部得到回应', res.every((x) => x.status === 'fulfilled'), res.map((x) => (x.status === 'fulfilled' ? `第${x.value.round}轮` : x.reason.message.slice(0, 40))).join('，') + `，共 ${Date.now() - t0}ms`);
const rounds = res.filter((x) => x.status === 'fulfilled').map((x) => x.value.round).sort((a, b) => a - b);
ok('各占一轮，没有丢也没有重', JSON.stringify(rounds) === JSON.stringify([1, 2, 3, 4]), rounds.join(','));
const evLu = (await J(`/api/s/${r.id}/events?t=${lu}&since=0`)).events, evSu = (await J(`/api/s/${r.id}/events?t=${su}&since=0`)).events, evKp = (await J(`/api/s/${r.id}/events?t=${kp}&since=0`)).events;
const secretSeqs = evKp.filter((e) => typeof e.vis === 'object').map((e) => e.seq);
ok('苏幼宁的私下行动只有她和掌灯人看得见', secretSeqs.length > 0 && secretSeqs.every((s) => evSu.some((e) => e.seq === s)) && !secretSeqs.some((s) => evLu.some((e) => e.seq === s)), `${secretSeqs.length} 条私密事件`);
ok('玩家席位看不到导演单、隔离审计、闸门报警、触发器内情、控制台操作', ![...evLu, ...evSu].some((e) => ['director.sheet', 'context.audit', 'guard.alert', 'proposal.rejected', 'trigger.fired', 'aipc.skip', 'console.action'].includes(e.type)));
// 玩家能看到的落库记录只有「自己那次检定造成的数值变化」这一类（生命、心智、状态），看不到 flag、线索、相位、NPC 态度的落库
const leaks = [...evLu, ...evSu].filter((e) => e.type === 'state.change').flatMap((e) => e.data.changes).filter((c) => !['mind.delta', 'hp.delta', 'pc.condition', 'pc.status', 'skill.set', 'foe.hp'].includes(c.op));
ok('玩家看到的落库记录只含生命/心智这类公开数值，不含 flag、线索、相位、NPC 态度', leaks.length === 0, leaks.map((c) => c.op).join(','));
const view = await J(`/api/s/${r.id}/view?t=${kp}`);
ok('状态库轮数与日志一致', view.round === 4, `第 ${view.round} 轮`);
