/* 单骑 · 汉字塔防 —— 静态棋盘地形 + 单位层离屏装饰（Day 25 画风补图）
 * 规矩：只生成一次，之后每帧只 drawImage；纯表现，不读写 state、不碰判定。
 * 草地 / 石砖 / 路径箭头 / 白格 / 深绿格 / 红兵营 / 阿斗冠与旗 / 城墙带 / 外圈草叶
 * 全部程序化，随机走 seeded rng，零外链零图片；高分屏按 DPR 放大再缩回。
 * Day 25 续 2：格子按 (列,行) 哈希确定性生成，铺满整格只留 1px 格缝；
 * 波浪分界改成城墙带，铲开的 D 格与静态白格共用同一个 tile()。
 *
 * 和 art.js 的分工：art.js 管宣纸纹理与汉字缓存，这里管「棋盘这张画」和
 * 单位用的墨晕 / 等级角标小图。DPR=1 时直接复用宣纸 canvas 作底，
 * 整个棋盘只有一张全幅离屏层，不额外占内存。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var cfg = null;        // balance.art.board
  var figure = null;     // balance.art.figure
  var terrain = null;    // { canvas, w, h }
  var blot = null;       // { canvas, w, h }
  var badges = {};       // lv -> { canvas, w, h }
  var dpr = 1;
  var ready = false;

  function rand(state) { return Game.rng.next(state); }

  function makeCanvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) {
      return null;
    }
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    var g = c.getContext('2d');
    return g ? { canvas: c, g: g } : null;
  }

  function cellCenter(board, cell) {
    return board.cellCenter(cell);
  }

  /* ============ 初始化：只跑一次 ============ */

  function init(balance, board) {
    if (ready) {
      return;
    }
    if (!balance || !balance.art || !balance.art.board || !balance.art.figure) {
      return;
    }
    cfg = balance.art.board;
    figure = balance.art.figure;
    dpr = Math.min(global.devicePixelRatio || 1, cfg.dprMax || 2);

    var lw = board.WIDTH;
    var lh = board.DUEL_HEIGHT;
    var paper = Game.art && Game.art.paper ? Game.art.paper() : null;
    var item;

    if (dpr > 1) {
      item = makeCanvas(lw * dpr, lh * dpr);
      if (item) {
        item.g.scale(dpr, dpr);
        if (paper && typeof item.g.drawImage === 'function') {
          item.g.drawImage(paper, 0, 0, lw, lh);
        }
      }
    } else {
      /* 复用宣纸 canvas：纸纹留在最底层，草地半透明盖上去，暖白透得出来。 */
      item = paper ? { canvas: paper, g: paper.getContext('2d') } : makeCanvas(lw, lh);
    }
    if (!item || !item.g) {
      ready = true;
      return;
    }

    var g = item.g;
    var st = { seed: cfg.seed >>> 0 };

    paintGround(g, lw, lh, st);
    paintCells(g, board);
    paintStoneFrame(g, lw, lh);
    paintPathArrows(g, board);
    paintSpawnAndHome(g, board);
    paintWall(g, board, lw);
    paintEdge(g, lw, lh, st);

    terrain = { canvas: item.canvas, w: lw, h: lh };
    blot = makeBlot(figure);
    ready = true;
  }

  /* ============ 地面 / 格子纹理 ============ */

  function paintGround(g, w, h, st) {
    g.save();
    g.globalAlpha = cfg.groundAlpha;
    g.fillStyle = cfg.ground;
    g.fillRect(0, 0, w, h);
    g.restore();

    for (var i = 0; i < cfg.noiseCount; i++) {
      g.fillStyle = 'rgba(' + cfg.noiseRgb + ',' + cfg.noiseAlpha + ')';
      g.fillRect(rand(st) * w, rand(st) * h, 1, 1);
    }
  }

  /* 每格的随机量由 (列,行) 哈希派生，不吃全局 rng 流：
   * 静态层一次生成、铲开后动态补画，同一格能拿到完全一样的抖动与砖纹。 */
  function cellState(c, r) {
    var s = (cfg.seed ^ Math.imul(c + 1, 73856093) ^ Math.imul(r + 1, 19349663)) >>> 0;
    return { seed: s };
  }

  function shade(hex, k, st) {
    var v = parseInt(hex.slice(1), 16);
    var d = 1 + (rand(st) * 2 - 1) * k;
    var rr = Math.max(0, Math.min(255, Math.round(((v >> 16) & 255) * d)));
    var gg = Math.max(0, Math.min(255, Math.round(((v >> 8) & 255) * d)));
    var bb = Math.max(0, Math.min(255, Math.round((v & 255) * d)));
    return 'rgb(' + rr + ',' + gg + ',' + bb + ')';
  }

  function tilePath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* 手绘砖纹：几笔短划 + 一道错位砖缝，全部关在圆角裁剪里，不越出格子 */
  function tileTexture(g, x, y, w, h, type, st) {
    g.strokeStyle = type === 'W' ? cfg.tileBrickW
      : type === 'R' ? cfg.tileBrickR : cfg.tileBrick;
    g.lineWidth = 1;
    g.beginPath();
    for (var i = 0; i < cfg.brickStrokes; i++) {
      var bx = x + 4 + rand(st) * (w - 12);
      var by = y + 4 + rand(st) * (h - 8);
      var len = 5 + rand(st) * 8;
      g.moveTo(bx, by);
      g.lineTo(bx + len, by + (rand(st) - 0.5) * 2);
    }
    var my = y + h * (0.42 + rand(st) * 0.16);
    g.moveTo(x + 2, my + 0.5);
    g.lineTo(x + w - 2, my + 0.5);
    var vx = x + w * (0.35 + rand(st) * 0.3);
    g.moveTo(vx + 0.5, y + 2);
    g.lineTo(vx + 0.5, my);
    var vx2 = x + w * (0.6 + rand(st) * 0.25);
    g.moveTo(vx2 + 0.5, my);
    g.lineTo(vx2 + 0.5, y + h - 2);
    g.stroke();
  }

  /* 一格砖块：铺满整格（白格与相邻格共边）、±3% 色抖、手绘砖纹、
   * 1px 格缝 + 深色描边 + 左上亮 / 右下暗的极轻浮雕。
   * 静态层和「铲开 D 格」都调它，保证挖开后不是突然冒出一块纯色。 */
  function tile(g, x, y, w, h, type, c, r) {
    var st = cellState(c, r);
    var base = type === 'W' ? cfg.cellW : type === 'D' ? cfg.cellD
      : type === 'R' ? cfg.cellR : type === 'H' ? cfg.cellH : cfg.cellP;
    var rad = cfg.tileRadius;
    var i;

    /* 直接按圆角路径填充，不用 clip()：极简 Canvas / 老环境降级时也能画。
     * 纹理笔画都收在格子内 2px 以上，不会溢出圆角。 */
    g.save();
    tilePath(g, x, y, w, h, rad);
    g.fillStyle = shade(base, cfg.tileJitter, st);
    g.fill();

    if (type === 'D') {
      g.strokeStyle = cfg.cellDGrass;
      g.lineWidth = 1;
      for (i = 0; i < cfg.cellDBlades; i++) {
        var px = x + 4 + rand(st) * (w - 8);
        var py = y + 6 + rand(st) * (h - 10);
        var len = 3 + rand(st) * 5;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px - 2, py - len);
        g.moveTo(px, py);
        g.lineTo(px + 2, py - len);
        g.stroke();
      }
    } else if (type === 'W') {
      for (i = 0; i < cfg.whiteNoise; i++) {
        g.fillStyle = cfg.cellWNoise;
        g.fillRect(x + 3 + rand(st) * (w - 6), y + 3 + rand(st) * (h - 6), 1, 1);
      }
    }
    tileTexture(g, x, y, w, h, type, st);
    g.restore();

    /* 格缝 + 深色描边：两圈都是圆角，不许尖角 / 大圆角 / 强阴影 */
    g.save();
    tilePath(g, x + 0.5, y + 0.5, w - 1, h - 1, rad);
    g.strokeStyle = cfg.tileJoint;
    g.lineWidth = 1;
    g.stroke();
    tilePath(g, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, rad - 1));
    g.strokeStyle = cfg.tileOutline;
    g.lineWidth = cfg.tileOutlineW;
    g.stroke();

    g.lineWidth = 1;
    g.strokeStyle = cfg.tileLight;
    g.beginPath();
    g.moveTo(x + rad, y + 2.5);
    g.lineTo(x + w - rad, y + 2.5);
    g.moveTo(x + 2.5, y + rad);
    g.lineTo(x + 2.5, y + h - rad);
    g.stroke();
    g.strokeStyle = cfg.tileDark;
    g.beginPath();
    g.moveTo(x + rad, y + h - 2.5);
    g.lineTo(x + w - rad, y + h - 2.5);
    g.moveTo(x + w - 2.5, y + rad);
    g.lineTo(x + w - 2.5, y + h - rad);
    g.stroke();
    g.restore();
  }

  function paintCells(g, board) {
    var w = board.CELL_W;
    var h = board.CELL_H;
    for (var r = 0; r < board.ROWS; r++) {
      for (var c = 0; c < board.COLS; c++) {
        tile(g, c * w, r * h, w, h, board.typeAt([c, r]), c, r);
      }
    }
  }

  /* ============ 外圈石框 / 分界线 / 边缘装饰 ============ */

  function paintStoneFrame(g, w, h) {
    var s = cfg.stoneWidth;
    g.fillStyle = cfg.stone;
    g.fillRect(0, 0, w, s);
    g.fillRect(0, h - s, w, s);
    g.fillRect(0, 0, s, h);
    g.fillRect(w - s, 0, s, h);

    g.strokeStyle = cfg.stoneJointColor;
    g.lineWidth = 1;
    g.beginPath();
    for (var x = s; x < w; x += cfg.stoneJoint) {
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, s);
      g.moveTo(x + 0.5, h - s);
      g.lineTo(x + 0.5, h);
    }
    for (var y = s; y < h; y += cfg.stoneJoint) {
      g.moveTo(0, y + 0.5);
      g.lineTo(s, y + 0.5);
      g.moveTo(w - s, y + 0.5);
      g.lineTo(w, y + 0.5);
    }
    g.stroke();

    g.fillStyle = cfg.stoneLight;
    g.fillRect(s, s, w - s * 2, 1);
    g.fillRect(s, s, 1, h - s * 2);
  }

  /* 城墙带：横贯 8 列的一行砖墙 + 垛口 + 两端城门小旗，压在 r4 / r5 之间。
   * 全部画在静态离屏层里，每帧不重画；替换了原来的波浪分界线。 */
  function paintWall(g, board, w) {
    var y = board.HALF_HEIGHT - cfg.wallH / 2;
    var h = cfg.wallH;
    var x, s;

    g.save();
    g.fillStyle = cfg.wallFill;
    g.fillRect(0, y, w, h);
    g.strokeStyle = cfg.wallJoint;
    g.lineWidth = 1;
    g.beginPath();
    for (x = cfg.wallBrick; x < w; x += cfg.wallBrick) {
      g.moveTo(x + 0.5, y + 1);
      g.lineTo(x + 0.5, y + h - 1);
    }
    g.moveTo(0, y + h / 2 + 0.5);
    g.lineTo(w, y + h / 2 + 0.5);
    g.stroke();

    g.fillStyle = cfg.wallEdge;
    g.fillRect(0, y, w, 1);
    g.fillRect(0, y + h - 1, w, 1);

    /* 垛口：上沿一排小方齿 */
    for (x = 0; x < w; x += cfg.merlonStep) {
      g.fillStyle = cfg.wallFill;
      g.fillRect(x + 1, y - cfg.merlonH, cfg.merlonW, cfg.merlonH);
      g.strokeStyle = cfg.wallEdge;
      g.strokeRect(x + 1.5, y - cfg.merlonH + 0.5, cfg.merlonW - 1, cfg.merlonH);
    }

    /* 两端城门 + 小旗 */
    for (s = 0; s < 2; s++) {
      var gx = s === 0 ? 0 : w - cfg.gateW;
      g.fillStyle = cfg.gateFill;
      g.fillRect(gx, y - 2, cfg.gateW, h + 4);
      g.strokeStyle = cfg.wallEdge;
      g.strokeRect(gx + 0.5, y - 1.5, cfg.gateW - 1, h + 3);
      g.fillStyle = cfg.gateLight;
      g.fillRect(gx + cfg.gateW / 2 - 3, y + 3, 6, h - 4);

      var fx = gx + (s === 0 ? 5 : cfg.gateW - 5);
      g.strokeStyle = cfg.homeInk;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(fx, y - 2);
      g.lineTo(fx, y - cfg.flagH);
      g.stroke();
      g.fillStyle = cfg.flag;
      g.beginPath();
      g.moveTo(fx, y - cfg.flagH);
      g.lineTo(fx + (s === 0 ? 9 : -9), y - cfg.flagH + 3);
      g.lineTo(fx, y - cfg.flagH + 6);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function paintEdge(g, w, h, st) {
    /* 石框外沿的草叶：短线朝上，随机疏密，不盖住格子中心 */
    g.strokeStyle = cfg.bladeColor;
    g.lineWidth = 1;
    var band = cfg.edgeBand;
    for (var i = 0; i < cfg.edgeBlades; i++) {
      var edge = Math.floor(rand(st) * 4);
      var x = edge < 2 ? rand(st) * w : (edge === 2 ? rand(st) * band : w - rand(st) * band);
      var y = edge >= 2 ? rand(st) * h : (edge === 0 ? rand(st) * band : h - rand(st) * band);
      var len = 2 + rand(st) * cfg.bladeMaxLen;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 1.5, y - len);
      g.moveTo(x, y);
      g.lineTo(x + 1.5, y - len);
      g.stroke();
    }

    /* 四角朱砂小旗角饰 */
    var k = cfg.cornerSize;
    g.fillStyle = cfg.corner;
    var corners = [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]];
    for (var c = 0; c < corners.length; c++) {
      var q = corners[c];
      g.beginPath();
      g.moveTo(q[0], q[1]);
      g.lineTo(q[0] + q[2] * k, q[1]);
      g.lineTo(q[0], q[1] + q[3] * k);
      g.closePath();
      g.fill();
    }
  }

  /* ============ 路径箭头 / 出兵营 / 阿斗 ============ */

  function chevron(g, x, y, ux, uy) {
    var half = cfg.arrowHalf;
    var px = -uy;
    var py = ux;
    g.beginPath();
    g.moveTo(x - ux * half + px * half, y - uy * half + py * half);
    g.lineTo(x + ux * half * 0.7, y + uy * half * 0.7);
    g.lineTo(x - ux * half - px * half, y - uy * half - py * half);
    g.stroke();
  }

  function paintPathArrows(g, board) {
    g.save();
    g.strokeStyle = cfg.arrow;
    g.lineWidth = cfg.arrowWidth;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var sides = ['top', 'bottom'];
    for (var s = 0; s < sides.length; s++) {
      var pts = board.path(sides[s]);
      for (var i = 0; i < pts.length - 1; i += cfg.arrowEvery) {
        var a = cellCenter(board, pts[i]);
        var b = cellCenter(board, pts[i + 1]);
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        chevron(g, a.x, a.y, dx / len, dy / len);
      }
    }
    g.restore();
  }

  function drawCachedGlyph(g, text, size, color, x, y) {
    var item = Game.art.glyph(text, size, color, 0, false);
    if (item && typeof g.drawImage === 'function') {
      g.drawImage(item.canvas, x - item.size / 2, y - item.size / 2, item.size, item.size);
    } else {
      g.fillStyle = color;
      g.font = size + 'px "KaiTi","STKaiti","SimSun",serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, x, y);
    }
  }

  function paintSpawnAndHome(g, board) {
    var sides = ['top', 'bottom'];
    for (var s = 0; s < sides.length; s++) {
      var side = sides[s];
      var pts = board.path(side);
      var sp = cellCenter(board, board.spawn(side));
      var nx = cellCenter(board, pts[1]);

      /* 出兵营 R：白箭头指向路径第二格 */
      var dx = nx.x - sp.x;
      var dy = nx.y - sp.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len;
      var uy = dy / len;
      g.save();
      g.strokeStyle = cfg.spawnArrow;
      g.fillStyle = cfg.spawnArrow;
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(sp.x - ux * 8, sp.y - uy * 8);
      g.lineTo(sp.x + ux * 8, sp.y + uy * 8);
      g.stroke();
      var tx = sp.x + ux * 10;
      var ty = sp.y + uy * 10;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - ux * 8 - uy * 5, ty - uy * 8 + ux * 5);
      g.lineTo(tx - ux * 8 + uy * 5, ty - uy * 8 - ux * 5);
      g.closePath();
      g.fill();
      g.restore();

      /* 阿斗 H：斗字 + 冕旒冠 + 暗红心排（亮心由 render.js 按生命值画） + 小旗 */
      var home = cellCenter(board, board.home(side));
      var cx = home.x;
      var cy = home.y;

      drawCachedGlyph(g, '斗', cfg.homeSize, cfg.homeInk, cx, cy + 7);

      g.save();
      g.fillStyle = cfg.crown;
      g.fillRect(cx - 9, cy - 12, 18, 3);
      for (var b = 0; b < 5; b++) {
        g.fillRect(cx - 8 + b * 4, cy - 9, 2, 3);
      }
      g.restore();

      for (var i = 0; i < cfg.homeHearts; i++) {
        drawCachedGlyph(g, '♥', cfg.heartSize, cfg.heartDim,
          cx + (i - (cfg.homeHearts - 1) / 2) * cfg.heartGap, cy - 18);
      }

      /* 小旗：左上插一根杆，三角旗朝外 */
      g.save();
      g.strokeStyle = cfg.homeInk;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx - 16, cy + 14);
      g.lineTo(cx - 16, cy - 10);
      g.stroke();
      g.fillStyle = cfg.flag;
      g.beginPath();
      g.moveTo(cx - 16, cy - 10);
      g.lineTo(cx - 5, cy - 7);
      g.lineTo(cx - 16, cy - 3);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  /* ============ 单位层离屏小图 ============ */

  function makeBlot(f) {
    var w = f.inkBlotW;
    var h = f.inkBlotH;
    var item = makeCanvas(w * dpr, h * dpr);
    if (!item) {
      return null;
    }
    if (dpr > 1) {
      item.g.scale(dpr, dpr);
    }
    var g = item.g;
    if (typeof g.createRadialGradient !== 'function') {
      return null;
    }
    var rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    if (!rg || typeof rg.addColorStop !== 'function') {
      return null;   // 老环境 / 极简 mock 没渐变能力：不画墨晕也不白屏
    }
    rg.addColorStop(0, f.inkBlotColor);
    rg.addColorStop(1, 'rgba(28,25,20,0)');
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(1, h / w);
    g.translate(-w / 2, -h / 2);
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
    g.restore();
    return { canvas: item.canvas, w: w, h: h };
  }

  /**
   * rankBadge —— 左上角等级数字角标（Day 26 补丁：环与等级点已删，只剩这一个角标）。
   * 按等级上色：1–2 墨 / 3–4 朱砂 / 5 金；满级再把数字上移、下方补一条 6px 小金线。
   */
  function rankBadge(lv) {
    if (badges[lv]) {
      return badges[lv];
    }
    var f = figure;
    var s = f.badgeSize;
    var item = makeCanvas(s * dpr, s * dpr);
    if (!item) {
      return null;
    }
    if (dpr > 1) {
      item.g.scale(dpr, dpr);
    }
    var g = item.g;
    var maxed = lv >= f.badgeMaxLv;
    var tone = maxed ? f.badgeGold : (lv >= 3 ? f.badgeCinnabar : f.badgeInk);
    g.fillStyle = f.badgePaper;
    g.fillRect(1, 1, s - 2, s - 2);
    g.strokeStyle = tone;
    g.lineWidth = 1;
    g.strokeRect(1.5, 1.5, s - 3, s - 3);
    g.fillStyle = tone;
    g.font = 'bold ' + f.badgeFontPx + 'px "KaiTi","STKaiti","SimSun",serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(lv), s / 2, maxed ? s / 2 - 1 : s / 2 + 0.5);
    if (maxed) {
      g.fillStyle = f.badgeGold;
      g.fillRect((s - f.badgeGoldLineW) / 2,
        s - f.badgeGoldLineH - 1, f.badgeGoldLineW, f.badgeGoldLineH);
    }
    badges[lv] = { canvas: item.canvas, w: s, h: s };
    return badges[lv];
  }

  Game.boardArt = {
    init: init,
    terrain: function () { return terrain; },
    blot: function () { return blot; },
    rankBadge: rankBadge,
    tile: tile,                 // 铲开的 D 格补画时复用同一套砖块花纹
    wall: paintWall,            // 降级路径也能画出同一条城墙带
    cfg: function () { return cfg; },
    figure: function () { return figure; }
  };
})(globalThis);
