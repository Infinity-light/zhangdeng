# module.spec 字段说明

`module.spec.json` 是编译器的产物，也是开团的唯一依据。它可以在审阅页逐项修改，也可以在「完整 JSON」页整份编辑、下载、再导入。下面按顶层字段逐个说明。标 **真相** 的字段只有导演层读得到，永远不会进入 NPC、AI 寻访者或叙述层的上下文。

## 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `spec_version` | string | 目前是 `"1"` |
| `reviewed` | boolean | 编译产物恒为 `false`。审阅页点「确认」后才变 `true`；服务端拒绝用 `false` 的 spec 开团 |
| `source` | object | `name` 源文件名，`chars` 字数，`compiler` 为 `markdown` 或 `model:<模型名>`；模型抽取时另有 `stages`（每一段的模型、耗时、是否重试）和 `raw`（四段原始输出，便于核对） |
| `assembly_notes` | array | 只有自由文本抽取的产物有：组装时替模型补了什么、改了什么。校验时原样列进 `issues` |
| `issues` | array | 校验结果，`{ level: "error"｜"warn", where, msg }`。有 `error` 不能开团 |
| `meta` | object | 元数据，见下 |
| `constitution` | object | 冻结宪法，见下 |
| `scenes` `clues` `npcs` `triggers` `endings` `key_choices` `pregens` | array | 见各节 |
| `truth` | object | **真相** 层，见下 |

## meta 元数据

| 字段 | 说明 |
|---|---|
| `title` | 标题 |
| `players` `era` `place` `duration` | 推荐人数、时代、地点、预计时长 |
| `rulepack` | 规则包目录名，如 `chaohen-v1` |
| `horror_level` `content_warnings[]` | 恐怖尺度与内容安全提示 |
| `start_clock` | 开场时间，单位是「当天零点起的分钟数」。16:00 = 960。过了午夜继续累加（24:40 = 1480） |
| `start_scene` | 开场场景 id |
| `opening` | 开场白，开团时原文投放 |

## constitution 冻结宪法

每一轮都固定放在叙述层上下文的最前面，不参与任何摘要与滚动。

| 字段 | 说明 |
|---|---|
| `tone` | 世界观基调 |
| `style_bans[]` | 语气禁令 |
| `immutable_facts[]` | 不可变事实清单：防漂移的锚点 |
| `travel[]` `free[]` `probe[]` | 可选。离线演员在赶路、自由行动、对空发问时用的备用句；空着就用中性句 |

## scenes[] 场景图

| 字段 | 说明 |
|---|---|
| `id` `name` `aliases[]` | 编号、名称、玩家可能用到的叫法（意图识别靠它） |
| `kind` | `main` 主场景 / `side` 侧支地点（在侧支地点的行动记为跑偏） |
| `exits[]` | 可去的场景 id |
| `npcs[]` | 常在此处的 NPC id（实际位置以状态库为准） |
| `goal` | 本幕目标，写进导演单 |
| `public_desc` | 公开描述，首次进入时原文投放 |
| `beats[]` `press_beats[]` | 氛围句与加压氛围句，由导演层不重复地发给叙述层 |
| `interactables[]` | 可调查的东西，见下 |

### interactables[] 可调查项（检定点在这里）

| 字段 | 说明 |
|---|---|
| `id` `name` `keywords[]` | 玩家的话里出现任一关键词就认作调查它 |
| `obvious` | 是否在场景面板的「看得见的东西」里列出 |
| `requires` | 前置条件（条件原子数组，见文末） |
| `blocked_text` | 条件不满足时原文投放的文字 |
| `bypass_check` `bypass_flag` | 绕行检定 `{skill, tier}`：玩家表示硬来时掷；成功则置 `bypass_flag` |
| `check` | 检定 `{ skill, tier, bonus?, penalty? }`，`tier` 为 普通 / 困难 / 极难；`skill` 可以是技能名、别名或属性名；`bonus` / `penalty` 是奖励骰 / 惩罚骰的枚数 |
| `phase_floor` | 可选。调查成立后张力相位至少抬到这一档（加压 / 对抗 / 揭示） |
| `fail_text` `fail_attitude` | 失败后果文字；`{npc, delta}` 让某 NPC 态度变化 |
| `mind` | 心智检定（定力 / 理智）`{ success, fail }`，各是一个骰式，如 `"1"`、`"1d6"`、`"1d4+1"` |
| `text` | 调查成立时原文投放的内容 |
| `clue` `carrier` | 给出的线索 id 与载体 id |
| `set_flag` `give_item` | 成立时置的 flag、给的物品 |
| `minutes` | 耗费的故事时间 |

## clues[] 线索链

| 字段 | 说明 |
|---|---|
| `id` `name` | 编号、名称 |
| `content` | 线索的事实摘要：进线索板；淡化模式下代替具体描写 |
| `scene` `points_to` | 所在场景、指向的场景 |
| `key` | 是否关键线索。AI 寻访者不会揭开关键线索；柔性补线只补关键线索 |
| `give_item` | 得到线索的同时得到的物品 |
| `carriers[]` | 投放载体。第一种是原始载体，其余是备用投放形式 |

### carriers[] 载体

| 字段 | 说明 |
|---|---|
| `id` | 载体编号，全局唯一 |
| `form` | 形式的人话描述（「一通打错的电话」），Replay 里显示 |
| `where` | 可投放的场景 id，或 `any` |
| `via` | `可调查:<id>` / `NPC:<id>` / `事件`。只有「事件」型能在玩家跑偏时由导演主动送达 |
| `when` | 可选的额外条件（如子时之前不放） |
| `text` | 事件型载体原文投放的文字 |

## npcs[] NPC 卡

| 字段 | 说明 |
|---|---|
| `id` `name` `aliases[]` | 编号、姓名、叫法 |
| `public_identity` | 公开身份 |
| `true_identity` | **真相**。不进任何演员上下文 |
| `motive` | 动机（进该 NPC 自己的上下文） |
| `home` | 常驻场景 |
| `attitude_init` `mood_init` | 对寻访者的初始态度（整数，-3 到 4）与情绪 |
| `voice` | 人设锚：`style` 口吻、`catchphrases[]` 口头禅、`lexicon[]` 常用词、`banned[]` 禁用词（出现即被闸门打回） |
| `redlines[]` | 行为红线 |
| `greet[]` `smalltalk[]` `deflect[]` | 招呼、闲谈、推脱的备用台词。离线演员直接用；模型在场时作为口吻样例 |
| `knowledge[]` | 知识边界，见下 |

### knowledge[] 知识项

| 字段 | 说明 |
|---|---|
| `id` `title` `topics[]` | 编号、标题、话题关键词（玩家的话命中即触及） |
| `share` | `free` 随口可说 / `trust` 态度达到门槛或被出示线索才说 / `never` 绝不说。`never` 项 **不会进入** 这个 NPC 的演员上下文 |
| `trust_min` | 信任门槛。不够时掷话术，成功则态度上升 |
| `show_clue` | 寻访者已掌握这条线索时，直接肯说 |
| `say` | 他会怎么说。作为原文投放，保证事实不走样 |
| `gives_clue` `carrier` `set_flag` `give_item` | 说出口时附带的线索、flag、物品 |

## truth 真相层（全部为 **真相**）

| 字段 | 说明 |
|---|---|
| `summary` | 幕后真相 |
| `entity` | 怪物与神话存在的说明和数据 |
| `timeline[]` | 真实时间线 `{ when, what }` |
| `never_reveal[]` | 不可泄露清单 `{ id, text, keywords[], unlock }`。`keywords` 是泄露过滤器扫描的词；`unlock` 是线索 id（玩家发现它之后解锁），`null` 表示永不 |

## triggers[] 触发器

| 字段 | 说明 |
|---|---|
| `id` `name` | 编号、名称 |
| `when` | 条件原子数组（时间驱动、地点驱动、行为驱动都用它表达） |
| `once` | 恒为 `true`：每个触发器只响一次 |
| `effects[]` | 效果字符串：`flag:名=值`、`阶段:加压`、`定力检定:全体:成功损失/失败损失` |
| `public_text` | 触发时原文投放的文字 |
| `kp_note` | 导演注，只进导演单 |

## endings[] 结局条件

| 字段 | 说明 |
|---|---|
| `id` `name` `text` | 编号、名称、结局文本 |
| `when_any[]` | 若干组条件，任一组全部成立即达成。结局判定只认这里，叙述层无权另编 |

## key_choices[] 关键抉择

| 字段 | 说明 |
|---|---|
| `id` `name` `requires` | 编号、名称、出现条件 |
| `hint` | 可选。一句世界内的话：这个抉择已经做得成（条件里除了「人在哪儿」还有线索、物品或 flag）、玩家却连着两轮没碰它时，掌灯人说出来；隔六轮才会再说一次。不写就用一句通用的 |
| `options[]` | `{ id, keywords[], set_flag, label }`。玩家的话命中关键词即记为做出该选择；AI 寻访者的话永远不算 |

## pregens[] 预设寻访者

`id` `name` `role`、`attrs_named`（属性名 → 数值）、`skills_named`（技能名 → 数值，未列出的取规则包基础值）、`background` `drive`（执念）`fear`（恐惧源）`relations` `items[]`，以及 `ai`：该角色由 AI 扮演时的口吻 `voice` 与离线台词池 `misread[]`（误读）`retreat[]`（退缩）`chatter[]`（闲话）。

## 条件原子

条件是一个数组，数组内全部成立才算成立。每个原子：

| 写法（Markdown） | JSON | 含义 |
|---|---|---|
| `flag:名` | `{ "t":"flag", "k":"名" }` | 该 flag 已置 |
| `线索:C1` | `{ "t":"clue", "k":"C1" }` | 线索已被发现 |
| `物品:灯塔钥匙` | `{ "t":"item", "k":"灯塔钥匙" }` | 任一寻访者持有 |
| `场景:dock` | `{ "t":"scene", "k":"dock" }` | 当前在该场景 |
| `时间>=23:30` / `时间<22:00` | `{ "t":"time", "op":">=", "v":1410 }` | 故事时间 |
| 前面加 `!` | `"neg": true` | 取反 |

## 存档文件（`zhangdeng.session/1`）

「全量数据 → 存档」导出的 JSON：`spec`（上面这一整份）、`config`（种子、席位、各项设置）、`branches`（每条分支的 `parent`、`state` 当前状态、`log[]` 只追加日志、`snapshots{}` 每轮末的状态快照，含随机源状态）、`saves[]`、`current`。导入时逐分支验日志哈希链，验不过会拒绝。


## npcs[] 里后加的两个字段

| 字段 | 说明 |
|---|---|
| `nonverbal` | 这个人不会说话。他的台词按动作描写生成和显示（不加引号），模型提示也相应改变 |
| `repeat[]` | 被问到已经说过的事时的回应；空着就按口吻套一句通用的 |

## 规则包 rulepack.json

规则包不是 spec 的一部分，但 spec 的 `meta.rulepack` 指向它。一个规则包一个目录：`rulepacks/<id>/rulepack.json`。

| 字段 | 说明 |
|---|---|
| `id` `name` `note` | 目录名、显示名、一句说明 |
| `terms` | 叫法：`keeper` 主持人、`pc` 玩家角色、`hp` 生命、`mind` 心智、`bonus` / `penalty` 加骰、`push` 孤注一掷、`disorder` 心智失常。界面、日志、Replay 都跟着它走 |
| `attributes[]` | `{ id, name, aliases[] }`。引擎会用到的 id：`str`、`con`、`dex`、`int`（其余随意） |
| `derived` | `hp_max`、`mind_start` 两个算式，变量是属性 id，可用 `round` `floor` `ceil` |
| `check` | `tiers` 三档难度的名字与系数；`crit_max` 大成功上限；`fumble_min` 大失败下限；`fumble_min_when_target_below` 目标值低于某数时的大失败下限；`levels` 各成功等级的叫法 |
| `mind` | `bout_threshold` 单次损失达到多少触发智力检定；`long_fraction` 一天累计损失达到当日初值的几分之几算长期；`bout_duration` 临时状态持续几轮（骰式）；`pass` / `fail` / `permanent_text` 文案 |
| `combat` | `initiative_attr` 先攻看哪个属性；`major_wound_fraction` 单次伤害达到生命上限的几分之几算重伤；`damage_bonus_attrs` 伤害加值看哪些属性之和；`damage_bonus[]` 加值表 `{ max, bonus }` |
| `growth` | `gain` 成长骰式 |
| `social_skill` | 说动 NPC 时掷哪个技能（技能 id） |
| `skills[]` | `{ id, name, base, aliases[] }`。引擎会用到的 id：`dodge`、`brawl`、`firearm`，以及 `social_skill` 指到的那个 |
| `weapons[]` | `{ id, name, skill, damage, range, ammo?, note? }`，第一项当作徒手 |
| `rites[]` `relics[]` | 法术表与神话物品表：`{ id, name, cost_mind?, effect }`。目前只是数据，供掌灯人查阅，效果没有接进流程 |
| `disorder_short[]` `disorder_long[]` | 临时 / 长期症状表，触发时由引擎掷一条 |
