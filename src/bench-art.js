/* 单骑 · 汉字塔防 —— 备战席卡面图标（加餐 E）
 * 职责：用 Canvas 程序化画「铲子」卡面（不引任何图片），并给拖影复用同一张图。
 * 风格对着 ref/3.jpg：短木柄 + 深灰铲头 + 粗黑描边（约 2px）+ 底部淡阴影。
 * 纯表现：只读 DATA.balance.art.bench.shovel，不碰任何规则状态。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var cache = {};          // 按「取整后的边长」缓存，卡面尺寸固定，正常只生成一次

  function cfg() {
    var b = global.DATA && global.DATA.balance;
    return (b && b.art && b.art.bench && b.art.bench.shovel) || null;
  }

  /**
   * drawShovel —— 在 0~size 的方框里画一把铲子。
   * 所有几何值都是 c 里的「边长比例」，换尺寸只改 size，不改形状。
   */
  function drawShovel(g, size) {
    var c = cfg();
    if (!c || !g) {
      return;
    }

    var px = function (k) { return k * size; };
    var ow = c.outlinePx;            // 粗黑描边：固定 px，图标放大小也保持"手绘粗线"感

    /* ① 底部淡阴影：偏右下，压在铲头下面 */
    g.save();
    g.fillStyle = c.shadow;
    g.beginPath();
    g.ellipse(px(c.headCx + 0.05), px(c.headCy + 0.22),
      px(c.headW * 0.72), px(c.headH * 0.18), 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    /* ② 木柄：先画粗一圈的黑边，再用木色压上去，边缘自然剩 2px 墨线 */
    var hw = px(c.handleWidth);
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = c.outline;
    g.lineWidth = hw + ow * 2;
    g.beginPath();
    g.moveTo(px(c.handleX1), px(c.handleY1));
    g.lineTo(px(c.handleX2), px(c.handleY2));
    g.stroke();

    g.strokeStyle = c.wood;
    g.lineWidth = hw;
    g.beginPath();
    g.moveTo(px(c.handleX1), px(c.handleY1));
    g.lineTo(px(c.handleX2), px(c.handleY2));
    g.stroke();

    // 木柄受光：沿柄方向偏左上的一条细亮线
    g.strokeStyle = c.woodEdge;
    g.lineWidth = Math.max(1, hw * 0.22);
    g.beginPath();
    g.moveTo(px(c.handleX1 + 0.012), px(c.handleY1 - 0.012));
    g.lineTo(px(c.handleX2 + 0.006), px(c.handleY2 + 0.006));
    g.stroke();
    g.restore();

    /* ③ 铲头：上宽下尖的锹形，右上角带一个踩踏台阶（参考图里那块小凸起） */
    var cx = px(c.headCx);
    var cy = px(c.headCy);
    var hwd = px(c.headW) / 2;
    var hhh = px(c.headH) / 2;

    g.save();
    g.beginPath();
    g.moveTo(cx - hwd, cy - hhh * 0.94);
    g.lineTo(cx + hwd * 0.94, cy - hhh * 0.70);
    g.lineTo(cx + hwd * 0.86, cy + hhh * 0.10);
    g.quadraticCurveTo(cx + hwd * 0.58, cy + hhh * 0.76, cx + hwd * 0.10, cy + hhh * 0.94);
    g.lineTo(cx - hwd * 0.10, cy + hhh * 0.94);
    g.quadraticCurveTo(cx - hwd * 0.58, cy + hhh * 0.76, cx - hwd * 0.86, cy + hhh * 0.10);
    g.closePath();

    g.fillStyle = c.head;
    g.fill();
    g.lineWidth = ow;
    g.strokeStyle = c.outline;
    g.lineJoin = 'round';
    g.stroke();

    // 受光面：铲头左上半部提亮，别让整块死灰
    g.beginPath();
    g.moveTo(cx - hwd * 0.82, cy - hhh * 0.62);
    g.lineTo(cx + hwd * 0.30, cy - hhh * 0.46);
    g.lineTo(cx - hwd * 0.10, cy + hhh * 0.30);
    g.lineTo(cx - hwd * 0.60, cy + hhh * 0.10);
    g.closePath();
    g.fillStyle = c.headLight;
    g.globalAlpha = 0.55;
    g.fill();
    g.restore();
  }

  /**
   * shovelIcon —— 取一张画好铲子的离屏 canvas（带 DPR，卡面对应 CSS 尺寸）。
   * 尺寸取整后再缓存，避免亚像素尺寸把缓存撑爆。
   */
  function shovelIcon(size) {
    if (typeof document === 'undefined' || !document.createElement) {
      return null;
    }

    var s = Math.max(8, Math.round(size || 32));
    var dpr = (global.devicePixelRatio || 1);
    var key = s + '@' + dpr;
    if (cache[key]) {
      return cache[key];
    }

    var c = document.createElement('canvas');
    c.width = Math.round(s * dpr);
    c.height = Math.round(s * dpr);
    c.style.width = s + 'px';
    c.style.height = s + 'px';

    var g = c.getContext('2d');
    if (!g) {
      return null;
    }
    g.scale(dpr, dpr);
    drawShovel(g, s);

    cache[key] = c;
    return c;
  }

  Game.benchArt = {
    drawShovel: drawShovel,
    shovelIcon: shovelIcon
  };
})(globalThis);
