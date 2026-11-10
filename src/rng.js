/* 单骑 · 汉字塔防 —— 随机数
 * 项目硬约束：禁止 Math.random()，所有随机都走这里的 seeded rng。
 * 好处：同一个 seed 能复现同一局，测试里把 state.seed 固定住，
 * 抽卡结果就是可预期的，不用"多跑几次碰运气"。
 *
 * 算法是 mulberry32：32 位状态、写法短、分布够用，适合小游戏。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  /**
   * next —— 返回 [0, 1) 的浮点数，并把种子往前推一步。
   * 注意它改的是 state.seed，属于状态推进，不是纯函数——
   * 这样才能保证"同一局里连续调用不会拿到同一个数"。
   */
  function next(state) {
    state.seed = (state.seed + 0x6D2B79F5) >>> 0;

    var t = state.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * int —— 返回 [0, max) 的整数。用来从数组里挑一个。
   */
  function int(state, max) {
    return Math.floor(next(state) * max);
  }

  Game.rng = {
    next: next,
    int: int
  };
})(globalThis);
