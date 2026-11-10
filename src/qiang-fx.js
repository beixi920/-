/* 单骑 · 汉字塔防 —— 枪：木变枪 + 姿态状态机（Day 26 续 4 v4）
 * 从 weapon-fx.js 按职责拆出：木 / 仓 拆层 + glyph ↔ weapon 状态机。
 * 与刀共用 weapon-fx.js 的高倍离屏字 + 带符号距离软遮罩管线（Game.weaponFx.split）。
 * 纯表现：只读 state / board / effects，只写单位上的 _ 前缀表现缓存，
 * 不改伤害 / 判定 / CD / 波次。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var S = null;
  var balance = null;
  var qiang = null;
  var cache = {};
  var hold = 1.2;
  var maxDt = 0.1;

  function init(b) {
    if (qiang || !b || !b.art || !b.art.weapon || !b.art.weapon.qiang) { return; }
    if (!Game.weaponFx || !Game.weaponFx.split) { return; }
    balance = b;
    qiang = b.art.weapon.qiang;
    S = Game.weaponFx.split;
    if (typeof qiang.idleHoldSec === 'number' && qiang.idleHoldSec > 0) {
      hold = qiang.idleHoldSec;
    }
    maxDt = (b.loop && b.loop.maxDtSec > 0) ? b.loop.maxDtSec : maxDt;
    Game.weaponFx.qiang = api;   // 兼容旧验收脚本的入口
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(x) { return 1 - (1 - x) * (1 - x); }

  /** 最短角差：把方向差折到 [-PI, PI]，避免 ±PI 边界处整圈甩头。 */
  function angleDelta(from, to) {
    var d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) { d -= Math.PI * 2; }
    if (d < -Math.PI) { d += Math.PI * 2; }
    return d;
  }

  function ink(x, y, oy, at, n) {
    if (Game.renderFx && balance) {
      Game.renderFx.spawnInk(x, y, oy, at, n, balance);
    }
  }

  /* ===== 枪：木 / 仓 静态拆层（Day 26 续 4 第一步）=====
   * 与刀共用「高倍离屏字 + 带符号距离软遮罩」管线，多边形换成木字旁区域：
   * 区内 = 挥动层（木，含竖画），区外 = 静止层（仓，区内 alpha 归零）。
   * 本轮只出静态拆层图等确认，攻击动画不接线、不改 render.js / 规则层。
   */
  function qiangPolygon(size) {
    return S.polygonIn(S.frame(size), qiang.muPolygon);
  }

  function qiangPivot(size) {
    var f = S.frame(size);
    return { x: f.x + qiang.pivot[0] * f.w, y: f.y + qiang.pivot[1] * f.h };
  }

  function qiangLayers(text, size, color, lv, halo) {
    if (!qiang || typeof document === 'undefined' || !document.createElement) { return null; }
    var key = [text, size, color, lv || 0, halo ? 1 : 0,
      qiang.cacheScale, qiang.featherPx, qiang.muPolygon.length].join('|');
    if (cache[key]) { return cache[key]; }
    var hi = S.hiGlyph(text, size, color, halo, qiang);
    if (!hi) { return null; }
    var ptsHi = S.polygonIn(hi.frame, qiang.muPolygon);
    var parts = S.build(hi, ptsHi, qiang);
    if (!parts) { return null; }
    var logical = balance.art.glyph.cacheSize;
    var pivot = qiangPivot(size);
    var out = {
      sourceCanvas: hi.canvas,
      staticCanvas: parts.staticCanvas,
      strokeCanvas: parts.strokeCanvas,
      size: logical, canvasPx: hi.box, scale: qiang.cacheScale,
      polygon: qiangPolygon(size), pivot: pivot,
      pivotOff: { x: pivot.x - logical / 2, y: pivot.y - logical / 2 },
      inkTotal: parts.inkTotal, inkInStroke: parts.inkInStroke, residue: parts.residue
    };
    cache[key] = out;
    return out;
  }

  /* ===== 枪：木变枪 + 姿态状态机（Day 26 续 4 v4）=====
   * glyph：整字「枪」；weapon：静止层「仓」（全程不动）+ 挥动层「木」拉伸成枪杆 + 枪头。
   * 第一次开火播一次 0.07s「木变枪」进入 weapon；之后每次攻击只播
   * 瞄准 → 前刺 → 收回待发，两次攻击之间保持枪形、枪尖朝目标；
   * 停火 ≥ idleHoldSec(1.2s) 播 0.15s「枪变回木」落回 glyph，再来敌人重新变形。
   * 方向在开火瞬间锁进 u._qiangAim（目标中途死亡也朝最后位置刺完再收回），
   * 瞄准与待发期间按 turnSec 平滑追当前目标。纯表现：不改伤害 / CD / 波次。
   */
  var QIANG_IDLE = { x: 0, y: 0, angle: -Math.PI / 2, pierce: 0 };

  function qiangDuration(u) {
    var iv = u.intervalSec > 0 ? u.intervalSec : qiang.maxSec;
    return Math.min(qiang.maxSec, iv * qiang.intervalFactor);
  }

  function qiangHoldSec() {
    return qiang.idleHoldSec > 0 ? qiang.idleHoldSec : hold;
  }

  /** 强制回到汉字并清空全部过渡缓存（暂停 / 结算 / 重开 / 升级 / 变回结束）。 */
  function qiangForceGlyph(u) {
    u.stance = 'glyph';
    u.lastAttackAt = -1;
    u._qiangMorphAt = undefined;
    u._qiangReturnAt = undefined;
    u._qiangShotAt = undefined;
    u._qiangAimAt = u._fireAt;   // 旧开火标记为已消费，恢复后不会被误判成新的一枪
    u._qiangAim = null;
    u._qiangAngle = 0;
    u._qiangFrameAt = undefined;
    u._qiangTrackAt = undefined;
    u._qiangLv = u.lv;
  }

  /** 枪头角度平滑插值：按真实帧间隔推进，换目标时不瞬移。
   *  增益 2 让 turnSec 0.12s 真正在 ~0.3s 内收敛（逐帧指数收敛若只用 dt/turnSec 会拖到 0.6s）。 */
  function advanceQiangAngle(u, target, now) {
    var dt = clamp(now - (typeof u._qiangFrameAt === 'number' ? u._qiangFrameAt : now), 0, maxDt);
    var t = qiang.turnSec > 0 ? clamp(dt * 2 / qiang.turnSec, 0, 1) : 1;
    if (typeof u._qiangAngle !== 'number') { u._qiangAngle = 0; }
    u._qiangAngle += angleDelta(u._qiangAngle, target) * t;
    u._qiangFrameAt = now;
    return u._qiangAngle;
  }

  /** 开火瞬间锁定目标：优先读 combat 本帧刚推入的 line effect（主目标 / 最后命中位置），
   *  再退回 findTarget；都没取到就沿用上次 aim，目标中途死亡也朝最后位置刺完再收回。 */
  function qiangLockAim(u, state, board, p) {
    var eff = null, fx = state.effects || [];
    for (var i = fx.length - 1; i >= 0; i--) {
      if (fx[i].type === 'line') { eff = fx[i]; break; }
    }
    var tx, ty;
    if (eff) {
      tx = eff.x1; ty = eff.y1;
    } else {
      var e = Game.combat.findTarget ? Game.combat.findTarget(u, state.enemies, board) : null;
      if (e) { var pos = board.pathPos(e.side, e.progress); tx = pos.cx; ty = pos.cy; }
    }
    if (tx === undefined) {
      if (u._qiangAim) { return u._qiangAim; }
      var c = Game.combat.unitCenter(u);
      tx = c.x + 1; ty = c.y;
    }
    var to = Game.render.toPx(board, null, tx, ty);
    var pierce = eff &&
      (Math.abs(eff.x2 - eff.x1) > 0.01 || Math.abs(eff.y2 - eff.y1) > 0.01) ? 1 : 0;
    u._qiangAim = {
      x: to.x, y: to.y,
      angle: Math.atan2(to.y - p.y, to.x - p.x),
      pierce: pierce
    };
    return u._qiangAim;
  }

  /** 待发期间追当前目标：找到就更新方向，找不到就保持上一方向（目标死了不甩头）。
   *  只在两次攻击之间调用；攻击帧（瞄准 / 前刺 / 收回）一律用开火瞬间锁定的方向。 */
  function qiangTrackAim(u, state, board, p) {
    var e = Game.combat.findTarget ? Game.combat.findTarget(u, state.enemies, board) : null;
    if (!e) { return; }
    var pos = board.pathPos(e.side, e.progress);
    var to = Game.render.toPx(board, null, pos.cx, pos.cy);
    u._qiangAim = {
      x: to.x, y: to.y,
      angle: Math.atan2(to.y - p.y, to.x - p.x),
      pierce: u._qiangAim ? u._qiangAim.pierce : 0
    };
  }

  /** 一次攻击的相位：瞄准（0~aimFrac）→ 前刺（~thrustFrac）→ 收回待发。 */
  function qiangAttackPhase(S, dur) {
    var active = S >= 0 && S < dur;
    var k = dur > 0 ? clamp(S / dur, 0, 1) : 1;
    var thrust = 0;
    if (active) {
      if (k >= qiang.aimFrac && k < qiang.thrustFrac) {
        thrust = easeOut((k - qiang.aimFrac) / (qiang.thrustFrac - qiang.aimFrac));
      } else if (k >= qiang.thrustFrac) {
        thrust = 1 - easeOut((k - qiang.thrustFrac) / (1 - qiang.thrustFrac));
      }
    }
    return { active: active, k: k, thrust: thrust };
  }

  /** 画枪形态：木层沿自身竖轴拉伸成枪杆 + 顶端三角枪头。
   *  formK 0→1 是「木→枪」成形度（形体 / 角度 / 枪头一起淡入），
   *  thrust 0→1 是前刺，lagPx / alpha 给唯一一道残影用。 */
  function qiangDrawMu(g, L, p, aim, rad, thrust, formK, alpha, cellW, unitSize, inkColor, lagPx) {
    if (alpha <= 0.001 || formK <= 0.001) { return; }
    var reach = qiang.extendCells * cellW * thrust * formK - (lagPx || 0);
    var sy = lerp(1, qiang.spearLen * (1 + (qiang.thrustStretch - 1) * thrust), formK);
    /* 枪头接在木竖画顶端：坐标相对「握把轴」pivot，而不是字框中心 */
    var topY = (qiang.headTopY - qiang.pivot[1]) * unitSize;
    var headLen = qiang.headLenRatio * unitSize;
    var headHalf = qiang.headHalfRatio * unitSize;

    g.save();
    g.globalAlpha = alpha;
    /* 成形时锚点从「木原位」滑到「单位中心」：木抬起来变成握在手里的枪，
     * 而不是绕自身中心转、整块甩到仓那边去。前移仍严格沿枪头方向。 */
    var ax = p.x + L.pivotOff.x * (1 - formK);
    var ay = p.y + L.pivotOff.y * (1 - formK);
    g.translate(ax + Math.cos(aim.angle) * reach, ay + Math.sin(aim.angle) * reach);
    g.rotate(rad * formK);
    g.scale(1, sy);
    g.drawImage(L.strokeCanvas, -L.pivot.x, -L.pivot.y, L.size, L.size);
    g.globalAlpha = alpha * formK;
    g.fillStyle = inkColor;
    g.beginPath();
    g.moveTo(0, topY - headLen);
    g.lineTo(-headHalf, topY);
    g.lineTo(headHalf, topY);
    g.closePath();
    g.fill();
    g.restore();
  }

  /** 贯穿：本次攻击真的串了多个敌人时，沿枪身线点 2–4 个很小的淡墨点（不叠粒子池）。 */
  function qiangDrawPierce(g, p, aim, reach, alpha, inkColor) {
    if (!aim.pierce || alpha <= 0.001) { return; }
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = inkColor;
    for (var i = 0; i < qiang.pierceDots; i++) {
      var q = (i + 1) / (qiang.pierceDots + 1);
      var d = reach * (qiang.pierceDotFrom + (1 - qiang.pierceDotFrom) * q);
      g.beginPath();
      g.arc(p.x + Math.cos(aim.angle) * d, p.y + Math.sin(aim.angle) * d,
        qiang.pierceDotR, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function qiangDebug(g, L, p) {
    g.save();
    g.translate(p.x - L.size / 2, p.y - L.size / 2);
    g.beginPath();
    for (var i = 0; i < L.polygon.length; i++) {
      if (i === 0) { g.moveTo(L.polygon[i].x, L.polygon[i].y); }
      else { g.lineTo(L.polygon[i].x, L.polygon[i].y); }
    }
    g.closePath();
    g.strokeStyle = qiang.debug.polygonLine; g.lineWidth = 1; g.stroke();
    g.fillStyle = qiang.debug.pivotColor;
    g.beginPath(); g.arc(L.pivot.x, L.pivot.y, 2, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /** drawQiang —— render.js 每帧给「枪」调一次。
   *  姿态机：glyph ↔ weapon；weapon 期间每枪只播 瞄准→前刺→收回待发。 */
  function drawQiang(g, u, state, board, p, art, color) {
    if (!qiang) { return; }
    var L = qiangLayers(u.char, art.glyph.unitSize, color.ink, u.lv, true);
    if (!L) {
      Game.render.drawGlyph(g, u.char, p.x, p.y, color.ink,
        art.glyph.unitSize, 1, u.lv, true);
      return;
    }
    var left = p.x - L.size / 2, top = p.y - L.size / 2;
    var now = state.elapsed;

    if (u.stance !== 'glyph' && u.stance !== 'weapon') { u.stance = 'glyph'; }
    if (typeof u.lastAttackAt !== 'number') { u.lastAttackAt = -1; }

    /* 暂停 / 结算 / 重开 / 升级：强制回字并清过渡 */
    if (u.stance !== 'glyph' &&
        (state.status !== 'playing' || u._qiangLv !== u.lv ||
         (typeof u._qiangFrameAt === 'number' && now < u._qiangFrameAt - maxDt))) {
      qiangForceGlyph(u);
    }
    u._qiangLv = u.lv;

    /* 新的一枪：锁目标、刷新 lastAttackAt；glyph→weapon 或变回木途中重新成形 */
    var fireAt = u._fireAt;
    if (typeof fireAt === 'number' && fireAt !== u._qiangAimAt && state.status === 'playing') {
      u._qiangAimAt = fireAt;
      u.lastAttackAt = fireAt;
      u._qiangShotAt = fireAt;
      if (u.stance !== 'weapon') {
        u.stance = 'weapon';
        u._qiangMorphAt = fireAt;
        u._qiangAngle = 0;
        u._qiangFrameAt = undefined;
      } else if (typeof u._qiangReturnAt === 'number') {
        u._qiangReturnAt = undefined;      // 变回木途中又来敌人：重新播「木变枪」
        u._qiangMorphAt = fireAt;
        u._qiangAngle = 0;
        u._qiangFrameAt = undefined;
      } else {
        u._qiangMorphAt = undefined;
      }
      qiangLockAim(u, state, board, p);
    }

    if (u.stance === 'glyph') {
      g.drawImage(L.sourceCanvas, left, top, L.size, L.size);
      return;
    }

    var dur = qiangDuration(u);
    var S = typeof u._qiangShotAt === 'number' ? now - u._qiangShotAt : 1e9;
    var ph = qiangAttackPhase(S, dur);

    /* 只在两次攻击之间追当前目标；攻击帧保持开火瞬间锁定的方向。
     * 60ms 节流：枪兵多时不必每帧为每个单位扫一遍敌人列表，转向仍逐帧平滑。 */
    if (!ph.active &&
        (typeof u._qiangTrackAt !== 'number' || now - u._qiangTrackAt >= 0.06)) {
      qiangTrackAim(u, state, board, p);
      u._qiangTrackAt = now;
    }
    var aim = u._qiangAim || QIANG_IDLE;
    var rad = advanceQiangAngle(u, aim.angle + Math.PI / 2, now);

    /* 「木变枪」0.07s：mk 0→1，木从原样拉伸成枪杆 / 转向目标 / 枪头淡入 */
    var mk = 1, morphing = false;
    if (typeof u._qiangMorphAt === 'number') {
      var mt = now - u._qiangMorphAt;
      if (mt < qiang.morphInSec) {
        morphing = true;
        mk = clamp(mt / qiang.morphInSec, 0, 1);
      } else {
        u._qiangMorphAt = undefined;
      }
    }

    /* 停火 ≥ idleHoldSec 才启动「枪变回木」0.15s；结束时落回 glyph */
    var rk = 0, returning = false;
    if (typeof u._qiangReturnAt === 'number') {
      rk = clamp((now - u._qiangReturnAt) / qiang.morphOutSec, 0, 1);
      if (rk >= 1) {
        qiangForceGlyph(u);
        g.drawImage(L.sourceCanvas, left, top, L.size, L.size);
        return;
      }
      returning = true;
    } else if (!morphing && !ph.active && now - u.lastAttackAt >= qiangHoldSec()) {
      u._qiangReturnAt = now;
      returning = true;
    }

    var formK = morphing ? mk : (returning ? 1 - rk : 1);
    var woodAlpha = returning ? 1 - rk : 1;
    var glyphAlpha = morphing ? (1 - mk) : (returning ? rk : 0);
    var cellW = board.CELL_W, unitSize = art.glyph.unitSize;

    g.drawImage(L.staticCanvas, left, top, L.size, L.size);   // 仓：全程不动

    /* 唯一一道残影：前刺段 0.10s 内 0.09→0，沿刺出方向落后 3px */
    if (!morphing && !returning && ph.active && ph.k >= qiang.aimFrac) {
      var age = (ph.k - qiang.aimFrac) * dur;
      if (age >= 0 && age < qiang.ghostSec) {
        qiangDrawMu(g, L, p, aim, rad, ph.thrust * 0.75, formK,
          qiang.ghostAlpha * (1 - age / qiang.ghostSec),
          cellW, unitSize, color.ink, qiang.ghostLagPx);
      }
    }
    qiangDrawMu(g, L, p, aim, rad, ph.thrust, formK, woodAlpha,
      cellW, unitSize, color.ink, 0);
    if (ph.active && !morphing && !returning) {
      qiangDrawPierce(g, p, aim, qiang.extendCells * cellW * ph.thrust,
        qiang.pierceDotAlpha * ph.thrust, color.ink);
    }
    /* 变形 / 变回期间与整字交叉淡入淡出；仓像素重合，不会留缝 */
    if (glyphAlpha > 0.001) {
      g.save();
      g.globalAlpha = glyphAlpha;
      g.drawImage(L.sourceCanvas, left, top, L.size, L.size);
      g.restore();
    }
    if (qiang.debug && qiang.debug.enabled) { qiangDebug(g, L, p); }
  }


  /** 结算 / 重开：枪全部强制回字，清掉上一局的方向与过渡缓存。 */
  function reset(state) {
    if (!state) { return; }
    var us = state.units || [];
    for (var i = 0; i < us.length; i++) {
      if (us[i].kind === 'spear') { qiangForceGlyph(us[i]); }
    }
  }

  var api = {
    init: init,
    draw: drawQiang,
    reset: reset,
    layers: qiangLayers,
    polygon: qiangPolygon,
    pivot: qiangPivot,
    frame: function (size) { return S.frame(size); },
    duration: qiangDuration,
    attack: qiangAttackPhase,
    lock: qiangLockAim,
    forceGlyph: qiangForceGlyph,
    holdSec: qiangHoldSec,
    cfg: function () { return qiang; }
  };
  Game.qiangFx = api;
})(globalThis);
