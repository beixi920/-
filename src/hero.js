/* 单骑 · 汉字塔防 —— 武将拼字
 * 规矩：纯逻辑，只读写传进来的 state，不碰 DOM / Canvas。
 *
 * 为什么单独一个文件：拼字判定有一整套"合法 / 字序错 / 凑不成"的分支，
 * 塞在 state.js 里会把那个文件顶过 600 行红线，而且它和"造兵、落子"是两件事。
 *
 * 依赖：Game.state.makeHero（造武将对象）
 * 被调用：drag.js —— 每次落子 / 移动之后问一次"现在能拼了吗"
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  function sameCell(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }

  /**
   * charAt —— 这个格子上有没有休眠单字。
   */
  function charAt(state, cell) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.type === 'char' && sameCell(u.cell, cell)) {
        return u;
      }
    }
    return null;
  }

  /**
   * heroByChars —— 左字是姓、右字是名、且同属一个武将，就返回那个武将；否则 null。
   */
  function heroByChars(balance, leftChar, rightChar) {
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].surname === leftChar && list[i].given === rightChar) {
        return list[i];
      }
    }
    return null;
  }

  function isSurname(balance, ch) {
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].surname === ch) {
        return true;
      }
    }
    return false;
  }

  function isHeroChar(balance, ch) {
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].surname === ch || list[i].given === ch) {
        return true;
      }
    }
    return false;
  }

  /**
   * awaken —— 把两张字合成一个武将。
   * 武将占两格：左格姓、右格名，两张字原来的位置都归它，不空出格子。
   * 主格取右边那个（名格），和 makeHero 的约定一致。
   */
  function awaken(state, balance, left, right, heroDef) {
    var cells = [
      [left.cell[0], left.cell[1]],
      [right.cell[0], right.cell[1]]
    ];
    var bonus = (state.heroBonus && state.heroBonus[heroDef.key]) || 0;
    var hero = Game.state.makeHero(heroDef, cells, right.id, bonus);

    var alive = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.id === left.id) {
        continue;                 // 姓字这个对象没了，但格子被 hero 的 cells 占着
      }
      if (u.id === right.id) {
        alive.push(hero);
        continue;
      }
      alive.push(u);
    }
    state.units = alive;

    // 金色扩散环，位置取两格中心
    var life = balance.merge.animSec;
    state.effects.push({
      type: 'awaken',
      cx: (cells[0][0] + cells[1][0]) / 2,
      cy: (cells[0][1] + cells[1][1]) / 2,
      life: life,
      maxLife: life
    });
  }

  /**
   * tryAwaken —— 检查场上有没有能拼的相邻两字，有就立刻觉醒。
   *
   * 只在「左右相邻、且两张都是休眠单字」时才判定，所以不会误报：
   *   { ok:true,  heroName }              拼成了
   *   { ok:false, failReason:'order' }    两个都是合法字，但姓在右、名在左
   *   { ok:false, failReason:'mismatch' } 两个合法字，但不是同一个武将（赵+飞）
   *   { ok:false, failReason:null }       没凑成相邻的一对，什么都不用提示
   */
  function tryAwaken(state, balance) {
    var chars = [];
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].type === 'char') {
        chars.push(state.units[i]);
      }
    }

    if (chars.length < 2) {
      return { ok: false, heroName: null, failReason: null };
    }

    var orderFail = false;
    var mismatchFail = false;

    for (var a = 0; a < chars.length; a++) {
      var left = chars[a];
      var right = charAt(state, [left.cell[0] + 1, left.cell[1]]);
      if (!right) {
        continue;                 // 右边不是字，这一对不成对
      }

      var hero = heroByChars(balance, left.char, right.char);
      if (hero) {
        awaken(state, balance, left, right, hero);
        return { ok: true, heroName: hero.name, failReason: null };
      }

      if (isSurname(balance, right.char) && !isSurname(balance, left.char)) {
        orderFail = true;         // 名在左、姓在右：字序不对
      } else if (isHeroChar(balance, left.char) && isHeroChar(balance, right.char)) {
        mismatchFail = true;      // 两个都合法，但凑不成将
      }
    }

    if (orderFail) {
      return { ok: false, heroName: null, failReason: 'order' };
    }
    if (mismatchFail) {
      return { ok: false, heroName: null, failReason: 'mismatch' };
    }
    return { ok: false, heroName: null, failReason: null };
  }

  /**
   * returnToBench —— 把场上的休眠单字收回备战席（拖到棋盘外时用）。
   * 席上没有空位就返回 false，字留在原地。
   */
  function returnToBench(state, unitId) {
    var unit = null;
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id === unitId) {
        unit = state.units[i];
        break;
      }
    }

    if (!unit || unit.type !== 'char') {
      return false;
    }

    for (var b = 0; b < state.bench.length; b++) {
      if (!state.bench[b]) {
        state.bench[b] = { id: state.nextId++, type: 'heroChar', char: unit.char };
        state.units = state.units.filter(function (u) {
          return u.id !== unitId;
        });
        return true;
      }
    }
    return false;
  }

  /**
   * splitHero —— 把武将拆回两张单字（拖动它任意一格时调用）。
   *
   * picked 是"抓住的那一格"下标（0 = 姓格，1 = 名格）：
   *   - 两张字各自落在武将原来的两格上，不空出格子、不挪另一个字；
   *   - 被抓住的那张返回成 picked，跟着鼠标走；另一张留在原地休眠；
   *   - 武将对象直接删掉：停止攻击、技能冷却一并消失（重组时 makeHero 会给满 CD）。
   *
   * 这里**故意不调 tryAwaken**：两张字刚拆开时仍然满足「姓左名右 + 相邻」，
   * 立刻检查会马上又合上，玩家永远拆不开。觉醒判定放在拖动结束（松手）之后。
   */
  function splitHero(state, heroId, picked) {
    var hero = null;
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id === heroId && state.units[i].type === 'hero') {
        hero = state.units[i];
        break;
      }
    }
    if (!hero) {
      return null;
    }

    var cells = hero.cells || [hero.cell];
    var name = hero.name || hero.char || '';
    var idx = (picked === 1 && cells.length > 1) ? 1 : 0;

    var made = [];
    for (var k = 0; k < cells.length; k++) {
      var ch = name.charAt(k);
      if (!ch) {
        continue;
      }
      var c = Game.state.makeChar(ch, cells[k], state.nextId++);
      state.units.push(c);
      made.push(c);
    }

    state.units = state.units.filter(function (u) {
      return u.id !== hero.id;
    });

    if (!made.length) {
      return null;
    }

    return {
      picked: made[idx] || made[0],
      other: made[idx === 0 ? 1 : 0] || null
    };
  }

  Game.hero = {
    tryAwaken: tryAwaken,
    charAt: charAt,
    returnToBench: returnToBench,
    splitHero: splitHero
  };
})(globalThis);
