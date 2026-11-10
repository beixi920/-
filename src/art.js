/* 单骑 · 汉字塔防 —— 离屏资源层（ART.md 4.1 第 0 层 + 4.2 性能铁律）
 * 职责：宣纸纹理、汉字预渲染缓存。只生成一次，之后每帧只 drawImage。
 * 不读写 state、不碰游戏判定；随机走 Game.rng 的 seeded 状态，不用原生随机数。
 * 从 render.js 拆出：那边要放攻击形变与受击表现，不能挤破 800 行硬上限。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var cfg = null;
  var paperCanvas = null;
  var glyphCache = {};

  /** init —— 第一帧调用；顺便把数值表色板同步给 render.js 的 COLOR。 */
  function init(balance, board, colorTable) {
    cfg = balance.art;
    if (cfg && cfg.palette && colorTable) {
      colorTable.paper = cfg.palette.paper;
      colorTable.ink = cfg.palette.ink;
      colorTable.lightInk = cfg.palette.lightInk;
      colorTable.cinnabar = cfg.palette.cinnabar;
      colorTable.gold = cfg.palette.gold;
      colorTable.qualityGold = cfg.palette.gold;
      colorTable.qualityPurple = cfg.palette.purple;
    }
    if (!paperCanvas) {
      paperCanvas = makePaper(board);
    }
  }

  function getCfg() { return cfg; }
  function getPaper() { return paperCanvas; }

  /** radial —— 能力检测：缺 createRadialGradient 时跳过水渍/暗角，不白屏。 */
  function radial(g, x, y, r0, r1, c0, c1) {
    if (typeof g.createRadialGradient !== 'function') {
      return null;
    }
    var rg = g.createRadialGradient(x, y, r0, x, y, r1);
    if (!rg || typeof rg.addColorStop !== 'function') {
      return null;
    }
    rg.addColorStop(0, c0);
    rg.addColorStop(1, c1);
    return rg;
  }

  /** makePaper —— 三层配方（ART.md 3.3）：底色 → 水渍 → 噪点 → 纤维 → 暗角。 */
  function makePaper(board) {
    if (!cfg || typeof document === 'undefined' || !document.createElement) {
      return null;
    }
    var p = cfg.paper;
    var c = document.createElement('canvas');
    c.width = board.WIDTH;
    c.height = board.DUEL_HEIGHT;
    var g = c.getContext('2d');
    if (!g || typeof g.fillRect !== 'function') {
      return null;
    }

    var rng = { seed: p.seed >>> 0 };
    function rand() { return Game.rng.next(rng); }

    g.fillStyle = cfg.palette.paper;
    g.fillRect(0, 0, c.width, c.height);

    for (var i = 0; i < p.stainCount; i++) {
      var x = rand() * c.width;
      var y = rand() * c.height;
      var r = p.stainMinR + rand() * (p.stainMaxR - p.stainMinR);
      var rg = radial(g, x, y, 0, r, p.stainColor, 'rgba(150,120,70,0)');
      if (rg) {
        g.fillStyle = rg;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }

    for (var n = 0; n < p.noiseCount; n++) {
      var a = p.noiseAlphaMin + rand() * (p.noiseAlphaMax - p.noiseAlphaMin);
      g.fillStyle = 'rgba(' + p.noiseRgb + ',' + a + ')';
      g.fillRect(rand() * c.width, rand() * c.height, 1, 1);
    }

    g.strokeStyle = p.fiberColor;
    g.lineWidth = 1;
    for (var f = 0; f < p.fiberCount; f++) {
      var fx = rand() * c.width;
      var fy = rand() * c.height;
      var ang = rand() * Math.PI;
      var len = p.fiberMinLen + rand() * (p.fiberMaxLen - p.fiberMinLen);
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len);
      g.stroke();
    }

    var v = radial(g, c.width / 2, c.height / 2,
      c.height * p.vignetteInner, c.height * p.vignetteOuter,
      'rgba(60,45,25,0)', p.vignetteColor);
    if (v) {
      g.fillStyle = v;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  /**
   * glyph —— 汉字预渲染缓存，键 = 字 + 字号 + 颜色 + 等级 + 是否带纸色外圈。
   * ART.md 3.5 修订：24–26px 小字不能照搬 demo 74px 的墨色描边（会糊成一团），
   * 改为楷体 400 + 纸色外圈 + 墨色填充；高分屏按 DPR 放大缓存、绘制时缩回。
   */
  function glyph(text, size, color, lv, halo) {
    var key = text + '|' + size + '|' + color + '|' + (lv || 0) + '|' + (halo ? 1 : 0);
    if (glyphCache[key]) {
      return glyphCache[key];
    }
    if (!cfg || typeof document === 'undefined' || !document.createElement) {
      return null;
    }

    var gcfg = cfg.glyph;
    var logical = gcfg.cacheSize;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var c = document.createElement('canvas');
    c.width = Math.round(logical * dpr);
    c.height = Math.round(logical * dpr);
    var g = c.getContext('2d');
    if (!g || typeof g.fillText !== 'function') {
      return null;
    }

    if (dpr > 1 && typeof g.scale === 'function') {
      g.scale(dpr, dpr);
    }
    var mid = logical / 2;

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = gcfg.weight + ' ' + size + 'px ' + gcfg.fontStack;

    if (halo && typeof g.strokeText === 'function') {
      g.lineWidth = gcfg.paperStrokeWidth;
      g.strokeStyle = cfg.palette.paper;
      g.lineJoin = 'round';
      g.strokeText(text, mid, mid);
    }
    if (halo && gcfg.inkEdgeWidth > 0 && typeof g.strokeText === 'function') {
      g.lineWidth = gcfg.inkEdgeWidth;
      g.strokeStyle = cfg.palette.ink;
      g.strokeText(text, mid, mid);
    }
    g.fillStyle = color;
    g.fillText(text, mid, mid);

    glyphCache[key] = { canvas: c, size: logical };
    return glyphCache[key];
  }

  Game.art = {
    init: init,
    cfg: getCfg,
    paper: getPaper,
    glyph: glyph
  };
})(globalThis);
