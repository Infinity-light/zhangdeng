// L4 NPC 演员池 + L5 AI 寻访者 + 叙述层。
// 这个模块拿不到 spec：构造时只收 views.mjs 切出来的 world / npcCards / pcCards。
// 每次生成只吃一份当轮的「视图」（短上下文），不吃历史全文。有模型就交给模型，没有或失败就用离线演员。
// 离线演员是确定性的：按角色卡里的招呼、闲谈、推脱和导演单放行的内容出台词。

const pick = (arr, i) => (arr && arr.length ? arr[((i % arr.length) + arr.length) % arr.length] : '');

// 离线演员的备用句。这里的是不带任何题材的中性句；模组可以在「宪法」里用「路上 / 无回应 / 无人应答」写自己的，写了就用模组的。
const TRAVEL = ['路上没有遇见人。', '沿路的门都关着，门缝里没有光。', '走到一半，身后的路已经看不清了。', '一路上只有自己的脚步声。'];
const FREE = ['没有什么回应这个举动。', '这样做了以后，周围还是原来的样子，只是更静了一点。', '做完这件事，你站着听了一会儿。没有别的声音。', '没有人拦你，也没有人看你。', '这一阵工夫，天色又沉下去一层。', '事情做了。四下里什么也没有变。'];
const PROBE = ['没有谁回答这句话。', '这句话落在地上，没有人捡。', '问出口以后，周围静了一会儿。'];
const own = (list, d) => (list && list.length ? list : d);
const BLOCKED = ['这条路眼下走不通。', '它没有让开。'];

export class ActorPool {
  constructor({ world, npcCards, pcCards }, llm) { this.world = world; this.npcCards = npcCards; this.pcCards = pcCards; this.llm = llm; }

  constitutionBlock() {
    const c = this.world.constitution;
    return `【冻结宪法 · 每轮固定在最前，不参与摘要】\n基调：${c.tone}\n语气禁令：\n${c.style_bans.map((x) => '- ' + x).join('\n')}\n不可变事实：\n${c.immutable_facts.map((x) => '- ' + x).join('\n')}`;
  }

  // ---------- 叙述层 ----------
  narratorPrompt(v) {
    const system = `${this.constitutionBlock()}\n\n【你的职责】你是一场调查恐怖跑团的叙述者，只写这一轮的衔接叙述：行动者做了什么，眼前是什么样。\n【怎么写】像旧时候的人记一笔流水账，只记看得见、摸得着的。\n- 用行动者的名字起头，不用「你」。一段，25 到 60 字，一到两句，最多三句。句子长短不要一样，可以有一句只有三五个字。\n- 先写动作。动作之后至多带一样东西的一个细节——它在哪、什么料子、干的湿的、冷的热的、响不响。细节只能取自「可用的环境细节」；那一栏是（无），就只写动作，写完就停，一句也行。\n- 东西叫它本来的名字，材料里怎么叫就怎么叫，不换成笼统的说法；材料里没有的东西不添（路是什么铺的、墙是什么砌的、路通向哪里，材料没写就不写）。\n- 不用比喻，不用拟人，不写「像……一样」。不写气氛的总评（气氛如何、令人如何）。结尾不加感慨，不加一句意味深长的话。\n- 这些词一个都不用：仿佛、似乎、渐渐、缓缓、隐约、一丝、弥漫、笼罩、若隐若现、轮廓、吹拂、诡异、格外、空气中、蜿蜒、延伸、深处。\n- 示范（另一个故事里的，只学它的干净，不许借用里面的东西）：材料是「行动者：阿贵；行动原话：去后院；可用的环境细节：后院的井绳是新换的。」写成：「阿贵穿过灶间，到了后院。井绳是新换的。」\n【硬性规则】只能使用「本轮材料」里出现的人、物、地点；不得新增人物、地名、数字、道具、建筑结构、结论；不得替寻访者决定下一步，不写他们的想法、心情和身体反应（心跳、发抖、猛地抬头之类）；不得让寻访者去到别的地方；不得发生材料里没有的新事件（新的声音来源、谁做了什么、东西自己变了）；环境只写「可用的环境细节」和此地原本就有的东西；不得提问、不得建议；不写任何人的对白；不重复「已写过」里的句子和意象；调查到的具体内容会另行原文给出，你不要自己编。`;
    const user = `【场景】${v.sceneName}（${v.clock}，${v.phaseName}）\n【前情】${v.summary || '（刚开始）'}\n【已写过】\n${v.recent.map((x) => '- ' + x).join('\n') || '（无）'}\n【本轮材料】\n- 行动者：${v.actorName}\n- 行动原话：${v.actionText}\n- 导演判定：${v.directive}\n- 可用的环境细节：${v.beat || '（无）'}${v.fade ? '\n- 尺度：已请求淡化，不写躯体与受伤细节' : ''}${v.retry ? `\n- 上一稿的问题：${v.retry}。请避开。` : ''}\n【输出】只输出叙述正文。`;
    return { system, user };
  }
  narrateOffline(v) {
    const i = v.round + v.salt;
    let lead = '';
    const c = this.world.constitution;
    if (v.kind === 'move') lead = `你们往${v.target}去。${pick(own(c.travel, TRAVEL), i)}`;
    else if (v.kind === 'examine') lead = `${v.actorName}走近${v.target}。`;
    else if (v.kind === 'blocked') lead = `${v.actorName}试了试${v.target}。${pick(BLOCKED, i)}`;
    else if (v.kind === 'talk') lead = '';
    else if (v.kind === 'look') lead = '';
    else if (v.kind === 'party') lead = `${v.actorName}凑近${v.target}，压低声音说了一句。`;
    else if (v.kind === 'recall') lead = `${v.actorName}又把「${v.target}」拿出来想了一遍。`;
    else if (v.kind === 'probe') lead = pick(own(c.probe, PROBE), i);
    else if (v.kind === 'choice') lead = `${v.actorName}做了决定。`;
    else if (v.kind === 'wrap') lead = '这一夜已经有了结果。再做什么，都是之后的事了。';
    else lead = pick(own(c.free, FREE), i);
    return [lead, v.beat].filter(Boolean).join('');
  }

  // ---------- NPC ----------
  npcPrompt(v) {
    const c = v.card;
    const system = `你扮演「${c.name}」，只是这一个人，不是叙述者，也不知道别人心里的事。\n身份：${c.public_identity}\n此刻的心思：${c.motive}\n口吻：${c.voice.style}\n口头禅：${c.voice.catchphrases.join(' / ')}\n常用词：${c.voice.lexicon.join('、')}\n禁用词（绝不能出现）：${c.voice.banned.join('、')}\n你的底线：${c.redlines.join('；')}\n你只知道下面这些事。别的你一概不知道；被问到不知道或不想说的事，按你的性子推脱，不许编造任何新的人、事、物、数字：\n${v.knows.map((k) => '- ' + k).join('\n') || '- （没有特别的事）'}\n你亲眼见过的：\n${v.memory.map((m) => '- ' + m).join('\n') || '- （今天还没见过什么）'}${v.lately?.length ? `
你刚才说过的话（换一种说法，不要照搬原句，口头禅不要每句都带）：
${v.lately.map((m) => '- ' + m).join('\n')}` : ''}`;
    const modeText = { greet: '这是你第一次见到他们。用你的方式打个招呼。', smalltalk: '对方说的话你没什么可答的。按你的性子说一两句闲话，不透露任何新事实。', deflect: '对方问到了你不知道或不肯说的事。按你的性子推脱过去，不透露任何新事实，也不要暗示答案。', react: '只用半句到一句话表个态（一个语气、一声应答），不含任何事实、数字、人名、地点。你要说的正事会由别人原样接在后面，你绝对不要自己说，也不要提到这一点。不超过 16 字。', repeat: '这件事你已经说过一遍了。按你的性子表示说过了，不要复述细节。' }[v.mode];
    const tail = c.nonverbal ? '这个人不会说话。只输出一句对他的动作、手势或神情的第三人称描写（用他的称呼开头），不超过 40 字，不写任何台词，不带引号。' : '只输出台词本身，不超过 40 字，不带引号，不写动作和神态。要像这个人张嘴就说出来的话：口语，短，可以只说半句，可以答非所问；不说工整的书面句子，不讲道理，不用比喻。';
    const user = `${v.first ? '这是你第一次见到这几个外乡人。' : ''}地点：${v.sceneName}，${v.clock}。你此刻的情绪：${v.mood}；你对来人的态度：${v.attitudeWord}。\n${v.speakerName}（${v.speakerRole}）对你说：「${v.utterance}」\n【导演指示】${modeText}${v.retry ? `\n上一稿的问题：${v.retry}。请避开。` : ''}\n${tail}`;
    return { system, user };
  }
  npcOffline(v) {
    const c = v.card;
    if (v.mode === 'greet') return pick(c.greet, v.i);
    if (v.mode === 'smalltalk') return v.first ? pick(c.greet, v.i) : pick(c.smalltalk, v.i);
    if (v.mode === 'deflect') return pick(c.deflect, v.i);
    if (v.mode === 'repeat' && c.repeat?.length) return pick(c.repeat, v.i);
    if (v.mode === 'repeat' && c.nonverbal) return pick(c.deflect, v.i);
    if (v.mode === 'repeat') return `${pick(c.voice.catchphrases, v.i)}${c.voice.style.includes('极少') ? '说过了。' : c.voice.style.includes('醉') ? '……说过了……不说第二遍……' : c.voice.style.includes('官样') ? '此事已答复过，不再重复。' : c.voice.style.includes('嘴快') ? '这个我说过了呀，你没数着听？' : '这个我方才说过了，不兴翻来覆去讲的。'}`;
    return '';
  }

  // ---------- AI 寻访者 ----------
  aiPrompt(v) {
    const c = v.card;
    const system = `你扮演寻访者「${c.name}」（${c.role}），是一张桌上的玩家角色之一，不是主持人。\n背景：${c.background}\n执念：${c.drive}\n恐惧源：${c.fear}\n与同伴：${c.relations}\n说话的样子：${c.ai.voice}\n【红线】你只知道下面列出的事，不知道幕后真相；不替同伴做决定，不抢关键抉择，不主动下结论，不指挥别人；不许说出「刚才发生的」里没有的新东西（新的痕迹、人影、物件、声音）——只说你的感受、你记下了什么、或对已知的事的疑问；可以害怕、可以想错、可以把话咽回去。\n【怎么说】你是坐在桌边随口接一句话的人，不是在写文章：口语，短，一句，可以只有半句。不描写景物，不用比喻，不替大家归纳，不问一个听起来很深的问题。想不出要说什么，就说一句眼前的小事（冷、饿、鞋湿了、想走）。\n你目前知道的：\n${v.known.map((k) => '- ' + k).join('\n') || '- （还什么都不知道）'}${v.lately?.length ? `
你刚才说过的话（不要重复其中的句子和口头禅）：
${v.lately.map((m) => '- ' + m).join('\n')}` : ''}`;
    const modeText = { misread: '同伴刚发现了一样东西。按你的性子嘀咕一句你的想法——可以想偏。', retreat: '你害怕了。说一句退缩或给自己壮胆的话，把决定留给同伴。', chatter: '说一句你此刻留意到的小事或心里的不安。', answer: `同伴对你说了这句话：「${v.utterance}」。按你知道的回答；不知道就老实说不知道，不许猜出答案。`, ask: `你想向在场的${v.target}问一句话，关于${v.topic}。只说这一句问话。` }[v.mode];
    const user = `地点：${v.sceneName}，${v.clock}。你的${v.mindName || '定力'} ${v.mind}/${v.mindMax}。\n刚才发生的：\n${v.recent.map((x) => '- ' + x).join('\n') || '- （无）'}\n【指示】${modeText}${v.retry ? `\n上一稿的问题：${v.retry}。请避开。` : ''}\n只输出你说的话，不超过 28 字，不带引号，不写动作。`;
    return { system, user };
  }
  aiOffline(v) {
    const a = v.card.ai;
    if (v.mode === 'misread') return pick(a.misread, v.i);
    if (v.mode === 'retreat') return pick(a.retreat, v.i);
    if (v.mode === 'ask') return `请问……${v.topic}的事，您知道吗？`;
    if (v.mode === 'answer') return v.probe ? pick(own(a.dunno, ['我也想知道啊……我知道的不比你多。真的。']), v.i) : pick(a.chatter, v.i);
    return pick(a.chatter, v.i);
  }

  // 统一入口：返回 { text, source, prompt, ms }。prompt 交回给调用方做上下文审计。
  async generate(role, view, { useModel = true } = {}) {
    const prompt = role === 'narrator' ? this.narratorPrompt(view) : role === 'npc' ? this.npcPrompt(view) : this.aiPrompt(view);
    const offline = () => (role === 'narrator' ? this.narrateOffline(view) : role === 'npc' ? this.npcOffline(view) : this.aiOffline(view));
    // 哪些不交给模型：调查/受阻的引子（所见所得随后原文给出，模型一写就容易和原文打架）、交谈轮的环境句、NPC 的招呼（作者写好的更准）。
    const authored = (role === 'narrator' && ['talk', 'examine', 'blocked', 'wrap'].includes(view.kind)) || (role === 'npc' && view.mode === 'greet');
    if (useModel && this.llm?.enabled && !authored) {
      try {
        const r = await this.llm.complete({ role, system: prompt.system, user: prompt.user, maxTokens: role === 'narrator' ? 260 : 140, temperature: role === 'narrator' ? (['free', 'probe'].includes(view.kind) ? 0.55 : 0.7) : 0.85 });
        let text = r.text.replace(/^["“「『]+|["”」』]+$/g, '').replace(/^(叙述|旁白|台词|输出)[:：]\s*/, '').replace(/\n+/g, '').trim();
        if (role === 'narrator' && view.beat && false) text += view.beat;
        return { text, source: r.provider, prompt, ms: r.ms, usage: r.usage };
      } catch (e) { return { text: offline(), source: 'offline', fallback: String(e.message).slice(0, 120), prompt }; }
    }
    return { text: offline(), source: 'offline', prompt };
  }
}
