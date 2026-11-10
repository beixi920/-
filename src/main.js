/* 单骑 · 汉字塔防 —— 编排入口
 * 职责：启动、场景切换、固定步长主循环、存档。
 * 不画图（render.js）、不算数值（state / waves / combat / recruit）、不搬东西（drag.js）。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var DATA = global.DATA;

  var SAVE_KEY = 'sr_started';
  var DIFF_KEY = 'sr_difficulty';   // 难度单独存，和"是否玩过"分开

  var els = {};
  var canvas = null;
  var ctx = null;

  var currentScene = 'menu';
  var state = null;        // 玩家这一半
  var foeState = null;     // 对手这一半，独立一局，同一套波次

  /* ===== 对局结果 ===== */
  var duelOver = false;
  var duelResult = null;   // null = 还在打；'won' / 'lost'
  var aiTimer = 0;         // 对手 AI 下一次决策的倒计时（秒）；重置时填成一个完整间隔

  /* ===== 局外：金币 / 军衔 / 武器 =====
   * profile 由 Game.save.load() 从 localStorage 读出来（坏档自动回退新档）；
   * 结算 / 装备 / 卸下后立刻写档，难度仍沿用 sr_difficulty，不在这里管。 */
  var profile = null;      // 局外档案
  var metaReport = null;   // 本局结算报告，供结算面板显示金币 / 星 / 掉落

  /* ===== 难度：只影响 AI 想得多快、错得多不多，不改玩家规则和波次 ===== */
  var aiLevel = 'normal';

  function levelOf() {
    var levels = DATA.balance.ai.levels;
    return levels[aiLevel] || levels[DATA.balance.ai.default] || levels.normal;
  }

  /* ===== 主循环 ===== */
  var rafId = 0;
  var lastTs = 0;
  var acc = 0;                  // 时间累加器

  /* ============ 一、尺寸 ============ */

  function setupCanvas() {
    var board = Game.board;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);

    canvas.width = board.WIDTH * dpr;
    canvas.height = board.DUEL_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * fitScene —— 窗口比 375×667 小的时候整页等比缩小，不出现滚动条、不拉伸画布。
   * 用 zoom 而不是 transform：zoom 会同步改变布局盒尺寸，
   * canvas.getBoundingClientRect() 自然跟着变，drag.js 的坐标换算不用改。
   * 只缩放战斗页（菜单页有武器库展开，缩小反而看不清）。
   */
  function fitScene() {
    if (!els.battle) {
      return;
    }
    var vw = global.innerWidth || 375;
    var vh = global.innerHeight || 667;
    var s = Math.min(1, vw / 375, vh / 667);
    els.battle.style.zoom = s < 1 ? String(s) : '';
  }

  /* ============ 二、主循环：固定步长 60Hz ============ */

  function stepSec() {
    return 1 / DATA.balance.loop.stepHz;
  }

  /**
   * stepSide —— 推进一侧的战场。
   * 双方跑的是同一套 waves/combat、同一个步长，所以敌人数量、血量、位置天然同步；
   * 区别只在各自场上有多少兵（玩家自己放，对手由假 AI 放）。
   */
  function stepSide(side, step) {
    if (side.status !== 'playing') {
      return;
    }
    side.elapsed += step;
    Game.waves.update(side, step, DATA.balance, Game.board);
    Game.combat.update(side, step, DATA.balance, Game.board);
  }

  /**
   * update —— 一次固定步长的模拟推进。
   * 顺序固定为 waves → combat → tickPresentation（见 CODEBUDDY.md「每帧更新顺序」）。
   */
  function update(step) {
    if (!state || !foeState) {
      return;
    }

    // 入场动画期间冻结整局：波次、AI、战斗一步都不走，落地后才算开局。
    if (Game.intro && Game.intro.isActive()) {
      return;
    }

    if (!duelOver) {
      stepSide(state, step);
      stepSide(foeState, step);
      aiTick(step);
      checkDuel();
    }

    // 表现计时放最后且无条件执行：判负后抖动与飘字也要能收尾。两边都要跑。
    Game.waves.tickPresentation(state, step, DATA.balance);
    Game.waves.tickPresentation(foeState, step, DATA.balance);
  }

  /* ============ 对手 AI ============ */

  /**
   * aiTick —— 按当前难度的 intervalSec 让 AI 做一次决策。
   * 计时器放在这里（而不是 ai.js）是因为 ai.js 要保持纯函数：
   * 同一份 state + 同一档难度进去，永远得到同一份结果，好测也好好复现。
   */
  function aiTick(step) {
    if (foeState.status !== 'playing') {
      return;
    }

    var level = levelOf();

    aiTimer -= step;
    if (aiTimer > 0) {
      return;
    }
    aiTimer += level.intervalSec;

    Game.ai.decide(foeState, DATA.balance, Game.board, level);
  }

  /**
   * checkDuel —— 一方漏光 6 点（3 心）就结束整局，先没心的一方输。
   * 同一帧双方都漏光时判对手先没心（玩家赢），避免出现无法结算的平局；
   * 不再比较击杀数，也没有 12 波 / 超时判定。
   */
  function checkDuel() {
    var meDead = state.status === 'lost';
    var foeDead = foeState.status === 'lost';

    if (!meDead && !foeDead) {
      return;
    }

    var win = foeDead;   // 只有对手先没心才赢；双方同帧没心也归对手先

    duelOver = true;
    duelResult = win ? 'won' : 'lost';

    // 一局只结算一次：checkDuel 只会在 !duelOver 时被调到。
    metaReport = Game.meta.applyResult(profile, win, DATA.balance);
    Game.save.write(profile, DATA.balance);

    // 把结果写回玩家状态：拖拽、征兵、面板的守卫都读 status，不用到处加 duelOver。
    state.status = duelResult;
    resetWeaponStances();     // 胜负结算：弓一律回到「弓」字，不留武器形态
  }

  /**
   * resetWeaponStances —— 暂停 / 结算 / 重开时把两侧弓的姿态与过渡缓存清干净。
   * 纯表现钩子：weapon-fx.js 未加载（如只跑规则层的页面）时是空操作。
   */
  function resetWeaponStances() {
    if (!Game.weaponFx || !Game.weaponFx.reset) { return; }
    Game.weaponFx.reset(state);
    Game.weaponFx.reset(foeState);
  }

  function loop(ts) {
    if (!lastTs) {
      lastTs = ts;
    }

    var rawDt = (ts - lastTs) / 1000;
    lastTs = ts;

    // 掐住单帧步长：切后台 5 秒回来最多补 0.1 秒，不跳帧。
    if (rawDt > DATA.balance.loop.maxDtSec) {
      rawDt = DATA.balance.loop.maxDtSec;
    }
    if (rawDt < 0) {
      rawDt = 0;
    }

    acc += rawDt;

    var step = stepSec();
    var guard = 0;
    while (acc >= step && guard < 600) {
      update(step);
      acc -= step;
      guard += 1;
    }

    render();
    rafId = global.requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId) {
      return;   // 已经在跑，避免叠出第二条循环
    }
    acc = 0;
    lastTs = 0;
    rafId = global.requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) {
      global.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    acc = 0;
    lastTs = 0;
  }

  /* ============ 三、画面 ============ */

  function render() {
    if (!state || !foeState) {
      return;
    }
    Game.render.drawBattle(ctx, Game.board, state, foeState, Game.drag.getView(), DATA.balance);
    Game.ui.sync(state, foeState, duelResult, DATA.balance, metaReport);

    // 入场覆盖层画在最后：它自己铺纸底，盖住底下的战场；播完/跳过后自动隐藏。
    if (Game.intro && Game.intro.isActive()) {
      var now = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
      Game.intro.draw(now);
    }
  }

  /* ============ 四、场景切换 ============ */

  function resetBattle() {
    // 玩家在下半场（行 5–9），对手在上半场（行 0–4）；各自沿自己的 16 格路径行军。
    state = Game.state.createInitialState(DATA.balance, 'bottom');
    foeState = Game.state.createInitialState(DATA.balance, 'top');

    // 玩家装备只加成玩家侧的武将；对手侧没有这张表，hero.js 会按 0 处理。
    state.heroBonus = Game.meta.heroBonusMap(profile, DATA.balance);

    // 两个 state 必须走不同的随机序列：createInitialState 用 Date.now() 做种子，
    // 同一毫秒建出来的两局种子会一样，假 AI 的选择就会和玩家的抽卡"撞车"。
    foeState.seed = ((state.seed ^ 0x9E3779B9) >>> 0) || 2;

    duelOver = false;
    duelResult = null;
    metaReport = null;      // 上一局的金币 / 星变化不带进新一局的结算面板
    resetWeaponStances();   // 重开：新对象本来就是干净字，再显式清一次过渡缓存

    // 开局先让对手"想"一个完整间隔再动手：不然它会在第 0 帧就抽卡，
    // 顶栏那个 20 馒头一闪就没了，看不出它到底有没有正常经营。
    // 间隔按当前难度取（简单 3 秒 / 普通 2 秒 / 困难 1.2 秒）。
    aiTimer = levelOf().intervalSec;

    acc = 0;
    lastTs = 0;

    Game.drag.cancel();
    Game.ui.reset();

    if (canvas) {
      canvas.style.cursor = 'default';
    }
  }

  function showScene(name) {
    if (name === currentScene) {
      return;
    }

    if (name === 'battle') {
      resetBattle();
      els.menu.classList.remove('is-active');
      els.battle.classList.add('is-active');
      currentScene = 'battle';
      // 开场「斗」字入场：只在从首页进战斗时播；「再来一次」走 resetBattle+startLoop，不重播。
      if (Game.intro) {
        Game.intro.play();
      }
      startLoop();
    } else {
      resetWeaponStances();   // 暂停 / 返回首页：不留弓形态
      stopLoop();
      Game.drag.cancel();
      Game.ui.reset();      // 面板 / HUD 缓存 / 备战席一起清，回首页不留残影
      els.battle.classList.remove('is-active');
      els.menu.classList.add('is-active');
      currentScene = 'menu';
      Game.ui.syncMenu(profile, DATA.balance);   // 用结算后的金币 / 军衔刷新开始页
      updateHint();
    }
  }

  /* ============ 五、存档 ============ */

  function saveStarted() {
    try {
      global.localStorage.setItem(SAVE_KEY, JSON.stringify({ started: true }));
    } catch (err) {
      if (global.console) {
        console.warn('[单骑] 存档失败：', err);
      }
    }
  }

  function hasStarted() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (!raw) {
        return false;
      }
      var obj = JSON.parse(raw);
      return !!(obj && obj.started);
    } catch (err) {
      return false;
    }
  }

  function updateHint() {
    if (hasStarted()) {
      els.hint.textContent = '上次已开始';
      els.hint.classList.add('is-on');
    }
  }

  /* ============ 五之二、难度 ============ */

  function loadDifficulty() {
    try {
      var v = global.localStorage.getItem(DIFF_KEY);
      if (v && DATA.balance.ai.levels[v]) {
        return v;
      }
    } catch (err) {
      // file:// 下少数浏览器会直接抛，忽略，退回默认档
    }
    return DATA.balance.ai.default || 'normal';
  }

  function saveDifficulty(key) {
    try {
      global.localStorage.setItem(DIFF_KEY, key);
    } catch (err) {
      if (global.console) {
        console.warn('[单骑] 难度没存下来：', err);
      }
    }
  }

  /**
   * setDifficulty —— 切一档难度。只影响 AI 的思考间隔和失误率，
   * 玩家侧规则、波次数值一律不动，所以打到一半切换也不会让局面变形。
   */
  function setDifficulty(key) {
    if (!DATA.balance.ai.levels[key]) {
      return;
    }
    aiLevel = key;
    saveDifficulty(key);
    applyDifficultyUI();
  }

  /**
   * applyDifficultyUI —— 三个按钮里只让当前那档高亮。
   */
  function applyDifficultyUI() {
    var keys = Object.keys(DATA.balance.ai.levels);
    for (var i = 0; i < keys.length; i++) {
      var btn = els.diffBtns[keys[i]];
      if (btn) {
        btn.classList.toggle('is-on', keys[i] === aiLevel);
      }
    }
  }

  /* ============ 六、武器库 ============ */

  /**
   * armoryHandlers —— 武器库的三个动作，全部「改完立刻写档」。
   * ui.js 只把点击传回来，业务与落盘都留在这里。
   */
  function armoryHandlers() {
    return {
      onEquip: function (uid, heroKey) {
        if (Game.meta.equip(profile, uid, heroKey, DATA.balance)) {
          Game.save.write(profile, DATA.balance);
          Game.ui.renderArmory(profile, DATA.balance, armoryHandlers());
        }
      },
      onUnequip: function (uid) {
        if (Game.meta.unequip(profile, uid)) {
          Game.save.write(profile, DATA.balance);
          Game.ui.renderArmory(profile, DATA.balance, armoryHandlers());
        }
      },
      onWipe: function () {
        Game.save.clear();
        profile = Game.meta.createProfile(DATA.balance);
        Game.ui.syncMenu(profile, DATA.balance);
        Game.ui.renderArmory(profile, DATA.balance, armoryHandlers());
      },
      onClose: function () {}
    };
  }

  function bindArmory() {
    Game.ui.bindArmoryControls(armoryHandlers());
    els.armoryBtn.addEventListener('click', function () {
      Game.ui.toggleArmory(profile, DATA.balance, armoryHandlers());
    });
  }

  function bind() {
    bindArmory();

    els.start.addEventListener('click', function () {
      saveStarted();
      showScene('battle');
    });

    els.back.addEventListener('click', function () {
      showScene('menu');
    });

    els.panelBack.addEventListener('click', function () {
      showScene('menu');
    });

    els.retry.addEventListener('click', function () {
      resetBattle();
      startLoop();
    });

    /**
     * 征兵：扣钱、换整席、可能出铲子，全在 recruit.js 里算。
     * 这里只负责把"丢弃了几张"告诉界面。
     */
    els.recruitBtn.addEventListener('click', function () {
      if (!state || state.status !== 'playing') {
        return;
      }

      var result = Game.recruit.recruit(state, DATA.balance);
      if (!result) {
        return;   // 钱不够：按钮本该已禁用，这里再守一道
      }

      Game.ui.clearSelection();
      Game.ui.showNote(result.discarded > 0 ? '已丢弃 ' + result.discarded + ' 张' : '');
    });

    /* 难度按钮：点一下立刻生效，下一局、刷新页面都保持这一档 */
    var diffKeys = Object.keys(DATA.balance.ai.levels);
    for (var d = 0; d < diffKeys.length; d++) {
      (function (key) {
        var btn = els.diffBtns[key];
        if (btn) {
          btn.addEventListener('click', function () {
            setDifficulty(key);
          });
        }
      })(diffKeys[d]);
    }
  }

  /* ============ 七、启动 ============ */

  function cacheEls() {
    els.menu = document.getElementById('scene-menu');
    els.battle = document.getElementById('scene-battle');
    els.start = document.getElementById('btn-start');
    els.back = document.getElementById('btn-back');
    els.hint = document.getElementById('menu-hint');

    els.armoryBtn = document.getElementById('btn-armory');
    els.recruitBtn = document.getElementById('btn-recruit');

    els.retry = document.getElementById('btn-retry');
    els.panelBack = document.getElementById('btn-panel-back');

    /* 三档难度：开始页那排按钮，key 和 balance.ai.levels 一一对应 */
    els.diffBtns = {};
    var diffKeys = Object.keys(DATA.balance.ai.levels);
    for (var d = 0; d < diffKeys.length; d++) {
      els.diffBtns[diffKeys[d]] = document.getElementById('btn-diff-' + diffKeys[d]);
    }

    canvas = document.getElementById('battle-canvas');
    ctx = canvas.getContext('2d');
  }

  function boot() {
    cacheEls();

    if (!Game.board || !Game.render || !Game.renderFx || !Game.state || !Game.waves ||
        !Game.combat || !Game.skill || !Game.recruit || !Game.rng || !Game.ui ||
        !Game.drag || !Game.ai || !Game.hero || !Game.meta || !Game.save ||
        !Game.intro) {
      console.error('[单骑] src/ 下有模块未加载，检查 index.html 的 script 顺序');
      return;
    }

    if (!DATA || !DATA.balance) {
      console.error('[单骑] data/balance.js 未加载');
      return;
    }

    Game.ui.init(DATA.balance);

    profile = Game.save.load(DATA.balance);
    Game.ui.syncMenu(profile, DATA.balance);

    aiLevel = loadDifficulty();

    setupCanvas();
    fitScene();
    global.addEventListener('resize', fitScene);
    Game.drag.init(canvas);
    resetBattle();
    bind();
    applyDifficultyUI();
    render();
    updateHint();
  }

  Game.main = {
    boot: boot,
    showScene: showScene,
    getState: function () {
      return state;
    },
    /* 对手那一半：自测 / 调试脚本用，正常流程不需要读它 */
    getFoe: function () {
      return foeState;
    },
    /* 对局结果：null = 还在打，'won' / 'lost' */
    getResult: function () {
      return duelResult;
    },
    /* 局外档案：本轮只在内存里，刷新会丢（明天接 localStorage） */
    getProfile: function () {
      return profile;
    },
    /* 当前难度档位与参数（'easy' / 'normal' / 'hard'） */
    getDifficulty: function () {
      return aiLevel;
    },
    setDifficulty: setDifficulty
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis);
