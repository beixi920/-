/* 单骑 · 汉字塔防 —— 对手 AI
 * 规矩：纯逻辑，只读写传进来的 state，不碰 DOM / Canvas，也不持有计时器
 *       （"多久想一次"由 main.js 按难度取 intervalSec 来倒计时）。
 *
 * 它做事的方式和玩家完全一样：
 *   征兵走 Game.recruit.recruit（内部扣钱、整席替换、抽铲子）
 *   合成走 Game.state.mergeInto（内部重算等级属性）
 *   挖格走 Game.state.dropCard（铲子卡落 D 格：消耗卡 + 挖开 + 特效）
 *   放兵走 Game.state.dropCard（内部检查格子能不能放、放了才消耗卡）
 * 所以"不白送兵、不跳过费用、不无视格子规则"不是靠自觉——
 * 它根本没有别的入口可以绕开这些检查。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /**
   * distToPath —— 格子中心到行军路径的最近距离（单位：格）。
   * 沿路径均匀采样 24 个点算欧氏距离：够精确，也比做线段投影好懂。
   */
  function distToPath(cell, board, side) {
    var best = Infinity;
    var last = board.path(side).length - 1;
    var steps = 24;

    for (var i = 0; i <= steps; i++) {
      var p = board.pathPos(side, (last * i) / steps);
      var dx = p.cx - cell[0];
      var dy = p.cy - cell[1];
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) {
        best = d;
      }
    }
    return best;
  }

  /**
   * freeCells —— 这一侧还能放兵的空格。
   * 白格，加上"已经被铲子挖开的绿格"——没挖的绿格仍然不能放。
   */
  function freeCells(state, board) {
    var out = [];
    var whites = board.whiteCells(state.side);
    var digs = board.digCells(state.side);

    for (var i = 0; i < whites.length; i++) {
      var c = whites[i];
      if (!Game.state.unitAtCell(state, c)) {
        out.push(c);
      }
    }

    for (var j = 0; j < digs.length; j++) {
      var g = digs[j];
      if (Game.state.isUnlocked(state, g) && !Game.state.unitAtCell(state, g)) {
        out.push(g);
      }
    }
    return out;
  }

  /**
   * pickCell —— 给一个兵种挑落点。
   * 刀 / 枪 / 骑要贴路（越近越早打到）；弓放内圈（离路远一点，躲在后排）。
   * forceOutside 是"失误"用的：把弓也按近战的方式丢到外圈。
   */
  function pickCell(state, board, kind, forceOutside) {
    var cells = freeCells(state, board);
    if (!cells.length) {
      return null;
    }

    var wantFar = (kind === 'bow') && !forceOutside;
    var best = cells[0];
    var bestD = wantFar ? -Infinity : Infinity;

    for (var i = 0; i < cells.length; i++) {
      var d = distToPath(cells[i], board, state.side);
      if (wantFar ? d > bestD : d < bestD) {
        bestD = d;
        best = cells[i];
      }
    }
    return best;
  }

  /**
   * activeUnitCount —— 上限只数"真正在打的单位"（兵 + 武将）。
   * 休眠单字占格但不出手，不占这个名额；否则 AI 一旦放字就再也不放兵了。
   */
  function activeUnitCount(state) {
    var n = 0;
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].type !== 'char') {
        n += 1;
      }
    }
    return n;
  }

  /**
   * placeBench —— 把备战席里能放的兵卡放上场。
   * 金/紫单字不在这里处理（交给 placeHeroChars），会一直躺在席上等配对。
   *
   * 在场兵数上限 = 本半场白格数 + digCap（这一档最多能挖开几个绿格）。
   * 8×10 棋盘每半只有 6 个白格，旧的固定 maxUnits(3/9/18) 全被 6 格卡死、
   * 三档强度没区别；现在的强度差由「能挖开几格」决定。
   * 到上限就停手、卡留在席上不清空——等合成把兵数降下来还能接着放。
   */
  function placeBench(state, balance, board, forceBowOutside, level) {
    var placed = 0;
    var cap = board.whiteCells(state.side).length
      + ((level && level.digCap > 0) ? level.digCap : 0);

    for (var i = 0; i < state.bench.length; i++) {
      if (activeUnitCount(state) >= cap) {
        break;   // 到上限了，卡留着，别丢
      }

      var card = state.bench[i];
      if (!card || card.type !== 'unit') {
        continue;
      }

      var cell = pickCell(state, board, card.kind, forceBowOutside);
      if (!cell) {
        break;
      }

      var r = Game.state.dropCard(state, card.id, cell, balance, board);
      if (r.action === 'place') {
        placed += 1;
      }
    }
    return placed;
  }

  /* ============ 武将单字（AI 也会用武将）============ */

  /**
   * heroDefByChars —— 左姓右名能不能成将，读的是和玩家拼字同一份数值表。
   */
  function heroDefByChars(balance, left, right) {
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].surname === left && list[i].given === right) {
        return list[i];
      }
    }
    return null;
  }

  function sleepingChars(state) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].type === 'char') {
        out.push(state.units[i]);
      }
    }
    return out;
  }

  function isFreeCell(state, cell, board) {
    return board.isInside(cell)
      && Game.state.canPlaceAt(state, cell, board)
      && !Game.state.unitAtCell(state, cell);
  }

  /**
   * adjacentPair —— 一对左右相邻的空格，给"席上同时抽到姓和名"用。
   * 挑左格离路径最近的：武将射程有限，贴路才打得到怪。
   */
  function adjacentPair(state, board) {
    var cells = freeCells(state, board);
    var best = null;
    var bestD = Infinity;

    for (var i = 0; i < cells.length; i++) {
      var left = cells[i];
      var right = [left[0] + 1, left[1]];
      if (!isFreeCell(state, right, board)) {
        continue;
      }
      var d = distToPath(left, board, state.side);
      if (d < bestD) {
        bestD = d;
        best = [left, right];
      }
    }
    return best;
  }

  /**
   * pairCellWith —— 这张字放到哪格，能和场上已有的休眠字立刻成将。
   * 姓放名的左边、名放姓的右边；顺序不对就不返回，
   * AI 不靠"字序不对"提示试错，也不挪动已经落下的字。
   */
  function pairCellWith(state, balance, board, ch) {
    var chars = sleepingChars(state);

    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      var asSurname = [c.cell[0] - 1, c.cell[1]];
      if (heroDefByChars(balance, ch, c.char) && isFreeCell(state, asSurname, board)) {
        return asSurname;
      }
      var asGiven = [c.cell[0] + 1, c.cell[1]];
      if (heroDefByChars(balance, c.char, ch) && isFreeCell(state, asGiven, board)) {
        return asGiven;
      }
    }
    return null;
  }

  /**
   * looseCell —— 暂时配不上的字放哪：左右都没有别的休眠字（避免摆出"错序 / 不搭配"的死对）。
   *
   * sleepPreferFar 开启时挑「离路径最远」的空格：近战兵要贴路，散字本身不出手，
   * 把贴路的格子留给兵；关闭时沿用旧的「贴路」挑法（用于对照实验）。
   */
  function looseCell(state, board, balance) {
    var cells = freeCells(state, board);
    var best = null;
    var far = !!(balance.ai && balance.ai.sleepPreferFar);
    var bestD = far ? -Infinity : Infinity;

    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var l = Game.state.unitAtCell(state, [c[0] - 1, c[1]]);
      var r = Game.state.unitAtCell(state, [c[0] + 1, c[1]]);
      if ((l && l.type === 'char') || (r && r.type === 'char')) {
        continue;
      }
      var d = distToPath(c, board, state.side);
      if (far ? d > bestD : d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * placeHeroChars —— 把备战席里的金/紫单字放上场，再复用玩家的拼字纯函数觉醒。
   *
   * 三轮落点：① 席内正好凑成一对 → 一次摆到相邻两格；
   *          ② 与场上已有的休眠字能配 → 补到它左 / 右；
   *          ③ 暂时配不上 → 放场上休眠等以后配对（有数量上限）。
   * 最后循环 tryAwaken（一次只合一对）直到合不动。
   *
   * AI 只做「放字 + 觉醒」：不拆开武将、不移动已落下的字、不做重组。
   */
  function placeHeroChars(state, balance, board) {
    var out = { placed: 0, awakened: 0 };
    var cards = [];

    for (var i = 0; i < state.bench.length; i++) {
      var c = state.bench[i];
      if (c && c.type === 'heroChar') {
        cards.push(c);
      }
    }
    if (!cards.length || !Game.hero) {
      return out;
    }

    var used = [];
    for (var u = 0; u < cards.length; u++) {
      used.push(false);
    }

    // ① 席内成对
    for (var a = 0; a < cards.length; a++) {
      if (used[a]) {
        continue;
      }
      for (var b = 0; b < cards.length; b++) {
        if (a === b || used[b]) {
          continue;
        }
        if (!heroDefByChars(balance, cards[a].char, cards[b].char)) {
          continue;
        }

        var pair = adjacentPair(state, board);
        if (!pair) {
          break;
        }
        var r1 = Game.state.dropCard(state, cards[a].id, pair[0], balance, board);
        var r2 = Game.state.dropCard(state, cards[b].id, pair[1], balance, board);
        if (r1.action === 'place-char' && r2.action === 'place-char') {
          used[a] = true;
          used[b] = true;
          out.placed += 2;
        }
        break;
      }
    }

    // ② 与场上休眠字配对
    for (var a2 = 0; a2 < cards.length; a2++) {
      if (used[a2]) {
        continue;
      }
      var cell = pairCellWith(state, balance, board, cards[a2].char);
      if (!cell) {
        continue;
      }
      if (Game.state.dropCard(state, cards[a2].id, cell, balance, board).action === 'place-char') {
        used[a2] = true;
        out.placed += 1;
      }
    }

    // ③ 配不上的先休眠，数量封顶，别把棋盘塞满
    var cap = balance.ai.maxSleepingChars;
    for (var a3 = 0; a3 < cards.length; a3++) {
      if (used[a3]) {
        continue;
      }
      if (sleepingChars(state).length >= cap) {
        break;
      }
      var loose = looseCell(state, board, balance);
      if (!loose) {
        break;
      }
      if (Game.state.dropCard(state, cards[a3].id, loose, balance, board).action === 'place-char') {
        used[a3] = true;
        out.placed += 1;
      }
    }

    // ④ 觉醒：复用玩家那套 tryAwaken，一次只合一对
    var guard = 0;
    while (guard < 20) {
      guard += 1;
      if (!Game.hero.tryAwaken(state, balance).ok) {
        break;
      }
      out.awakened += 1;
    }
    return out;
  }

  /* ============ 合成 ============ */

  /**
   * findMergePair —— 找一对"同兵种、同等级、没满级"的兵。
   * 先按等级从高到低找：高等级的合成收益更大，也和玩家习惯一致。
   */
  function findMergePair(state, balance) {
    var us = state.units;

    for (var i = 0; i < us.length; i++) {
      for (var j = i + 1; j < us.length; j++) {
        if (Game.state.canMerge(us[i], us[j], balance)) {
          return [us[i], us[j]];
        }
      }
    }
    return null;
  }

  /**
   * mergePairs —— 一直合到没有可合的对为止。
   * 保留第二个（target），第一个（source）从场上消失，和玩家拖拽合成同一套规则。
   * guard 只是防死循环：真合不动了会自己 break。
   */
  function mergePairs(state, balance) {
    var merged = 0;
    var guard = 0;

    while (guard < 20) {
      guard += 1;

      var pair = findMergePair(state, balance);
      if (!pair) {
        break;
      }

      Game.state.mergeInto(state, pair[0], pair[1], balance);
      merged += 1;
    }
    return merged;
  }

  /**
   * mergeBenchIntoField —— 把备战席的兵卡直接叠到场上「同兵种 Lv1」的兵上合成。
   * 备战席的卡都是 Lv1，dropCard 的 merge 分支本来就支持这个动作；
   * 以前 AI 只会挑空格放卡，席上能和场上合的卡要等下次征兵被整席替换白白丢掉。
   */
  function mergeBenchIntoField(state, balance, board) {
    var n = 0;
    var guard = 0;

    while (guard < 20) {
      guard += 1;
      var hit = false;

      for (var i = 0; i < state.bench.length && !hit; i++) {
        var card = state.bench[i];
        if (!card || card.type !== 'unit') {
          continue;
        }
        for (var j = 0; j < state.units.length; j++) {
          var u = state.units[j];
          if (u.type !== 'unit' || u.lv !== 1 || u.kind !== card.kind ||
              u.lv >= balance.growth.maxLv) {
            continue;
          }
          if (Game.state.dropCard(state, card.id, u.cell, balance, board).action === 'merge') {
            n += 1;
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        break;
      }
    }
    return n;
  }

  /**
   * mergeAll —— 场上对场上、席上卡对场上兵，交替合到合不动为止。
   * 「合成优先」开启时用它；关闭时仍只走旧的 mergePairs（场上对场上）。
   */
  function mergeAll(state, balance, board) {
    var n = 0;
    var guard = 0;

    while (guard < 20) {
      guard += 1;
      var a = mergePairs(state, balance);
      var b = mergeBenchIntoField(state, balance, board);
      n += a + b;
      if (a === 0 && b === 0) {
        break;
      }
    }
    return n;
  }

  /* ============ 挖格 ============ */

  /**
   * benchShovelCard —— 备战席上的铲子卡（加餐 E：铲子占一个卡位）。
   * 每手最多 1 张，所以找到第一张就够；没有就返回 null。
   */
  function benchShovelCard(state) {
    for (var i = 0; i < state.bench.length; i++) {
      if (state.bench[i] && state.bench[i].type === 'shovelCard') {
        return state.bench[i];
      }
    }
    return null;
  }

  /**
   * digOne —— 用席上的铲子卡挖开一个绿格。
   * level.digCap 是这一档整局最多能挖开几个绿格（难度旋钮）；
   * state.unlocked.length 就是"已经挖开的格数"，到顶就不再挖。
   * 优先挖离路径最近的那个（挖出来最有用），和玩家挑位置的习惯一致。
   * 返回挖开的数量：0 表示席上没铲子卡 / 没剩绿格 / 已到 digCap。
   */
  function digOne(state, balance, board, level) {
    var card = benchShovelCard(state);
    if (!card) {
      return 0;
    }
    if (level && level.digCap > 0 && state.unlocked.length >= level.digCap) {
      return 0;
    }

    var best = null;
    var bestD = Infinity;

    var digs = board.digCells(state.side);
    for (var i = 0; i < digs.length; i++) {
      var c = digs[i];
      if (Game.state.isUnlocked(state, c)) {
        continue;
      }
      var d = distToPath(c, board, state.side);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }

    if (!best) {
      return 0;
    }

    // 和玩家同一条路径：dropCard 负责消耗卡 + 改盘面，AI 不再单独扣任何计数
    return Game.state.dropCard(state, card.id, best, balance, board).action === 'dig' ? 1 : 0;
  }

  /* ============ 失误 ============ */

  /**
   * rollMistake —— 这一轮会不会犯错、错在哪。
   * 先掷一次"是否犯错"（难度决定概率），命中了再从列表里等概率挑一种。
   * 随机数走 state.seed，所以同一局同一种子可以复现。
   */
  function rollMistake(state, balance, level) {
    if (!level || !(level.mistakeRate > 0)) {
      return null;
    }
    if (Game.rng.next(state) >= level.mistakeRate) {
      return null;
    }

    var list = balance.ai.mistakes;
    return list[Game.rng.int(state, list.length)];
  }

  /* ============ 收兵腾格（Day 25 续 3 · B4）============ */

  function benchHasCharCard(state) {
    for (var i = 0; i < state.bench.length; i++) {
      if (state.bench[i] && state.bench[i].type === 'heroChar') {
        return true;
      }
    }
    return false;
  }

  function benchHasSlot(state) {
    for (var i = 0; i < state.bench.length; i++) {
      if (!state.bench[i]) {
        return true;
      }
    }
    return false;
  }

  /**
   * makeRoomForPair —— 席上握着单字、场上却挤不出一对相邻空格时，把一个兵收回备战席腾格。
   * 只收「移走之后确实会出现相邻空格对」的兵，低等级优先，避免白扔火力。
   * 收回走 Game.state.returnUnitToBench（席满自动不动），和玩家拖回备战席同一套规则。
   */
  function makeRoomForPair(state, board) {
    if (!benchHasCharCard(state) || !benchHasSlot(state)) {
      return 0;
    }
    if (adjacentPair(state, board)) {
      return 0;
    }

    var units = [];
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].type === 'unit') {
        units.push(state.units[i]);
      }
    }
    units.sort(function (a, b) { return a.lv - b.lv; });

    for (var j = 0; j < units.length; j++) {
      var saved = state.units;
      var id = units[j].id;
      state.units = saved.filter(function (u) { return u.id !== id; });
      var helps = !!adjacentPair(state, board);
      state.units = saved;                 // 试探完立刻还原，不留下副作用

      if (helps && Game.state.returnUnitToBench(state, id)) {
        return 1;
      }
    }
    return 0;
  }

  /* ============ 一次决策 ============ */

  /**
   * decide —— 一次完整决策，每轮按难度间隔调一次。
   *
   * 顺序（合成优先于放新兵，挖格优先于征兵——挖开才有更多格子）：
   *   0. 掷失误
   *   1. 合成：场上对场上 + 席上卡对场上兵（mergeFirst 开启时），先合完再征兵
   *   2. 挖格：有铲子就挖一个绿格，整局最多挖 level.digCap 个
   *   3. 征兵：馒头 ≥ 下次费用就抽一轮；抽完再合一次（新席也不浪费）
   *   4. 放字 + 拼字觉醒：金/紫单字先占位，复用玩家那套 tryAwaken
   *   4.5 收兵腾格：席上还有单字却没有相邻空格时，把一个兵收回备战席，再拼一次字
   *   5. 放兵：把席上的兵卡放进空格（上限 = 白格数 + digCap）
   *   6. 溢出：馒头还超过 hoardFactor 倍费用就继续抽 + 继续放
   *
   * 注意 1 和 5 的关系：合成会减少在场兵数，所以「3 个 Lv1 合成 1 个 Lv2」
   * 之后还能再放两个新兵上去。这是预期的——上限说的是"在场几个"，不是"整局总共几个"。
   */
  function decide(state, balance, board, level) {
    var log = {
      mistake: null, merged: 0, dug: 0, recruited: 0, placed: 0,
      heroChars: 0, awakened: 0, returned: 0,
      bunBefore: 0, bunAfter: 0
    };

    if (!state || state.status !== 'playing') {
      return log;
    }

    log.bunBefore = state.bun;

    // 0) 这一轮会不会犯错
    var mistake = rollMistake(state, balance, level);
    log.mistake = mistake;

    var mergeFirst = !!balance.ai.mergeFirst;

    // 1) 合成优先：场上对场上 + 席上卡对场上兵。先合再征兵，
    //    否则旧席里能合的卡会被下一次「整席替换」白白丢掉。
    if (mistake !== 'skipMerge') {
      log.merged = mergeFirst ? mergeAll(state, balance, board) : mergePairs(state, balance);
    }

    // 2) 挖格（"有铲子也忘记挖"）；digCap 是这一档整局的挖格上限
    if (mistake !== 'skipDig') {
      log.dug = digOne(state, balance, board, level);
    }

    // 3) 征兵（"有钱也不抽"）
    var cost = Game.recruit.rollCost(state, balance);
    if (mistake !== 'skipRecruit' && state.bun >= cost && Game.recruit.recruit(state, balance)) {
      log.recruited += 1;
    }

    // 3.5) 新席也先合成再放兵，保证"合成优先"对整轮决策都成立
    if (mergeFirst && mistake !== 'skipMerge') {
      log.merged += mergeAll(state, balance, board);
    }

    // 4) 放字 + 拼字觉醒（AI 只放字、不拆不重组）
    var heroStep = placeHeroChars(state, balance, board);
    log.heroChars += heroStep.placed;
    log.awakened += heroStep.awakened;

    // 4.5) 收兵腾格：放字消耗过卡、席上通常已有空位；此时若还挤不出相邻空格对，
    //      就把一个兵收回备战席，再用新腾出的格子拼一次字。
    //      必须放在放兵之前，否则刚空出的格子会被新兵立刻占回去。
    log.returned = makeRoomForPair(state, board);
    if (log.returned) {
      var afterRoom = placeHeroChars(state, balance, board);
      log.heroChars += afterRoom.placed;
      log.awakened += afterRoom.awakened;
    }

    // 5) 放兵（"把弓丢外圈"）
    log.placed += placeBench(state, balance, board, mistake === 'bowOutside', level);

    // 6) 钱多到囤着没用的时候连续抽，每抽一轮立刻放
    var guard = 0;
    while (mistake !== 'skipRecruit' && guard < 6) {
      guard += 1;

      var next = Game.recruit.rollCost(state, balance);
      if (state.bun <= next * balance.ai.hoardFactor || state.bun < next) {
        break;
      }

      if (Game.recruit.recruit(state, balance)) {
        log.recruited += 1;
      }
      if (mergeFirst && mistake !== 'skipMerge') {
        log.merged += mergeAll(state, balance, board);
      }
      var more = placeHeroChars(state, balance, board);
      log.heroChars += more.placed;
      log.awakened += more.awakened;
      log.placed += placeBench(state, balance, board, mistake === 'bowOutside', level);
    }

    log.bunAfter = state.bun;
    return log;
  }

  Game.ai = {
    decide: decide,
    pickCell: pickCell,
    freeCells: freeCells,
    distToPath: distToPath,
    placeBench: placeBench,
    placeHeroChars: placeHeroChars,
    heroDefByChars: heroDefByChars,
    sleepingChars: sleepingChars,
    mergePairs: mergePairs,
    mergeBenchIntoField: mergeBenchIntoField,
    mergeAll: mergeAll,
    findMergePair: findMergePair,
    digOne: digOne,
    makeRoomForPair: makeRoomForPair,
    rollMistake: rollMistake
  };
})(globalThis);
