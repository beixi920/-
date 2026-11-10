/* 单骑 · 汉字塔防 —— 字形变武器层（Day 26）
 * 规矩：只负责「把字的一部分画成武器出手」，不读 state、不改判定、不产生伤害。
 * 全部是 Canvas 路径（arc / lineTo / stroke / fill），零图片、零外链、零随机数。
 * 调用点在 render.js 的 drawUnitWithAnim：那时画布已 translate/rotate/scale 到字的局部坐标，
 * 原点就是字中心，所以这里所有坐标都是「相对字中心」的小尺寸。
 *
 * 和「字本身变形」的分工：render.js 的 shapeFor 管字（位移 ≤0.1 格、旋转、拉伸），
 * 这里管武器（只有武器能前伸）。字不会飞到敌人身上，符合 ART.md 3.6 的原地形变原则。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var D = Math.PI / 180;

  /* 搭弦 / 离弦 / 真弹道共用的一支箭：线 + 三角箭头 + 尾羽。
   * dir=1 向右、dir=-1 向左；angle 给弹道箭转向目标；alpha 由调用方按飞行进度给。 */
  function arrow(g, x, y, dir, w, ink, alpha, angle) {
    g.save();
    g.translate(x, y);
    if (angle) { g.rotate(angle); }
    g.globalAlpha = alpha;
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = w.arrowWidth || 1.6;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    var tip = dir * w.arrowLenPx;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(tip, 0);
    g.stroke();

    /* 三角箭头：实心 */
    g.beginPath();
    g.moveTo(tip + dir * w.headLen, 0);
    g.lineTo(tip, -w.headHalf);
    g.lineTo(tip, w.headHalf);
    g.closePath();
    g.fill();

    /* 尾羽：两根斜线 */
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-dir * w.featherPx, -w.featherPx * 0.7);
    g.moveTo(0, 0);
    g.lineTo(-dir * w.featherPx, w.featherPx * 0.7);
    g.stroke();
    g.restore();
  }

  /* 刀（旧版）：左侧长撇变月牙刀刃。Day 26 续 3 起刀改走 weapon-fx.js 的
   * 「拆层抡刀」（整字不动、只抡左撇），本函数与 art.weapon.blade 已不再被调用，
   * 留着只是为了不改动枪 / 骑的既有实现。 */
  function blade(g, k, w, ink, edge) {
    var a = (w.fromDeg + (w.toDeg - w.fromDeg) * k) * D;

    g.save();
    g.translate(w.originX, w.originY);
    g.rotate(a);

    /* 刀柄：从字里长出来的一小段 */
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-5, 7);
    g.lineTo(0, 1);
    g.stroke();

    /* 月牙刃：一段粗弧 + 外侧一道朱砂细锋 */
    g.strokeStyle = ink;
    g.lineWidth = w.width;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, -w.radius * 0.55, w.radius, 0.16 * Math.PI, 0.84 * Math.PI);
    g.stroke();
    g.strokeStyle = edge;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, -w.radius * 0.55, w.radius + 2, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
    g.restore();

    /* 劈砍墨痕：从左上到右下，只在刀尖扫过之后淡出 */
    if (k >= w.slashAt) {
      var q = (k - w.slashAt) / (1 - w.slashAt);
      g.save();
      g.globalAlpha = (1 - q) * 0.85;
      g.strokeStyle = ink;
      g.lineWidth = w.slashWidth;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-w.slashLen / 2, -w.slashLen / 2);
      g.lineTo(w.slashLen / 2, w.slashLen / 2);
      g.stroke();
      g.restore();
    }
  }

  /* 枪（旧版）：左侧「木」偏旁位置画独立枪杆 + 三角枪头。Day 26 续 4 起
   * 枪改走 weapon-fx.js 的拆层直刺，本函数与 art.weapon.spear 已作废，
   * 保留只为不改动骑的既有实现。 */
  function spear(g, k, w, board, ink, edge) {
    var reach = w.thrustCells * board.CELL_W * Math.sin(k * Math.PI);
    var len = w.shaftLen * w.stretch;
    var x0 = w.originX - len / 2;
    var tip = x0 + len + reach;

    g.save();
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, 0);
    g.lineTo(tip, 0);
    g.stroke();

    /* 三角枪头 */
    g.beginPath();
    g.moveTo(tip + w.headLen, 0);
    g.lineTo(tip, -w.headHalf);
    g.lineTo(tip, w.headHalf);
    g.closePath();
    g.fill();

    /* 红缨 */
    g.strokeStyle = edge;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(tip, 0);
    g.lineTo(tip - 5, -5);
    g.moveTo(tip, 0);
    g.lineTo(tip - 5, 5);
    g.stroke();

    /* 沿途贯穿墨点：跟着枪杆一起往前推，不叠粒子池 */
    g.fillStyle = ink;
    g.globalAlpha = 0.55 + 0.3 * Math.sin(k * Math.PI);
    for (var i = 0; i < w.dots; i++) {
      var dx = (i + 1) / (w.dots + 1) * (len + reach);
      g.beginPath();
      g.arc(x0 + dx, 0, w.dotR, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /* 弓已移到 src/weapon-fx.js 的「字变武器」v2；这里只留刀 / 枪 / 骑。
   * 通用 arrow() 仍供 weapon-fx.js 与 render.js 的弹道箭复用。 */

  /* 骑：右下底横变方天画戟，绕单位抡约 300°；2–3 道圆弧残影按溅射半径铺开。 */
  function ride(g, k, w, u, board, ink, edge) {
    var sweep = w.sweepDeg * D;
    var a0 = -sweep / 2;
    var radius = (u.splashRadius || 1) * board.CELL_W * w.radiusFactor;

    /* 圆弧残影：越靠后的越淡、越短，只用 stroke，不产生粒子 */
    g.save();
    g.strokeStyle = edge;
    g.lineWidth = w.arcWidth;
    g.lineCap = 'round';
    for (var i = 0; i < w.ghostArcs; i++) {
      var lag = (i + 1) * 0.1;
      var ak = k - lag;
      if (ak <= 0) { continue; }
      g.globalAlpha = w.ghostAlpha - i * w.ghostAlphaStep;
      g.beginPath();
      g.arc(0, 0, radius * (0.55 + i * 0.12), a0, a0 + sweep * ak);
      g.stroke();
    }
    g.restore();

    /* 方天画戟本体：杆 + 三角戟头 + 两侧枝 */
    g.save();
    g.translate(w.originX, w.originY);
    g.rotate(a0 + sweep * k);
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -w.halberdLen);
    g.stroke();

    g.beginPath();
    g.moveTo(0, -w.halberdLen - w.headLen);
    g.lineTo(-3.5, -w.halberdLen);
    g.lineTo(3.5, -w.halberdLen);
    g.closePath();
    g.fill();

    g.strokeStyle = edge;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -w.halberdLen * 0.7);
    g.lineTo(-w.branchLen, -w.halberdLen * 0.7 - 3);
    g.moveTo(0, -w.halberdLen * 0.7);
    g.lineTo(w.branchLen, -w.halberdLen * 0.7 - 3);
    g.stroke();
    g.restore();
  }

  /** draw —— 在字的局部坐标里画当前兵种的武器。art = balance.art（含 anim / weapon）。 */
  function draw(g, kind, k, u, board, art, color) {
    if (!art || !art.weapon || !color) { return; }
    var w = art.weapon;
    var ink = w.ink || color.ink;
    var edge = w.edge || color.cinnabar;

    if (kind === 'blade') {
      blade(g, k, w.blade, ink, edge);
    } else if (kind === 'spear') {
      /* Day 26 续 4 起枪改走 src/weapon-fx.js 的「木偏旁拆层直刺」：
       * 整字不再形变、也不再另画独立枪杆 / 枪头，枪尖就是木竖画顶端的小三角。
       * 本分支保留为空，是为了不动骑的既有实现；render.js 已提前分流，不会走到这里。 */
    } else if (kind === 'ride') {
      ride(g, k, w.ride, u, board, ink, edge);
    }
  }

  Game.weaponArt = {
    draw: draw,
    arrow: arrow
  };
})(globalThis);
