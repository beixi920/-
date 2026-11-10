/* 单骑 · 汉字塔防 —— 开场「斗」字入场（ART.md 3.10）
 * 职责：点「开始游戏」后、进入战斗前播 1.2–1.8 秒的入场：字放大出现 → 沿墨迹弧线
 * 飞到玩家的阿斗格 → 落地墨爆 + 轻微屏震 → 淡出交给战斗。
 *
 * 约束：
 *   - 只有一个 progress 0→1 的时间轴，不用动画库、不用 CSS 动画；
 *   - 纯表现：只读 DATA.balance.art.intro 与棋盘几何，不碰 state/combat 等规则层；
 *   - 覆盖层是一张全屏 canvas（fixed），窗口缩放时重算尺寸，按 DPR 渲染保证字清晰；
 *   - 点任意处可直接跳过（立刻结束，不留残影）。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var canvas = null;
  var ctx = null;
  var active = false;
  var startedAt = 0;
  var durationMs = 1500;
  var dpr = 1;
  var viewW = 0;
  var viewH = 0;
  var onDone = null;
  var skipHandler = null;
  var resizeHandler = null;

  function cfg() {
    var b = global.DATA && global.DATA.balance;
    return (b && b.art && b.art.intro) || null;
  }

  function ensureCanvas() {
    if (canvas) {
      return true;
    }
    if (typeof document === 'undefined' || !document.getElementById) {
      return false;
    }
    canvas = document.getElementById('intro-canvas');
    if (!canvas) {
      return false;
    }
    ctx = canvas.getContext('2d');
    return !!ctx;
  }

  /** resize —— 覆盖层按视口铺满，backing store = 实际显示尺寸 × DPR（上限 2，与主画布一致）。
   *  尺寸取 getBoundingClientRect（而不是 innerWidth/Height）：CSS 里可能还有 zoom / 安全区，
   *  以「真正显示多大」为准才不会出现纸底没铺满、边缘露黑边。 */
  function resize() {
    if (!canvas) {
      return;
    }
    dpr = Math.min(global.devicePixelRatio || 1, 2);

    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    viewW = Math.max(1, Math.round((rect && rect.width) || global.innerWidth || 375));
    viewH = Math.max(1, Math.round((rect && rect.height) || global.innerHeight || 667));

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    if (ctx && typeof ctx.setTransform === 'function') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /**
   * targetPoint —— 玩家阿斗格的屏幕坐标。
   * 用战斗画布的 getBoundingClientRect 反算：画布被 zoom 缩放过，直接用 rect 才准。
   * 阿斗在下半场最右列，落点会贴着屏幕右缘，所以按落点字号往里夹一下，别让字被裁掉。
   */
  function targetPoint() {
    var board = Game.board;
    var battle = document.getElementById('battle-canvas');
    var c = cfg() || {};
    var size = (c.glyphSize || 100) * (c.flyScale || 0.55) * 0.55 + 6;

    var x = viewW / 2;
    var y = viewH * 0.72;

    if (board && battle && battle.getBoundingClientRect) {
      var rect = battle.getBoundingClientRect();
      var home = board.home ? board.home('bottom') : null;
      var cell = home || [3, 8];
      var cx = (cell[0] + 0.5) * board.CELL_W;
      var cy = (cell[1] + 0.5) * board.CELL_H;
      x = rect.left + (cx / board.WIDTH) * rect.width;
      y = rect.top + (cy / board.DUEL_HEIGHT) * rect.height;
    }

    // 落点再夹一次：既不超过覆盖层，也不超过真实视口（页面可能被内容撑得比视口宽）
    var maxW = Math.min(viewW, global.innerWidth || viewW);
    var maxH = Math.min(viewH, global.innerHeight || viewH);
    return {
      x: Math.min(maxW - size, Math.max(size, x)),
      y: Math.min(maxH - size, Math.max(size, y))
    };
  }

  function easeOutCubic(t) {
    var u = 1 - t;
    return 1 - u * u * u;
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /** bezier —— 二次贝塞尔：起点 / 控制点 / 终点，t 0~1。 */
  function bezier(p0, p1, p2, t) {
    var u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    };
  }

  /** drawGlyph —— 用数值表里的字体栈现画「斗」；带纸色外圈，和棋盘上的字同一套口径。 */
  function drawGlyph(g, text, x, y, size, alpha) {
    var art = global.DATA.balance.art;
    var gcfg = art.glyph;

    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = gcfg.weight + ' ' + size + 'px ' + gcfg.fontStack;
    g.lineJoin = 'round';

    if (typeof g.strokeText === 'function') {
      g.lineWidth = gcfg.paperStrokeWidth * (size / gcfg.unitSize);
      g.strokeStyle = art.palette.paper;
      g.strokeText(text, x, y);
    }
    g.fillStyle = art.palette.ink;
    g.fillText(text, x, y);
    g.restore();
  }

  /** drawBurst —— 落地墨爆：一圈小墨点向外扩散并淡出（数量固定，不 new 对象）。 */
  function drawBurst(g, x, y, k, c) {
    var n = c.burstCount;
    for (var i = 0; i < n; i++) {
      var a = Math.PI * 2 * i / n;
      var r = c.burstR0 + (c.burstR1 - c.burstR0) * k;
      var dot = c.burstDot * (1 - k * 0.55);
      g.globalAlpha = (1 - k) * 0.85;
      g.fillStyle = global.DATA.balance.art.palette.ink;
      g.beginPath();
      g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, dot, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /**
   * draw —— 主循环每帧调一次（只在 active 时）。
   * p = 0→1：riseEnd 之前放大出现，flyEnd 之前沿弧线飞，landEnd 之前墨爆，之后淡出。
   */
  function draw(now) {
    if (!active || !ctx) {
      return;
    }
    var c = cfg();
    if (!c) {
      finish();
      return;
    }

    var p = (now - startedAt) / durationMs;
    if (p >= 1) {
      finish();
      return;
    }
    if (p < 0) {
      p = 0;
    }

    var w = viewW;
    var h = viewH;
    var center = { x: w / 2, y: h * c.centerY };
    var target = targetPoint();
    var ctrl = { x: (center.x + target.x) / 2, y: Math.min(center.y, target.y) - h * c.arcLift };

    ctx.clearRect(0, 0, w, h);

    /* 纸底：开头 8% 淡入，最后 18% 淡出，中间不透明盖住战斗画面 */
    var paperA = p < c.paperIn ? p / c.paperIn : (p > c.fadeStart ? Math.max(0, (1 - p) / (1 - c.fadeStart)) : 1);
    ctx.save();
    ctx.globalAlpha = paperA;
    ctx.fillStyle = global.DATA.balance.art.palette.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    var pos = center;
    var scale = c.zoomFrom;
    var alpha = 0;
    var burstK = -1;

    if (p < c.riseEnd) {
      var q = p / c.riseEnd;
      scale = c.zoomFrom + (1 - c.zoomFrom) * easeOutCubic(q);
      alpha = Math.min(1, q * 1.4);
    } else if (p < c.flyEnd) {
      var f = (p - c.riseEnd) / (c.flyEnd - c.riseEnd);
      var k = easeInOutQuad(f);
      pos = bezier(center, ctrl, target, k);
      scale = 1 + (c.flyScale - 1) * k;
      alpha = 1;

      /* 墨迹拖尾：沿弧线回看几段，越远越淡 */
      for (var i = 4; i >= 1; i--) {
        var back = Math.max(0, k - i * c.trailGap);
        var tp = bezier(center, ctrl, target, back);
        drawGlyph(ctx, c.char, tp.x, tp.y, c.glyphSize * (1 + (c.flyScale - 1) * back),
          alpha * c.trailAlpha * (1 - i / 5));
      }
    } else {
      pos = target;
      scale = c.flyScale;
      alpha = 1;
      var b = (p - c.flyEnd) / Math.max(0.001, c.landEnd - c.flyEnd);
      burstK = Math.min(1, b);
    }

    /* 屏震：只在落地那一小段，幅度随墨爆衰减 */
    var shakeX = 0;
    var shakeY = 0;
    if (burstK >= 0 && burstK < 1) {
      var amp = c.shakePx * (1 - burstK);
      shakeX = Math.sin(p * 260) * amp;
      shakeY = Math.cos(p * 310) * amp * 0.6;
    }

    if (burstK >= 0) {
      drawBurst(ctx, pos.x + shakeX, pos.y + shakeY, burstK, c);
    }

    /* 字本体：rise 阶段居中放大，fly 阶段一路缩小，落地后跟着墨爆淡出一点点 */
    var glyphAlpha = alpha;
    if (burstK >= 0) {
      glyphAlpha = Math.max(0, 1 - burstK) * alpha;
    }
    drawGlyph(ctx, c.char, pos.x + shakeX, pos.y + shakeY, c.glyphSize * scale, glyphAlpha);
  }

  function cleanup() {
    active = false;
    if (typeof global.removeEventListener === 'function') {
      if (skipHandler) {
        global.removeEventListener('pointerdown', skipHandler, true);
        global.removeEventListener('keydown', skipHandler, true);
      }
      if (resizeHandler) {
        global.removeEventListener('resize', resizeHandler);
      }
    }
    skipHandler = null;
    resizeHandler = null;
    if (canvas) {
      canvas.classList.remove('is-on');
    }
  }

  function finish() {
    if (!active) {
      return;
    }
    var cb = onDone;
    onDone = null;
    cleanup();
    if (cb) {
      cb();
    }
  }

  /** skip —— 点任意处 / 按键：立刻结束，直接进入战斗。 */
  function skip() {
    finish();
  }

  /**
   * play —— 开始播放。已经激活时直接忽略（重开/结算不会重复触发）。
   * onFinished 在自然播完或跳过时各调一次。
   */
  function play(done) {
    if (active || !ensureCanvas()) {
      if (done) {
        done();
      }
      return;
    }

    var c = cfg();
    if (!c || !c.enabled) {
      if (done) {
        done();
      }
      return;
    }

    durationMs = c.durSec * 1000;
    onDone = done || null;
    active = true;
    startedAt = (global.performance && global.performance.now) ? global.performance.now() : Date.now();

    // 先显示再量尺寸：display:none 时 getBoundingClientRect 全是 0
    canvas.classList.add('is-on');
    resize();

    skipHandler = function () { skip(); };
    resizeHandler = function () { resize(); };
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('pointerdown', skipHandler, true);
      global.addEventListener('keydown', skipHandler, true);
      global.addEventListener('resize', resizeHandler);
    }
  }

  function isActive() {
    return active;
  }

  Game.intro = {
    play: play,
    skip: skip,
    draw: draw,
    isActive: isActive
  };
})(globalThis);
