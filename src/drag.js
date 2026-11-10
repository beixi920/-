/* 单骑 · 汉字塔防 —— 拖拽（备战席 → 棋盘，场上 → 场上）
 * 职责：只做"手指/鼠标搬东西"这件事：跟手、算落点、把结果交给 state.js。
 * 不判定规则（state.js 判定），不画战场（render.js 画），只管一个 DOM 拖影。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var THRESHOLD = 4;      // 超过这么多像素才算拖拽，否则算点击（px）
  var HIT_RADIUS = 26;    // 判定"点到某个兵"的半径（画布逻辑像素）

  /* 给 render 用的视图状态，字段名和以前的 main.view 一致 */
  var view = {
    dragging: false,
    dragUnitId: -1,
    dragChar: '',
    dragPos: { x: 0, y: 0 },
    targetCell: null,
    targetMode: 'none'   // none | place | swap | blocked：决定高亮颜色
  };

  var canvas = null;
  var scene = null;
  var ghost = null;
  var ghostIsShovel = false;   // 拖影当前是不是铲子图标（避免每帧重建 canvas）
  var benchEl = null;     // 备战席 DOM，用来判断「拖到备战席区域」（B4）

  var drag = {
    active: false,
    moved: false,
    source: 'none',     // 'card' | 'unit'
    cardId: -1,
    unitId: -1,
    char: '',
    isShovel: false,    // 拖的是铲子卡：拖影画图标、落点只认 D 格
    startX: 0,
    startY: 0,
    /* 抓到的如果是武将：先记下"抓的是哪一格"，真正拖起来（超过阈值）才拆，
     * 否则点一下就会把武将拆散，代价太大。 */
    cellIndex: 0,
    wasHero: false,       // 这次拖拽的起点是武将（用于拒绝「武将↔武将」）
    pendingSplit: null
  };

  function init(canvasEl) {
    canvas = canvasEl;
    scene = document.getElementById('scene-battle');
    ghost = document.getElementById('drag-ghost');
    benchEl = document.getElementById('bench');

    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('pointermove', onCanvasHover);

    // move / up 挂在 window 上：卡片在 DOM 里，拖到画布上时事件目标会变，
    // 挂在 window 才收得到，不需要指针捕获。
    global.addEventListener('pointermove', onMove);
    global.addEventListener('pointerup', onUp);
    global.addEventListener('pointercancel', onUp);
  }

  /* ============ 坐标 ============ */

  /**
   * boardPoint —— 指针位置 → 整块 8×10 画布的坐标。
   * 分母是 WIDTH / DUEL_HEIGHT（整块画布），棋盘不再分上下两块做镜像。
   */
  function boardPoint(event) {
    var board = Game.board;
    var rect = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left) * (board.WIDTH / rect.width),
      y: (event.clientY - rect.top) * (board.DUEL_HEIGHT / rect.height)
    };
  }

  /**
   * isOverBench —— 松手时指针是不是落在备战席区域（B4）。
   * 用备战席自己的矩形，不靠「画布外」这个模糊范围，免得拖到 HUD 也把兵收走。
   */
  function isOverBench(event) {
    if (!benchEl || !benchEl.getBoundingClientRect) {
      return false;
    }
    var r = benchEl.getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right &&
      event.clientY >= r.top && event.clientY <= r.bottom;
  }

  /**
   * cellAt —— 画布坐标 → 全局格子 [列, 行]（列 0–7、行 0–9）。
   * 只有玩家半场（行 5–9）可以落子；上半场是对手的，返回 null。
   */
  function cellAt(point) {
    var board = Game.board;

    if (point.x < 0 || point.x >= board.WIDTH || point.y < 0 || point.y >= board.HEIGHT) {
      return null;
    }
    var cell = [Math.floor(point.x / board.CELL_W), Math.floor(point.y / board.CELL_H)];
    if (cell[1] < board.ROWS / 2) {
      return null;
    }
    return cell;
  }

  /**
   * hitUnit —— 指针落在哪个单位上，以及落在它的第几格。
   *
   * 武将占两格，两格都能抓。cellIndex 说明抓的是哪一格：抓住哪张字，
   * 拆开后就拖哪张（姓格 → 姓，名格 → 名），另一个字留在原地。
   */
  function hitUnit(point) {
    var state = Game.main.getState();
    if (!state) {
      return null;
    }

    var board = Game.board;

    // 指针在上半场（行 0–4）：那里是对手的兵，玩家碰不到。
    if (point.y < board.HALF_HEIGHT || point.y >= board.HEIGHT) {
      return null;
    }

    var best = null;
    var bestIdx = 0;
    var bestDist = HIT_RADIUS;

    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      var cells = u.cells || [u.cell];

      for (var k = 0; k < cells.length; k++) {
        var c = board.cellCenter(cells[k]);
        var dx = point.x - c.x;
        var dy = point.y - c.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= bestDist) {
          bestDist = dist;
          best = u;
          bestIdx = k;
        }
      }
    }

    return best ? { unit: best, cellIndex: bestIdx } : null;
  }

  /* ============ 开始拖 ============ */

  function onCanvasDown(event) {
    if (event.button !== 0) {
      return;
    }
    var state = Game.main.getState();
    if (!state || state.status !== 'playing') {
      return;
    }

    var point = boardPoint(event);
    var hit = hitUnit(point);

    if (hit) {
      begin('unit', hit.unit, event, hit.cellIndex);
      return;
    }

    // 点到绿格（今天还不能放）：直接提示，不用等拖拽。
    var cell = cellAt(point);
    if (cell && Game.state.isGreenCell(cell, Game.board, state.side)) {
      Game.ui.showNote('需要铲子');
    }
  }

  function onCanvasHover(event) {
    if (drag.active) {
      return;
    }
    var state = Game.main.getState();
    if (!state) {
      return;
    }
    canvas.style.cursor = hitUnit(boardPoint(event)) ? 'grab' : 'default';
  }

  /**
   * beginFromCard —— ui.js 在卡片 pointerdown 时调用。
   */
  function beginFromCard(card, event) {
    begin('card', card, event);
  }

  function begin(source, item, event, cellIndex) {
    if (drag.active) {
      return;
    }

    drag.active = true;
    drag.moved = false;
    drag.source = source;
    drag.char = item.char || '';
    drag.isShovel = item.type === 'shovelCard';
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.cellIndex = (source === 'unit' && cellIndex) ? cellIndex : 0;
    drag.wasHero = false;
    drag.pendingSplit = null;

    if (source === 'card') {
      drag.cardId = item.id;
      drag.unitId = -1;
    } else if (source === 'unit') {
      drag.cardId = -1;

      if (item.type === 'hero') {
        // 抓的是武将：先记下来，落子时才真拆（见 onUp）。
        // 拖影先显示"抓到的那一个字"，拆完后是同一个字，视觉上不跳。
        var nm = item.name || item.char || '';
        drag.char = nm.charAt(drag.cellIndex) || nm.charAt(0);
        drag.wasHero = true;
        drag.unitId = -1;
        drag.pendingSplit = { heroId: item.id, cellIndex: drag.cellIndex };
      } else {
        drag.unitId = item.id;
      }
    } else {
      drag.unitId = -1;
      drag.cardId = -1;
    }
  }

  /* ============ 拖拽中 ============ */

  function onMove(event) {
    if (!drag.active) {
      return;
    }

    var dx = event.clientX - drag.startX;
    var dy = event.clientY - drag.startY;

    // 还没超过阈值：当成普通点击，不显示拖影。
    if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < THRESHOLD) {
      return;
    }
    drag.moved = true;

    var p = boardPoint(event);
    var st = Game.main.getState();

    view.dragging = true;
    view.dragChar = drag.char;
    /* 武将还没拆：先把整个武将藏起来，拖影跟着指针；落子时才拆（onUp）。 */
    view.dragUnitId = drag.source === 'unit'
      ? (drag.unitId >= 0 ? drag.unitId : (drag.pendingSplit ? drag.pendingSplit.heroId : -1))
      : -1;
    view.dragPos.x = p.x;
    view.dragPos.y = p.y;
    view.targetCell = cellAt(p);
    view.targetMode = st ? targetMode(st, view.targetCell) : 'none';

    moveGhost(event);
  }

  /**
   * targetMode —— 落点回馈：空格可放 = place，已占格可换 = swap，非法 = blocked。
   * 只用于高亮颜色，不参与任何判定（真正能不能换仍由 state.dropUnit/dropCard 决定）。
   */
  function targetMode(state, cell) {
    if (!cell) {
      return 'none';
    }
    if (drag.isShovel) {
      return (Game.state.isGreenCell(cell, Game.board, state.side) &&
        !Game.state.isUnlocked(state, cell)) ? 'place' : 'blocked';
    }

    var except = (drag.source === 'unit' && drag.unitId >= 0) ? drag.unitId : undefined;
    var tgt = Game.state.unitAtCell(state, cell, except);

    if (!tgt) {
      return Game.state.canPlaceAt(state, cell, Game.board) ? 'place' : 'blocked';
    }
    if (tgt.type === 'hero') {
      // 武将↔武将不换；其它来源落到武将格会先拆开再换。
      return drag.wasHero ? 'blocked' : 'swap';
    }
    return 'swap';
  }

  function moveGhost(event) {
    if (!ghost || !scene) {
      return;
    }
    var rect = scene.getBoundingClientRect();
    var wantShovel = !!drag.isShovel;

    if (wantShovel !== ghostIsShovel) {
      ghost.textContent = '';
      if (wantShovel) {
        var icon = Game.benchArt ? Game.benchArt.shovelIcon(34) : null;
        if (icon) {
          ghost.appendChild(icon);
        }
      }
      ghostIsShovel = wantShovel;
    }

    if (!wantShovel) {
      ghost.textContent = drag.char;   // 字卡 / 兵 / 单字：还是那个字
    }

    ghost.classList.add('is-on');
    ghost.style.left = (event.clientX - rect.left) + 'px';
    ghost.style.top = (event.clientY - rect.top) + 'px';
  }

  /* ============ 松手 ============ */

  function onUp(event) {
    if (!drag.active) {
      return;
    }

    var state = Game.main.getState();
    var moved = drag.moved;
    var source = drag.source;
    var cardId = drag.cardId;
    var unitId = drag.unitId;
    var isShovel = drag.isShovel;
    var splitReq = drag.pendingSplit;

    finish();

    if (!state) {
      return;
    }

    // 没拖动 = 点击：备战席卡片切换选中。
    if (!moved) {
      if (source === 'card') {
        Game.ui.toggleCardSelection(cardId);
      }
      return;
    }

    var cell = cellAt(boardPoint(event));

    if (!cell) {
      // 拖到棋盘外（B4 口径）：
      //   兵   → 只有落在「备战席区域」才收回，带兵种 + 等级变成一张卡；席满则归位不动。
      //   单字 → 规则不变，拖到棋盘外就能由 hero.returnToBench 收回复战席。
      //   武将 → 松开时才拆，被抓的那张字按单字规则收回复战席。
      //   铲子卡 → 什么都不做，卡留在席上。
      if (splitReq) {
        var out = Game.hero.splitHero(state, splitReq.heroId, splitReq.cellIndex);
        if (out) {
          unitId = out.picked.id;
        }
      }
      var putBack = false;
      if (source === 'unit') {
        if (isOverBench(event)) {
          putBack = Game.state.returnUnitToBench(state, unitId);
        }
        if (!putBack) {
          putBack = Game.hero.returnToBench(state, unitId);
        }
      }
      if (putBack) {
        Game.ui.markBenchDirty();
        Game.ui.showNote('已收回备战席');
      } else if (isShovel) {
        Game.ui.showNote('铲子卡只能拖到深绿格');
      } else {
        // 收不回去（席满 / 兵没拖到备战席）就留在原地 —— 万一旁边正躺着另一半字，该合就合。
        reportAwaken(state);
      }
      return;
    }

    /* ===== 武将参与：先把该拆的拆掉，再走普通落子 ===== */
    if (splitReq) {
      var heroUnit = findUnitById(state, splitReq.heroId);
      // 原地松手：不拆分、不移动。
      if (heroUnit && isHeroCell(heroUnit, cell)) {
        return;
      }
      var heroTarget = Game.state.unitAtCell(state, cell);
      // 武将↔武将：两边都不动，也不拆（避免刷技能 CD）。
      if (heroTarget && heroTarget.type === 'hero') {
        Game.ui.showNote('请先拆开再移动');
        return;
      }
      // 非法落点（路径 / 未挖的深绿格）：不拆，武将原样留下（拆了再合会白刷技能 CD）。
      if (!heroTarget && !Game.state.canPlaceAt(state, cell, Game.board)) {
        Game.ui.showNote(Game.state.isGreenCell(cell, Game.board, state.side) ? '需要铲子' : '这里不能放');
        return;
      }
      var picked = Game.hero.splitHero(state, splitReq.heroId, splitReq.cellIndex);
      if (picked) {
        unitId = picked.picked.id;
      }
    }

    /* 目标是武将：解体，让目标格上的字参与交换，另一张字留在原格。 */
    var targetNow = Game.state.unitAtCell(state, cell, source === 'unit' ? unitId : undefined);
    if (targetNow && targetNow.type === 'hero') {
      var cells = targetNow.cells || [targetNow.cell];
      var idx = 0;
      for (var k = 0; k < cells.length; k++) {
        if (cells[k][0] === cell[0] && cells[k][1] === cell[1]) {
          idx = k;
          break;
        }
      }
      Game.hero.splitHero(state, targetNow.id, idx);
    }

    var result = source === 'card'
      ? Game.state.dropCard(state, cardId, cell, global.DATA.balance, Game.board)
      : Game.state.dropUnit(state, unitId, cell, global.DATA.balance, Game.board);

    if (result.action === 'place' || result.action === 'merge' ||
        result.action === 'place-char' || result.action === 'dig' ||
        result.action === 'swap') {
      // 卡被消耗 / 换位后必须重绘备战席，否则屏幕上会留下"同一张卡"。
      Game.ui.markBenchDirty();
    }

    if (result.action === 'dig') {
      Game.ui.showNote('挖开一格');
    }

    if (result.action === 'swap') {
      Game.ui.showNote('已交换');
    }

    if (result.action === 'reject') {
      if (source === 'card') {
        Game.ui.shakeCard(cardId);   // 卡不能上场时抖一下，绝不吞卡
      }
      if (isShovel) {
        Game.ui.showNote(Game.state.isGreenCell(cell, Game.board, state.side)
          ? '这格已经挖开了' : '铲子卡只能拖到深绿格');
      } else if (Game.state.isGreenCell(cell, Game.board, state.side)) {
        Game.ui.showNote('需要铲子');
      }
    }

    if (result.action === 'merge') {
      var merged = Game.state.unitAtCell(state, result.cell);
      if (merged) {
        Game.ui.showNote('合成 Lv' + merged.lv);
      }
    }

    // 松手后统一查一次"能不能拼字"。
    //
    // 为什么连 'none' / 'reject' 也要查：武将拆开后两张字仍然相邻、字序也对，
    // 拆分那一刻不能查（否则立刻又合上）；但如果玩家把字拖回原位、或者拖到非法格
    // 被退回原位，这时两张字又摆成了合法的一对，就该自动重组。
    reportAwaken(state);
  }

  function findUnitById(state, id) {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id === id) {
        return state.units[i];
      }
    }
    return null;
  }

  function isHeroCell(hero, cell) {
    if (!hero) {
      return false;
    }
    var cells = hero.cells || [hero.cell];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] === cell[0] && cells[i][1] === cell[1]) {
        return true;
      }
    }
    return false;
  }

  /**
   * reportAwaken —— 查一次拼字，顺手把三种结果说给玩家听。
   */
  function reportAwaken(state) {
    var aw = Game.hero.tryAwaken(state, global.DATA.balance);

    if (aw.ok) {
      Game.ui.showNote(aw.heroName + ' 觉醒');
    } else if (aw.failReason === 'order') {
      Game.ui.showNote('字序不对');
    } else if (aw.failReason === 'mismatch') {
      Game.ui.showNote('此二字不能成将');
    }
  }

  function finish() {
    drag.active = false;
    drag.moved = false;
    drag.source = 'none';
    drag.cardId = -1;
    drag.unitId = -1;
    drag.cellIndex = 0;
    drag.wasHero = false;
    drag.isShovel = false;
    drag.pendingSplit = null;

    view.dragging = false;
    view.dragUnitId = -1;
    view.targetCell = null;
    view.targetMode = 'none';

    if (ghost) {
      ghost.classList.remove('is-on');
    }
  }

  /**
   * cancel —— 切场景 / 重开时强制收尾，避免拖影留在屏幕上。
   */
  function cancel() {
    finish();
  }

  function getView() {
    return view;
  }

  Game.drag = {
    init: init,
    beginFromCard: beginFromCard,
    cancel: cancel,
    getView: getView
  };
})(globalThis);
