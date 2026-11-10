/* 单骑 · 汉字塔防 —— 武器表现层
 * ① 弓「字变武器」v3：姿态状态机（Day 26 续 2），glyph ↔ weapon。
 * ② 刀「左撇抡刀」：高倍软遮罩拆层 + 抬 → 抡 → 回正（Day 26 续 3）。
 * ③ 枪「木偏旁变枪」：同一套拆层管线 + 姿态状态机（Day 26 续 4 v4），
 *    glyph ↔ weapon，持续攻击保持枪形，每枪只播 瞄准 → 前刺 → 收回待发。
 * 纯表现：只读 state / board / balance，只写单位上的 _ 前缀表现缓存字段，
 * 不改伤害 / 判定 / CD / 波次。render.js 已接近行数硬上限，故独立成文件。
 *
 * 姿态：
 *   glyph   静止汉字；等级环 + 等级点都在（环与点由 render.js 画）
 *   weapon  持续攻击期间常驻：每箭只播 瞄准 → 拉弦 → 放箭 → 箭飞行，
 *           箭与箭之间是「搭箭待发」的弓，绝不每箭闪回汉字；
 *           只有停火超过 art.weapon.idleHoldSec 才播 0.15s 回归过渡变回 glyph。
 * 开始攻击且不在 weapon 时播一次 0.08s「字变弓」（淡出 + 缩小 + 墨点，弓淡入）。
 * 每次开火重新锁定目标角度，弓当前角度用平滑插值转过去。
 * 升级 / 暂停 / 结算 / 重开一律强制 stance='glyph' 并清掉所有过渡缓存。
 *
 * 目标位置在开火瞬间锁进 u._bowAim（下划线前缀 = 渲染层表现缓存，逻辑层不读）：
 * 优先取 combat 刚发的 projectile 的 tx/ty（弹道终点 / 最后已知位置），
 * 否则退回 findTarget；目标中途死亡或漏掉，箭照样飞到缓存位置再消散。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var balance = null;
  var cfg = null;
  var dao = null;          // art.weapon.dao（刀的静态拆层参数）
  var daoCache = {};       // 刀拆层离屏图，只生成一次
  var hold = 1.2;          // art.weapon.idleHoldSec（数值表漏配时的兜底默认值）
  var maxDt = 0.1;         // 单帧最大步长，取 balance.loop.maxDtSec
  var FALLBACK = { x: 0, y: 0, angle: 0 };

  function init(b) {
    if (balance || !b || !b.art || !b.art.weapon || !b.art.weapon.bow) { return; }
    balance = b;
    cfg = b.art.weapon.bow;
    dao = b.art.weapon.dao || null;
    if (typeof b.art.weapon.idleHoldSec === 'number' && b.art.weapon.idleHoldSec > 0) {
      hold = b.art.weapon.idleHoldSec;
    }
    maxDt = (b.loop && b.loop.maxDtSec > 0) ? b.loop.maxDtSec : maxDt;
    if (Game.qiangFx) { Game.qiangFx.init(b); }   // 枪独立成文件（qiang-fx.js）
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function ink(x, y, oy, at, n) {
    if (Game.renderFx && balance) {
      Game.renderFx.spawnInk(x, y, oy, at, n, balance);
    }
  }

  /** 最短角差：把方向差折到 [-PI, PI]，避免 ±PI 边界处整圈甩头。 */
  function angleDelta(from, to) {
    var d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) { d -= Math.PI * 2; }
    if (d < -Math.PI) { d += Math.PI * 2; }
    return d;
  }

  /** 弓角度平滑插值：按真实帧间隔推进，帧率无关；首次从「朝右」的中性角起转。 */
  function advanceAngle(u, target, now) {
    var dt = clamp(now - (typeof u._bowFrameAt === 'number' ? u._bowFrameAt : now), 0, maxDt);
    var t = cfg.turnSec > 0 ? clamp(dt / cfg.turnSec, 0, 1) : 1;
    if (typeof u._bowAngle !== 'number') { u._bowAngle = 0; }
    u._bowAngle += angleDelta(u._bowAngle, target) * t;
    u._bowFrameAt = now;
    return u._bowAngle;
  }

  /** 强制回到汉字并清空全部过渡缓存（暂停 / 结算 / 重开 / 升级 / 回归结束）。 */
  function forceGlyph(u) {
    u.stance = 'glyph';
    u.lastAttackAt = -1;
    u._bowMorphAt = undefined;
    u._bowReturnAt = undefined;
    u._bowShotAt = undefined;
    u._bowAimAt = u._fireAt;   // 旧开火标记为已消费，恢复后不会被误判成新的一箭
    u._bowAim = null;
    u._bowAngle = 0;
    u._bowFrameAt = undefined;
    u._bowMissInkDone = 0;
  }

  /** 对整侧强制回归：结算 / 重开 / 返回首页由 main.js 调用。 */
  function reset(state) {
    if (!state) { return; }
    var i;
    var us = state.units || [];
    for (i = 0; i < us.length; i++) {
      if (us[i].kind === 'bow') { forceGlyph(us[i]); }
    }
    if (Game.qiangFx) { Game.qiangFx.reset(state); }   // 枪：强制回字 + 清方向缓存
    var ps = state.projectiles || [];
    for (i = 0; i < ps.length; i++) {
      ps[i]._bowDriven = 0;    // 交还给 drawProjectiles，免得结算后留下隐身箭
    }
  }

  /** 一箭的标称时长（沿用 render.animSec 的弓特例，避免两套公式分叉）。 */
  function shotSec(u, art) {
    if (Game.render && Game.render.animSec) {
      return Game.render.animSec(u, art && art.anim ? art.anim.bow : null);
    }
    var iv = u.intervalSec > 0 ? u.intervalSec : cfg.nominalSec;
    return Math.min(cfg.maxSec, iv * cfg.intervalFactor);
  }

  /** 开火瞬间锁定目标角度与终点（只读逻辑层）。命中的 projectile 打表现标记，避免画第二支箭。 */
  function lockAim(u, state, board, p) {
    var c = Game.combat.unitCenter(u);
    var tx = c.x + 2;
    var ty = c.y;
    var proj = null;
    var ps = state.projectiles || [];

    for (var i = 0; i < ps.length; i++) {
      var hit = ps[i];
      if (Math.abs(hit.x0 - c.x) < 0.6 && Math.abs(hit.y0 - c.y) < 0.6) {
        proj = hit;
        break;
      }
    }

    if (proj) {
      tx = proj.tx;
      ty = proj.ty;
      proj._bowDriven = 1;          // 视觉由本文件的飞行箭接管
    } else {
      var e = Game.combat.findTarget ? Game.combat.findTarget(u, state.enemies, board) : null;
      if (e) {
        var pos = board.pathPos(e.side, e.progress);
        tx = pos.cx;
        ty = pos.cy;
      }
    }

    var to = Game.render.toPx(board, null, tx, ty);
    u._bowAim = {
      x: to.x,
      y: to.y,
      angle: Math.atan2(to.y - p.y, to.x - p.x)
    };
  }

  /** 变形 / 回归阶段的「弓」字：淡入淡出 + 缩小 + 轻旋。 */
  function drawGlyphPhase(g, u, p, size, inkColor, alpha, scale, rot) {
    if (alpha <= 0.001) { return; }
    g.save();
    g.translate(p.x, p.y);
    g.rotate(rot);
    g.scale(scale, scale);
    /* drawGlyph 内部会自己设 globalAlpha，所以透明度必须走它的 alpha 参数 */
    Game.render.drawGlyph(g, u.char, 0, 0, inkColor, size, alpha, u.lv, true);
    g.restore();
  }

  /** 弓形：弧身 + V 形弦 + 搭弦箭；angle 让它面朝本次锁定的敌人。 */
  function drawBowShape(g, p, angle, alpha, pull, recoil) {
    var r = cfg.bowR;
    var a = cfg.bowArcRad;
    var upX = r * Math.cos(-a);
    var upY = r * Math.sin(-a);
    var dnX = r * Math.cos(a);
    var dnY = r * Math.sin(a);
    var sx = upX - cfg.stringPullPx * pull;

    g.save();
    g.globalAlpha = alpha;
    g.translate(p.x - Math.cos(angle) * recoil, p.y - Math.sin(angle) * recoil);
    g.rotate(angle);

    g.strokeStyle = cfg.drawColor;
    g.lineWidth = cfg.bowWidth;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, 0, r, -a, a);
    g.stroke();

    g.strokeStyle = cfg.stringColor;
    g.lineWidth = cfg.stringWidth;
    g.beginPath();
    g.moveTo(upX, upY);
    g.lineTo(sx, 0);
    g.lineTo(dnX, dnY);
    g.stroke();

    if (pull > 0 && Game.weaponArt) {
      Game.weaponArt.arrow(g, sx, 0, 1, cfg, cfg.arrowColor,
        cfg.nockAlphaBase + (1 - cfg.nockAlphaBase) * pull, 0);
    }
    g.restore();
  }

  /** 飞行箭：从单位中心沿锁定方向飞到弹道终点，末端淡出（消散）。 */
  function drawFlight(g, p, aim, flyK, alpha) {
    if (!Game.weaponArt || alpha <= 0.001) { return; }
    Game.weaponArt.arrow(g,
      lerp(p.x, aim.x, flyK), lerp(p.y, aim.y, flyK),
      1, cfg, cfg.arrowColor, alpha, aim.angle);
  }

  /** 目标已消失时，箭到终点撒一小撮墨点当作消散（正常命中由敌人掉血触发墨爆）。 */
  function missInk(u, state, board, tf, S, aim) {
    if (S < cfg.hitEnd || u._bowMissInkDone) { return; }
    u._bowMissInkDone = 1;
    var alive = false;
    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.dead || e.leaked) { continue; }
      var pos = board.pathPos(e.side, e.progress);
      var q = Game.render.toPx(board, null, pos.cx, pos.cy);
      if (Math.abs(q.x - aim.x) < board.CELL_W && Math.abs(q.y - aim.y) < board.CELL_H) {
        alive = true;
        break;
      }
    }
    if (!alive) { ink(aim.x, aim.y, tf.oy, state.elapsed, cfg.missInk); }
  }

  /**
   * drawBow —— render.js 每个弓单位每帧都调（不只是攻击帧），p 是格中心像素坐标。
   * k 保留兼容旧验收页；v3 一律用 state.elapsed 计时，姿态才不会被动画时长截断。
   */
  function drawBow(g, u, state, board, tf, p, k, art, color) {
    if (!cfg) { return; }
    if (u.stance !== 'glyph' && u.stance !== 'weapon') { u.stance = 'glyph'; }
    if (typeof u.lastAttackAt !== 'number') { u.lastAttackAt = -1; }
    var now = state.elapsed;

    /* 暂停 / 结算 / 重开 / 升级：强制回字并重置过渡。
     * 升级看 lv 跳变；重开看 elapsed 回退；结算看 status；main.js 另有显式 reset()。 */
    if (u.stance !== 'glyph' &&
        (state.status !== 'playing' || u._bowLv !== u.lv ||
         (typeof u._bowFrameAt === 'number' && now < u._bowFrameAt - maxDt))) {
      forceGlyph(u);
    }
    u._bowLv = u.lv;

    /* 新的一箭：重新锁目标、刷新 lastAttackAt；仅在 glyph→weapon 时播一次字变弓。 */
    var fireAt = u._fireAt;
    if (typeof fireAt === 'number' && fireAt !== u._bowAimAt && state.status === 'playing') {
      u._bowAimAt = fireAt;
      u.lastAttackAt = fireAt;
      u._bowShotAt = fireAt;
      u._bowMissInkDone = 0;
      u._bowReturnAt = undefined;
      if (u.stance !== 'weapon') {
        u.stance = 'weapon';
        u._bowMorphAt = fireAt;
        ink(p.x, p.y, tf.oy, now, cfg.inkBurst);
      } else {
        u._bowMorphAt = undefined;
      }
      lockAim(u, state, board, p);
    }

    var aim = u._bowAim;
    var angle = advanceAngle(u, aim ? aim.angle : 0, now);
    if (u.stance === 'weapon' && !aim) {
      aim = FALLBACK;
      FALLBACK.x = p.x + cfg.arrowLenPx * 2;
      FALLBACK.y = p.y;
    }

    /* 一箭内的标称时间轴：高攻速整体等比压缩，保证下一箭来之前已收尾。 */
    var scale = cfg.nominalSec / shotSec(u, art);
    var shotAt = typeof u._bowShotAt === 'number' ? u._bowShotAt : now;
    var T = Math.max(0, (now - shotAt) * scale);
    var morphing = typeof u._bowMorphAt === 'number' && T < cfg.morphEnd;
    var S = T + (typeof u._bowMorphAt === 'number' ? 0 : cfg.morphEnd);

    /* 停火超过 idleHoldSec 才启动 0.15s 回归；有箭在飞 / 正在变形都不打断。 */
    if (u.stance === 'weapon' && typeof u._bowReturnAt !== 'number' &&
        !morphing && S >= cfg.hitEnd && now - u.lastAttackAt >= hold) {
      u._bowReturnAt = now;
    }

    var gAlpha = 0, gScale = 1, gRot = 0;
    var bAlpha = 0, pull = 0, recoil = 0;
    var flying = false, flyK = 0, flightAlpha = 0;

    if (u.stance === 'glyph') {
      gAlpha = 1;                                  // 静止：只画「弓」字

    } else if (morphing) {
      /* ① 字变弓 0.08s：字淡出缩小轻旋 + 墨点，弓淡入，严格互斥不叠字 */
      var m = clamp(T / cfg.morphEnd, 0, 1);
      gAlpha = 1 - clamp(T / cfg.morphSwap, 0, 1);
      gScale = lerp(1, cfg.morphScale, m);
      gRot = lerp(0, cfg.morphRotDeg * Math.PI / 180, m);
      bAlpha = T < cfg.morphSwap ? 0
        : clamp((T - cfg.morphSwap) / (cfg.morphEnd - cfg.morphSwap), 0, 1);
      pull = cfg.idlePull;

    } else if (typeof u._bowReturnAt === 'number') {
      /* ② 回归过渡 0.15s：弓先淡出、字再淡入，结束落回 glyph */
      var rt = now - u._bowReturnAt;
      if (rt >= cfg.returnSec) {
        forceGlyph(u);
        gAlpha = 1;
      } else {
        bAlpha = 1 - clamp(rt / cfg.returnSwapSec, 0, 1);
        if (rt >= cfg.returnSwapSec) {
          var gk = clamp((rt - cfg.returnSwapSec) / (cfg.returnSec - cfg.returnSwapSec), 0, 1);
          gAlpha = gk;
          gScale = lerp(cfg.morphScale, 1, gk);
          gRot = lerp(cfg.morphRotDeg * Math.PI / 180, 0, gk);
        }
        pull = cfg.idlePull;
      }

    } else {
      /* ③ 瞄准 → 拉弦 → 放箭 → 箭飞行 → 搭箭待发（全程不显示字） */
      bAlpha = 1;
      if (S < cfg.aimEnd) {
        pull = cfg.idlePull;                     // 瞄准：弓平滑转向，箭已搭弦
      } else if (S < cfg.pullEnd) {
        pull = clamp((S - cfg.aimEnd) / (cfg.pullEnd - cfg.aimEnd), 0, 1);
      } else if (S < cfg.releaseEnd) {
        var q = clamp((S - cfg.pullEnd) / (cfg.releaseEnd - cfg.pullEnd), 0, 1);
        pull = 1 - q;
        recoil = cfg.recoilPx * q;
        flying = true;
      } else if (S < cfg.hitEnd) {
        recoil = cfg.recoilPx * 0.4 *
          (1 - clamp((S - cfg.releaseEnd) / (cfg.hitEnd - cfg.releaseEnd), 0, 1));
        flying = true;
      } else {
        pull = cfg.idlePull;                     // 箭与箭之间：搭箭待发
      }
      flyK = clamp((S - cfg.releaseEnd) / (cfg.hitEnd - cfg.releaseEnd), 0, 1);
      flightAlpha = clamp((cfg.hitEnd - S) / cfg.flightFadeSec, 0, 1);
    }

    if (bAlpha > 0.001) { drawBowShape(g, p, angle, bAlpha, pull, recoil); }
    if (flying) { drawFlight(g, p, aim, flyK, flightAlpha); }
    if (u.stance === 'weapon' && !morphing && typeof u._bowReturnAt !== 'number') {
      missInk(u, state, board, tf, S, aim);
    }
    if (gAlpha > 0.001) {
      drawGlyphPhase(g, u, p, art.glyph.unitSize, color.ink, gAlpha, gScale, gRot);
    }
  }

  /** 真弹道：由弓动画接管的 projectile 不重复画，其余仍按目标方向画成完整箭。 */
  function drawProjectiles(g, board, tf, state) {
    if (!cfg || !Game.weaponArt) { return; }
    var ps = state.projectiles || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (p._bowDriven) { continue; }
      var now = Game.render.toPx(board, tf, p.cx, p.cy);
      var end = Game.render.toPx(board, tf, p.tx, p.ty);
      var angle = Math.atan2(end.y - now.y, end.x - now.x);
      Game.weaponArt.arrow(g, now.x, now.y, 1, cfg, cfg.arrowColor, 1, angle);
    }
  }

  /* ===== 刀：左撇拆层 + 抡刀（Day 26 续 3）=====
   * 拆层在 cacheScale 倍字号的离屏缓存上做，再缩回 96px 逻辑尺寸：
   * 26px 直接切多边形会有明显锯齿，高倍缓存 + 缩小天然把斜边抗锯齿掉；
   * 遮罩另按 featherPx 做 0.5px 羽化。多边形内 = 挥动层（只留左撇），
   * 外 = 静止层（整字减去左撇，区内 alpha 归零，不留任何撇痕）。
   * 静止时不叠两层、直接画原字，所以羽化不会在字上留下浅色缝。
   */
  function daoFrame(size) {
    var box = balance.art.glyph.cacheSize;
    return { x: (box - size) / 2, y: (box - size) / 2, w: size, h: size, box: box };
  }

  function daoPolygonIn(frame, src) {
    var pts = [];
    for (var i = 0; i < src.length; i++) {
      pts.push({ x: frame.x + src[i][0] * frame.w, y: frame.y + src[i][1] * frame.h });
    }
    return pts;
  }

  function daoPolygon(size) { return daoPolygonIn(daoFrame(size), dao.strokePolygon); }

  function daoPivot(size) {
    var f = daoFrame(size);
    return { x: f.x + dao.pivot[0] * f.w, y: f.y + dao.pivot[1] * f.h };
  }

  /** 点在多边形内（射线法）；顶点是离屏缓存像素坐标。 */
  function daoInPoly(x, y, pts) {
    var hit = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > y) !== (yj > y) &&
          x < (xj - xi) * (y - yi) / (yj - yi) + xi) { hit = !hit; }
    }
    return hit;
  }

  /** 点到多边形边界的最短距离，用来给软遮罩做带符号距离。 */
  function daoEdgeDist(x, y, pts) {
    var best = Infinity;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var ax = pts[j].x, ay = pts[j].y, bx = pts[i].x, by = pts[i].y;
      var dx = bx - ax, dy = by - ay;
      var l2 = dx * dx + dy * dy;
      var t = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      var px = ax + t * dx - x, py = ay + t * dy - y;
      var d2 = px * px + py * py;
      if (d2 < best) { best = d2; }
    }
    return Math.sqrt(best);
  }

  /** 高倍离屏字：与 art.glyph 同一套字体 / 字重 / 纸色外圈，只是整体放大 scale 倍。
   *  conf 省略时用刀的 art.weapon.dao；枪传 art.weapon.qiang 共用同一套拆层管线。 */
  function daoHiGlyph(text, size, color, halo, conf) {
    var scale = (conf || dao).cacheScale;
    var gcfg = balance.art.glyph;
    var box = Math.round(gcfg.cacheSize * scale);
    var fs = size * scale;
    var c = document.createElement('canvas');
    c.width = box; c.height = box;
    var g = c.getContext('2d');
    if (!g || typeof g.fillText !== 'function') { return null; }
    var mid = box / 2;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = gcfg.weight + ' ' + fs + 'px ' + gcfg.fontStack;
    if (halo) {
      g.lineWidth = gcfg.paperStrokeWidth * scale;
      g.strokeStyle = balance.art.palette.paper;
      g.lineJoin = 'round';
      g.strokeText(text, mid, mid);
    }
    g.fillStyle = color;
    g.fillText(text, mid, mid);
    return { canvas: c, box: box,
      frame: { x: (box - fs) / 2, y: (box - fs) / 2, w: fs, h: fs } };
  }

  /**
   * daoBuild —— 带符号距离软遮罩，把高倍字缓存拆成两层。
   * swingT：边界 0.5、向内 1、向外 0（±featherPx 羽化）；
   * staticT：多边形内恒 0（撇完全清空），向外 2×羽化带淡入到 1。
   */
  function daoBuild(hi, pts, conf) {
    var c = conf || dao;
    var box = hi.box;
    var tmp = document.createElement('canvas');
    tmp.width = box; tmp.height = box;
    var tg = tmp.getContext('2d');
    if (!tg || typeof tg.getImageData !== 'function' || typeof tg.createImageData !== 'function') {
      return null;
    }
    tg.drawImage(hi.canvas, 0, 0);
    var sd = tg.getImageData(0, 0, box, box).data;
    var ia = tg.createImageData(box, box), ib = tg.createImageData(box, box);
    var A = ia.data, B = ib.data;
    var w = c.featherPx * c.cacheScale;
    var inkTotal = 0, inkInStroke = 0, residue = 0;

    for (var y = 0; y < box; y++) {
      for (var x = 0; x < box; x++) {
        var o = (y * box + x) * 4, a = sd[o + 3];
        if (a === 0) { continue; }
        var inside = daoInPoly(x + 0.5, y + 0.5, pts);
        var dist = daoEdgeDist(x + 0.5, y + 0.5, pts);
        var d = inside ? dist : -dist;
        var swingT = clamp(0.5 + d / (2 * w), 0, 1);
        var staticT = clamp(-d / (2 * w), 0, 1);
        var ca = a * staticT, cb = a * swingT;
        A[o] = sd[o]; A[o + 1] = sd[o + 1]; A[o + 2] = sd[o + 2]; A[o + 3] = ca;
        B[o] = sd[o]; B[o + 1] = sd[o + 1]; B[o + 2] = sd[o + 2]; B[o + 3] = cb;
        if (a >= 110 && (sd[o] + sd[o + 1] + sd[o + 2]) / 3 < 130) {
          inkTotal++;
          if (inside) { inkInStroke++; if (ca > 8) { residue++; } }
        }
      }
    }

    function toCanvas(img) {
      var c = document.createElement('canvas');
      c.width = box; c.height = box;
      var g = c.getContext('2d');
      if (g && typeof g.putImageData === 'function') { g.putImageData(img, 0, 0); }
      return c;
    }
    return {
      staticCanvas: toCanvas(ia), strokeCanvas: toCanvas(ib),
      inkTotal: inkTotal, inkInStroke: inkInStroke, residue: residue
    };
  }

  /** daoLayers —— 高倍拆层只生成一次；polygon / pivot 换算回 96px 逻辑坐标。 */
  function daoLayers(text, size, color, lv, halo) {
    if (!dao || typeof document === 'undefined' || !document.createElement) { return null; }
    var key = [text, size, color, lv || 0, halo ? 1 : 0,
      dao.cacheScale, dao.featherPx, dao.strokePolygon.length].join('|');
    if (daoCache[key]) { return daoCache[key]; }
    var hi = daoHiGlyph(text, size, color, halo);
    if (!hi) { return null; }
    var ptsHi = daoPolygonIn(hi.frame, dao.strokePolygon);
    var parts = daoBuild(hi, ptsHi);
    if (!parts) { return null; }
    var logical = balance.art.glyph.cacheSize;
    var pivot = daoPivot(size);
    var out = {
      sourceCanvas: hi.canvas,
      staticCanvas: parts.staticCanvas,
      strokeCanvas: parts.strokeCanvas,
      size: logical, canvasPx: hi.box, scale: dao.cacheScale,
      polygon: daoPolygon(size), pivot: pivot,
      pivotOff: { x: pivot.x - logical / 2, y: pivot.y - logical / 2 },
      inkTotal: parts.inkTotal, inkInStroke: parts.inkInStroke, residue: parts.residue
    };
    daoCache[key] = out;
    return out;
  }

  /* ===== 刀：抡刀动画（只读 state.elapsed / _fireAt，方向固定不追敌人）===== */

  function daoDuration(u) {
    var iv = u.intervalSec > 0 ? u.intervalSec : dao.maxSec;
    return Math.min(dao.maxSec, iv * dao.intervalFactor);
  }

  function easeOut(x) { return 1 - (1 - x) * (1 - x); }

  /** 起势 -15° → 抡刀 +35° → 回正过冲 -3° → 0°。 */
  function daoAngle(T) {
    if (T < dao.raiseEnd) {
      return dao.raiseDeg * easeOut(T / dao.raiseEnd);
    }
    if (T < dao.swingEnd) {
      return lerp(dao.raiseDeg, dao.swingDeg,
        easeOut((T - dao.raiseEnd) / (dao.swingEnd - dao.raiseEnd)));
    }
    if (T < dao.returnEnd) {
      var x = (T - dao.swingEnd) / (dao.returnEnd - dao.swingEnd);
      if (x < dao.overshootAt) {
        return lerp(dao.swingDeg, dao.overshootDeg, easeOut(x / dao.overshootAt));
      }
      return lerp(dao.overshootDeg, 0,
        easeOut((x - dao.overshootAt) / (1 - dao.overshootAt)));
    }
    return 0;
  }

  /** 以撇起笔点为轴画挥动层；alpha 给残影用。 */
  function daoDrawStroke(g, L, p, rad, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(p.x + L.pivotOff.x, p.y + L.pivotOff.y);
    g.rotate(rad);
    g.drawImage(L.strokeCanvas,
      -L.size / 2 - L.pivotOff.x, -L.size / 2 - L.pivotOff.y, L.size, L.size);
    g.restore();
  }

  function daoDebug(g, L, p) {
    g.save();
    g.translate(p.x - L.size / 2, p.y - L.size / 2);
    g.beginPath();
    for (var i = 0; i < L.polygon.length; i++) {
      if (i === 0) { g.moveTo(L.polygon[i].x, L.polygon[i].y); }
      else { g.lineTo(L.polygon[i].x, L.polygon[i].y); }
    }
    g.closePath();
    g.strokeStyle = dao.debug.polygonLine; g.lineWidth = 1; g.stroke();
    g.fillStyle = dao.debug.pivotColor;
    g.beginPath(); g.arc(L.pivot.x, L.pivot.y, 2, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /** drawDao —— render.js 每帧给「刀」调一次；静止画整字，攻击只让左撇动。 */
  function drawDao(g, u, state, p, art, color) {
    if (!dao) { return; }
    var L = daoLayers(u.char, art.glyph.unitSize, color.ink, u.lv, true);
    if (!L) {
      Game.render.drawGlyph(g, u.char, p.x, p.y, color.ink,
        art.glyph.unitSize, 1, u.lv, true);
      return;
    }
    var left = p.x - L.size / 2, top = p.y - L.size / 2;
    var t = typeof u._fireAt === 'number' ? state.elapsed - u._fireAt : -1;
    var dur = daoDuration(u);
    var active = state.status === 'playing' && t >= 0 && t < dur;

    if (!active) {
      g.drawImage(L.sourceCanvas, left, top, L.size, L.size);
    } else {
      var phaseScale = dur < dao.returnEnd ? dur / dao.returnEnd : 1;
      var T = t / phaseScale;
      var rad = daoAngle(T) * Math.PI / 180;
      /* 唯一一道残影：角度落后 4–6°，0.10 透明度在 0.10s 内淡到 0 */
      if (T >= dao.raiseEnd && T < dao.raiseEnd + dao.ghostSec) {
        var ga = dao.ghostAlpha * (1 - (T - dao.raiseEnd) / dao.ghostSec);
        daoDrawStroke(g, L, p, rad - dao.ghostLagDeg * Math.PI / 180, ga);
      }
      g.drawImage(L.staticCanvas, left, top, L.size, L.size);
      daoDrawStroke(g, L, p, rad, 1);
    }
    if (dao.debug && dao.debug.enabled) { daoDebug(g, L, p); }
  }

  Game.weaponFx = {
    init: init,
    drawBow: drawBow,
    drawProjectiles: drawProjectiles,
    reset: reset,
    resetUnit: forceGlyph,
    drawDao: drawDao,
    dao: {
      layers: daoLayers,
      polygon: daoPolygon,
      pivot: daoPivot,
      frame: daoFrame,
      duration: daoDuration,
      angle: daoAngle,
      cfg: function () { return dao; }
    },
    cfg: function () { return cfg; }
  };

  /* 给 qiang-fx.js 复用的共享拆层管线（高倍离屏字 + 带符号距离软遮罩）。 */
  Game.weaponFx.split = {
    frame: daoFrame,
    polygonIn: daoPolygonIn,
    inPoly: daoInPoly,
    edgeDist: daoEdgeDist,
    hiGlyph: daoHiGlyph,
    build: daoBuild
  };
})(globalThis);
