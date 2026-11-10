/* 单骑 · 汉字塔防 —— 战斗：索敌、伤害、冷却、四种攻击方式
 * 规矩：纯逻辑，只读写传进来的 state，不碰 DOM / Canvas。
 *
 * 四种攻击方式（由 unit.attack 决定，参数全部来自 data/balance.js）：
 *   single     刀：打主目标一个
 *   line       枪：主目标按射程选；随后沿路径向前穿透，最多 pierceMax 个（含主目标），后续目标不再单独检查射程
 *   projectile 弓：先发一支箭，飞 flightSec 秒后才结算伤害
 *   splash     骑：主目标 + 周围 splashRadius 格内，合计最多 splashMax 个（含主目标）
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /* ===== 基础几何 ===== */

  function distanceInCells(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * enemyPos —— 敌人当前所在的格子坐标（浮点）。
   */
  function enemyPos(enemy, board) {
    return board.pathPos(enemy.side, enemy.progress);
  }

  function isAlive(enemy) {
    return enemy && !enemy.dead && !enemy.leaked;
  }

  function findEnemyById(enemies, id) {
    for (var i = 0; i < enemies.length; i++) {
      if (enemies[i].id === id) {
        return enemies[i];
      }
    }
    return null;
  }

  /* ===== 索敌 ===== */

  /**
   * unitCenter —— 单位的"攻击原点"（格子坐标，可以是小数）。
   * 兵就一格，直接用它脚下那格；武将占两格（左姓右名），取两格中心。
   * 这样它的射程判断和子弹起点都从"两格中间"算，不会偏向名格那一侧。
   */
  function unitCenter(unit) {
    if (unit.cells && unit.cells.length > 1) {
      var sx = 0;
      var sy = 0;
      for (var i = 0; i < unit.cells.length; i++) {
        sx += unit.cells[i][0];
        sy += unit.cells[i][1];
      }
      return { x: sx / unit.cells.length, y: sy / unit.cells.length };
    }
    return { x: unit.cell[0], y: unit.cell[1] };
  }

  /**
   * findTarget —— 射程内挑一个主目标。
   * 规则（GDD 8.1）：打"最靠近阿斗"的那个，也就是 progress 最大的，
   * 优先清掉最危险的敌人，减少漏怪。
   */
  function findTarget(unit, enemies, board) {
    var c = unitCenter(unit);
    var ux = c.x;
    var uy = c.y;
    var best = null;
    var bestProgress = -1;

    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!isAlive(e)) {
        continue;
      }

      var pos = enemyPos(e, board);
      if (distanceInCells(ux, uy, pos.cx, pos.cy) > unit.range) {
        continue;
      }
      if (e.progress > bestProgress) {
        bestProgress = e.progress;
        best = e;
      }
    }

    return best;
  }

  /**
   * collectLine —— 枪的穿透目标：沿路径向前串，而不是沿一条直线。
   *
   * 为什么不用「敌人 → 阿斗」的射线：路径是 S 形，底边上的敌人和终点 (3,0)
   * 根本不在同一条直线上，射线永远只穿过主目标自己，穿透等于没做。
   * 改成按 progress 排队取，每个直段都能串起来。
   *
   * 规则：
   *   1. 主目标算第一个（它由 findTarget 选出，是射程内最靠近阿斗的）
   *   2. 之后只取 progress 更大的（更靠近阿斗的），按进度由近到远
   *   3. 相邻两个的进度差 > maxGap 就停（队列中间空了一大段，串不过去）
   *      maxGap = unit.range + pierceGapBonus，由调用方传进来，跟着射程一起长
   *   4. 总数不超过 maxCount
   */
  function collectLine(primary, enemies, board, maxCount, maxGap) {
    var hits = [{ enemy: primary, pos: enemyPos(primary, board) }];

    if (maxCount <= 1) {
      return hits;
    }

    var ahead = [];
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!isAlive(e) || e === primary) {
        continue;
      }
      if (e.progress > primary.progress) {
        ahead.push(e);
      }
    }

    ahead.sort(function (a, b) {
      return a.progress - b.progress;
    });

    var lastProgress = primary.progress;

    for (var j = 0; j < ahead.length && hits.length < maxCount; j++) {
      var next = ahead[j];

      // 断档就停，否则枪会隔空打到地图另一头。
      if (next.progress - lastProgress > maxGap) {
        break;
      }

      hits.push({ enemy: next, pos: enemyPos(next, board) });
      lastProgress = next.progress;
    }

    return hits;
  }

  /**
   * collectSplash —— 骑的溅射目标：主目标周围 radius 格内，按距离取前 maxCount 个。
   */
  function collectSplash(primary, enemies, board, radius, maxCount) {
    var origin = enemyPos(primary, board);
    var near = [];

    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!isAlive(e) || e === primary) {
        continue;
      }

      var p = enemyPos(e, board);
      var d = distanceInCells(origin.cx, origin.cy, p.cx, p.cy);
      if (d <= radius) {
        near.push({ enemy: e, dist: d });
      }
    }

    near.sort(function (a, b) {
      return a.dist - b.dist;
    });

    return near.slice(0, maxCount);
  }

  /* ===== 伤害结算 ===== */

  /**
   * damageEnemy —— 扣血，打死了就奖励馒头 + 飘字。
   */
  function damageEnemy(state, enemy, amount, balance, board) {
    if (!isAlive(enemy)) {
      return false;
    }

    enemy.hp -= amount;

    if (enemy.hp > 0) {
      return false;
    }

    enemy.dead = true;
    state.kills += 1;
    state.bun += balance.economy.killBun;

    var pos = enemyPos(enemy, board);
    state.floaters.push({
      text: '+' + balance.economy.killBun,
      cx: pos.cx,
      cy: pos.cy,
      variant: 'gain',
      life: balance.float.lifeSec
    });
    return true;
  }

  /* ===== 四种开火方式 ===== */

  function fireSingle(unit, primary, state, balance, board) {
    var pos = enemyPos(primary, board);
    damageEnemy(state, primary, unit.damage, balance, board);

    state.effects.push({
      type: 'hit',
      cx: pos.cx,
      cy: pos.cy,
      life: balance.fx.hitLifeSec,
      maxLife: balance.fx.hitLifeSec
    });
  }

  function fireLine(unit, primary, state, balance, board) {
    // 穿透距离跟着射程走：range + pierceGapBonus（当前 1.8 + 1.2 = 3.0 格）。
    // 加成写成相对值，以后加射程的武器/道具会自动把穿透一并拉长。
    var maxGap = unit.range + (unit.pierceGapBonus || 0);
    var hits = collectLine(primary, state.enemies, board, unit.pierceMax, maxGap);
    var from = enemyPos(primary, board);

    // 贯穿线的终点画到最后一个被命中的敌人身上。
    var to = from;

    for (var i = 0; i < hits.length; i++) {
      damageEnemy(state, hits[i].enemy, unit.damage, balance, board);
      to = hits[i].pos;
    }

    state.effects.push({
      type: 'line',
      x1: from.cx,
      y1: from.cy,
      x2: to.cx,
      y2: to.cy,
      life: balance.fx.lineLifeSec,
      maxLife: balance.fx.lineLifeSec
    });
  }

  function fireSplash(unit, primary, state, balance, board) {
    var origin = enemyPos(primary, board);

    damageEnemy(state, primary, unit.damage, balance, board);

    var extras = collectSplash(
      primary, state.enemies, board,
      unit.splashRadius, unit.splashMax - 1
    );

    for (var i = 0; i < extras.length; i++) {
      damageEnemy(state, extras[i].enemy, unit.damage, balance, board);
    }

    state.effects.push({
      type: 'arc',
      cx: origin.cx,
      cy: origin.cy,
      r: unit.splashRadius,
      life: balance.fx.arcLifeSec,
      maxLife: balance.fx.arcLifeSec
    });
  }

  /**
   * fireProjectile —— 弓：先造一支箭，飞完才结算。
   * 飞行时间按距离在 flightSecMin ~ flightSecMax 之间插值：
   * 贴脸的目标也得飞 0.15 秒，远处 0.25 秒，看得出"箭在飞"。
   */
  function fireProjectile(unit, primary, state, balance, board) {
    var from = unitCenter(unit);
    var to = enemyPos(primary, board);

    var dist = distanceInCells(from.x, from.y, to.cx, to.cy);
    var k = unit.range > 0 ? Math.min(1, dist / unit.range) : 0;
    var duration = unit.flightSecMin + (unit.flightSecMax - unit.flightSecMin) * k;

    state.projectiles.push({
      id: state.nextId++,
      x0: from.x,
      y0: from.y,
      cx: from.x,
      cy: from.y,
      tx: to.cx,
      ty: to.cy,
      t: 0,
      duration: duration,
      damage: unit.damage,
      targetId: primary.id
    });
  }

  /**
   * fire —— 按攻击方式分派。没有目标返回 false（冷却停在 0，随时可打）。
   */
  function fire(unit, state, balance, board) {
    var primary = findTarget(unit, state.enemies, board);
    if (!primary) {
      return false;
    }

    if (unit.attack === 'line') {
      fireLine(unit, primary, state, balance, board);
    } else if (unit.attack === 'splash') {
      fireSplash(unit, primary, state, balance, board);
    } else if (unit.attack === 'projectile') {
      fireProjectile(unit, primary, state, balance, board);
    } else {
      fireSingle(unit, primary, state, balance, board);
    }

    return true;
  }

  /* ===== 每帧推进 ===== */

  function updateUnits(state, dt, balance, board) {
    for (var i = 0; i < state.units.length; i++) {
      var unit = state.units[i];

      // 休眠单字（金卡放上场但还没成将）：占着格子，但不出手。
      if (unit.type === 'char') {
        continue;
      }

      unit.cooldown -= dt;

      if (unit.cooldown > 0) {
        continue;
      }

      if (!fire(unit, state, balance, board)) {
        unit.cooldown = 0;
        continue;
      }

      // 用"加一个间隔"而不是"设成间隔"，多出来的零头不丢，长时间跑攻速才准。
      unit.cooldown += unit.intervalSec;
    }
  }

  /**
   * updateProjectiles —— 箭往前飞，飞到了才结算。
   * 目标中途死了，这支箭就落空（不做追踪，省事且看得出弹道）。
   */
  function updateProjectiles(state, dt, balance, board) {
    var alive = [];

    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      p.t += dt;

      var k = Math.min(1, p.t / p.duration);
      p.cx = p.x0 + (p.tx - p.x0) * k;
      p.cy = p.y0 + (p.ty - p.y0) * k;

      if (p.t >= p.duration) {
        var target = findEnemyById(state.enemies, p.targetId);
        if (isAlive(target)) {
          damageEnemy(state, target, p.damage, balance, board);
        }
        continue;   // 命中后这支箭就消失
      }

      alive.push(p);
    }

    state.projectiles = alive;
  }

  function updateEffects(state, dt) {
    var alive = [];

    for (var i = 0; i < state.effects.length; i++) {
      var fx = state.effects[i];
      fx.life -= dt;
      if (fx.life > 0) {
        alive.push(fx);
      }
    }
    state.effects = alive;
  }

  function pruneDead(state) {
    var alive = [];
    for (var i = 0; i < state.enemies.length; i++) {
      if (!state.enemies[i].dead) {
        alive.push(state.enemies[i]);
      }
    }
    state.enemies = alive;
  }

  function update(state, dt, balance, board) {
    if (state.status !== 'playing') {
      return;
    }

    updateUnits(state, dt, balance, board);
    updateProjectiles(state, dt, balance, board);

    // 武将技能 + 敌人状态（眩晕/灼烧）跟普攻同属 combat 阶段，排在普攻之后：
    // 这一帧的普攻先结算完，技能再补刀，顺序固定、模拟可复现。
    if (Game.skill) {
      Game.skill.update(state, dt, balance, board);
    }

    pruneDead(state);

    updateEffects(state, dt);
  }

  Game.combat = {
    update: update,
    findTarget: findTarget,
    collectLine: collectLine,
    collectSplash: collectSplash,

    /* skill.js 要用这两个：伤害结算（击杀奖励、飘字都在里面）和武将的两格中心。
     * 它自己不重新实现一遍，避免"技能打死的怪不给馒头"这类分叉。 */
    damageEnemy: damageEnemy,
    unitCenter: unitCenter
  };
})(globalThis);
