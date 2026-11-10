/* 单骑 · 汉字塔防 —— 波次：开波节奏、出怪、移动、漏怪、奖励
 * 规矩：纯逻辑，只读写传进来的 state，不碰 DOM / Canvas。
 * 数值全部来自 data/balance.js 的 wave 段（GDD 4.1）。
 *
 * 节奏是"固定节拍"而不是"清完再等"：
 * 开局 8 秒开第 1 波，之后每 17 秒开下一波，不管上一波有没有清完。
 * 加餐 C 起**无限波**：没有总波数、没有超时判负；谁先漏光 6 点谁输。
 * 每 6 波额外一只 BOSS「将」，血量 = 当波普通卒 × 5.5；6 分钟后开的新波
 * 每波额外 ×1.05（逐波叠加），保证一定分胜负。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /* ============ 公式 ============ */

  /**
   * waveOverride —— 只给「某一波」的微调留的口子：
   * data/balance.js 的 wave.waveOverrides[w] 可写 count / hp / spawnIntervalSec，
   * 不写就完全走原公式。整体曲线（baseHp / hpLinear / countPerWave）一行不动。
   */
  function waveOverride(w, balance) {
    var all = balance.wave.waveOverrides;
    return all ? (all[w] || null) : null;
  }

  /**
   * waveCount —— 第 w 波几只：baseCount + countPerWave × (w-1)，不超过上限。
   */
  function waveCount(w, balance) {
    var c = balance.wave;
    var ov = waveOverride(w, balance);
    if (ov && typeof ov.count === 'number') {
      return ov.count;
    }
    var n = c.baseCount + c.countPerWave * (w - 1);
    return Math.min(c.maxCount, n);
  }

  /**
   * overtimeStacks —— 第 w 波开波时已经进入加时几波：
   * 开波时刻 = firstDelay + (w-1)×interval，超过 overtimeStartSec 后每波 +1。
   * 用「波号 → 开波时刻」推算而不是读 state.elapsed，保证 sim / 跳波同结果。
   */
  function overtimeStacks(w, c) {
    if (!(c.overtimeHpPerWave > 0) || !(c.overtimeStartSec > 0)) {
      return 0;
    }
    var startAt = c.firstDelaySec + (w - 1) * c.intervalSec;
    if (startAt < c.overtimeStartSec) {
      return 0;
    }
    return Math.floor((startAt - c.overtimeStartSec) / c.intervalSec) + 1;
  }

  /**
   * waveHp —— 第 w 波血量：
   * baseHp × (1 + linear×(w-1) + max(0, w-curveStart)^power × factor) × 加时复利
   */
  function waveHp(w, balance) {
    var c = balance.wave;
    var ov = waveOverride(w, balance);
    var base;
    if (ov && typeof ov.hp === 'number') {
      base = ov.hp;
    } else {
      var linear = c.hpLinear * (w - 1);
      var curve = Math.pow(Math.max(0, w - c.hpCurveStart), c.hpCurvePower) * c.hpCurveFactor;
      base = c.baseHp * (1 + linear + curve);
    }
    var ot = overtimeStacks(w, c);
    return Math.round(base * Math.pow(1 + c.overtimeHpPerWave, ot));
  }

  /** bossHp —— BOSS「将」血量 = 当波普通卒 × bossHpMul（已含加时复利）。 */
  function bossHp(w, balance) {
    return Math.round(waveHp(w, balance) * balance.wave.bossHpMul);
  }

  /**
   * spawnIntervalFor —— 波内出怪间隔，只有配了覆盖的那一波会变。
   */
  function spawnIntervalFor(w, balance) {
    var ov = waveOverride(w, balance);
    return (ov && typeof ov.spawnIntervalSec === 'number')
      ? ov.spawnIntervalSec : balance.wave.spawnIntervalSec;
  }

  /**
   * waveBonus —— 清完第 w 波的馒头奖励：base + perWave × w。
   */
  function waveBonus(w, balance) {
    var c = balance.wave;
    return c.clearBonusBase + c.clearBonusPerWave * w;
  }

  /**
   * heartCount —— 显示心数：每 leaksPerHeart 点漏怪碎 1 颗心，向上取整。
   */
  function heartCount(leakPoints, balance) {
    if (leakPoints <= 0) {
      return 0;
    }
    return Math.ceil(leakPoints / balance.lives.leaksPerHeart);
  }

  /* ============ 出怪 ============ */

  function makeEnemy(state, char, hp, speed, waveNo) {
    return {
      id: state.nextId++,
      /* side 决定它沿哪条路径走：上下半场跑同一套波次，但各走各的 16 格路径。 */
      side: state.side,
      char: char,
      hp: hp,
      maxHp: hp,
      speed: speed,
      progress: 0,
      leaked: false,
      dead: false,
      wave: waveNo,

      /* 状态类字段（由 skill.js 写入、在这里只读）
       * stunTimer  >0 = 被眩晕，原地不动（计时在 skill 里递减）
       * stunResist 免控抗性 0~0.6，每被控一次 +0.1，所以同一只怪越控越难控
       * burnTimer  >0 = 正在灼烧，每帧掉 burnDps 点血 */
      stunTimer: 0,
      stunResist: 0,
      burnTimer: 0,
      burnDps: 0
    };
  }

  /**
   * scheduleWaves —— 到点就开新的一波。
   */
  function scheduleWaves(state, dt, balance) {
    state.nextWaveIn -= dt;
    if (state.nextWaveIn > 0) {
      return;
    }

    var w = state.waveIndex;
    state.waveIndex += 1;
    state.nextWaveIn = balance.wave.intervalSec;

    state.spawnWave = w;
    state.spawnedInWave = 0;
    state.spawnTimer = 0;
    state.bossSpawned = false;
  }

  /**
   * spawnTick —— 当前这一波按 0.8 秒/只往外放；放完再补 BOSS，最后标记该波出完。
   */
  function spawnTick(state, dt, balance) {
    var w = state.spawnWave;
    if (!w) {
      return;
    }

    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) {
      return;
    }

    var c = balance.wave;
    var target = waveCount(w, balance);

    if (state.spawnedInWave < target) {
      state.enemies.push(makeEnemy(state, '卒', waveHp(w, balance), c.speedCellsPerSec, w));
      state.spawnedInWave += 1;
      state.spawnTimer += spawnIntervalFor(w, balance);
      return;
    }

    // 每 6 波（6/12/18…）额外放一只 BOSS，不占本波普通只数；血量随波次涨。
    if (c.bossEvery > 0 && w % c.bossEvery === 0 && !state.bossSpawned) {
      state.enemies.push(makeEnemy(state, c.boss.char, bossHp(w, balance),
        c.boss.speedCellsPerSec, w));
      state.bossSpawned = true;
      state.spawnTimer += spawnIntervalFor(w, balance);
      return;
    }

    state.wavesDone[w] = true;
    state.spawnWave = 0;
  }

  /* ============ 移动与漏怪 ============ */

  function moveEnemies(state, dt, balance, board) {
    var last = board.path(state.side).length - 1;

    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.dead || e.leaked) {
        continue;
      }

      // 被眩晕的站住不动。计时在 skill.js 里递减，这里只读。
      if (e.stunTimer > 0) {
        continue;
      }

      e.progress += e.speed * dt;

      if (e.progress >= last) {
        e.progress = last;
        e.leaked = true;
      }
    }
  }

  function resolveLeaks(state, balance, board) {
    var lastCell = board.home(state.side);

    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (!e.leaked || e.dead) {
        continue;
      }

      e.dead = true;

      var heartsBefore = heartCount(state.leakPoints, balance);

      state.leakPoints -= 1;
      state.leaks += 1;
      state.bun += balance.economy.leakBun;

      var heartsAfter = heartCount(state.leakPoints, balance);
      var shattered = heartsAfter < heartsBefore;

      state.hurtTimer = shattered ? balance.adu.shatterSec : balance.adu.shakeSec;
      if (shattered) {
        state.shatterTimer = balance.adu.shatterSec;
      }

      state.floaters.push({
        text: '+' + balance.economy.leakBun,
        cx: lastCell[0],
        cy: lastCell[1] + 0.35,
        variant: shattered ? 'shatter' : 'gain',
        life: balance.float.lifeSec
      });

      if (state.leakPoints <= 0) {
        state.leakPoints = 0;
        state.status = 'lost';
      }
    }
  }

  function pruneEnemies(state) {
    var alive = [];
    for (var i = 0; i < state.enemies.length; i++) {
      if (!state.enemies[i].dead) {
        alive.push(state.enemies[i]);
      }
    }
    state.enemies = alive;
  }

  /* ============ 奖励与胜负 ============ */

  /**
   * rewardWaves —— 某一波"出完了 + 场上没有它的兵"就发奖励，每波只发一次。
   * 用 enemy.wave 判定，所以波次重叠时也不会互相干扰。
   *
   * 奖励提示走 HUD（馒头数字右侧的 "+N"），不再在阿斗头顶飘字：
   * 漏怪的 "+5" 是掉血换来的补偿，波次奖励是过关收入，两者不该长在同一个位置。
   */
  function rewardWaves(state, balance) {
    /* 无限波：只扫已经开过的波（waveIndex 是下一波波号），未开到的不用看。 */
    for (var w = 1; w < state.waveIndex; w++) {
      if (!state.wavesDone[w] || state.wavesRewarded[w]) {
        continue;
      }

      var alive = false;
      for (var i = 0; i < state.enemies.length; i++) {
        if (state.enemies[i].wave === w) {
          alive = true;
          break;
        }
      }
      if (alive) {
        continue;
      }

      state.wavesRewarded[w] = true;

      var bonus = waveBonus(w, balance);
      state.bun += bonus;

      // 直接覆盖而不是排队：两波奖励挨得很近时，叠在一起反而看不清。
      state.bunGainText = '+' + bonus;
      state.bunGainTimer = balance.hud.gainFadeInSec
        + balance.hud.gainHoldSec
        + balance.hud.gainFadeOutSec;
    }
  }

  /* ============ 表现计时 ============ */

  function tickPresentation(state, dt, balance) {
    if (state.hurtTimer > 0) {
      state.hurtTimer = Math.max(0, state.hurtTimer - dt);
    }
    if (state.shatterTimer > 0) {
      state.shatterTimer = Math.max(0, state.shatterTimer - dt);
    }

    // HUD 收入提示：淡入 → 保持 → 淡出。走完才清文字，
    // 这样淡出期间画面里还有内容，透明度能一路降到 0 再消失。
    if (state.bunGainTimer > 0) {
      state.bunGainTimer = Math.max(0, state.bunGainTimer - dt);
      if (state.bunGainTimer === 0) {
        state.bunGainText = '';
      }
    }

    var alive = [];
    for (var i = 0; i < state.floaters.length; i++) {
      var f = state.floaters[i];
      f.life -= dt;
      f.cy -= balance.float.riseCellsPerSec * dt;

      if (f.life > 0) {
        alive.push(f);
      }
    }
    state.floaters = alive;
  }

  /* ============ 每帧 ============ */

  function update(state, dt, balance, board) {
    if (state.status !== 'playing') {
      return;
    }

    scheduleWaves(state, dt, balance);
    spawnTick(state, dt, balance);
    moveEnemies(state, dt, balance, board);
    resolveLeaks(state, balance, board);
    pruneEnemies(state);
    rewardWaves(state, balance);
  }

  Game.waves = {
    update: update,
    tickPresentation: tickPresentation,
    heartCount: heartCount,
    waveCount: waveCount,
    waveHp: waveHp,
    bossHp: bossHp,
    overtimeStacks: overtimeStacks,
    waveBonus: waveBonus
  };
})(globalThis);
