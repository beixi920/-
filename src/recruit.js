/* 单骑 · 汉字塔防 —— 征兵
 * 规矩：纯逻辑，只读写 state 和 balance，不碰 DOM / Canvas。
 * 导出两个主函数：
 *   rollCost(state, balance) → 这一次要花多少馒头
 *   recruit(state, balance)  → 扣钱、整席替换、可能把 1 张卡换成铲子卡，
 *                              返回 { cards, discarded, shovelCard, cost }
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /**
   * rollCost —— 第 n 次征兵的费用 = baseCost + costPerRecruit × (n - 1)。
   * recruitCount 是"已经抽过几次"，所以这里直接用它可以少一次 ±1。
   */
  function rollCost(state, balance) {
    var cfg = balance.recruit;
    return cfg.baseCost + cfg.costPerRecruit * state.recruitCount;
  }

  /**
   * pairableChars —— 场上休眠单字「缺的另一半」的字集合。
   * 场上有「赵」→ 需要「云」；有「张」→ 需要「飞」或「苞」；有「云」→ 需要「赵」。
   * 只读 state.units 与数值表，不改状态；整席替换规则不变，只是让抽字更容易配上。
   */
  function pairableChars(state, balance) {
    var want = [];
    var list = balance.heroes.list;
    var pool = balance.recruit.heroChars;

    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].type !== 'char') {
        continue;
      }
      var ch = state.units[i].char;
      for (var j = 0; j < list.length; j++) {
        var def = list[j];
        if (def.surname === ch && pool.indexOf(def.given) >= 0 && want.indexOf(def.given) < 0) {
          want.push(def.given);
        }
        if (def.given === ch && pool.indexOf(def.surname) >= 0 && want.indexOf(def.surname) < 0) {
          want.push(def.surname);
        }
      }
    }
    return want;
  }

  /**
   * rollCard —— 抽一张卡。
   * 先掷一次决定类型，再掷一次决定具体是哪一个；两次分开掷让四类兵种真正均分。
   *
   * pairSet 是本次征兵算好的「可配对字集合」：抽到金卡时按 cfg.pairBias 概率
   * 从该集合里挑，否则全字池随机。不传 pairSet 时行为与原来完全一致，
   * 连随机序列都不多消耗。保底（必出一对）在 recruit() 里用 ensurePair 单独做。
   */
  function rollCard(state, balance, pairSet) {
    var cfg = balance.recruit;
    var roll = Game.rng.next(state) * 100;

    if (roll < cfg.odds.unit) {
      // 兵种顺序来自数值表的定义顺序，不要另写一份数组，避免两处不同步。
      var kinds = Object.keys(balance.units);
      var kind = kinds[Game.rng.int(state, kinds.length)];

      return {
        id: state.nextId++,
        type: 'unit',
        char: balance.units[kind].char,
        kind: kind
      };
    }

    var pool = cfg.heroChars;
    if (pairSet && pairSet.length && cfg.pairBias > 0 &&
        Game.rng.next(state) < cfg.pairBias) {
      pool = pairSet;
    }

    return {
      id: state.nextId++,
      type: 'heroChar',
      char: pool[Game.rng.int(state, pool.length)]
    };
  }

  /**
   * heroDefByChars —— 姓左名右能不能成将（和玩家拼字同一份数值表）。
   */
  function heroDefByChars(list, left, right) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].surname === left && list[i].given === right) {
        return list[i];
      }
    }
    return null;
  }

  /**
   * ensurePair —— 保底：让这一批 5 张卡里至少有一对「姓左名右」能成将的字。
   * 已经有成对就什么都不做；否则挑一个武将（优先能和场上休眠单字配上的），
   * 把两张兵卡换成它的姓 + 名。仍是 5 张卡、仍是整席替换，规则不变。
   */
  function ensurePair(cards, state, balance, pairSet) {
    var list = balance.heroes.list;

    for (var a = 0; a < cards.length; a++) {
      if (cards[a].type !== 'heroChar') {
        continue;
      }
      for (var b = 0; b < cards.length; b++) {
        if (a !== b && cards[b].type === 'heroChar' &&
            heroDefByChars(list, cards[a].char, cards[b].char)) {
          return;
        }
      }
    }

    var def = null;
    for (var d = 0; d < list.length && !def; d++) {
      if (pairSet.indexOf(list[d].surname) >= 0 || pairSet.indexOf(list[d].given) >= 0) {
        def = list[d];
      }
    }
    if (!def) {
      def = list[Game.rng.int(state, list.length)];
    }

    // 优先换掉兵卡（字卡留着还有别的配对机会），凑够两个位置就够
    var slots = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].type === 'unit') {
        slots.push(i);
      }
    }
    for (var j = 0; j < cards.length && slots.length < 2; j++) {
      if (cards[j].type !== 'unit' && slots.indexOf(j) < 0) {
        slots.push(j);
      }
    }
    if (slots.length < 2) {
      return;
    }

    cards[slots[0]] = { id: state.nextId++, type: 'heroChar', char: def.surname };
    cards[slots[1]] = { id: state.nextId++, type: 'heroChar', char: def.given };
  }

  /**
   * rollShovelCard —— 铲子卡（加餐 E）。
   * 先按原规则出满 5 张，再掷一次：命中就把随机 1 个卡位换成铲子卡。
   * 每手最多 1 张、总卡数仍是 5；不设保底、不累计数量——「上限」就是每手一张。
   */
  function rollShovelCard(state, cards, balance) {
    var cfg = balance.recruit;

    if (!(cfg.shovelCardChance > 0) || !cards.length) {
      return false;
    }
    if (Game.rng.next(state) * 100 >= cfg.shovelCardChance) {
      return false;
    }

    var slot = Game.rng.int(state, cards.length);
    cards[slot] = { id: state.nextId++, type: 'shovelCard' };
    return true;
  }

  /**
   * recruit —— 一次完整征兵。
   * 馒头不够返回 null（按钮本该已经禁用，这里是第二道保险）。
   * 整席替换用的是"换一个新数组"而不是逐格清空，明天做拖拽时引用不会串。
   */
  function recruit(state, balance) {
    var cfg = balance.recruit;
    var cost = rollCost(state, balance);

    if (state.bun < cost) {
      return null;
    }

    state.bun -= cost;
    state.recruitCount += 1;

    // 先数一下旧席位上还有几张，用于「已丢弃 N 张」提示。
    var discarded = 0;
    for (var i = 0; i < state.bench.length; i++) {
      if (state.bench[i]) {
        discarded += 1;
      }
    }

    /* 配对权重：场上有休眠单字时，抽到的金卡更可能是「缺的另一半」。
     * 保底 pairPity：每第 N 次征兵，5 张里必有一对能直接拼成武将的字。
     * 两者都只改「抽到哪些字」，不改一次 5 张、也不改整席替换。 */
    var pairSet = pairableChars(state, balance);
    var cards = [];
    for (var c = 0; c < cfg.benchSize; c++) {
      cards.push(rollCard(state, balance, pairSet));
    }

    /* 铲子卡先替换、再跑保底：这样保底配对不会被铲子卡冲掉；
     * 反过来先保底的话，铲子有概率正好换掉那一对里的字。 */
    var gotShovelCard = rollShovelCard(state, cards, balance);
    if (cfg.pairPity > 0 && state.recruitCount % cfg.pairPity === 0) {
      ensurePair(cards, state, balance, pairSet);
    }
    state.bench = cards;

    return {
      cards: cards,
      discarded: discarded,
      shovelCard: gotShovelCard,
      cost: cost
    };
  }

  Game.recruit = {
    rollCost: rollCost,
    recruit: recruit,
    rollCard: rollCard,
    pairableChars: pairableChars
  };
})(globalThis);
