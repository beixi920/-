/* 单骑 · 汉字塔防 —— 棋盘几何与格子数据
 * 只放"事实"：尺寸、格子类型、两条路径。不画图、不碰 DOM、不读存档。
 *
 * 唯一数据源是 data/board_map.js 的 DATA.boardMap（预览页同一份）。
 * 坐标一律是「整块 8×10 棋盘」的全局坐标：列 0–7、行 0–9，不做半场镜像。
 *   上半场 side='top'    = 行 0–4（对手）
 *   下半场 side='bottom' = 行 5–9（玩家）
 * 两半 180° 旋转对称：cell(c,r) 的对称格是 (7-c, 9-r)。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var map = (global.DATA && global.DATA.boardMap) || null;

  if (!map) {
    console.error('[单骑] data/board_map.js 未加载，检查 index.html 的 script 顺序');
    return;
  }

  /* ===== 尺寸 =====
   * 44px 正方形格子：8 列 = 352 宽、10 行 = 440 高。
   * 画布就是这一整块，不再拼两个半场，所以 DUEL_HEIGHT === HEIGHT。 */
  var COLS = map.cols;        // 8
  var ROWS = map.rowCount;    // 10
  var CELL_W = 44;            // 格宽（画布逻辑像素）
  var CELL_H = 44;            // 格高（正方形：路径横竖等长，技能横杠不会变形）
  var WIDTH = COLS * CELL_W;  // 352
  var HEIGHT = ROWS * CELL_H; // 440
  var HALF_H = HEIGHT / 2;    // 220：行 4 / 行 5 的分界

  /* 兼容字段：art.js / main.js 用 DUEL_HEIGHT 当作整块画布高；
   * drag.js 旧代码里的 LOWER_Y / GAP 已不再参与坐标，保留为 0 避免误用。 */
  var DUEL_H = HEIGHT;
  var LOWER_Y = 0;
  var GAP = 0;

  var paths = { top: map.topPath, bottom: map.bottomPath };
  var homes = { top: map.adu.top, bottom: map.adu.bottom };
  var spawns = { top: map.spawn.top, bottom: map.spawn.bottom };

  /* 开局 3 个兵的落点：上半场按任务卡给定，下半场取 180° 对应。 */
  var starts = {
    top: [[3, 2], [4, 2], [5, 2]],
    bottom: [[4, 7], [3, 7], [2, 7]]
  };

  /* 按类型预先分好格子，避免每次落子都扫整张表。 */
  var byType = { W: [], D: [], P: [], R: [], H: [] };
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      byType[map.rows[r].charAt(c)].push([c, r]);
    }
  }

  function normSide(side) {
    return side === 'top' ? 'top' : 'bottom';
  }

  /** sideOf —— 这个格子属于哪半场。越界返回 null。 */
  function sideOf(cell) {
    if (!cell || !isInside(cell)) {
      return null;
    }
    return cell[1] < ROWS / 2 ? 'top' : 'bottom';
  }

  function isInside(cell) {
    return !!cell && cell[0] >= 0 && cell[0] < COLS && cell[1] >= 0 && cell[1] < ROWS;
  }

  function typeAt(cell) {
    return isInside(cell) ? map.rows[cell[1]].charAt(cell[0]) : '';
  }

  /** cellCenter —— 全局格子 → 画布像素中心（不再有半场偏移）。 */
  function cellCenter(cell) {
    return {
      x: cell[0] * CELL_W + CELL_W / 2,
      y: cell[1] * CELL_H + CELL_H / 2
    };
  }

  /** path(side) —— 该边 16 格路径，顺序就是敌人行进顺序（首 R、尾 H）。 */
  function path(side) {
    return paths[normSide(side)];
  }

  /**
   * pathPos(side, progress) —— 沿该边路径插值。
   * progress 单位是「格」：0 = 出兵营，(path.length-1) = 阿斗。
   * 兼容旧调用 pathPos(progress)：省略 side 时按 bottom 处理。
   */
  function pathPos(side, progress) {
    if (typeof side === 'number') {
      progress = side;
      side = 'bottom';
    }
    var pts = path(side);
    var last = pts.length - 1;

    if (progress >= last) {
      return { cx: pts[last][0], cy: pts[last][1] };
    }
    if (progress <= 0) {
      return { cx: pts[0][0], cy: pts[0][1] };
    }

    var i = Math.floor(progress);
    var t = progress - i;
    return {
      cx: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
      cy: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
    };
  }

  function cellsOf(side, type) {
    var s = normSide(side);
    var out = [];
    for (var i = 0; i < byType[type].length; i++) {
      var cell = byType[type][i];
      if (sideOf(cell) === s) {
        out.push(cell);
      }
    }
    return out;
  }

  function hasSide(cell, side) {
    return side === undefined || sideOf(cell) === normSide(side);
  }

  /** isPlace —— 白格可放置（W）。挖开的 D 由 state.unlocked 另外判。 */
  function isPlace(cell, side) {
    return typeAt(cell) === 'W' && hasSide(cell, side);
  }

  /** isDig —— 深绿可铲格（D）。 */
  function isDig(cell, side) {
    return typeAt(cell) === 'D' && hasSide(cell, side);
  }

  /** isPath —— 浅绿敌人路径（P）。 */
  function isPath(cell, side) {
    return typeAt(cell) === 'P' && hasSide(cell, side);
  }

  function home(side) { return homes[normSide(side)]; }
  function spawn(side) { return spawns[normSide(side)]; }

  function isHome(side, cell) {
    var h = home(side);
    return !!cell && cell[0] === h[0] && cell[1] === h[1];
  }
  function isSpawn(side, cell) {
    var s = spawn(side);
    return !!cell && cell[0] === s[0] && cell[1] === s[1];
  }
  function startCells(side) { return starts[normSide(side)]; }

  Game.board = {
    COLS: COLS,
    ROWS: ROWS,
    CELL_W: CELL_W,
    CELL_H: CELL_H,
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    DUEL_HEIGHT: DUEL_H,
    HALF_HEIGHT: HALF_H,
    LOWER_Y: LOWER_Y,
    GAP: GAP,

    rows: map.rows,
    paths: paths,
    starts: starts,

    sideOf: sideOf,
    isInside: isInside,
    typeAt: typeAt,
    cellCenter: cellCenter,

    path: path,
    pathPos: pathPos,
    pathCells: function (side) { return path(side).slice(); },
    whiteCells: function (side) { return cellsOf(side, 'W'); },
    digCells: function (side) { return cellsOf(side, 'D'); },
    pathCellsByType: function (side) { return cellsOf(side, 'P'); },
    home: home,
    spawn: spawn,
    startCells: startCells,

    isPlace: isPlace,
    isDig: isDig,
    isPath: isPath,
    isHome: isHome,
    isSpawn: isSpawn
  };
})(globalThis);
