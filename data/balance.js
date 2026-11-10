/* 单骑 · 汉字塔防 —— 数值表
 * 约定：所有可调的"游戏数值"都放这里，代码里只读 DATA，不写死数字。
 * 数值来源：docs/GDD.md 第 8.1 节（兵种 Lv1 属性）与第 4、5、6 节（敌人 / 阿斗 / 馒头）。
 */
(function (global) {
  'use strict';

  var DATA = global.DATA = global.DATA || {};

  DATA.balance = {
    // 数值表结构版本。改动字段时 +1，存档靠它判断要不要迁移。
    version: 10,

    /* ===== 经济：馒头 ===== */
    economy: {
      startBun: 20,        // 开局馒头（个）
      killBun: 1,          // 击杀 1 只敌人奖励（馒头）
      leakBun: 5           // 漏 1 只敌人补偿（馒头，硬规则：必须 5）
    },

    /* ===== 阿斗：漏怪点 ===== */
    lives: {
      hearts: 3,           // 显示心数（颗，硬规则：3）
      leaksPerHeart: 2,    // 每碎 1 颗心需要的漏怪数（只）
      leakPoints: 6        // 总漏怪点（硬规则：3 心 × 每心 2 漏 = 6）
    },

    /* ===== 敌人与波次（GDD 4.1）===== */
    wave: {
      /* 加餐 C：无限波，不再有总波数 / 对局时限。谁先漏光 6 点谁输。 */
      firstDelaySec: 8,        // 开局到第 1 波的准备时间（秒）
      intervalSec: 17,         // 波与波之间的固定间隔（秒）
      spawnIntervalSec: 0.8,   // 波内出怪间隔（秒/只）
      baseCount: 6,            // 第 1 波只数
      countPerWave: 1,         // 每多一波多几只
      maxCount: 20,            // 单波只数上限（数量封顶，血量继续外推）
      /* baseHp 历史：80（Day 21 前）→ 64（Day 21 sim）→ 82（Day 26 补丁 2 新射程补量）
       * → 104（加餐 D：金卡 65%→35% + 武将 DPS 砍到约 2 倍 Lv1 兵后，双方中后期输出
       * 都掉了一截，波次压力必须补回来，否则局长 170s、困难只有 19%）。
       * 200 局/档：81.5 / 45.5 / 33.5，普通局长 149.6s。 */
      baseHp: 104,             // 第 1 波血量
      /* 加餐 D：0.30→0.45。金卡率 65%→35%、武将 DPS 砍半后中期输出下滑，
       * 靠线性项把第 6–10 波的压力补回来（曲线项不动，避免后期陡成墙）。 */
      hpLinear: 0.45,          // 线性增长系数：× (w-1)
      hpCurveStart: 6,         // 从第几波开始叠曲线
      hpCurvePower: 1.6,       // 曲线指数
      hpCurveFactor: 0.2,      // 曲线系数
      speedCellsPerSec: 1,     // 普通敌人移速（格/秒）
      /* 加时赛：6 分钟后开始的每一波，血量再乘 1.05（逐波叠加），保证无限波一定分胜负。 */
      overtimeStartSec: 360,   // 从第几秒之后开的新波进入加时（秒）
      overtimeHpPerWave: 0.05, // 加时每波额外血量比例（0.05 = +5%，逐波复利）
      clearBonusBase: 6,       // 每波清完奖励 = base + perWave × w
      clearBonusPerWave: 2,
      bossEvery: 6,            // 每 6 波（6/12/18…）额外出一只 BOSS「将」
      /* 加餐 D：5.5→4.5。5.5 倍时正常兵阵磨不动，等于逼玩家必须带武将；4.5 倍留在
       * 「满级兵阵能磨死、但会吃掉大半波时间」的区间，BOSS 是压力点而不是门槛。 */
      bossHpMul: 4.5,          // BOSS 血量 = 该波普通卒血量 × 4.5（随波次涨）
      boss: {
        char: '将',
        /* 加餐 D：0.6→0.75。BOSS 4.5× 血走得太慢会横跨两波，把第 7 波压成漏怪尖峰
         * （普通档第 7 波 2.03、第 8 波 0.74）；提速后 1.36 / 0.91，曲线平了。 */
        speedCellsPerSec: 0.75
      },
      /* 单波微调（Day 24.5 平衡）：只写需要覆盖的那一波的 count / hp / spawnIntervalSec，
       * 不写就完全走上面的整体公式。改这里不会动到 baseHp / hpLinear / countPerWave 曲线。
       * 第 2 波原血量 83 偏高、简单档两侧合计漏 4.08；降到 72 后 0.60，且三档胜率仍达标。 */
      waveOverrides: {
        /* 开局 0 兵（B4）后第 1 波太脆：6 只降到 5 只，两侧合计漏怪 2.10→1.78。 */
        1: { count: 5 },
        2: { hp: 72 }
      }
    },

    /* ===== 兵种 Lv1：数值取自 GDD 8.1 =====
     * attack 决定结算方式，combat.js 按它分派：
     *   single     单体
     *   line       主目标按射程选，随后沿路径向前穿透，最多 pierceMax 个（含主目标），后续目标不再单独检查射程
     *   projectile 弹道，飞行 flightSecMin ~ flightSecMax 秒后命中
     *   splash     主目标 + 周围 splashRadius 格内，合计最多 splashMax 个（含主目标）
     */
    units: {
      blade: {
        kind: 'blade', char: '刀', attack: 'single',
        range: 2.0, damage: 16, intervalSec: 0.75
      },
      spear: {
        kind: 'spear', char: '枪', attack: 'line',
        range: 2.6, damage: 22, intervalSec: 1.00,
        pierceMax: 2,           // 一条线上最多打几个（含主目标）
        // 穿透会打到主目标前方最多 range+1.2 格的敌人，后续目标不再单独查射程——这是有意设计。
        // 写成"相对射程的增量"而不是固定值：以后武器/道具加射程时，穿透距离自动同步变长。
        pierceGapBonus: 1.2
      },
      bow: {
        kind: 'bow', char: '弓', attack: 'projectile',
        range: 3.2, damage: 12, intervalSec: 0.60,
        flightSecMin: 0.15,     // 打最近目标时的飞行时间（秒）
        flightSecMax: 0.25      // 打最远目标时的飞行时间（秒）
      },
      ride: {
        kind: 'ride', char: '骑', attack: 'splash',
        range: 2.4, damage: 30, intervalSec: 1.20,
        // 1.6 格：正常出怪间距是 1.2 格，半径必须大于它才够得到相邻敌人，
        // 留 0.4 格余量给路径拐弯处的实际距离误差。
        splashRadius: 1.6,
        splashMax: 3            // 合计最多打几个（含主目标）
      }
    },

    /* ===== 开局预置的 3 个 Lv1 兵 ===== */
    /* 开局预置兵（Day 25 续 3 · B4）：按原版改为 0 兵，双方从空棋盘起步。
     * 位置由 board.startCells(side) 给，这里的 cell 只是历史字段、代码不再读。
     * 想恢复预置就往数组里加 { kind: 'blade' } 这样的项。 */
    startUnits: [],

    /* ===== 主循环 ===== */
    loop: {
      stepHz: 60,            // 固定步长频率（次/秒）
      maxDtSec: 0.1          // 单帧最大步长，切后台回来不跳帧
    },

    /* ===== 飘字 ===== */
    float: {
      lifeSec: 0.9,          // 飘字存活时间（秒）
      riseCellsPerSec: 0.8   // 飘字上升速度（格/秒）
    },

    /* ===== 攻击表现（线 / 弧 / 命中点）===== */
    fx: {
      lineLifeSec: 0.18,     // 枪：贯穿线停留时间（秒）
      arcLifeSec: 0.22,      // 骑：范围弧停留时间（秒）
      hitLifeSec: 0.12,      // 刀：命中点停留时间（秒）
      borderWidth: 6,        // 漏怪时四周朱砂边框的线宽（px）
      borderInset: 4         // 边框距画布边缘（px），约为线宽的一半，避免被裁
    },

    /* ===== 阿斗表现：抖动 / 碎心 ===== */
    adu: {
      shakeSec: 0.4,          // 普通漏怪抖动时长（秒）
      shatterSec: 0.55,       // 碎心那次的抖动时长（秒），比普通更长
      shakeAmpCells: 0.055,   // 普通抖动幅度（格）
      shatterAmpCells: 0.11,  // 碎心抖动幅度（格），约为普通的两倍
      shakeSpeed: 55,         // 抖动频率（弧度/秒）
      flashAlpha: 0.5         // 朱砂边框最亮时的透明度（0~1）
    },

    /* ===== 对手 AI（Day 17：合成 / 挖格 / 三档难度）=====
     * AI 和玩家走同一套规则：征兵扣钱、抽 5 张、整席替换，放兵要过格子检查。
     * Day 24.5 起三档难度由「挖格能力 digCap + 决策间隔 + 失误率」共同决定，
     * 不改任何游戏规则；合成优先开关见 mergeFirst。
     */
    ai: {
      default: 'normal',       // 默认难度
      hoardFactor: 3,          // 馒头超过「下次征兵费 × 这个数」就连续征兵
      maxSleepingChars: 3,     // AI 场上最多留几张配不上对的休眠单字（张），防止把棋盘塞满
      /* 散字优先放「离路径最远」的空格，把贴路的格子留给近战兵（Day 25 续 B2）；
       * false = 旧的贴路挑法。sim：开启后武将 0.56/0.63/0.71 → 0.59/0.67/0.72，胜率仍达标。
       * maxSleepingChars 保持 3：试到 2 虽能把武将推到 0.7–0.9，但局长涨到 150+、
       * 普通胜率掉到 37%，故本轮不降。 */
      sleepPreferFar: true,

      /* 难度旋钮 = digCap（整局最多挖开几个绿格）。
       * 8×10 棋盘每半只有 6 个白格，旧的 maxUnits(3/9/18) 全被 6 格卡死、三档没区别；
       * 现在能挖开几格就多几个位置放兵，火力天花板由 digCap 决定。
       * hard 挖格时同样优先挑离路径最近的绿格（ai.digOne 已有此规则）。 */
      levels: {
        /* 加餐 E2：4.0→5.0。铲子卡片化后玩家每局要花 3.5 张卡挖格，简单档
         * 需要再让一点节奏：200 局简单胜率 72.0%→75.0%（800 局 71.3→72.6）。 */
        easy:   { label: '简单', intervalSec: 5.0, mistakeRate: 0.45, digCap: 1 },
        /* Day 25 续 3（B4）：开局 0 兵后重新调过。normal 3→4 把普通档拉回 45–55，
         * hard 6→8 把困难档从 33 压到 28（400 局/档复验仍达标）。 */
        normal: { label: '普通', intervalSec: 2.0, mistakeRate: 0.15, digCap: 4 },
        /* 加餐 D：hard 6→5。武将 DPS 砍半后困难档的挖格优势更明显（6 格时胜率 19%），
         * −1 格配合 baseHp 107 拉回 34.0%。 */
        /* 加餐 E2：1.2→1.6。铲子卡片化后每次决策都会「先挖格再征兵」，
         * 决策太密等于频繁整席刷新、把卡浪费在挖格上；放慢到 1.6s 后
         * 800 局困难胜率 41.0%→37.9%（每局少一次冲动刷新）。 */
        /* 加餐 E3：失误率 0.03→0.02 + digCap 5→6（困难压回 ≤35%），数值定稿。
         * 铲子卡片化后挖格要花卡，多一格就是多一个能放兵的位，困难才重新比普通强。 */
        hard:   { label: '困难', intervalSec: 1.6, mistakeRate: 0.02, digCap: 6 }
      },

      // 合成优先：每轮先合完（含备战席卡叠到场上兵）再征兵 / 放兵，避免整席替换浪费可合的卡
      mergeFirst: true,

      // 犯错时具体错在哪：每轮先掷一次"是否犯错"，犯错再等概率挑一种。
      //   skipMerge    有可合成对也放着不合
      //   bowOutside   把弓当近战放，丢到外圈
      //   skipRecruit  有钱也不征兵
      //   skipDig      有铲子也忘记挖绿格
      mistakes: ['skipMerge', 'bowOutside', 'skipRecruit', 'skipDig']
    },

    /* ===== 武将（GDD 9.2，MVP 做 6 个：3 金 + 3 紫）=====
     * 两张单字按「姓在左、名在右」相邻摆放 → 自动觉醒成武将。
     * 数值口径：dps 是每秒伤害（GDD 9.2 表头就是 DPS），intervalSec 是攻击间隔（秒），
     *           range 是射程（格）。单次伤害不写在这里——由 state.makeHero 用
     *           Math.round(dps × intervalSec) 算出来，避免以后只改一个字段就对不上。
     * slots 是占格数：所有武将都占 2 格（左姓、右名），觉醒后两张单字的位置都归它。
     * quality 是品质：gold 金 / purple 紫，只影响边框颜色和一眼的强弱预期，
     *                 真正的强弱看 dps（加餐 D 后金 42~50、紫 38~42，约 Lv1 兵的 2 倍）。
     * skill 是整套技能参数；紫将这一版还没做技能，写成 null（tickHeroes 会跳过）。
     *
     * skill 字段说明（纯数据，代码里不写死任何数字）：
     *   kind         dash 沿路径突进 / stun 全屏眩晕 / volley 全屏伤害 + 灼烧
     *   cdSec        冷却（秒），对应 GDD 9.2 的 CD 列
     *   damageMul    伤害倍率：单次伤害 = 武将 damage × 这个数
     *   hits/gapCells/halfWidthCells  突进次数 / 相邻两段间距（格）/ 每段覆盖带宽的一半（格）
     *   stunSec      眩晕时长（秒），实际时长会被敌人的免控抗性打折
     *   burnSec      灼烧持续时间（秒）
     *   burnDpsRatio 灼烧每秒伤害 = 武将 damage × 这个数
     */
    heroes: {
      list: [
        {
          key: 'zhaoyun', surname: '赵', given: '云', name: '赵云', quality: 'gold',
          dps: 50, range: 1.8, intervalSec: 0.7, slots: 2,
          skill: {
            kind: 'dash', name: '七进七出', cdSec: 18,
            hits: 7,               // 段数：固定 7 段（路径不够长时缩间距，不缩段数）
            damageMul: 2,          // 每次 2× 普攻伤害
            gapCells: 1.0,         // 相邻两段的路径间距（格）
            halfWidthCells: 0.45,  // 每段覆盖的路径带宽的一半（格），带内的敌人全吃
            stepSec: 0.14          // 每段间隔（秒）：7 段约 1 秒依次打出去
          }
        },
        {
          key: 'zhangfei', surname: '张', given: '飞', name: '张飞', quality: 'gold',
          dps: 42, range: 1.6, intervalSec: 1.2, slots: 2,
          skill: {
            kind: 'stun', name: '当阳爆喝', cdSec: 20,
            stunSec: 2.5           // 全屏眩晕（秒），被免控抗性打折后才是实际时长
          }
        },
        {
          key: 'huangzhong', surname: '黄', given: '忠', name: '黄忠', quality: 'gold',
          dps: 46, range: 2.6, intervalSec: 1.0, slots: 2,
          skill: {
            kind: 'volley', name: '万箭齐发', cdSec: 22,
            damageMul: 1,          // 全屏 1.0× 普攻伤害
            burnSec: 3,            // 灼烧持续 3 秒
            burnDpsRatio: 0.5      // 灼烧每秒 = 武将 damage × 0.5（黄忠 46 → 23/秒）
          }
        },

        /* ---- 紫色品质：只有普攻，技能留空（GDD 9.2 里排在后面）---- */
        {
          key: 'guanping', surname: '关', given: '平', name: '关平', quality: 'purple',
          dps: 38, range: 1.8, intervalSec: 1.0, slots: 2,
          skill: null              // 紫将技能未实现
        },
        {
          key: 'zhangbao', surname: '张', given: '苞', name: '张苞', quality: 'purple',
          dps: 40, range: 1.8, intervalSec: 1.0, slots: 2,
          skill: null
        },
        {
          key: 'huanggai', surname: '黄', given: '盖', name: '黄盖', quality: 'purple',
          dps: 42, range: 2.0, intervalSec: 1.1, slots: 2,
          skill: null
        }
      ]
    },

    /* ===== 技能通用参数（三个武将共用、不随人变的那几个）=====
     * 免控抗性：同一个敌人每被控一次 +tenacityStep，最多到 tenacityMax。
     * 也就是说张飞的眩晕对同一个敌人会越来越短：2.5s → 2.25 → 2.0 → … 最低 1.0s。
     */
    skills: {
      tenacityStep: 0.10,        // 每次被控后抗性增加量（10%）
      tenacityMax: 0.60,         // 抗性上限（60%，眩晕最短只到原来的 40%）
      fx: {
        dashHitLifeSec: 0.14,    // 七进七出：单段横杠的停留时间（秒）。等于段间隔，所以同时只亮一道
        dashTickCells: 0.7,      // 七进七出：每道横杠有多长（按格子宽算，约 43px；转方向长度不变）
        dashRingFrom: 0.15,      // 七进七出：命中扩散环的起始半径（格）
        dashRingTo: 0.35,        // 七进七出：命中扩散环的终止半径（格）
        roarLifeSec: 0.50,       // 当阳爆喝：声波环扩散时间（秒）
        volleyLifeSec: 0.45,     // 万箭齐发：箭线停留时间（秒）
        volleyArrows: 12         // 万箭齐发画几条箭线（纯视觉，不影响伤害）
      }
    },

    /* ===== 局外循环：金币与军衔（GDD 11.1 / 11.2）=====
     * 本轮只用内存变量保存，刷新会丢；明天再接 localStorage。
     * ranks 数据驱动：加一段只改数组，src/meta.js 不用动。
     */
    meta: {
      startGold: 0,            // 新档初始金币（个）
      winGold: 100,            // 胜利奖励金币（个）
      loseGold: 40,            // 失败奖励金币（个，不论胜负都给）
      starsPerRank: 3,         // 每段需要的星数（颗）
      ranks: [
        '军士', '什长', '百夫长', '校尉', '中郎将', '将军',
        '大将军', '大司马', '丞相', '诸侯', '皇帝'
      ],                       // 11 段军衔，从低到高
      saveVersion: 1,          // 存档结构版本；加字段时 +1，靠 src/save.js 的 migrate 升级
      dropSeed: 20261108       // 新档掉落随机种子（seeded rng，刷新后从存档续上）
    },

    /* ===== 武器（GDD 11.3 简版：绿 / 蓝 / 紫，不做白 / 金、不做出售与合成）=====
     * 一件武器只加「它绑定的那个武将」的伤害，不改射程、攻速、技能范围。
     * bonus 是伤害倍率增量：damage = dps × intervalSec × (1 + bonus)。
     * 胜利掉 1 把：先按 dropChance 抽品质，再从该品质里等概率抽一件。
     */
    weapons: {
      dropChance: { green: 70, blue: 25, purple: 5 },   // 品质概率（%），合计 100
      qualityName: { green: '绿', blue: '蓝', purple: '紫' },
      qualityColor: { green: '#3F7D52', blue: '#3A6EA5', purple: '#8E6BB8' },
      list: [
        { id: 'g1', name: '青锋剑',   quality: 'green',  bonus: 0.10 },
        { id: 'g2', name: '环首刀',   quality: 'green',  bonus: 0.10 },
        { id: 'g3', name: '木胎弓',   quality: 'green',  bonus: 0.10 },
        { id: 'b1', name: '雁翎刀',   quality: 'blue',   bonus: 0.20 },
        { id: 'b2', name: '铁胎弓',   quality: 'blue',   bonus: 0.20 },
        { id: 'b3', name: '长戟',     quality: 'blue',   bonus: 0.20 },
        { id: 'p1', name: '丈八蛇矛', quality: 'purple', bonus: 0.35 },
        { id: 'p2', name: '青龙偃月刀', quality: 'purple', bonus: 0.35 }
      ]
    },

    /* ===== 画风（docs/ART.md，Day 24 P0；纯表现参数，不参与任何玩法判定）===== */
    art: {
      palette: {                     // ART.md 3.1 色板：纸 / 墨 / 朱砂 / 少量金
        paper: '#F3EBD9',            // 宣纸
        paperDark: '#E4D6BC',        // 纸暗部
        ink: '#1C1914',              // 墨黑
        lightInk: '#4B453B',         // 淡墨
        cinnabar: '#B23A2B',         // 朱砂
        cinnabarLight: '#D4674F',    // 朱砂亮
        gold: '#C9A227',             // 金（Lv5 / 金品质）
        purple: '#8E6BB8',           // 紫（紫品质）
        teal: '#4A6F63'              // 青（绿格，极少量冷色）
      },
      paper: {
        seed: 20261108,              // 纹理随机种子（seeded rng，程序化生成可复现）
        noiseCount: 12000,           // 噪点数（个，只生成一次）
        noiseAlphaMin: 0.015,        // 噪点最低透明度
        noiseAlphaMax: 0.045,        // 噪点最高透明度
        noiseRgb: '60,50,35',        // 噪点颜色（rgb 三段）
        fiberCount: 50,              // 纤维条数（条）
        fiberMinLen: 20,             // 纤维最短长度（px）
        fiberMaxLen: 100,            // 纤维最长长度（px）
        fiberColor: 'rgba(90,75,55,0.05)',
        stainCount: 6,               // 水渍个数（个）
        stainMinR: 60,               // 水渍最小半径（px）
        stainMaxR: 200,              // 水渍最大半径（px）
        stainColor: 'rgba(150,120,70,0.05)',
        vignetteInner: 0.35,         // 暗角内圈（× 画布高）
        vignetteOuter: 0.85,         // 暗角外圈（× 画布高）
        vignetteColor: 'rgba(60,45,25,0.16)'
      },
      glyph: {
        cacheSize: 96,               // 离屏字缓存边长（逻辑 px，高分屏按 DPR 放大）
        weight: 400,                 // 字重：楷体本身笔画清楚，不加粗（ART.md 3.5 修订）
        unitSize: 26,                // 兵种单位字字号（px，格 62×48 放得下）
        paperStrokeWidth: 3.2,       // 纸色外圈线宽（px）：只留白，不描墨边
        inkEdgeWidth: 0,             // 墨色描边（px）；24–26px 小字不用 2.5px 墨边，最多调到 0.8
        fontStack: '"KaiTi","STKaiti","Kaiti SC","Songti SC","SimSun","Noto Serif SC",serif'
      },
      /* 等级环 / 等级点已于 Day 26 补丁整体删除（原 art.rank 段）。
       * 等级视觉只剩左上角数字角标，参数全部归到下面的 art.figure.badge*。 */

      /* 加餐 E：备战席铲子卡的程序化图标（Canvas 手绘，不引图片）。
       * 画风对照 ref/3.jpg：短木柄 + 深灰铲头 + 粗黑描边 + 底部淡阴影。
       * 几何值都是「图标边长」的比例（0~1），换尺寸不用改代码。 */
      bench: {
        shovel: {
          wood: '#C98A4B',             // 木柄主色
          woodEdge: '#8A5A2B',         // 木柄暗面
          head: '#7C8792',            // 铲头深灰
          headLight: '#98A2AC',       // 铲头受光面
          outline: '#1C1914',         // 粗黑描边（约 2px）
          outlinePx: 2,               // 描边线宽（px，不随字号缩放）
          shadow: 'rgba(28,25,20,0.16)', // 底部淡阴影
          iconRatio: 0.66,            // 卡面尺寸占比（卡宽 × 该比例）
          handleWidth: 0.10,          // 木柄宽度（× 图标边长）
          handleX1: 0.50, handleY1: 0.47,  // 木柄下端（插进铲头）
          handleX2: 0.80, handleY2: 0.18,  // 木柄上端
          headCx: 0.41, headCy: 0.64, // 铲头中心
          headW: 0.40, headH: 0.36    // 铲头宽 / 高（× 图标边长）
        }
      },

      /* Day 27：开场「斗」字入场（ART.md 3.10）。p 是 0→1 的单一时间轴，
       * 下面所有时间点都是「占总时长的比例」，改 durSec 会整体缩放。 */
      intro: {
        enabled: true,               // 关掉就跳过入场，直接进战斗
        durSec: 1.5,                 // 总时长（秒，任务要求 1.2–1.8）
        char: '斗',                  // 入场的字
        glyphSize: 116,              // 屏幕基准字号（px）
        zoomFrom: 1.8,               // 出现时的初始缩放（1.8→1）
        flyScale: 0.55,              // 落到终点时缩到的比例
        centerY: 0.42,               // 起始位置（× 视口高）；0.5 才是正中，稍上更顺眼
        arcLift: 0.26,               // 弧线抬升（× 视口高）
        riseEnd: 0.28,               // 放大出现结束（占总时长比例）
        flyEnd: 0.74,                // 飞到终点结束
        landEnd: 0.86,               // 墨爆结束
        fadeStart: 0.82,             // 纸底开始淡出
        paperIn: 0.08,               // 纸底淡入
        trailGap: 0.055,             // 拖尾相邻残影的进度差
        trailAlpha: 0.20,            // 拖尾最远处的不透明度
        shakePx: 3,                  // 落地屏震幅度（px）
        burstCount: 18,              // 墨爆点数（个，固定，不走粒子池）
        burstR0: 6,                  // 墨点起始半径（px）
        burstR1: 46,                 // 墨点扩散半径（px）
        burstDot: 3                  // 墨点半径（px）
      },
      hero: {
        borderWidth: 2,              // 品质边框线宽（px，ART.md 3.9）
        flashSec: 0.2                // 技能激活后边框提亮时长（秒）
      },
      /* 敌方血量：Day 25 续 2 起只用「格子上沿的细红条」（见 figure），
       * 不再画字下 3 颗朱砂点，避免与字 / 血条重叠；ART.md 3.7 口径已同步。 */

      /* ===== 棋盘地形（Day 25 画风补图）：全部静态生成一次，参数只管长相 ===== */
      board: {
        seed: 20261109,              // 地形纹理随机种子（seeded rng，可复现）
        dprMax: 2,                   // 离屏层 DPR 上限
        ground: '#8E9A7E',           // 暖橄榄灰绿草地底（原版卡通色）
        groundAlpha: 0.90,           // 半透明：让底下的宣纸暖白透出来
        noiseCount: 4200,            // 草地噪点数（个）
        noiseRgb: '55,70,50',        // 噪点颜色（rgb 三段）
        noiseAlpha: 0.07,            // 噪点透明度
        bladeColor: 'rgba(55,80,50,0.22)',  // 草叶短线颜色
        bladeMaxLen: 6,              // 草叶最长（px）
        edgeBand: 13,                // 外圈草叶分布带宽（px）
        edgeBlades: 150,             // 外圈草叶条数（条）

        stone: '#4C5B4D',            // 外圈粗石框
        stoneWidth: 7,               // 石框宽（px）
        stoneJoint: 16,              // 石砖竖缝间距（px）
        stoneJointColor: 'rgba(20,28,20,0.42)',
        stoneLight: 'rgba(200,215,190,0.22)',
        corner: '#B23A2B',           // 四角朱砂装饰
        cornerSize: 9,               // 四角三角边长（px）

        /* 砖块质感（Day 25 续 2）：铺满整格、只留 1px 格缝；
         * 圆角 2–3px、左上亮 / 右下暗的极轻浮雕，不许尖角、大圆角或强阴影。 */
        tileRadius: 2.5,             // 砖块圆角（px）
        tileJitter: 0.03,            // 每格颜色微抖动幅度（±3%）
        tileJoint: 'rgba(0,0,0,0.12)',       // 格缝：1px，相邻格共边
        tileOutline: 'rgba(40,45,32,0.55)',  // 砖块深色描边
        tileOutlineW: 1.2,           // 深色描边线宽（px）
        tileLight: 'rgba(255,255,232,0.34)', // 左上 1px 亮边
        tileDark: 'rgba(30,35,25,0.30)',     // 右下 1px 暗边
        brickStrokes: 4,             // 每格手绘短砖纹笔数（笔）
        tileBrick: 'rgba(50,62,40,0.11)',    // 绿格砖纹
        tileBrickW: 'rgba(150,130,95,0.13)', // 白格纸纹线
        tileBrickR: 'rgba(90,35,30,0.16)',   // 红营砖纹

        cellP: '#AEBB9E',            // P 路径：浅橄榄绿砖
        cellD: '#6E7A5C',            // D 深橄榄可铲草格
        cellW: '#F7F1DF',            // W 可放置：米白土块（铺满整格，无内缩缝）
        cellR: '#A9564A',            // R 出兵营：砖红
        cellH: '#F3EBD9',            // H 阿斗格：纸色
        cellDGrass: 'rgba(205,225,195,0.18)',
        cellDBlades: 5,              // 每格草叶丛数（丛）
        whiteNoise: 14,              // 每个白格的纸纹点数（个）
        cellWNoise: 'rgba(120,100,70,0.10)',

        arrow: '#B23A2B',            // 路径朱砂方向箭头
        arrowEvery: 3,               // 每几格画一个箭头（格）
        arrowHalf: 8,                // 箭头半宽（px）
        arrowWidth: 3,               // 箭头线宽（px）
        spawnArrow: '#FBF6E8',       // 出兵营里的白箭头

        /* 城墙带（Day 25 续 2）：替换原来的波浪分界，压在 r4 / r5 之间 */
        wallH: 14,                    // 墙身高度（px）
        wallFill: '#62674C',          // 墙砖底色（暖橄榄灰）
        wallJoint: 'rgba(25,30,20,0.42)',   // 砖缝
        wallEdge: 'rgba(28,32,22,0.75)',    // 上下收边 / 垛口描边
        wallBrick: 14,                // 墙砖竖缝间距（px）
        merlonW: 9,                   // 垛口宽（px）
        merlonH: 4,                   // 垛口凸出高（px）
        merlonStep: 18,               // 垛口间距（px）
        gateW: 26,                    // 两端城门宽（px）
        gateFill: '#3E4232',          // 城门暗色
        gateLight: 'rgba(210,200,165,0.30)',// 门缝亮色
        flagH: 13,                    // 城门小旗杆高（px）

        homeSize: 20,                // 「斗」字字号（px）
        homeInk: '#1C1914',
        crown: '#B23A2B',            // 冕旒冠
        heartDim: 'rgba(178,58,43,0.20)',  // 静态暗心（亮心由 render.js 按生命值画）
        heartSize: 10,               // 红心字号（px）
        heartGap: 11,                // 红心间距（px）
        homeHearts: 3,               // 红心颗数（颗）
        flag: '#B23A2B'              // 阿斗小旗 / 城门小旗
      },

      /* ===== 单位层小图（Day 25 画风补图）：墨晕 / 等级角标 / 阵营色 / 细血条 ===== */
      figure: {
        inkBlotW: 52,                // 字下墨晕宽（px）
        inkBlotH: 22,                // 字下墨晕高（px）
        inkBlotColor: 'rgba(28,25,20,0.22)',
        badgeSize: 15,               // 左上角等级角标边长（px）
        badgeFontPx: 10,             // 角标数字字号（px）
        badgeMaxLv: 5,               // 满级等级：金数字 + 数字下方小金线
        badgePaper: '#FBF6E8',       // 角标底色
        badgeInk: '#1C1914',         // 1–2 级：墨色数字与边框
        badgeCinnabar: '#B23A2B',    // 3–4 级：朱砂数字与边框
        badgeGold: '#C9A227',        // 5 级：金色数字、边框与满级小金线
        badgeGoldLineW: 6,           // 5 级满级小金线宽（px）
        badgeGoldLineH: 2,           // 5 级满级小金线高（px）
        enemyInk: '#8B3A2E',         // 敌方红棕字（我方仍是浓墨）
        hpBarW: 30,                  // 敌方细血条宽（px）
        hpBarH: 3,                   // 细血条高（px）
        hpBarInset: 2,               // 距格子上沿（px）：血条统一贴在格子上沿
        hpBarTrack: 'rgba(28,25,20,0.42)',  // 墨色底衬：窗口缩小时血条也看得见
        hpBarFill: '#B23A2B'
      },
      /* 打击感（ART.md 3.6）：全是表现参数，战斗判定 / 伤害 / CD / 波次一律不读这里。
       * 四种攻击一律「原地形变」：位移上限只有 0.1 格，字不会飞到敌人身上；
       * 真正的箭仍由 combat.js 的 projectile 从字中心发出（远程才发弹道）。 */
      anim: {
        dashCells: 0.1,              // 四兵种通用前冲上限（格，× CELL_W 换算成 px）
        /* Day 26 攻速缩放：动画时长 = min(maxSec, 单位攻击间隔 × intervalFactor)。
         * 高等级攻速快 → 动画自动加快，不会拖到下一次开火；各兵种 sec 只是无
         * intervalSec 时的兜底。这里只管显示，不碰 combat 的 cooldown / 伤害。 */
        maxSec: 0.35,
        intervalFactor: 0.7,
        blade: { sec: 0.28, rotRad: 0.2 },                          // 刀：±0.2 弧度旋身挥砍，末段快速回正到 0
        spear: { sec: 0.25, sx: 1.25 },                             // 枪：沿路径方向（棋盘横向）拉长 1.25
        bow:   { sec: 0.35, squash: 0.82, pullPart: 0.45, arrowLenPx: 26 }, // 弓：压扁 0.82→1 + 离弦箭飞出
        ride:  { sec: 0.30, rotRad: -0.14, ghosts: 2, ghostGapCells: 0.1 }, // 骑：2 帧半透明拖影，不叠粒子
        hitSec: 0.15,                // 受击闪白 + 抖动时长（秒）
        hitShakePx: 3,               // 受击抖动幅度（px）
        mergeSec: 0.45,              // 合成叠合时长（秒）
        mergeSpreadPx: 20,           // 两字初始间距（px）
        mergeScale: 1.6,             // 叠合放大倍率
        hurtShakePx: 8,              // 阿斗受击全屏震幅（px）
        skillSec: 1.0,               // 武将技能字阵时长（秒）
        skillGlyphCount: 6,          // 字阵字数（个）
        skillRadiusPx: 46,           // 字阵半径（px）
        heroBorderFlashPx: 1         // 技能激活时品质边框额外加粗（px）
      },

      /* ===== 字形变武器（Day 26）：字的一部分变成武器出手，纯 Canvas 路径，零图片。
       * 全在字所在格的局部坐标里画（原点是字中心），字主体位移仍受 dashCells 0.1 格约束；
       * 只有「武器」本身能前伸，字不会飞到敌人身上。所有字段都不参与伤害 / 命中判定。 */
      weapon: {
        ink: '#1C1914',              // 武器墨色
        edge: '#B23A2B',             // 朱砂点缀（刀锋 / 红缨 / 戟刃）
        /* v3 姿态状态机（Day 26 续 2）：单位的 stance / lastAttackAt 是纯表现字段，
         * 逻辑层一律不读；停火超过 idleHoldSec 就从 weapon 变回 glyph。 */
        idleHoldSec: 1.2,            // 距上次开火的武器形态保持时长（秒），超过即回归「弓」字
        /* 旧版「月牙刀刃」参数：Day 26 续 3 起刀已改用下面的 dao 拆层抡刀，
         * 这段与 weapon-art.js 的 blade() 都不再被调用，保留仅为不碰枪 / 骑。 */
        blade: {
          fromDeg: -30, toDeg: 40,   // 月牙刀刃从左上扫到右下的旋转角（度）
          radius: 15,                // 刀刃弧半径（px）
          width: 3,                  // 刀刃线宽（px）
          originX: -9, originY: -2,  // 左侧长撇位置
          slashAt: 0.45,             // 刀尖经过目标时的动画进度
          slashLen: 26,              // 劈砍墨痕长度（px）
          slashWidth: 2.5            // 劈砍墨痕线宽（px）
        },

        /* ===== 刀：左撇抡刀（Day 26 续 3）=====
         * 「刀」字拆成 静止层（整字 − 撇区，区内 alpha 归零不留痕）与 挥动层（只留撇），
         * 静止画整字、攻击时只有撇层绕起笔点旋转。比例都是「字框」比例 (0~1)：
         * 字框 = 字号 em 方框，居中在 art.glyph.cacheSize 的 96px 离屏缓存里。
         * 拆层在 cacheScale 倍字号的离屏缓存上做带符号距离软遮罩，再缩回 96px。 */
        dao: {
          /* 左撇笔画范围（字框比例，顺时针）：前 5 点右缘、后 5 点左缘。
           * 起点已向右上延伸到 (0.64,0.04) / (0.47,0.06)，把撇的起笔连同纸色外圈
           * 一起罩住，静止层才不会残留起笔痕迹；收笔到 (0.08,0.80)。 */
          strokePolygon: [
            [0.64, 0.04], [0.56, 0.28], [0.47, 0.44], [0.39, 0.58], [0.24, 0.76],
            [0.08, 0.80], [0.23, 0.58], [0.32, 0.44], [0.40, 0.28], [0.47, 0.06]
          ],
          pivot: [0.46, 0.13],       // 撇起笔点（字框比例）：挥动的旋转轴
          cacheScale: 3,             // 拆层离屏缓存的字号倍数（2–3×），缩回原尺寸消锯齿
          featherPx: 0.5,            // 遮罩边缘羽化半宽（按最终字号 px），带符号距离软过渡
          debug: {
            enabled: 0,                          // 1 = 在棋盘上画撇区轮廓与轴点（验收后关掉）
            polygonFill: 'rgba(178,58,43,0.10)', // 拆层图：撇区淡朱砂填充
            polygonLine: '#B23A2B',              // 拆层图 / 调试：撇区描边
            pivotColor: '#C9A227',               // 拆层图 / 调试：起笔轴点
            gridLine: 'rgba(28,25,20,0.18)',     // 拆层图：0.1 字框网格
            separatePx: 62,                      // 拆层图：挥动层右移距离（px，仅预览用）
            tintIn: '#B23A2B',                   // 覆盖校验：撇区内墨迹染朱砂
            tintOut: '#4B453B'                   // 覆盖校验：撇区外墨迹保持淡墨
          },

          /* 动画：每次攻击一段，时长 = min(maxSec, 攻击间隔 × intervalFactor) */
          maxSec: 0.30,              // 攻击动画总时长上限（秒）
          intervalFactor: 0.8,       // 实际时长 = min(maxSec, 攻击间隔 × 这个系数)
          raiseEnd: 0.08,            // 起势结束（秒）：向左上抬约 15°
          swingEnd: 0.18,            // 抡刀结束（秒）：ease-out 扫到约 +35°
          returnEnd: 0.28,           // 回正结束（秒）：回 0°，过冲 -3° 后静止
          overshootAt: 0.75,         // 回正段内「到达过冲点」的比例，之后收回到 0°
          raiseDeg: -15,             // 起势角度（度，负 = 向左上）
          swingDeg: 35,              // 抡刀角度（度，正 = 向右下）
          overshootDeg: -3,          // 回正过冲角度（度）
          ghostAlpha: 0.10,          // 唯一一道撇残影的起始透明度
          ghostSec: 0.10,            // 残影时长（秒），淡到 0
          ghostLagDeg: 5             // 残影角度比当前撇落后（度，4–6° 取中）
        },

        /* ===== 枪：木变枪 + 姿态状态机（Day 26 续 4 v4）=====
         * glyph = 整字「枪」；weapon = 静止层「仓」+ 挥动层「木」拉伸成枪杆 + 枪头。
         * 第一次开火播 0.07s「木变枪」进入 weapon；之后每次攻击只播
         * 瞄准 → 前刺 → 收回待发，两次攻击之间保持枪形、枪尖朝目标；
         * 停火 ≥ idleHoldSec(1.2s) 播 0.15s「枪变回木」落回 glyph。
         * `muPolygon` 是字框 0~1 比例的 12 点折线：逐行取「木 / 仓 墨迹空白带」
         * 的中点，区内 = 挥动层（木，含竖画），区外 = 静止层（仓，区内 alpha 归零）。
         * 8 邻域下整字是 1 个连通域（木横画与仓撇捺真相连），只能按空白带分界；
         * 旧版中段放宽到 0.45 会把仓撇捺左端 13 个墨点划进木层，故收窄到 0.37~0.40。
         * 拆层在 cacheScale 倍字号离屏缓存上做 0.5px 羽化软遮罩再缩回 96px。 */
        qiang: {
          /* 木字旁区域（字框比例，沿右边界从上到下）：y=0.02~0.30 空白 0.31~0.54，
           * 取 0.42；y=0.34~0.42 木横画右端 0.37 / 仓最左 0.46，取 0.40~0.41；
           * y=0.46~0.50 木与仓相连处空白只到 0.41，收窄到 0.37；
           * y=0.56 以下木最右 0.37 / 仓最左 0.47，取 0.40~0.41。 */
          muPolygon: [
            [0.00, 0.00], [0.42, 0.00], [0.42, 0.28], [0.41, 0.34],
            [0.40, 0.40], [0.37, 0.46], [0.37, 0.50], [0.40, 0.56],
            [0.40, 0.64], [0.41, 0.72], [0.41, 1.00], [0.00, 1.00]
          ],
          pivot: [0.25, 0.70],       // 握把：横画落在枪身中段、撇点当红缨，枪杆朝目标伸出
          cacheScale: 3,             // 离屏拆层缓存字号倍数（2–3×），缩回消锯齿
          featherPx: 0.5,            // 遮罩边缘羽化半宽（按最终字号 px）
          spearLen: 1.55,            // weapon 形态：木竖画拉伸成枪杆的倍率
          headLenRatio: 0.12,        // 三角枪头长 = 字框 12%（上限）
          headHalfRatio: 0.050,      // 三角枪头半宽 = 字框 5%
          headTopY: 0.06,            // 木竖画顶端字框 y：枪头接在这里
          debug: {
            enabled: 0,                          // 1 = 棋盘上画木区轮廓（验收后关）
            polygonFill: 'rgba(178,58,43,0.10)', // 拆层图：木区淡朱砂填充
            polygonLine: '#B23A2B',              // 拆层图 / 调试：木区描边
            pivotColor: '#C9A227',               // 拆层图：木中心锚点
            gridLine: 'rgba(28,25,20,0.18)',     // 拆层图：0.1 字框网格
            separatePx: 62,                      // 拆层图：木层右移距离（px，仅预览用）
            tintIn: '#B23A2B',                   // 覆盖校验：木区墨迹染朱砂
            tintOut: '#4B453B'                   // 覆盖校验：仓墨迹保持淡墨
          },

          /* 姿态状态机（与弓一致）：动画时长 = min(maxSec, 攻击间隔 × intervalFactor) */
          morphInSec: 0.07,          // glyph→weapon「木变枪」过渡（秒）
          morphOutSec: 0.15,         // weapon→glyph「枪变回木」过渡（秒）
          idleHoldSec: 1.2,          // 停火超过这么久才开始变回木（秒）
          maxSec: 0.30,              // 单次攻击动画总时长上限（秒）
          intervalFactor: 0.8,       // 实际时长 = min(maxSec, 攻击间隔 × 0.8)
          aimFrac: 0.22,             // 攻击时间轴里「瞄准」占比（木变枪也在这段完成）
          thrustFrac: 0.58,          // 「前刺」结束占比，之后是「收回待发」
          thrustSec: 0.10,           // 前刺名义时长（秒，便于调参；实际按总时长等比）
          extendCells: 0.25,         // 前刺沿枪头方向前移（格，× CELL_W，0.2–0.3）
          thrustStretch: 1.15,       // 前刺瞬间枪杆额外拉伸倍率
          turnSec: 0.12,             // 换目标时枪头平滑转身的时长（秒）
          pierceDots: 3,             // 穿透多个敌人时沿途贯穿墨点数（2–4）
          pierceDotR: 1.6,           // 贯穿墨点半径（px）
          pierceDotAlpha: 0.42,      // 贯穿墨点透明度（很淡，不抢受击反馈）
          pierceDotFrom: 0.45,       // 墨点沿枪身起点（占前移距离比例）
          ghostAlpha: 0.09,          // 唯一一道残影起始透明度（0.08–0.10）
          ghostSec: 0.10,            // 残影时长（秒），淡到 0
          ghostLagPx: 3              // 残影前移落后当前木偏旁（px）
        },
        /* 旧枪「独立枪杆」参数：Day 26 续 4 起枪改走 art.weapon.qiang 的拆层直刺，
         * 这段与 weapon-art.js spear() 一并作废，保留只为不改动骑的既有实现。 */
        spear: {
          thrustCells: 0.35,         // 枪头前伸（格，× CELL_W）：只伸武器、不挪字
          stretch: 1.2,              // 枪杆拉长倍率
          shaftLen: 18,              // 枪杆基础长（px）
          headLen: 8,                // 三角枪头长（px）
          headHalf: 4,               // 三角枪头半宽（px）
          originX: -10,              // 左侧「木」偏旁位置
          dots: 3,                   // 沿途贯穿墨点数（2–4 个）
          dotR: 2                    // 贯穿墨点半径（px）
        },
        bow: {
          /* 形状与颜色 */
          bowR: 13,                  // 弓身弧半径（px）
          bowArcRad: 1.3,            // 弓身弧半角（弧度，约 150° 开口；别画成整圆）
          bowWidth: 3,               // 弓身线宽（px）
          arrowWidth: 2.2,           // 箭杆线宽（px）
          stringWidth: 1.8,          // V 形弦线宽（px）
          stringPullPx: 9,           // 弦中心拉成 V 的最大后拉距离（px）
          nockAlphaBase: 0.6,        // 搭弦箭最低可见度（0–1）
          drawColor: '#1C1914',      // 弓身墨色
          stringColor: '#B23A2B',    // 朱砂弓弦
          arrowColor: '#1C1914',     // 箭色
          arrowLenPx: 30,            // 箭长（px）
          headLen: 6,                // 三角箭头长（px）
          headHalf: 3,               // 三角箭头半宽（px）
          featherPx: 5,              // 尾羽长（px）
          arrowFlightSec: 0.18,      // 兼容旧验收字段；飞行时长由 releaseEnd→hitEnd 段控制

          /* v3 时间轴（标称 0.5s）：只在「一箭之内」用，阶段终点仍是标称秒数；
           * 实际时长 = min(maxSec, 单位 intervalSec × intervalFactor)，按
           * T = (now - 开火时刻) × nominalSec / 实际时长 等比压缩，高攻速连射不拖拍。
           * 一箭走完就停在「搭箭待发」，不再变回字；变回由 idleHoldSec 决定。 */
          nominalSec: 0.5,
          maxSec: 0.5,
          intervalFactor: 0.85,
          morphSwap: 0.04,           // 字→弓互斥切换点（秒）：此前只有字、此后只有弓
          morphEnd: 0.08,            // 「字变弓」0.08 秒：字淡出缩小 + 墨点，弓淡入
          aimEnd: 0.12,              // 瞄准结束（秒）
          pullEnd: 0.22,             // 拉弦结束（秒）
          releaseEnd: 0.25,          // 放箭结束（秒）
          hitEnd: 0.38,              // 箭到达最后已知目标位置（秒），之后是搭箭待发
          morphScale: 0.55,          // 变形时「弓」字缩到的比例
          morphRotDeg: 12,           // 变形时「弓」字轻旋（度）
          recoilPx: 5,               // 放箭时弓身后坐（px）
          inkBurst: 6,               // 变形墨点数（个）
          missInk: 4,                // 目标消失时的消散墨点数（个）

          /* v3 姿态状态机参数 */
          returnSec: 0.15,           // 弓→字回归过渡时长（秒）：弓淡出、字淡入
          returnSwapSec: 0.075,      // 回归过渡的互斥切换点（秒）：此前只有弓、此后只有字
          turnSec: 0.05,             // 每次换目标时弓角度平滑插值的时间常数（秒）
          idlePull: 0.18,            // 「搭箭待发」时弦的轻拉比例（0–1），顺带画出待发箭
          flightFadeSec: 0.05        // 飞行箭在 hitEnd 前这段标称时间淡出（秒）
        },
        ride: {
          sweepDeg: 300,             // 方天画戟绕单位抡过的角度（度）
          halberdLen: 22,            // 戟杆长（px）
          headLen: 9,                // 戟头长（px）
          branchLen: 6,              // 侧枝长（px）
          originX: 8, originY: 10,   // 右下「奇/可」底横位置
          ghostArcs: 3,              // 圆弧残影道数（道）
          ghostAlpha: 0.16,          // 残影起始透明度（让戟本体更突出）
          ghostAlphaStep: 0.04,      // 每道残影递减
          radiusFactor: 1.0,         // 残影半径 = splashRadius × CELL_W × 此系数
          arcWidth: 2                // 残影线宽（px）
        }
      },
      fx: {
        maxParticles: 72,            // 粒子池容量（个，ART.md 4.2 建议 60–80）
        burstCount: 8,               // 一次墨点爆开几个（个）
        hitBurstCount: 4,            // 命中溅几个（个）
        particleLifeSec: 0.5,        // 粒子寿命（秒）
        particleR: 2.2,              // 粒子半径（px）
        particleSpeed: 90,           // 初速（px/秒）
        gravity: 140,                // 重力（px/秒²）
        inkColor: 'rgba(28,25,20,0.75)',
        skillInk: 'rgba(28,25,20,0.18)',     // 技能全屏墨 wash
        skillGlyphs: { strike: '枪', roar: '吼', volley: '箭' }
      }
    },

    /* ===== 征兵（GDD 第七节）===== */
    recruit: {
      baseCost: 10,            // 第 1 次征兵的费用（馒头）
      costPerRecruit: 2,       // 每抽一次，下次费用 +2：10, 12, 14, 16…
      benchSize: 5,            // 备战席格数（硬规则：一次给 5 张）
      /* 单卡概率（%），两者相加应为 100；recruit.js 实际读 odds.unit 作阈值。
       * Day 24.5 sim：35→45 时每局武将只到 0.28，逐档试到 65 才到 0.56。
       * 加餐 D：65→35（金卡回退到 1/3 强），让兵卡成为主输出、武将只做控场与技能爆发；
       * 武将数靠 pairBias 0.60 + pairPity 5 维持，不靠抬高金卡率。 */
      odds: { unit: 65, heroChar: 35 },
      /* 金卡字池：6 个武将共用 10 个字（张、黄各被两个武将共用）。
       * 抽到「张」以后可能配「飞」也可能配「苞」，所以这里只列字、不列配对。 */
      heroChars: ['赵', '云', '张', '飞', '黄', '忠', '关', '平', '苞', '盖'],
      /* 加餐 E：铲子改成卡片。每次征兵先按原规则出 5 张卡，再按这个概率
       * 随机把 1 张换成铲子卡——每手最多 1 张，总卡数仍是 5，不再有独立计数器。
       * 旧的 shovelChance（额外出 1 把）/ shovelPity（3 次保底）/ maxShovels（上限 6）
       * 已随计数逻辑一起删除。
       * 加餐 E2：35→55。卡片化后每局只挖 2.6–2.8 格，hard 的 digCap 5 摸不到、
       * 三档被压成 61.5 / 45.5 / 46.0；抬到 55% 让每局铲子卡 ≈4 张，供应重新够用。 */
      shovelCardChance: 55,    // 每次征兵把 1 张卡换成铲子卡的概率（%）
      /* 配对权重：抽到金卡时，若场上有休眠单字，按此概率从「能和它成将的字」里挑，
       * 否则全字池随机。0 = 关闭。
       * 加餐 E3：0.60→0.70，数值定稿。55% 铲子卡每手挤掉 1 张字卡、武将掉到
       * 0.95–0.99，抬配对权重把「抽到金卡时正好是缺的那一半」的概率补回来。 */
      pairBias: 0.70,          // 0~1，抽到配对字的概率
      /* 保底：每 N 次征兵，5 张里必有一对能直接拼成武将的字；0 = 关闭。
       * 仍是 5 张卡 + 整席替换，不改规则。实测提升 <0.02 个武将——瓶颈在摆位空格，
       * 不在抽字，保留机制供后续调格子/AI 摆位时用。 */
      pairPity: 5              // 次，0 表示不保底
    },

    /* ===== 等级成长（GDD 8.2）===== */
    growth: {
      damagePerLv: 1.7,        // 每级攻击倍率：damage × 1.7^(lv-1)（加餐 D：1.6→1.7，兵种是主输出）
      speedPerLv: 1.08,        // 每级攻速倍率：攻速 × 1.08^(lv-1)
      maxLv: 5,                // 等级上限
      maxAttacksPerSec: 2.5    // 攻速上限（次/秒），防止高等级弓过强
    },

    /* ===== 合成 / 非法操作的提示时长 ===== */
    merge: {
      animSec: 0.4,            // 合成动画（秒），GDD 要求 0.3~0.45
      denySec: 0.25,           // 抖动/红叉提示（秒）
      digSec: 0.45             // 铲子挖开绿格的动画（秒）
    },

    /* ===== HUD 收入提示（波次奖励在馒头数字右侧闪一下）=====
     * 三段加起来才是总时长：淡入 0.2 + 保持 1.0 + 淡出 0.3 = 1.5 秒。
     * 想让它"更久一点"，改 gainHoldSec 就行，另两个不用动。
     */
    hud: {
      gainFadeInSec: 0.2,      // 从透明到完全显示
      gainHoldSec: 1.0,        // 完全显示的时长（"淡入后 1 秒开始淡出"就是这一段）
      gainFadeOutSec: 0.3      // 淡出到消失
    }
  };
})(globalThis);
