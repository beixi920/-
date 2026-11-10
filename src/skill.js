/* 单骑 · 汉字塔防 —— 武将技能
 * 规矩：纯逻辑，只读写传进来的 state，不碰 DOM / Canvas。
 *
 * 三个技能（参数全在 balance.heroes.list[*].skill，代码里不写死数字）：
 *   dash    赵云「七进七出」：沿路径向前突进，每次 damageMul 倍普攻伤害，一条带上全吃。
 *           唯一一个**多段**技能：取点一次，之后每 stepSec 打一段（7 段 ≈ 0.84 秒），
 *           靠 state.skillSeqs 按 dt 推进，不用 setTimeout，暂停/重开/跳波能一起清掉。
 *   stun    张飞「当阳爆喝」：全屏眩晕，实际时长按敌人的免控抗性打折
 *   volley  黄忠「万箭齐发」：全屏 damageMul 倍伤害 + 灼烧若干秒
 *
 * 免控抗性：同一个敌人每被控一次 +tenacityStep，最多 tenacityMax。
 * 存在敌人自己身上（stunResist），所以是"每只怪各自越控越难控"，
 * 不会出现"控住一只就再也动不了"的无限连控。
 *
 * 调用点：combat.update 在 updateUnits 之后调一次 update()。
 * 这样技能属于「combat 阶段」，主循环的 waves → combat → tickPresentation 顺序不变。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /* ============ 小工具 ============ */

  function isAlive(enemy) {
    return enemy && !enemy.dead && !enemy.leaked;
  }

  function aliveEnemies(state) {
    var out = [];
    for (var i = 0; i < state.enemies.length; i++) {
      if (isAlive(state.enemies[i])) {
        out.push(state.enemies[i]);
      }
    }
    return out;
  }

  /**
   * frontmost —— 最靠近阿斗（progress 最大）的活敌人。
   * 它决定赵云从哪一段开始往回突进。
   */
  function frontmost(state) {
    var best = null;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (!isAlive(e)) {
        continue;
      }
      if (!best || e.progress > best.progress) {
        best = e;
      }
    }
    return best;
  }

  function pushEffect(state, fx, life) {
    fx.life = life;
    fx.maxLife = life;
    state.effects.push(fx);
  }

  /* ============ 三个技能 ============ */

  /**
   * castDash —— 赵云「七进七出」。
   *
   * 这里只做两件事：取点、把序列塞进 state.skillSeqs。伤害不在这里结算，
   * 由 tickSeqs 每 stepSec 秒结算一段 —— 一帧打完全部 7 段的话，
   * 画面上就是"一条长线 + 全体同时掉血"，看不出是七进七出。
   *
   * 取点是**固定 7 个**，不是"排到起点就停"：
   *   一开始写成"从最靠前的敌人往回排，排到 0 就 break"，结果敌人挤在出生点时
   *   progress 才 2~3 格，只能排出 2~3 段，根本数不出七进七出。
   *   现在改成先算一个 6 格宽（(hits-1)×1.0）的窗口，把它滑进路径范围内。
   *
   * 窗口要往前多放一格（lead），不是原样对齐锚点：
   *   7 段打完要 1 秒，这 1 秒里敌人会往前走约 1 格。如果窗口正好停在锚点身上，
   *   最后一道横杠打出去时，最靠前那只已经跑到横杠前面去了 —— 实测它整轮 0 伤害。
   *   往前挪 lead = 速度 × 总时长，最后一道正好落在它**那时**的位置上。
   *   lead 用数值表算，不写死：以后改移速或段间隔，这里自动跟着变。
   */
  function castDash(hero, state, balance, board) {
    var anchor = frontmost(state);
    if (!anchor) {
      return false;
    }

    var sk = hero.skill;
    var hits = sk.hits;
    var side = state.side;
    var last = board.path(side).length - 1;
    var gap = sk.gapCells;
    var span = (hits - 1) * gap;

    // 路径不够长：缩间距，不缩段数
    if (last < span) {
      gap = last / (hits - 1);
      span = last;
    }

    // 整段序列播完要多久，敌人就会往前走多远
    var lead = balance.wave.speedCellsPerSec * hits * sk.stepSec;
    var start = Math.max(0, Math.min(anchor.progress + lead - span, last - span));
    var points = [];

    for (var i = 0; i < hits; i++) {
      var at = start + i * gap;
      var pos = board.pathPos(side, at);
      points.push({ progress: at, cx: pos.cx, cy: pos.cy });
    }

    state.skillSeqs.push({
      heroId: hero.id,
      kind: 'dash',
      side: side,                                     // 该半场路径，逐段横杠按它取切线
      points: points,
      index: 0,                                        // 下一段要打第几个点
      timer: sk.stepSec,                               // 第一段也等满一个间隔，不是立刻打
      stepSec: sk.stepSec,
      damage: hero.damage * sk.damageMul,              // 每段伤害，取一次存好
      halfWidth: sk.halfWidthCells,
      tickCells: balance.skills.fx.dashTickCells,
      ringFrom: balance.skills.fx.dashRingFrom,
      ringTo: balance.skills.fx.dashRingTo
    });

    return true;
  }

  /**
   * tickEnds —— 某一点上「垂直于路径」的一道横杠的两个端点（格子坐标）。
   *
   * 横杠垂直于路径，而不是沿着路径画一小段：
   * 沿着路径画的话，7 段首尾几乎相接（间距 1 格、线段 0.7 格），
   * 看起来就是一条连续的线，数不出是 7 下。垂直的短杠才是"一下一下"的。
   *
   * 切线先在**像素空间**里算再转 90°：格子是 62×46，不是正方形，
   * 直接在格子坐标里转 90°，同一根杠在横路上会比在竖路上短一截（32px vs 43px），
   * 一眼就能看出歪。转成像素再换算回来，长度才是恒定的。
   */
  function tickEnds(board, side, at, tickCells) {
    var last = board.path(side).length - 1;
    var eps = 0.05;

    var a = board.pathPos(side, Math.max(0, at - eps));
    var b = board.pathPos(side, Math.min(last, at + eps));

    var tx = (b.cx - a.cx) * board.CELL_W;
    var ty = (b.cy - a.cy) * board.CELL_H;
    var len = Math.sqrt(tx * tx + ty * ty) || 1;

    // 垂直方向（像素空间的单位向量），换算成"沿它走 tickCells 个格宽"的格子位移
    var nx = -ty / len;
    var ny = tx / len;
    var halfPx = (tickCells * board.CELL_W) / 2;

    var c = board.pathPos(side, at);

    return {
      cx: c.cx,
      cy: c.cy,
      x1: c.cx - (nx * halfPx) / board.CELL_W,
      y1: c.cy - (ny * halfPx) / board.CELL_H,
      x2: c.cx + (nx * halfPx) / board.CELL_W,
      y2: c.cy + (ny * halfPx) / board.CELL_H
    };
  }

  /**
   * strikeDashSegment —— 打出序列里的第 index 段。
   *
   * 命中判定读的是敌人**当前**的 progress，不是施法瞬间的快照 ——
   * 1 秒里敌人会往前走一格左右，这样"打的是现在站在这一段上的兵"，
   * 观感才是突进扫过去，而不是对着空气放。
   *
   * 每段 push 一条只属于这一段的特效：一道垂直横杠 + 一个扩散小环 + 命中点。
   */
  function strikeDashSegment(seq, state, balance, board) {
    var p = seq.points[seq.index];
    var ends = tickEnds(board, seq.side, p.progress, seq.tickCells);

    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (!isAlive(e)) {
        continue;
      }
      if (Math.abs(e.progress - p.progress) <= seq.halfWidth) {
        Game.combat.damageEnemy(state, e, seq.damage, balance, board);
      }
    }

    pushEffect(state, {
      type: 'strike',
      x1: ends.x1, y1: ends.y1,
      x2: ends.x2, y2: ends.y2,
      cx: ends.cx, cy: ends.cy,
      r0: seq.ringFrom,
      r1: seq.ringTo
    }, balance.skills.fx.dashHitLifeSec);
  }

  /**
   * hasActiveSeq —— 这个武将还有没走完的技能序列吗。
   * 用来挡住"序列没播完又放一次"—— 即使 CD 被改短也不会叠在一起。
   */
  function hasActiveSeq(state, heroId) {
    for (var i = 0; i < state.skillSeqs.length; i++) {
      if (state.skillSeqs[i].heroId === heroId) {
        return true;
      }
    }
    return false;
  }

  /**
   * tickSeqs —— 按 dt 推进技能序列，每 stepSec 打一段。
   *
   * 用 `timer += stepSec` 而不是 `timer = stepSec`：余数留着，
   * 长时间跑不会越拖越慢（和普攻冷却用的是同一个写法）。
   * 这里刻意不用 while —— 固定步长 1/60 秒本来就小于 0.12 秒，
   * 一帧最多一段；while 遇到 stepSec 被误设成 0 会死循环。
   */
  function tickSeqs(state, dt, balance, board) {
    var running = [];

    for (var i = 0; i < state.skillSeqs.length; i++) {
      var seq = state.skillSeqs[i];
      seq.timer -= dt;

      if (seq.timer <= 0 && seq.index < seq.points.length) {
        strikeDashSegment(seq, state, balance, board);
        seq.index += 1;
        seq.timer += seq.stepSec;
      }

      if (seq.index < seq.points.length) {
        running.push(seq);
      }
    }

    state.skillSeqs = running;
  }

  /**
   * castStun —— 张飞「当阳爆喝」。
   * 全屏生效，但每个敌人各自按自己的免控抗性打折：
   * 实际眩晕 = stunSec × (1 - stunResist)，放完抗性再 +10%（封顶 60%）。
   */
  function castStun(hero, state, balance, board) {
    var list = aliveEnemies(state);
    if (!list.length) {
      return false;
    }

    var cfg = balance.skills;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var resist = e.stunResist || 0;
      var actual = hero.skill.stunSec * (1 - resist);

      // 已经在晕就取较长的那次，别用一次更短的把它盖掉。
      e.stunTimer = Math.max(e.stunTimer || 0, actual);
      e.stunResist = Math.min(cfg.tenacityMax, resist + cfg.tenacityStep);
    }

    var c = Game.combat.unitCenter(hero);
    pushEffect(state, { type: 'roar', cx: c.x, cy: c.y }, cfg.fx.roarLifeSec);

    return true;
  }

  /**
   * castVolley —— 黄忠「万箭齐发」。
   * 全屏立刻吃一次伤害；没死的再挂上灼烧（每秒 burnDps，持续 burnSec 秒）。
   * 被这一箭直接射死的就不挂灼烧了，免得对尸体放状态。
   */
  function castVolley(hero, state, balance, board) {
    var list = aliveEnemies(state);
    if (!list.length) {
      return false;
    }

    var sk = hero.skill;
    var amount = hero.damage * sk.damageMul;
    var burnDps = hero.damage * sk.burnDpsRatio;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      Game.combat.damageEnemy(state, e, amount, balance, board);

      if (isAlive(e)) {
        e.burnTimer = sk.burnSec;
        e.burnDps = burnDps;
      }
    }

    var c = Game.combat.unitCenter(hero);
    pushEffect(state, {
      type: 'volley',
      cx: c.x,
      cy: c.y,
      arrows: balance.skills.fx.volleyArrows
    }, balance.skills.fx.volleyLifeSec);

    return true;
  }

  /**
   * cast —— 按 skill.kind 分派。没打到人就返回 false（CD 停在 0，等下一帧再试）。
   */
  function cast(hero, state, balance, board) {
    var kind = hero.skill.kind;

    if (kind === 'dash') {
      return castDash(hero, state, balance, board);
    }
    if (kind === 'stun') {
      return castStun(hero, state, balance, board);
    }
    if (kind === 'volley') {
      return castVolley(hero, state, balance, board);
    }
    return false;
  }

  /* ============ 每帧推进 ============ */

  /**
   * tickStatus —— 敌人身上的状态计时。
   * 眩晕只递减（移动由 waves.moveEnemies 按 stunTimer 拦住）；
   * 灼烧除了递减还要连续扣血，所以这里必须拿得到 balance 和 board。
   */
  function tickStatus(state, dt, balance, board) {
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (!isAlive(e)) {
        continue;
      }

      if (e.stunTimer > 0) {
        e.stunTimer = Math.max(0, e.stunTimer - dt);
      }

      if (e.burnTimer > 0) {
        e.burnTimer = Math.max(0, e.burnTimer - dt);
        Game.combat.damageEnemy(state, e, e.burnDps * dt, balance, board);
      }
    }
  }

  /**
   * tickHeroes —— 冷却递减，好了就自动放。
   *
   * 两个细节：
   * 1. CD 好了但场上没敌人就停在 0 等 —— 不空放，不然第一波来之前就白烧一次大招；
   * 2. 放成功才把 CD 重置成满，没打到人就保持 0，下一帧继续找目标。
   */
  function tickHeroes(state, dt, balance, board) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];

      if (u.type !== 'hero' || !u.skill) {
        continue;
      }

      // 冷却先减 —— 序列播放期间 CD 也要照常走，不能因为"正在放技能"就停表。
      if (u.skillCd > 0) {
        u.skillCd = Math.max(0, u.skillCd - dt);
      }
      if (u.skillCd > 0) {
        continue;
      }

      // CD 好了但上一段序列还没播完：等它播完再放，别两条叠在一起。
      if (hasActiveSeq(state, u.id)) {
        continue;
      }

      if (cast(u, state, balance, board)) {
        u.skillCd = u.skill.cdSec;
      }
    }
  }

  /**
   * update —— 一帧（固定 1/60 秒）。
   * 顺序：状态（灼烧可能把人烧死）→ 正在播的技能序列 → 武将技能冷却。
   * 序列排在新施法前面，所以这一帧新起的序列不会立刻打第一段，
   * 第一段一定等满一个 stepSec。
   */
  function update(state, dt, balance, board) {
    tickStatus(state, dt, balance, board);
    tickSeqs(state, dt, balance, board);
    tickHeroes(state, dt, balance, board);
  }

  Game.skill = {
    update: update,
    /* 下面几个导出只给自测用，正常流程不需要直接调 */
    frontmost: frontmost,
    aliveEnemies: aliveEnemies,
    cast: cast,
    hasActiveSeq: hasActiveSeq
  };
})(globalThis);
