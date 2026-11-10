/* 单骑 · 汉字塔防 —— 战斗特效绘制
 * 从 render.js 拆出来：枪线 / 骑弧 / 合成环 / 觉醒环 / 挖格环 / 红叉 / 命中点。
 * 这些都是"一次性、会淡出"的东西，和常驻的棋盘、单位不是一类，单独放一个文件更清楚。
 *
 * 依赖 Game.render 导出的 toPx / COLOR（render.js 先加载）。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var R = Game.render;

  function toPx(board, tf, cx, cy) { return R.toPx(board, tf, cx, cy); }
  var COLOR = R.COLOR;

  /* ===== 粒子池（ART.md 4.2）：预分配固定槽，满了复用最旧的，绝不每帧 new ===== */
  var pool = null;
  var poolCursor = 0;

  function ensurePool(balance) {
    if (pool) { return; }
    pool = [];
    for (var i = 0; i < balance.art.fx.maxParticles; i++) {
      pool.push({ active: false, bornAt: 0, x: 0, y: 0, vx: 0, vy: 0, oy: 0, r: 0, life: 0 });
    }
  }

  function spawnInk(x, y, oy, bornAt, count, balance) {
    ensurePool(balance);
    var cfg = balance.art.fx;
    for (var i = 0; i < count; i++) {
      var p = pool[poolCursor % pool.length];
      poolCursor += 1;
      var a = Math.PI * 2 * i / count + bornAt * 0.7;   // 确定性角度，不用随机数
      var s = cfg.particleSpeed * (0.6 + (i % 3) * 0.2);
      p.active = true;
      p.bornAt = bornAt;
      p.x = x; p.y = y; p.oy = oy;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s - cfg.particleSpeed * 0.45;
      p.r = cfg.particleR;
      p.life = cfg.particleLifeSec;
    }
  }

  function drawParticles(ctx, tf, state, balance) {
    if (!pool) { return; }
    var cfg = balance.art.fx;
    ctx.save();
    ctx.fillStyle = cfg.inkColor;
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (!p.active || p.oy !== tf.oy) { continue; }
      var age = state.elapsed - p.bornAt;
      if (age < 0 || age >= p.life) { p.active = false; continue; }
      var k = age / p.life;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.beginPath();
      ctx.arc(p.x + p.vx * age,
        p.y + p.vy * age + cfg.gravity * age * age * 0.5,
        p.r * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** drawMergeBlend —— 合成：两个墨团靠拢 → 放大 1.6 → 墨点爆开（ART.md 3.6）。 */
  function drawMergeBlend(ctx, c, k, balance) {
    var a = balance.art.anim;
    var spread = a.mergeSpreadPx * Math.max(0, 1 - k * 2);
    var sc = k < 0.5 ? 1 : 1 + (a.mergeScale - 1) * Math.sin((k - 0.5) * Math.PI * 2);
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.fillStyle = COLOR.ink;
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.arc(c.x + s * spread, c.y, 9 * sc, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** drawSkillWash —— 武将技能：一圈淡墨 wash + 汉字阵随进度扩散。 */
  function drawSkillWash(ctx, board, c, type, k, alpha, balance) {
    var an = balance.art.anim;
    var fx = balance.art.fx;

    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillStyle = fx.skillInk;
    ctx.beginPath();
    ctx.arc(c.x, c.y, board.CELL_W * (0.35 + k * 1.0), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var ch = fx.skillGlyphs[type] || '武';
    for (var i = 0; i < an.skillGlyphCount; i++) {
      var ang = Math.PI * 2 * i / an.skillGlyphCount + k * 0.7;
      var r = an.skillRadiusPx * (0.5 + k * 0.8);
      R.drawGlyph(ctx, ch, c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r,
        COLOR.ink, 14, alpha * 0.75, 0, false);
    }
  }

  /** particleStats —— 验收用：池容量、活跃数。池长度恒定就不会泄漏。 */
  function particleStats() {
    var active = 0;
    if (pool) {
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].active) { active += 1; }
      }
    }
    return { size: pool ? pool.length : 0, active: active };
  }

  /**
   * drawEffects —— 攻击表现：枪的贯穿线 / 骑的范围弧 / 刀的命中点。
   * 都按 life/maxLife 淡出，不做任何花哨特效。
   */
  function drawEffects(ctx, board, tf, state, balance) {
    ensurePool(balance);
    var artFx = balance.art.fx;

    for (var i = 0; i < state.effects.length; i++) {
      var fx = state.effects[i];
      var alpha = Math.max(0, fx.life / fx.maxLife);
      var k = 1 - alpha;

      if (fx.type === 'line') {
        var a = toPx(board, tf, fx.x1, fx.y1);
        var b = toPx(board, tf, fx.x2, fx.y2);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = COLOR.cinnabar;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();

      } else if (fx.type === 'arc') {
        var c = toPx(board, tf, fx.cx, fx.cy);
        // 半径按"格"换算成像素：横向一格宽 62px。
        var r = fx.r * board.CELL_W;

        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = COLOR.cinnabar;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

      } else if (fx.type === 'strike') {
        // 赵云「七进七出」的**单段**：一道垂直于路径的朱砂横杠 + 一个墨色扩散小环 + 命中点。
        //
        // 横杠是"垂直于路径"而不是"沿着路径"：沿着路径画一小段的话，7 段几乎首尾相接
        // （间距 1 格、线段 0.7 格），看起来还是一条线；垂直的短杠才数得出是 7 下。
        // 停留时间等于段间隔，所以同一时刻基本只亮一道，是"一下一下推进"。
        var k2 = 1 - fx.life / fx.maxLife;
        var s1 = toPx(board, tf, fx.x1, fx.y1);
        var s2 = toPx(board, tf, fx.x2, fx.y2);
        var sp = toPx(board, tf, fx.cx, fx.cy);

        ctx.save();
        ctx.lineCap = 'round';

        /* 横杠 */
        ctx.globalAlpha = alpha * 0.95;
        ctx.strokeStyle = COLOR.cinnabar;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();

        /* 命中扩散环：从 r0 扩到 r1，跟横杠同寿命 */
        var rr = board.CELL_W * (fx.r0 + (fx.r1 - fx.r0) * k2);
        ctx.globalAlpha = (1 - k2) * 0.6;
        ctx.strokeStyle = COLOR.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, rr, 0, Math.PI * 2);
        ctx.stroke();

        /* 命中点 */
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = COLOR.ink;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

      } else if (fx.type === 'roar') {
        // 张飞「当阳爆喝」：三圈墨色声波向外扩，越外圈越淡。
        var rc = toPx(board, tf, fx.cx, fx.cy);
        var rk = 1 - fx.life / fx.maxLife;

        ctx.save();
        ctx.strokeStyle = COLOR.ink;
        for (var ring = 0; ring < 3; ring++) {
          ctx.globalAlpha = (1 - rk) * (0.6 - ring * 0.16);
          ctx.lineWidth = 2.4 - ring * 0.6;
          ctx.beginPath();
          ctx.arc(rc.x, rc.y, board.CELL_W * (0.3 + rk * (1.0 + ring * 0.5)), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

      } else if (fx.type === 'volley') {
        // 黄忠「万箭齐发」：从武将身上放射出去一圈朱砂箭线，边转边往外走。
        var vc = toPx(board, tf, fx.cx, fx.cy);
        var vk = 1 - fx.life / fx.maxLife;
        var n = fx.arrows || 12;

        ctx.save();
        ctx.strokeStyle = COLOR.cinnabar;
        ctx.globalAlpha = (1 - vk) * 0.85;
        ctx.lineWidth = 1.5;

        for (var ar = 0; ar < n; ar++) {
          // 起始角转一点，看起来像"撒出去"而不是"固定八向"
          var ang = (Math.PI * 2 * ar) / n + vk * 0.3;
          var r0 = board.CELL_W * (0.25 + vk * 0.85);

          ctx.beginPath();
          ctx.moveTo(vc.x + Math.cos(ang) * r0, vc.y + Math.sin(ang) * r0);
          ctx.lineTo(vc.x + Math.cos(ang) * (r0 + 14), vc.y + Math.sin(ang) * (r0 + 14));
          ctx.stroke();
        }
        ctx.restore();

      } else if (fx.type === 'merge') {
        // 合成：一圈朱砂环向外扩散并淡出，0.4 秒左右。
        var m = toPx(board, tf, fx.cx, fx.cy);
        var k = 1 - fx.life / fx.maxLife;
        var radius = board.CELL_W * (0.18 + k * 0.55);

        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = COLOR.cinnabar;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

      } else if (fx.type === 'awaken') {
        // 拼字成将：一圈金色环向外扩散，比普通合成更亮一点
        var aw = toPx(board, tf, fx.cx, fx.cy);
        var ak = 1 - fx.life / fx.maxLife;
        var ar = board.CELL_W * (0.25 + ak * 0.8);

        ctx.save();
        ctx.globalAlpha = (1 - ak) * 0.95;
        ctx.strokeStyle = COLOR.gold;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(aw.x, aw.y, ar, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

      } else if (fx.type === 'dig') {
        // 铲子挖开绿格：绿色圆环向外扩散。
        var dg = toPx(board, tf, fx.cx, fx.cy);
        var dk = 1 - fx.life / fx.maxLife;
        var dr = board.CELL_W * (0.2 + dk * 0.5);

        ctx.save();
        ctx.globalAlpha = (1 - dk) * 0.9;
        ctx.strokeStyle = '#5B8C6E';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(dg.x, dg.y, dr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

      } else if (fx.type === 'deny') {
        // 非法落点：一个淡出的红叉。
        var d = toPx(board, tf, fx.cx, fx.cy);
        var da = Math.max(0, fx.life / fx.maxLife);
        var s = 8;

        ctx.save();
        ctx.globalAlpha = da;
        ctx.strokeStyle = COLOR.cinnabar;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(d.x - s, d.y - s);
        ctx.lineTo(d.x + s, d.y + s);
        ctx.moveTo(d.x + s, d.y - s);
        ctx.lineTo(d.x - s, d.y + s);
        ctx.stroke();
        ctx.restore();

      } else {
        var p = toPx(board, tf, fx.cx, fx.cy);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COLOR.ink;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* 叠合 / 字阵 / 墨点：每个特效只撒一次，标记是渲染层的表现缓存（下划线前缀），
       * 逻辑层完全不读，战斗判定、伤害、CD 都不受影响。
       * Day 26：普通命中的墨点统一由 render.js 的「敌人掉血跳变」触发（覆盖枪/骑/弓/技能），
       * 这里只留合成 / 觉醒 / 技能的爆点，避免刀命中重复撒两份。 */
      var skill = fx.type === 'strike' || fx.type === 'roar' || fx.type === 'volley';
      if (fx.type === 'merge' || fx.type === 'awaken' || skill) {
        var c2 = toPx(board, tf, fx.cx, fx.cy);
        if (fx.type === 'merge') {
          drawMergeBlend(ctx, c2, k, balance);
        }
        if (skill) {
          drawSkillWash(ctx, board, c2, fx.type, k, alpha, balance);
        }
        if (!fx._inkDone) {
          fx._inkDone = 1;
          spawnInk(c2.x, c2.y, tf.oy, state.elapsed, artFx.burstCount, balance);
        }
      }
    }
    drawParticles(ctx, tf, state, balance);
  }

  Game.renderFx = {
    draw: drawEffects,
    spawnInk: spawnInk,
    particleStats: particleStats
  };
})(globalThis);
