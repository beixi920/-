/* 单骑 · 汉字塔防 —— 绘制层
 * 规矩：只负责"把状态画出来"，绝不修改状态、不绑定事件、不读存档。
 *
 * 整块 8×10 棋盘一次画完：上半场行 0–4（对手）、下半场行 5–9（玩家），
 * 坐标一律是全局格子 [列 0–7, 行 0–9]，不做镜像、不做半场偏移。
 * tf 只用来标记"这一笔属于哪个半场"（oy 用于粒子分组与半场边框），
 * 不再参与坐标变换。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var COLOR = {
    paper: '#F3EBD9',
    grid: 'rgba(28, 25, 20, 0.15)',
    greenFill: 'rgba(74, 111, 99, 0.16)',   // 青：低饱和，不做高饱和色块（ART.md 3.1）
    greenLine: 'rgba(28, 25, 20, 0.12)',
    whiteFill: '#FBF6E8',
    whiteLine: 'rgba(28, 25, 20, 0.14)',
    ink: '#1C1914',
    lightInk: '#4B453B',
    cinnabar: '#B23A2B',
    path: 'rgba(178, 58, 43, 0.28)',
    gain: '#4B453B',
    hpTrack: 'rgba(28, 25, 20, 0.18)',
    divider: 'rgba(28, 25, 20, 0.22)',
    gold: '#C9A227',      // 金卡 / 休眠单字 / 金环（ART.md 3.1）
    /* 武将品质边框：ART.md 3.9，金 #C9A227、紫 #8E6BB8 */
    qualityGold: '#C9A227',
    qualityPurple: '#8E6BB8',

    /* 8×10 棋盘五类格子（data/board_map.js 的 D/P/W/R/H） */
    cellP: '#CFE0D8',     // P 浅绿敌人路径
    cellD: '#5C7B66',     // D 深绿可铲格
    cellW: '#FBF6E8',     // W 米白可放置
    cellR: '#B23A2B',     // R 红色出兵营
    cellH: '#F3EBD9'      // H 阿斗（画「斗」+ 红心）
  };

  /* 离屏资源层在 src/art.js：纸纹理与汉字缓存只生成一次，每帧只 drawImage。 */
  var artCfg = null;

  function ensureArt(balance, board) {
    Game.art.init(balance, board, COLOR);
    artCfg = Game.art.cfg();
    if (Game.boardArt) {
      Game.boardArt.init(balance, board);   // 静态地形 + 墨晕/角标只生成一次
    }
    if (Game.weaponFx) {
      Game.weaponFx.init(balance);          // 弓 v2 的纯表现参数，只缓存一次
    }
  }


  /**
   * roundRect —— 画圆角矩形（Canvas 没有现成方法，用 arcTo 拐四个角）。
   */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * toPx —— 全局格子下标（可以是小数）→ 整块画布像素。
   * 不再镜像、不再加半场偏移：格子坐标本身就是全局的。
   * tf 保留在签名里，是为了 render-fx.js 的调用不用改；它只用于标记半场。
   */
  function toPx(board, tf, cx, cy) {
    return {
      x: (cx + 0.5) * board.CELL_W,
      y: (cy + 0.5) * board.CELL_H
    };
  }

  function paintPaper(ctx, board) {
    var paper = Game.art.paper();
    if (paper && typeof ctx.drawImage === 'function') {
      ctx.drawImage(paper, 0, 0);
      return;
    }
    ctx.fillStyle = COLOR.paper;
    ctx.fillRect(0, 0, board.WIDTH, board.DUEL_HEIGHT);
  }

  /**
   * drawCells —— 整块 8×10 一次上色（P 浅绿 / D 深绿 / W 米白 / R 红 / H 纸色）。
   * 已挖开的 D 按对应半场 state.unlocked 画成白色。两个 state 分别传进来，
   * 因为上下半场各自记录自己挖开了哪些格。
   */
  function drawCells(ctx, board, me, foe) {
    for (var r = 0; r < board.ROWS; r++) {
      for (var c = 0; c < board.COLS; c++) {
        var t = board.typeAt([c, r]);
        var side = board.sideOf([c, r]);
        var st = side === 'top' ? foe : me;
        var unlocked = st && st.unlocked.indexOf(c + ',' + r) >= 0;
        var fill = COLOR.cellP;

        if (t === 'D' && !unlocked) {
          fill = COLOR.cellD;
        } else if (t === 'W' || (t === 'D' && unlocked)) {
          fill = COLOR.cellW;
        } else if (t === 'R') {
          fill = COLOR.cellR;
        } else if (t === 'H') {
          fill = COLOR.cellH;
        }

        var x = c * board.CELL_W;
        var y = r * board.CELL_H;
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, board.CELL_W, board.CELL_H);
      }
    }

    /* 细墨格线，压在底色上 */
    ctx.save();
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var cc = 0; cc <= board.COLS; cc++) {
      var gx = Math.min(cc * board.CELL_W, board.WIDTH - 1) + 0.5;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, board.HEIGHT);
    }
    for (var rr = 0; rr <= board.ROWS; rr++) {
      var gy = Math.min(rr * board.CELL_H, board.HEIGHT - 1) + 0.5;
      ctx.moveTo(0, gy);
      ctx.lineTo(board.WIDTH, gy);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * drawUnlockedCells —— 静态地形之外唯一的动态地形：被铲子挖开的 D 格。
   * 调 boardArt.tile 画同一套米白砖块（格缝 / 抖动 / 浮雕 / 圆角完全一致），
   * 所以挖开不会突然冒出一块平涂；绝大多数帧一格都不用补画。
   */
  function drawUnlockedCells(ctx, board, me, foe) {
    for (var r = 0; r < board.ROWS; r++) {
      for (var c = 0; c < board.COLS; c++) {
        if (board.typeAt([c, r]) !== 'D') {
          continue;
        }
        var st = board.sideOf([c, r]) === 'top' ? foe : me;
        if (!st || st.unlocked.indexOf(c + ',' + r) < 0) {
          continue;
        }
        Game.boardArt.tile(ctx, c * board.CELL_W, r * board.CELL_H,
          board.CELL_W, board.CELL_H, 'W', c, r);
      }
    }
  }

  /**
   * drawPaths —— 两条 16 点路径的朱砂虚线 + 出兵营箭头。
   * 静态地形可用时这些已经画在离屏层里，这里只作为降级路径保留。
   */
  function drawPaths(ctx, board) {
    var sides = ['top', 'bottom'];

    for (var s = 0; s < sides.length; s++) {
      var pts = board.path(sides[s]);

      ctx.save();
      ctx.strokeStyle = COLOR.path;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var p = toPx(board, null, pts[i][0], pts[i][1]);
        if (i === 0) {
          ctx.moveTo(p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
      ctx.restore();

      /* 出兵营箭头：从 R 格指向路径第 2 格 */
      var a = toPx(board, null, pts[0][0], pts[0][1]);
      var b = toPx(board, null, pts[1][0], pts[1][1]);
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len;
      var uy = dy / len;

      ctx.save();
      ctx.strokeStyle = COLOR.paper;
      ctx.fillStyle = COLOR.paper;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + ux * 15, a.y + uy * 15);
      ctx.stroke();
      var tx = a.x + ux * 15;
      var ty = a.y + uy * 15;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - ux * 8 - uy * 5, ty - uy * 8 + ux * 5);
      ctx.lineTo(tx - ux * 8 + uy * 5, ty - uy * 8 - ux * 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * drawHighlight —— rgba 方框提示落点。
   * mode='swap' 用金色（和「可放置」的朱砂区分），'place' 仍用朱砂。
   */
  function drawHighlight(ctx, board, tf, cell, mode) {
    var c = toPx(board, tf, cell[0], cell[1]);
    var inset = 2;

    roundRect(ctx, c.x - board.CELL_W / 2 + inset, c.y - board.CELL_H / 2 + inset,
      board.CELL_W - inset * 2, board.CELL_H - inset * 2, 6);
    ctx.lineWidth = mode === 'swap' ? 2.5 : 2;
    ctx.strokeStyle = mode === 'swap' ? COLOR.gold : COLOR.cinnabar;
    ctx.stroke();
  }

  /**
   * drawGlyph —— 所有汉字走离屏缓存，每帧只 drawImage（halo = 纸色外圈）。
   * 显式给目标尺寸把 DPR 缓存缩回逻辑尺寸；离屏不可用才回退 fillText。
   */
  function drawGlyph(ctx, text, x, y, color, size, alpha, lv, halo) {
    var item = artCfg ? Game.art.glyph(text, size, color, lv, halo) : null;

    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    if (item && typeof ctx.drawImage === 'function') {
      var s = item.size;
      ctx.drawImage(item.canvas, x - s / 2, y - s / 2, s, s);
    } else {
      ctx.fillStyle = color;
      ctx.font = size + 'px ' + (artCfg ? artCfg.glyph.fontStack : '"KaiTi",serif');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  /**
   * drawFigureBase —— 字下墨晕：一张离屏椭圆渐变，每帧只 drawImage。
   * 放在字下面一点，像「墨落在纸上、字从墨里长出来」。
   */
  function drawFigureBase(ctx, x, y) {
    var b = Game.boardArt && Game.boardArt.blot ? Game.boardArt.blot() : null;
    if (!b || typeof ctx.drawImage !== 'function') {
      return;
    }
    ctx.drawImage(b.canvas, x - b.w / 2, y + 4, b.w, b.h);
  }

  /**
   * drawRankBadge —— 唯一的等级视觉：左上角数字角标。
   * 1–2 墨 / 3–4 朱砂 / 5 金（满级数字下方另有 6px 小金线），全部离屏预渲染，
   * 每帧只 drawImage；武将 / 休眠单字没有等级，不画。
   */
  function drawRankBadge(ctx, board, p, lv) {
    var item = Game.boardArt && Game.boardArt.rankBadge
      ? Game.boardArt.rankBadge(lv) : null;
    if (!item || typeof ctx.drawImage !== 'function') {
      return;
    }
    ctx.drawImage(item.canvas,
      p.x - board.CELL_W / 2 + 2, p.y - board.CELL_H / 2 + 2, item.w, item.h);
  }

  /**
   * drawChar —— 休眠单字：一个字 + 一圈金色虚线框。
   * 虚线框是给玩家的信号：这东西占格、但不打人，等着配对。
   */
  function drawChar(ctx, board, p, u) {
    drawGlyph(ctx, u.char, p.x, p.y - 1, COLOR.gold, 20, 1, 0, true);

    var inset = 6;
    ctx.save();
    ctx.strokeStyle = 'rgba(196, 154, 42, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    roundRect(ctx, p.x - board.CELL_W / 2 + inset, p.y - board.CELL_H / 2 + inset,
      board.CELL_W - inset * 2, board.CELL_H - inset * 2, 5);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * drawHeroGlyph —— 武将的一个字：墨字 + 纸色外圈，走预渲染缓存。
   * 品质由 2px 直角边框体现，不再给字描品质色的边（那会让小字发糊）。
   */
  function drawHeroGlyph(ctx, x, y, ch) {
    if (!ch) {
      return;
    }
    drawGlyph(ctx, ch, x, y, COLOR.ink, 20, 1, 0, true);
  }

  /**
   * drawHero —— 武将占两格：左格姓、右格名。
   * 先铺一块跨两格的浅色底 + 边框，一眼能看出"这是一个单位占了两个格"，
   * 而不是两个各自为政的字。底色/边框按品质分：金 #C9A227、紫 #8E6BB8。
   */
  function drawHero(ctx, board, tf, u) {
    var name = u.name || u.char;
    var left = u.cells ? u.cells[0] : u.cell;
    var right = u.cells ? u.cells[u.cells.length - 1] : u.cell;

    var pl = toPx(board, tf, left[0], left[1]);
    var pr = toPx(board, tf, right[0], right[1]);

    var qc = u.quality === 'purple' ? COLOR.qualityPurple : COLOR.qualityGold;

    var inset = 3;
    var x0 = Math.min(pl.x, pr.x) - board.CELL_W / 2 + inset;
    var y0 = pl.y - board.CELL_H / 2 + inset;
    var w = board.CELL_W * (u.cells ? u.cells.length : 1) - inset * 2;
    var h = board.CELL_H - inset * 2;

    /* ART.md 3.9：2px 直角框连成一圈，和「单格内的圆形细等级环」在形状、
     * 线宽、位置上都不一样，一眼能分清「等级」和「品质」。
     * 技能刚放完的 flashSec 秒内提亮一下，提示它正在放技能。 */
    var flash = !!u.skill && u.skillCd > 0 &&
      (u.skill.cdSec - u.skillCd) < artCfg.hero.flashSec;

    ctx.save();
    ctx.fillStyle = qc;
    ctx.globalAlpha = flash ? 0.26 : 0.12;
    ctx.fillRect(x0, y0, w, h);

    ctx.globalAlpha = flash ? 1 : 0.9;
    ctx.strokeStyle = qc;
    ctx.lineWidth = artCfg.hero.borderWidth + (flash ? artCfg.anim.heroBorderFlashPx : 0);   // 技能激活时边框闪一下
    ctx.strokeRect(x0, y0, w, h);
    ctx.restore();

    drawHeroGlyph(ctx, pl.x, pl.y, name.charAt(0));
    drawHeroGlyph(ctx, pr.x, pr.y, name.charAt(1) || '');
  }

  /**
   * drawSkillCd —— 武将格上方的墨色 CD 环。
   * 圈按「剩余比例」画：刚放完是整圈，转完一圈就是能再放了。
   * CD 好了就不画 —— 技能一好就自动放，留着个空圈只是干扰。
   *
   * 画在格内靠上沿而不是格外面：往上跑到上一行会压到隔壁兵的字，
   * 而格子高度只有 46px，塞在字顶上正好。
   */
  function drawSkillCd(ctx, board, tf, u) {
    if (!u.skill || !(u.skillCd > 0)) {
      return;
    }

    var left = u.cells ? u.cells[0] : u.cell;
    var right = u.cells ? u.cells[u.cells.length - 1] : u.cell;
    var pl = toPx(board, tf, left[0], left[1]);
    var pr = toPx(board, tf, right[0], right[1]);

    var cx = (pl.x + pr.x) / 2;
    var cy = Math.min(pl.y, pr.y) - board.CELL_H / 2 + 7;
    var r = 5;
    var k = Math.max(0, Math.min(1, u.skillCd / u.skill.cdSec));

    ctx.save();

    // 底圈：淡淡一圈，告诉你"这儿有个环"（不然只剩一小段弧，看不出是进度）
    ctx.strokeStyle = 'rgba(28, 25, 20, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // 剩余 CD：从 12 点方向起顺时针画，圈越短说明越快好
    ctx.strokeStyle = 'rgba(28, 25, 20, 0.82)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();

    ctx.restore();
  }

  /* Day 26 补丁：等级环与字下等级点已整体删除，等级视觉只剩左上角数字角标
   * （在 drawUnits 里统一画，武器形态同样保留）。其它圆圈不受影响：
   * 阿斗红心在 drawAdu、武将品质边框在 drawHero、技能 CD 环在 drawSkillCd。 */

  /* ===== 打击感：字本身变形（ART.md 3.6）=====
   * 开火时机靠 cooldown 跳变推断（combat.js 开火后 cooldown += intervalSec），
   * 动画进度用 state.elapsed。只在表现对象上写 _ 前缀缓存字段，不碰判定/伤害/CD。
   */
  /* Day 26 攻速缩放：动画时长 = min(maxSec, 单位攻击间隔 × intervalFactor)。
   * 只读单位属性，绝不写 cooldown / 伤害；高等级攻速快时动画自动变短，不拖拍。
   * 导出给验收脚本用，避免测试里复制一份公式。 */
  function animSec(u, cfg) {
    /* 首帧前被外部（验收页 / 测试）直接调用时，从 DATA 兜底读同一份表现参数 */
    var art = artCfg || (global.DATA && global.DATA.balance ? global.DATA.balance.art : null);
    if (!art) { return (cfg && cfg.sec) || 0.3; }
    /* 弓 v3 是 0.5s 的多阶段动画，单独一套缩放（min(0.5, intervalSec × 0.85)） */
    if (u.kind === 'bow' && art.weapon && art.weapon.bow) {
      var b = art.weapon.bow;
      var bIv = (u.intervalSec > 0) ? u.intervalSec : b.nominalSec;
      return Math.min(b.maxSec, bIv * b.intervalFactor);
    }
    /* 刀 v3 拆层抡刀：min(0.30, intervalSec × 0.8)，参数全在 art.weapon.dao */
    if (u.kind === 'blade' && art.weapon && art.weapon.dao) {
      var d = art.weapon.dao;
      var dIv = (u.intervalSec > 0) ? u.intervalSec : d.maxSec;
      return Math.min(d.maxSec, dIv * d.intervalFactor);
    }
    /* 枪 v3 木偏旁直刺：同样是 min(0.30, intervalSec × 0.8)，参数在 art.weapon.qiang */
    if (u.kind === 'spear' && art.weapon && art.weapon.qiang) {
      var sp = art.weapon.qiang;
      var sIv = (u.intervalSec > 0) ? u.intervalSec : sp.maxSec;
      return Math.min(sp.maxSec, sIv * sp.intervalFactor);
    }
    var iv = (u && u.intervalSec > 0) ? u.intervalSec : ((cfg && cfg.sec) || 0.3);
    return Math.min(art.anim.maxSec, iv * art.anim.intervalFactor);
  }

  function attackProgress(u, state) {
    /* 弓 v3 / 刀 v3 / 枪 v3：新建单位的 cooldown 是 0，而本帧 combat 可能已经
     * 开过火、冷却已跳到 intervalSec；首帧若把 _lastCd 记成这个新值就永远
     * 看不到跳跃，第一箭 / 第一刀 / 第一枪会被漏掉。这三种按 0 起算，骑沿用旧口径。 */
    if (u._lastCd === undefined) {
      u._lastCd = (u.kind === 'bow' || u.kind === 'blade' || u.kind === 'spear')
        ? 0 : u.cooldown;
    }
    if (u.cooldown > u._lastCd + 0.0001) { u._fireAt = state.elapsed; }
    u._lastCd = u.cooldown;
    if (u._fireAt === undefined) { return -1; }
    var cfg = artCfg.anim[u.kind];
    if (!cfg) { return -1; }
    var k = (state.elapsed - u._fireAt) / animSec(u, cfg);
    return (k >= 0 && k < 1) ? k : -1;
  }

  function hitProgress(e, state) {
    if (e._lastHp === undefined) { e._lastHp = e.hp; }
    if (e.hp < e._lastHp) { e._hitAt = state.elapsed; }
    e._lastHp = e.hp;
    if (e._hitAt === undefined) { return -1; }
    var k = (state.elapsed - e._hitAt) / artCfg.anim.hitSec;
    return (k >= 0 && k < 1) ? k : -1;
  }

  /**
   * shapeFor —— 只算「字本身怎么变形」，绝不改单位坐标或判定。
   * 四种动作的位移上限都是 art.anim.dashCells（0.1 格），全程绕 p.x/p.y 做变换，
   * 首尾严格回 0：字在原格挥砍 / 突刺 / 拉弦 / 冲锋，不会飞到敌人身上。
   */
  function shapeFor(kind, k, mirror, board) {
    var s = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, ghosts: 0, ghostGap: 0 };
    var cfg = artCfg.anim[kind];
    if (!cfg) { return s; }

    var sign = mirror ? -1 : 1;
    var dash = artCfg.anim.dashCells * board.CELL_W;   // 0.1 格 → 约 6px
    var wave = Math.sin(k * Math.PI);                  // 0 → 1 → 0，中段最猛、首尾归位

    /* 刀（拆层抡刀）与枪（木偏旁直刺）都交给 weapon-fx.js：整字不再形变，
     * 所以这两种 kind 在这里直接回中性形状，避免旧口径把字整块拉长。 */
    if (kind === 'spear') {
      return s;
    } else if (kind === 'ride') {
      s.tx = dash * wave * sign;
      s.rot = cfg.rotRad * wave * sign;
      s.ghosts = cfg.ghosts;
      s.ghostGap = cfg.ghostGapCells * board.CELL_W;
    }
    return s;
  }

  function drawUnitWithAnim(ctx, board, tf, state, p, u) {
    var k = attackProgress(u, state);

    /* 弓 v3：姿态状态机（glyph ↔ weapon）整段交给 weapon-fx.js，连「搭箭待发」
     * 和回归过渡都算它的帧，所以没有攻击动画的帧也必须调一次。
     * Day 26 补丁：武器形态不画等级环 / 等级点，等级数字由 drawUnits 统一补。 */
    if (u.kind === 'bow' && Game.weaponFx) {
      Game.weaponFx.drawBow(ctx, u, state, board, tf, p, k, artCfg, COLOR);
      return;
    }

    /* 刀 v3：整字不动，只让左撇抡一下；拆层 / 动画 / 残影都在 weapon-fx.js */
    if (u.kind === 'blade' && Game.weaponFx && Game.weaponFx.drawDao) {
      Game.weaponFx.drawDao(ctx, u, state, p, artCfg, COLOR);
      return;
    }

    /* 枪：姿态状态机（glyph ↔ weapon）在 src/qiang-fx.js；仓不动、木变枪 */
    if (u.kind === 'spear' && Game.qiangFx) {
      Game.qiangFx.draw(ctx, u, state, board, p, artCfg, COLOR);
      return;
    }

    if (k < 0) {
      drawGlyph(ctx, u.char, p.x, p.y, COLOR.ink, artCfg.glyph.unitSize, 1, u.lv, true);
      return;
    }

    var s = shapeFor(u.kind, k, tf.mirror, board);
    var sign = tf.mirror ? -1 : 1;

    ctx.save();
    ctx.translate(p.x + s.tx, p.y + s.ty);
    ctx.rotate(s.rot);
    ctx.scale(s.sx, s.sy);

    for (var g = s.ghosts; g > 0; g--) {
      // 越远的拖影越淡（2–3 帧半透明残影），只是重画字，不产生粒子。
      drawGlyph(ctx, u.char, -g * s.ghostGap * sign, 0,
        COLOR.ink, artCfg.glyph.unitSize, 0.2 / g, u.lv, true);
    }
    drawGlyph(ctx, u.char, 0, 0, COLOR.ink, artCfg.glyph.unitSize, 1, u.lv, true);

    /* Day 26 字形变：字的一部分变成武器出手，画在同一局部坐标里，字不飞出去 */
    if (Game.weaponArt) {
      Game.weaponArt.draw(ctx, u.kind, k, u, board, artCfg, COLOR);
    }
    ctx.restore();
  }

  /**
   * drawUnits —— 画场上的单位。三种画法分开：兵 / 休眠单字 / 武将。
   * 正在被拖的那一个跳过（改画成 DOM 拖影）。
   */
  function drawUnits(ctx, board, tf, state, view) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];

      if (view.dragging && u.id === view.dragUnitId) {
        continue;
      }

      if (u.type === 'hero') {
        var lc = u.cells ? u.cells[0] : u.cell;
        var rc = u.cells ? u.cells[u.cells.length - 1] : u.cell;
        var lp = toPx(board, tf, lc[0], lc[1]);
        var rp = toPx(board, tf, rc[0], rc[1]);
        drawFigureBase(ctx, lp.x, lp.y);
        drawFigureBase(ctx, rp.x, rp.y);
        drawHero(ctx, board, tf, u);
        drawSkillCd(ctx, board, tf, u);
        continue;
      }

      var p = toPx(board, tf, u.cell[0], u.cell[1]);
      drawFigureBase(ctx, p.x, p.y);

      if (u.type === 'char') {
        drawChar(ctx, board, p, u);
        continue;
      }

      drawUnitWithAnim(ctx, board, tf, state, p, u);
      drawRankBadge(ctx, board, p, u.lv);
    }
  }

  /**
   * drawEnemies —— 画敌人 + 血条。
   * 血条很细（3px），只用来让你看出"打中了没有"。
   */
  function drawEnemies(ctx, board, tf, state, balance) {
    var fig = Game.boardArt ? Game.boardArt.figure() : null;
    var enemyInk = fig ? fig.enemyInk : COLOR.cinnabar;

    for (var i = 0; i < state.enemies.length; i++) {
      var e = state.enemies[i];
      if (e.dead) {
        continue;
      }

      var pos = board.pathPos(e.side, e.progress);
      var p = toPx(board, tf, pos.cx, pos.cy);

      /* 受击：纸色闪一下（不用纯白）+ 横向抖动 3px，0.15 秒收住。 */
      var hk = hitProgress(e, state);
      var ex = p.x + (hk < 0 ? 0
        : Math.sin(state.elapsed * 80) * artCfg.anim.hitShakePx * (1 - hk));

      /* 阵营区分：来袭敌兵用红棕字，我方棋子仍是浓墨 */
      drawFigureBase(ctx, ex, p.y);
      drawGlyph(ctx, e.char, ex, p.y - 3, enemyInk, 22, 1, 0, true);
      if (hk >= 0) {
        drawGlyph(ctx, e.char, ex, p.y - 3, artCfg.palette.paper, 22, (1 - hk) * 0.85, 0, false);
        /* 命中反馈：只在掉血那一帧撒一次黑墨点，复用粒子池（不每帧 new）。
         * 所有攻击方式（刀 / 枪穿透 / 骑溅射 / 弓弹道 / 技能）都走这里，不改判定。 */
        if (e._inkDone !== e._hitAt && Game.renderFx) {
          e._inkDone = e._hitAt;
          Game.renderFx.spawnInk(ex, p.y - 3, tf.oy, state.elapsed,
            artCfg.fx.hitBurstCount, balance);
        }
      }

      /* 细红血条统一贴在格子上沿（按 hp/maxHp），和字 / 状态标记都不重叠 */
      if (fig) {
        var bw = fig.hpBarW;
        var bh = fig.hpBarH;
        var bx = ex - bw / 2;
        var by = p.y - board.CELL_H / 2 + fig.hpBarInset;
        ctx.fillStyle = fig.hpBarTrack;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = fig.hpBarFill;
        ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, e.hp / e.maxHp)), bh);
      }

      /* 状态标记：只加两个小记号，不抢血条的注意力 ——
       * 眩晕 = 墨色虚线圈（"被震住了"），灼烧 = 头顶跳动的朱砂小点。 */
      if (e.stunTimer > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(28, 25, 20, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y - 3, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (e.burnTimer > 0) {
        var flick = Math.sin(state.elapsed * 18 + e.id) * 1.6;
        ctx.save();
        ctx.fillStyle = COLOR.cinnabar;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(p.x + 9, p.y - 14 + flick, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

    }
  }

  /**
   * drawFloaters —— 馒头飘字。
   * 普通收入用墨绿；碎心那一次换成朱砂、字号更大，一眼能看出"这次不一样"。
   */
  function drawFloaters(ctx, board, tf, state) {
    for (var i = 0; i < state.floaters.length; i++) {
      var f = state.floaters[i];
      var p = toPx(board, tf, f.cx, f.cy);

      // 边界保护：飘字会上浮，靠近半场边缘的字会被裁掉。
      // 夹在该半场自己的纵向范围内（整块画布的一上半或一下半）。
      var x = Math.max(20, Math.min(board.WIDTH - 20, p.x));
      var top = tf.oy || 0;
      var y = Math.max(top + 12, Math.min(top + (tf.halfH || board.HEIGHT) - 8, p.y));

      // 快消失时淡出，避免硬闪一下就没。
      var alpha = Math.min(1, f.life / 0.35);
      var strong = f.variant === 'shatter';

      drawGlyph(ctx, f.text, x, y, strong ? COLOR.cinnabar : COLOR.gain, strong ? 15 : 12, alpha);
    }
  }

  /**
   * drawAdu —— 阿斗的「动态部分」：只按剩余生命点亮红心。
   * 「斗」字 / 冕旒冠 / 小旗 / 暗心排已经画在 board-art.js 的静态地形里，
   * 这里不重画，免得每帧叠字重影；受击的整半场屏震由 drawSide 负责。
   */
  function drawAdu(ctx, board, tf, state, balance) {
    var end = board.home(state.side);
    var c = toPx(board, tf, end[0], end[1]);

    var hearts = state.leakPoints <= 0
      ? 0
      : Math.ceil(state.leakPoints / balance.lives.leaksPerHeart);
    var total = balance.lives.hearts;
    var cfg = Game.boardArt ? Game.boardArt.cfg() : null;
    var gap = cfg ? cfg.heartGap : 11;
    var size = cfg ? cfg.heartSize : 10;
    var startX = c.x - ((total - 1) * gap) / 2;

    for (var i = 0; i < hearts && i < total; i++) {
      drawGlyph(ctx, '♥', startX + i * gap, c.y - 18, COLOR.cinnabar, size, 1);
    }
  }

  /**
   * drawHurtBorder —— 漏怪时该半场四周的朱砂边框，随时间淡出。
   * 只框自己那半边，玩家一眼能看出是哪边挨打了。
   */
  function drawHurtBorder(ctx, board, tf, state, balance) {
    if (state.hurtTimer <= 0) {
      return;
    }

    var window = state.shatterTimer > 0 ? balance.adu.shatterSec : balance.adu.shakeSec;
    var k = Math.max(0, Math.min(1, state.hurtTimer / window));
    var inset = balance.fx.borderInset;

    ctx.save();
    ctx.globalAlpha = k * balance.adu.flashAlpha;
    ctx.strokeStyle = COLOR.cinnabar;
    ctx.lineWidth = balance.fx.borderWidth;
    ctx.strokeRect(inset, (tf.oy || 0) + inset,
      board.WIDTH - inset * 2, (tf.halfH || board.HEIGHT) - inset * 2);
    ctx.restore();
  }

  /**
   * drawProjectiles —— 弓的飞行箭：一小段横线，尾巴朝来的方向。
   */
  /* 真弹道：复用 weaponArt.arrow 的「线 + 三角箭头 + 尾羽」，按目标方向旋转；
   * 飞行时间仍由 combat 的 projectile.duration（0.15–0.25s）决定，这里只管画。 */
  function drawProjectiles(ctx, board, tf, state) {
    if (Game.weaponFx) {
      Game.weaponFx.drawProjectiles(ctx, board, tf, state);
      return;
    }
    /* 降级：weapon-fx.js 未加载时仍按旧法把弹道画成完整箭 */
    if (!Game.weaponArt) { return; }
    var w = artCfg.weapon.bow;
    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      var now = toPx(board, tf, p.cx, p.cy);
      var end = toPx(board, tf, p.tx, p.ty);
      var angle = Math.atan2(end.y - now.y, end.x - now.x);
      Game.weaponArt.arrow(ctx, now.x, now.y, 1, w, COLOR.ink, 1, angle);
    }
  }

  /* 降级路径（离屏地形不可用）也画同一条城墙带，不让波浪线 / 实线回潮。 */
  function drawDivider(ctx, board) {
    if (Game.boardArt && Game.boardArt.cfg()) {
      Game.boardArt.wall(ctx, board, board.WIDTH);
    }
  }

  /**
   * drawSide —— 画一个半场的「动态内容」：阿斗 / 单位 / 敌人 / 特效 / 弹道 / 飘字 / 边框。
   * 棋盘底色与路径是整块画一次的（drawCells / drawPaths），不在这里重复。
   * tf.oy 只是该半场的像素起点，供粒子分组、飘字边界与朱砂边框使用；
   * tf.mirror 恒为 false —— 上半场单位/敌人保持正向，不旋转。
   */
  function drawSide(ctx, board, tf, state, view, balance, withHighlight) {
    /* 阿斗受击：整个半场屏震（ART.md 3.6，8px 衰减），不是只有阿斗自己抖。 */
    ctx.save();
    if (state.hurtTimer > 0) {
      var win = state.shatterTimer > 0 ? balance.adu.shatterSec : balance.adu.shakeSec;
      var k = Math.max(0, Math.min(1, state.hurtTimer / win));
      ctx.translate(Math.sin(state.elapsed * 55) * artCfg.anim.hurtShakePx * k, 0);
    }

    if (withHighlight && view.dragging && view.targetCell &&
        view.targetMode && view.targetMode !== 'none' && view.targetMode !== 'blocked') {
      drawHighlight(ctx, board, tf, view.targetCell, view.targetMode);
    }

    drawAdu(ctx, board, tf, state, balance);

    drawUnits(ctx, board, tf, state, view);
    drawEnemies(ctx, board, tf, state, balance);
    Game.renderFx.draw(ctx, board, tf, state, balance);
    drawProjectiles(ctx, board, tf, state);
    drawFloaters(ctx, board, tf, state);

    drawHurtBorder(ctx, board, tf, state, balance);
    ctx.restore();
  }

  /**
   * drawBattle —— 战斗场景的完整一帧：整块 8×10 一次画完。
   * 上半场（行 0–4）是对手，下半场（行 5–9）是玩家，都不镜像。
   * me 是玩家 state（side='bottom'），foe 是对手 state（side='top'）。
   */
  function drawBattle(ctx, board, me, foe, view, balance) {
    ensureArt(balance, board);   // 第一帧生成纸张 + 静态地形，之后只是取缓存
    ctx.clearRect(0, 0, board.WIDTH, board.DUEL_HEIGHT);

    /* 静态地形：草地 / 石框 / 五类格 / 路径箭头 / 阿斗 / 外圈装饰，
     * 全部预先画在离屏 canvas 上，每帧只一次 drawImage。 */
    var t = Game.boardArt ? Game.boardArt.terrain() : null;
    if (t && typeof ctx.drawImage === 'function') {
      ctx.drawImage(t.canvas, 0, 0, t.w, t.h);
      drawUnlockedCells(ctx, board, me, foe);   // 唯一会变的地形：铲开的 D 格
    } else {
      /* 降级：离屏 canvas 不可用时仍能看到棋盘，不白屏 */
      paintPaper(ctx, board);
      drawCells(ctx, board, me, foe);
      drawPaths(ctx, board);
      drawDivider(ctx, board);
    }

    /* 动态层：两个半场各画自己的对象，坐标都是全局格子，不做镜像 */
    var half = board.HALF_HEIGHT;
    drawSide(ctx, board, { ox: 0, oy: 0, halfH: half, mirror: false }, foe, view, balance, false);
    drawSide(ctx, board, { ox: 0, oy: half, halfH: half, mirror: false }, me, view, balance, true);
  }

  Game.render = {
    drawBattle: drawBattle,
    COLOR: COLOR,

    /* 下面这几个是 render-fx.js 要用的工具：特效用同一套坐标换算和画字方式，
     * 不然它还得自己再实现一遍 toPx。 */
    toPx: toPx,
    drawGlyph: drawGlyph,
    roundRect: roundRect,
    animSec: animSec
  };
})(globalThis);