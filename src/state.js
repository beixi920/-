/* 单骑 · 汉字塔防 —— 一局的状态
 * 规矩：纯数据 + 纯函数，不碰 DOM、不碰 Canvas、不读存档。
 * 想算"这一局现在怎么样"，只看这个对象就够了。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /**
   * makeUnit —— 造一个兵。
   * def 是数值表里的兵种定义，cell 是它站的格子。
   * type 区分三种场上对象：'unit' 兵 / 'char' 休眠单字 / 'hero' 武将。
   */
  function makeUnit(def, cell, id) {
    return {
      id: id,
      type: 'unit',
      kind: def.kind,
      char: def.char,
      attack: def.attack,   // single | line | projectile | splash
      lv: 1,
      cell: [cell[0], cell[1]],
      range: def.range,
      damage: def.damage,
      intervalSec: def.intervalSec,
      cooldown: 0,          // 还剩多少秒可以开火，<=0 表示随时能打

      /* 攻击姿态（Day 26 续 2，纯表现）：glyph = 汉字 / weapon = 武器形态。
       * 这两个字段只由 src/weapon-fx.js 的状态机读写，逻辑层任何判定都不读；
       * lastAttackAt 记的是上次开火时的 state.elapsed，-1 = 从未开火。 */
      stance: 'glyph',
      lastAttackAt: -1,

      /* 攻击方式专属参数：缺哪个就不会启用对应分支，所以这里全部带上。 */
      pierceMax: def.pierceMax,
      pierceGapBonus: def.pierceGapBonus,
      splashRadius: def.splashRadius,
      splashMax: def.splashMax,
      flightSecMin: def.flightSecMin,
      flightSecMax: def.flightSecMax
    };
  }

  /**
   * makeChar —— 造一个「休眠单字」。
   * 金卡落到场上就是这个：占一格、不攻击、不能合成，等另一个字来配对。
   * 给它一个独立的 type，是为了让所有"这是兵吗"的判断都走同一个字段，
   * 而不是到处靠 kind 是否为空去猜。
   */
  function makeChar(ch, cell, id) {
    return {
      id: id,
      type: 'char',
      kind: 'char',
      char: ch,
      attack: 'none',
      lv: 0,
      cell: [cell[0], cell[1]],
      range: 0,
      damage: 0,
      intervalSec: 1,
      cooldown: 0
    };
  }

  /**
   * makeHero —— 两张单字拼出来的武将，占 2 格（左姓、右名）。
   *
   * cell 保留成"主格"，指右侧名格；cells 才是它真正占的全部格子。
   * 为什么还要 cell：拖拽、渲染、日志里到处都在用 unit.cell 当"这个单位在哪"，
   * 给武将留一个主格比把所有调用点都改成读数组省事得多。
   *
   * weaponBonus 是「装备给这个武将的武器」提供的伤害倍率增量（0 = 没装）。
   * 由 hero.js 从 state.heroBonus 传进来，这里只做一次乘法，不读存档、不碰 DOM。
   */
  function makeHero(def, cells, id, weaponBonus) {
    var left = cells[0];
    var right = cells[cells.length - 1];

    return {
      id: id,
      type: 'hero',
      heroKey: def.key,
      kind: 'hero',
      char: def.name,        // 渲染时拆成两个字
      name: def.name,
      quality: def.quality || 'gold',   // gold / purple：只影响边框颜色
      attack: 'single',
      lv: 1,

      cell: [right[0], right[1]],                       // 主格：右侧名格
      cells: [
        [left[0], left[1]],
        [right[0], right[1]]
      ],
      slots: def.slots || cells.length,

      range: def.range,
      // 单次伤害 = DPS × intervalSec × (1 + 武器加成)（GDD 9.2 / 11.3）
      damage: Math.round(def.dps * def.intervalSec * (1 + (weaponBonus || 0))),
      dps: def.dps,
      intervalSec: def.intervalSec,
      cooldown: 0,

      /* 技能：直接引用数值表里的那一个对象（只读，不拷贝、不改）。
       * 以前漏拷字段出过"表里写了但行为不对"的 bug，引用整块就不可能漏。
       * skillCd 是唯一可变的部分：剩余冷却秒数，武将一上场就是满 CD。 */
      skill: def.skill || null,
      skillCd: def.skill ? def.skill.cdSec : 0
    };
  }

  /**
   * emptyBench —— 造一个长度固定、全是 null 的备战席。
   * 用 null 而不是省略，是为了让"第几格"永远稳定，明天做拖拽时下标不会错位。
   */
  function emptyBench(size) {
    var bench = [];
    for (var i = 0; i < size; i++) {
      bench.push(null);
    }
    return bench;
  }

  /**
   * createInitialState —— 开一局新游戏。
   * side='top'（上半场对手）或 'bottom'（下半场玩家）：这一侧决定路径、白格、绿格。
   * Day 25 续 3（B4）起按原版开局 0 兵：balance.startUnits 是空数组，
   * 双方都从空棋盘 + 20 馒头起步，6 个白格全部自由。布局全部来自 data/board_map.js。
   */
  function createInitialState(balance, side, boardRef) {
    var board = boardRef || Game.board;
    var mySide = side === 'top' ? 'top' : 'bottom';
    var state = {
      /* 半场标识：'top' / 'bottom'。所有格子/路径判定都按它取，不靠镜像。 */
      side: mySide,

      /* 经济与血量 */
      bun: balance.economy.startBun,
      leakPoints: balance.lives.leakPoints,
      maxLeakPoints: balance.lives.leakPoints,

      /* 波次进度：固定节拍开波、不等上一波清完；加餐 C 起无限递增，不设总波数。 */
      waveIndex: 1,                              // 下一波要开的波号（1 起，无限递增）
      nextWaveIn: balance.wave.firstDelaySec,    // 距下一波还有多少秒
      spawnWave: 0,                              // 正在出怪的那一波（0 = 没在出）
      spawnedInWave: 0,                          // 该波已出多少只
      spawnTimer: 0,                             // 距下一只出怪还有多少秒
      bossSpawned: false,
      wavesDone: {},                             // 该波是否已全部出完
      wavesRewarded: {},                         // 该波奖励是否已发

      /* 绿格解锁：存格子 key（"列,行"），只在这一局有效 */
      unlocked: [],

      /* 场上对象 */
      units: [],
      enemies: [],
      projectiles: [],   // 弓的飞行箭（飞完才结算伤害）
      effects: [],       // 枪线 / 骑弧 / 刀命中点，纯表现
      floaters: [],      // 飘字

      /* 正在播放的技能序列（目前只有赵云的七进七出）。
       * 每段按 stepSec 依次结算，所以技能伤害是"逐段落下"的，不是一个瞬间。
       * 放在 state 里而不是 setTimeout：暂停、重开、跳波都能一起清掉，也不会
       * 在页面切到后台时继续偷偷跑。 */
      skillSeqs: [],

      /* 结果 */
      status: 'playing', // playing | won | lost

      /* 统计 */
      elapsed: 0,
      kills: 0,
      leaks: 0,

      /* 表现计时（只影响画面，不参与任何判定） */
      hurtTimer: 0,      // 漏怪抖动剩余时间（秒）
      shatterTimer: 0,   // 碎心强抖动剩余时间（秒），>0 表示这次是碎心
      bunGainText: '',   // HUD 馒头旁的收入提示文字，如 "+8"
      bunGainTimer: 0,   // 该提示的剩余播放时间（秒），<=0 表示不显示

      /* 征兵相关：全部放在这里，所以「再来一次」天然重置 */
      bench: emptyBench(balance.recruit.benchSize),  // 固定长度 5，空位是 null
      recruitCount: 0,   // 已经抽过几次，决定下一次的费用

      /* 随机数种子：seed rng 用，保证同一 seed 同一局 */
      seed: (Date.now() >>> 0) || 1,

      nextId: 1
    };

    // 按 balance.startUnits 预置兵（B4 起为空数组 = 0 兵）。
    // 位置取该侧 startCells；balance.js 里的旧 cell 字段不再读。
    var startCells = board.startCells(mySide);
    for (var i = 0; i < balance.startUnits.length; i++) {
      var preset = balance.startUnits[i];
      var def = balance.units[preset.kind];
      state.units.push(makeUnit(def, startCells[i], state.nextId++));
    }

    return state;
  }

  /**
   * unitAtCell —— 这个格子上有没有东西。
   * exceptId 用来排除自己（比如拖拽时判断目标格是否被别人占着）。
   *
   * 多格单位（武将占 2 格）看 cells：任意一格命中都算被占。
   * 兵没有 cells 字段，还是看 cell —— 这样不用给每个兵都塞一个长度 1 的数组。
   */
  function unitAtCell(state, cell, exceptId) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (exceptId !== undefined && u.id === exceptId) {
        continue;
      }

      if (u.cells) {
        for (var k = 0; k < u.cells.length; k++) {
          if (u.cells[k][0] === cell[0] && u.cells[k][1] === cell[1]) {
            return u;
          }
        }
        continue;
      }

      if (u.cell[0] === cell[0] && u.cell[1] === cell[1]) {
        return u;
      }
    }
    return null;
  }

  /* ============ 放置 / 交换 / 合成 ============ */

  function sameCell(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }

  /* ===== 格子判定 =====
   * 全部转发给 board 的 side 化 API：白格 W / 可铲格 D / 路径格 P。
   * side 由 state.side 传进来，缺省时不做半场限制（只按类型判）。 */

  function isPathCell(cell, board, side) {
    return board.isPath(cell, side);
  }

  function isGreenCell(cell, board, side) {
    return board.isDig(cell, side);
  }

  /**
   * isPlaceable —— 这个格子能不能放兵。只认该侧白格：
   * 路径格要给敌兵走、深绿格要等铲子开，别的格一律不放。
   */
  function isPlaceable(cell, board, side) {
    return board.isPlace(cell, side);
  }

  function cellKey(cell) {
    return cell[0] + ',' + cell[1];
  }

  function isUnlocked(state, cell) {
    return state.unlocked.indexOf(cellKey(cell)) >= 0;
  }

  /**
   * canPlaceAt —— 真正用于放置：该侧白格，或该侧已被挖开的深绿格。
   * 用 state.side 限制半场，玩家碰不到对手的格子。
   */
  function canPlaceAt(state, cell, board) {
    var side = state.side;
    return isPlaceable(cell, board, side) ||
      (isGreenCell(cell, board, side) && isUnlocked(state, cell));
  }

  /**
   * unlockGreen —— 挖开该侧深绿格，挖完变可放置。
   * 加餐 E 起铲子是备战席上的一张卡：卡由 dropCard 消耗，这里只负责改盘面 +
   * 出挖掘特效，不再管任何计数器。
   * 返回 true 表示这一格确实被挖开了。
   */
  function unlockGreen(state, cell, board, balance) {
    if (!isGreenCell(cell, board, state.side) || isUnlocked(state, cell)) {
      return false;
    }

    state.unlocked.push(cellKey(cell));

    state.effects.push({
      type: 'dig',
      cx: cell[0],
      cy: cell[1],
      life: balance.merge.digSec,
      maxLife: balance.merge.digSec
    });
    return true;
  }

  /**
   * applyLevel —— 按等级重算伤害与攻击间隔（GDD 8.2）。
   * 数值来自 balance.growth，不在这里写死 1.6 / 1.08。
   */
  function applyLevel(unit, balance) {
    var base = balance.units[unit.kind];
    var g = balance.growth;

    var damage = base.damage * Math.pow(g.damagePerLv, unit.lv - 1);
    var attacksPerSec = (1 / base.intervalSec) * Math.pow(g.speedPerLv, unit.lv - 1);

    if (attacksPerSec > g.maxAttacksPerSec) {
      attacksPerSec = g.maxAttacksPerSec;
    }

    unit.damage = Math.round(damage);
    unit.intervalSec = 1 / attacksPerSec;

    /* 升级时姿态立刻回到「弓」字并清掉过渡（Day 26 续 2）。
     * 只在渲染层已加载时生效：test/sim.html 只引入规则层，这里就是个空操作。 */
    if (Game.weaponFx && Game.weaponFx.resetUnit) {
      Game.weaponFx.resetUnit(unit);
    }
  }

  /**
   * canMerge —— 能不能合。只有「兵」之间才谈得上合成：
   * 休眠单字要靠拼字觉醒，武将已经成型，两者都不参与。
   */
  function canMerge(a, b, balance) {
    if (a.type !== 'unit' || b.type !== 'unit') {
      return false;
    }
    return a.kind === b.kind && a.lv === b.lv && a.lv < balance.growth.maxLv;
  }

  function findUnit(state, id) {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id === id) {
        return state.units[i];
      }
    }
    return null;
  }

  function findCardIndex(state, cardId) {
    for (var i = 0; i < state.bench.length; i++) {
      if (state.bench[i] && state.bench[i].id === cardId) {
        return i;
      }
    }
    return -1;
  }

  function pushEffect(state, type, cell, balance, sec) {
    state.effects.push({
      type: type,
      cx: cell[0],
      cy: cell[1],
      life: sec,
      maxLife: sec
    });
  }

  /**
   * mergeInto —— target 升一级，source 从场上移除。
   * 注意保留的是"目标格上的兵"，符合 GDD 8.3 第 1 条。
   */
  function mergeInto(state, source, target, balance) {
    target.lv += 1;
    applyLevel(target, balance);

    var alive = [];
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id !== source.id) {
        alive.push(state.units[i]);
      }
    }
    state.units = alive;

    pushEffect(state, 'merge', target.cell, balance, balance.merge.animSec);
  }

  /**
   * dropUnit —— 把场上的兵 / 休眠单字放到某个格子。
   * 武将不再整体拖动（拖它会在 drag.js 里先拆成两张单字），所以这里不会收到武将。
   * 返回 { action: 'move' | 'merge' | 'swap' | 'reject' | 'none' }。
   */
  function dropUnit(state, unitId, cell, balance, board) {
    var unit = findUnit(state, unitId);
    if (!unit || !cell) {
      return { action: 'none' };
    }

    // 放回自己脚下：什么都不做。
    if (sameCell(unit.cell, cell)) {
      return { action: 'none' };
    }

    // 休眠单字：能挪到空格；也可以和兵 / 另一张字互换位置（Day 30 交换）。
    if (unit.type === 'char') {
      var charTarget = unitAtCell(state, cell, unit.id);
      if (charTarget) {
        if (charTarget.type === 'hero') {
          // 目标武将应由 drag 层先拆开再落子；真走到这里就拒绝，不碰它的 cells。
          pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
          return { action: 'reject' };
        }
        var charOld = [unit.cell[0], unit.cell[1]];
        unit.cell = [charTarget.cell[0], charTarget.cell[1]];
        charTarget.cell = charOld;
        return { action: 'swap', cell: cell };
      }
      if (!canPlaceAt(state, cell, board)) {
        pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
        return { action: 'reject' };
      }
      unit.cell = [cell[0], cell[1]];
      return { action: 'move' };
    }

    // 武将不参与落子：拖它时 drag.js 会先把它拆成两张单字。
    // 真走到这里说明调用方绕过了拆分——拒绝，别把 cells 悄悄改掉。
    if (unit.type === 'hero') {
      pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
      return { action: 'reject' };
    }

    var target = unitAtCell(state, cell, unit.id);

    if (target) {
      // 目标是武将：它占两格、不参与合成，兵不能和它换位（换位会拆散结构）。
      if (target.type === 'hero') {
        pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
        return { action: 'reject' };
      }
      if (canMerge(unit, target, balance)) {
        mergeInto(state, unit, target, balance);
        return { action: 'merge', cell: target.cell };
      }

      // 不同兵种 / 不同等级 / 已满级：交换位置。
      var old = [unit.cell[0], unit.cell[1]];
      unit.cell = [target.cell[0], target.cell[1]];
      target.cell = old;
      return { action: 'swap' };
    }

    if (!canPlaceAt(state, cell, board)) {
      pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
      return { action: 'reject' };
    }

    unit.cell = [cell[0], cell[1]];
    return { action: 'move' };
  }

  /**
   * unitToCard —— 把场上的单位折回一张备战席卡（交换时用）。
   * 兵保留兵种与等级；休眠单字折成金卡；武将不该走到这里（先由 drag 拆开）。
   */
  function unitToCard(state, unit) {
    if (unit.type === 'unit') {
      return {
        id: state.nextId++,
        type: 'unit',
        kind: unit.kind,
        char: unit.char,
        lv: unit.lv
      };
    }
    return { id: state.nextId++, type: 'heroChar', char: unit.char };
  }

  /**
   * dropCard —— 把备战席的卡放到某个格子。
   * 兵种卡：空格 → 生成 Lv1 兵；同兵种同级的兵 → 合成；
   *         其它已占格 → 交换：卡上场，原单位回这张卡原来的备席位（保留兵种 / 等级）。
   * 金卡：空格 → 休眠单字；已占格 → 与目标单位互换（目标回备战席）。
   * 铲子卡（加餐 E）：只能落到自己半场还没挖开的 D 格，挖开 + 卡消失；
   *                    白格 / 路径 / 已挖开 / 棋盘外一律拒绝，卡留在席上。
   */
  function dropCard(state, cardId, cell, balance, board) {
    var index = findCardIndex(state, cardId);
    if (index < 0 || !cell) {
      return { action: 'none' };
    }

    var card = state.bench[index];

    if (card.type === 'shovelCard') {
      if (!isGreenCell(cell, board, state.side) || isUnlocked(state, cell)) {
        pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
        return { action: 'reject' };
      }

      state.bench[index] = null;
      unlockGreen(state, cell, board, balance);
      return { action: 'dig', cell: cell };
    }

    if (card.type !== 'unit') {
      // 金色单字：空格 → 休眠；已占格 → 与目标单位互换（目标回这张卡原来的席位上）。
      var charTarget = unitAtCell(state, cell);
      if (charTarget) {
        if (charTarget.type === 'hero') {
          // 防御：目标武将应先由 drag 拆成两张字再落子。
          pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
          return { action: 'reject' };
        }
        state.bench[index] = unitToCard(state, charTarget);
        state.units = state.units.filter(function (u) { return u.id !== charTarget.id; });
        state.units.push(makeChar(card.char, cell, state.nextId++));
        return { action: 'swap', cell: cell };
      }
      if (!canPlaceAt(state, cell, board)) {
        pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
        return { action: 'reject' };
      }

      state.units.push(makeChar(card.char, cell, state.nextId++));
      state.bench[index] = null;
      return { action: 'place-char', cell: cell };
    }

    /* 收回备战席的兵卡带 lv（B4）；抽卡出来的卡没有这个字段，按 Lv1 处理。 */
    var cardLv = card.lv || 1;
    var target = unitAtCell(state, cell);

    if (target) {
      if (target.type === 'hero') {
        // 防御：目标武将应先由 drag 拆开。
        pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
        return { action: 'reject' };
      }
      if (target.kind === card.kind && target.lv === cardLv && cardLv < balance.growth.maxLv) {
        target.lv += 1;
        applyLevel(target, balance);
        state.bench[index] = null;
        pushEffect(state, 'merge', target.cell, balance, balance.merge.animSec);
        return { action: 'merge', cell: target.cell };
      }

      // 不同兵种 / 不同等级 / 已满级：交换。卡上场，原单位折回这张卡的备席位。
      state.bench[index] = unitToCard(state, target);
      state.units = state.units.filter(function (u) { return u.id !== target.id; });
      var swapped = makeUnit(balance.units[card.kind], cell, state.nextId++);
      if (cardLv > 1) {
        swapped.lv = cardLv;
        applyLevel(swapped, balance);
      }
      state.units.push(swapped);
      return { action: 'swap', cell: cell };
    }

    if (!canPlaceAt(state, cell, board)) {
      pushEffect(state, 'deny', cell, balance, balance.merge.denySec);
      return { action: 'reject' };
    }

    var fresh = makeUnit(balance.units[card.kind], cell, state.nextId++);
    if (cardLv > 1) {
      fresh.lv = cardLv;
      applyLevel(fresh, balance);   // 按等级重算伤害 / 攻速，收回的兵不白掉等级
    }
    state.units.push(fresh);
    state.bench[index] = null;
    return { action: 'place', cell: cell };
  }

  /**
   * returnUnitToBench —— 把场上的「普通兵」拖回备战席（Day 25 续 3 · B4）。
   * 兵从场上消失，变成一张卡放回席，保留兵种与等级；席满则什么都不做（归位不动）。
   * 单字 / 武将不走这里：单字回席仍由 hero.returnToBench 管，武将只能先拆开。
   * 一次征兵仍是 5 张卡 + 整席替换，这里只是往空位补一张，不改那条硬规则。
   */
  function returnUnitToBench(state, unitId) {
    var unit = findUnit(state, unitId);
    if (!unit || unit.type !== 'unit') {
      return false;
    }

    var slot = -1;
    for (var i = 0; i < state.bench.length; i++) {
      if (!state.bench[i]) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      return false;   // 席满：兵留在原格，等于取消这次拖动
    }

    state.bench[slot] = {
      id: state.nextId++,
      type: 'unit',
      kind: unit.kind,
      char: unit.char,
      lv: unit.lv
    };
    state.units = state.units.filter(function (u) { return u.id !== unitId; });
    return true;
  }

  Game.state = {
    createInitialState: createInitialState,
    makeUnit: makeUnit,
    unitAtCell: unitAtCell,
    isPlaceable: isPlaceable,
    canPlaceAt: canPlaceAt,
    isUnlocked: isUnlocked,
    unlockGreen: unlockGreen,
    isGreenCell: isGreenCell,
    isPathCell: isPathCell,
    applyLevel: applyLevel,
    canMerge: canMerge,
    mergeInto: mergeInto,
    dropUnit: dropUnit,
    dropCard: dropCard,
    returnUnitToBench: returnUnitToBench,

    /* 武将：造对象留在这里（dropCard 要用），拼字判定搬到了 src/hero.js */
    makeChar: makeChar,
    makeHero: makeHero
  };
})(globalThis);
