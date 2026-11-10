/* 单骑 · 汉字塔防 —— 界面层（HUD / 备战席 / 结算面板）
 * 规矩：只读写 DOM，不做任何游戏判定，也不碰 Canvas。
 * main.js 每帧调 sync()，把 state 里的数字搬到屏幕上。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  var els = {};
  var heartEls = [];       // 玩家侧（下半场）
  var foeHeartEls = [];    // 对手侧（上半场）

  /* 上一次写进 DOM 的值：一样就不再写，避免每帧都动 DOM。 */
  var cache = { bun: null, foeBun: null, hearts: null, foeHearts: null, wave: null, next: null, cost: null, disabled: null, gainText: null, gainAlpha: null, menuGold: null, menuRank: null, menuStars: null };
  var panelOpen = false;

  /* 备战席：选中状态属于"界面状态"，不进 state，明天拖拽直接读 Game.ui.getSelectedCardId() */
  var selectedCardId = null;
  var lastSelected;
  var benchRef = null;
  var cardEls = {};
  var curState = null;
  var noteTimer = 0;

  function setText(el, value, key) {
    if (el && cache[key] !== value) {
      el.textContent = value;
      cache[key] = value;
    }
  }

  /**
   * fillHearts —— 在一个容器里按配置的心数生成一排 ♥，返回这批元素。
   * 只建一次，之后只切换 is-lost 类，不重建 DOM。
   */
  function fillHearts(container, balance) {
    container.textContent = '';
    var out = [];

    for (var i = 0; i < balance.lives.hearts; i++) {
      var span = document.createElement('span');
      span.className = 'hud-heart';
      span.textContent = '♥';
      container.appendChild(span);
      out.push(span);
    }
    return out;
  }

  function buildHearts(balance) {
    heartEls = fillHearts(els.hearts, balance);
    foeHeartEls = fillHearts(els.foeHearts, balance);
  }

  function init(balance) {
    els.bun = document.getElementById('hud-bun');
    els.gain = document.getElementById('hud-gain');
    els.hearts = document.getElementById('hud-hearts');
    els.foeHearts = document.getElementById('hud-hearts-foe');
    els.foeBun = document.getElementById('hud-foe-bun');
    els.wave = document.getElementById('hud-wave');
    els.next = document.getElementById('hud-next');
    els.panel = document.getElementById('panel');
    els.panelTitle = document.getElementById('panel-title');
    els.panelSub = document.getElementById('panel-sub');
    els.panelMeta = document.getElementById('panel-meta');
    els.panelDrop = document.getElementById('panel-drop');

    /* 局外：开始页的金币 / 军衔 / 星数，以及武器库简版列表 */
    els.menuGold = document.getElementById('menu-gold');
    els.menuRank = document.getElementById('menu-rank');
    els.menuStars = document.getElementById('menu-stars');
    els.armoryBtn = document.getElementById('btn-armory');
    els.armory = document.getElementById('armory');
    els.armoryHero = document.getElementById('armory-hero');
    els.armoryList = document.getElementById('armory-list');
    els.armoryClose = document.getElementById('btn-armory-close');
    els.wipe = document.getElementById('btn-wipe');

    els.bench = document.getElementById('bench');
    els.cost = document.getElementById('recruit-cost');
    els.note = document.getElementById('recruit-note');
    els.recruitBtn = document.getElementById('btn-recruit');

    buildHearts(balance);
  }

  /**
   * applyHearts —— 把一排心的亮灭改到目标心数，数量没变就跳过。
   */
  function applyHearts(list, leakPoints, balance, key) {
    var n = Game.waves.heartCount(leakPoints, balance);
    if (cache[key] === n) {
      return;
    }
    cache[key] = n;

    for (var i = 0; i < list.length; i++) {
      list[i].classList.toggle('is-lost', i >= n);
    }
  }

  /**
   * syncHearts —— 上下两排各自同步，互不影响。
   */
  function syncHearts(state, foeState, balance) {
    applyHearts(heartEls, state.leakPoints, balance, 'hearts');
    applyHearts(foeHeartEls, foeState.leakPoints, balance, 'foeHearts');
  }

  /**
   * syncPanel —— 一方心归零后弹出结算。
   * 结果由 main.js 判好传进来（result 为 null 表示还在打），这里只负责显示。
   */
  function syncPanel(state, foeState, result, report, balance) {
    var over = !!result;
    if (over === panelOpen) {
      return;   // 状态没变，别每帧都动 DOM
    }

    panelOpen = over;
    els.panel.classList.toggle('is-on', over);

    if (over) {
      els.panelTitle.textContent = result === 'won' ? '你赢了' : '你输了';
      els.panelSub.textContent = panelSubText(state, foeState, result);
      if (els.panelMeta) {
        els.panelMeta.textContent = report ? metaReportText(report) : '';
      }
      renderPanelDrop(report, balance);
    }
  }

  /**
   * metaReportText —— 结算第三行：金币变化、星变化、当前军衔（含升/掉段）。
   * 数字全部来自 Game.meta.applyResult 的 report，这里只拼字，不自己算。
   */
  function metaReportText(r) {
    var text = '金币 +' + r.goldDelta + '（共 ' + r.goldAfter + '）'
      + '　·　' + (r.starDelta > 0 ? '+' : '') + r.starDelta + ' 星'
      + '　·　' + r.rankName + ' ' + r.starLabel;

    if (r.rankChanged === 'up') {
      text += '　【升段】';
    } else if (r.rankChanged === 'down') {
      text += '　【掉段】';
    }
    return text;
  }

  /**
   * syncMenu —— 把内存里的金币 / 军衔搬到开始页。
   * 每次回首页和结算后调一次，不进每帧循环。
   */
  function syncMenu(profile, balance) {
    if (!profile) {
      return;
    }
    setText(els.menuGold, String(profile.gold), 'menuGold');
    setText(els.menuRank, Game.meta.rankName(profile, balance), 'menuRank');
    setText(els.menuStars, Game.meta.starLabel(profile, balance), 'menuStars');
  }

  /* ============ 武器库（简版列表）============ */

  var armoryHandlers = null;
  var heroOptionsBuilt = false;
  var wipeArmed = false;
  var wipeTimer = 0;

  /** clearChildren —— 真 DOM / 假 DOM 都能用，不用只读的 children 赋值。 */
  function clearChildren(el) {
    while (el.children && el.children.length) {
      el.removeChild(el.children[0]);
    }
    el.textContent = '';
  }

  function buildHeroOptions(balance) {
    if (heroOptionsBuilt || !els.armoryHero) {
      return;
    }
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      var opt = document.createElement('option');
      opt.value = list[i].key;
      opt.textContent = list[i].name;
      els.armoryHero.appendChild(opt);
    }
    els.armoryHero.value = list[0].key;
    heroOptionsBuilt = true;
  }

  function getArmoryHero(balance) {
    return (els.armoryHero && els.armoryHero.value) || balance.heroes.list[0].key;
  }

  function equippedHero(profile, weaponId) {
    for (var key in profile.equipped) {
      if (profile.equipped[key] === weaponId) {
        return key;
      }
    }
    return null;
  }

  function heroTitle(balance, key) {
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) {
        return list[i].name;
      }
    }
    return key;
  }

  /**
   * renderArmory —— 一行一件武器：名字（品质色）+ 装备状态 + 装备/卸下按钮。
   * 按钮只回调 main.js，界面自己不改 profile、不写档。
   */
  function renderArmory(profile, balance, handlers) {
    if (!els.armoryList) {
      return;
    }
    armoryHandlers = handlers || armoryHandlers;
    clearChildren(els.armoryList);

    if (!profile.inventory.length) {
      var empty = document.createElement('div');
      empty.className = 'armory-empty';
      empty.textContent = '还没有武器，赢一局掉 1 把。';
      els.armoryList.appendChild(empty);
      return;
    }

    for (var i = 0; i < profile.inventory.length; i++) {
      var item = profile.inventory[i];
      var def = Game.meta.weaponDef(balance, item.defId);
      if (!def) {
        continue;
      }

      var hk = equippedHero(profile, item.id);
      var row = document.createElement('div');
      row.className = 'armory-row';

      var name = document.createElement('span');
      name.className = 'armory-name';
      name.textContent = def.name + ' +' + Math.round(def.bonus * 100) + '%';
      name.style.color = balance.weapons.qualityColor[def.quality];

      var state = document.createElement('span');
      state.className = 'armory-state';
      state.textContent = hk ? ('已装备·' + heroTitle(balance, hk)) : '未装备';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = hk ? '卸下' : '装备';
      (function (uid, isEquipped) {
        btn.addEventListener('click', function () {
          if (!armoryHandlers) {
            return;
          }
          if (isEquipped) {
            armoryHandlers.onUnequip(uid);
          } else {
            armoryHandlers.onEquip(uid, getArmoryHero(balance));
          }
        });
      })(item.id, !!hk);

      row.appendChild(name);
      row.appendChild(state);
      row.appendChild(btn);
      els.armoryList.appendChild(row);
    }
  }

  function resetWipe() {
    wipeArmed = false;
    if (wipeTimer) {
      clearTimeout(wipeTimer);
      wipeTimer = 0;
    }
    if (els.wipe) {
      els.wipe.textContent = '清空存档';
    }
  }

  /**
   * bindArmoryControls —— 一次性绑定关闭 / 清空存档。
   * 清空要点两次：第一次把按钮改成「再点一次确认清空」，3 秒内再点才真清。
   */
  function bindArmoryControls(handlers) {
    armoryHandlers = handlers;

    if (els.armoryClose) {
      els.armoryClose.addEventListener('click', function () {
        closeArmory(handlers);
      });
    }
    if (els.wipe) {
      els.wipe.addEventListener('click', function () {
        if (!wipeArmed) {
          wipeArmed = true;
          els.wipe.textContent = '再点一次确认清空';
          wipeTimer = setTimeout(resetWipe, 3000);
          return;
        }
        resetWipe();
        if (armoryHandlers && armoryHandlers.onWipe) {
          armoryHandlers.onWipe();
        }
      });
    }
  }

  function openArmory(profile, balance, handlers) {
    armoryHandlers = handlers;
    buildHeroOptions(balance);
    els.armory.classList.add('is-on');
    renderArmory(profile, balance, handlers);
  }

  function closeArmory() {
    if (els.armory) {
      els.armory.classList.remove('is-on');
    }
    resetWipe();
  }

  function toggleArmory(profile, balance, handlers) {
    if (els.armory.classList.contains('is-on')) {
      closeArmory();
    } else {
      openArmory(profile, balance, handlers);
    }
  }

  /** renderPanelDrop —— 结算面板第四行：本局掉的武器名，按品质上色。 */
  function renderPanelDrop(report, balance) {
    if (!els.panelDrop) {
      return;
    }
    clearChildren(els.panelDrop);
    if (!report || !report.drop) {
      return;
    }

    var d = report.drop;
    var label = document.createElement('span');
    label.textContent = '本局掉落：';

    var name = document.createElement('span');
    name.textContent = d.name + '（' + balance.weapons.qualityName[d.quality]
      + ' +' + Math.round(d.bonus * 100) + '%）';
    name.style.color = balance.weapons.qualityColor[d.quality];

    els.panelDrop.appendChild(label);
    els.panelDrop.appendChild(name);
  }

  /**
   * panelSubText —— 结算面板第二行：只说明「谁先没心」，不再比击杀 / 漏怪。
   */
  function panelSubText(state, foeState, result) {
    /* 加餐 C：结算只说明「谁先没心」，不再比击杀 / 漏怪数。 */
    return result === 'won' ? '对手先没心' : '你先没心';
  }

  /**
   * syncAction —— 征兵按钮的费用文字与置灰状态。
   * 只在这些值真的变化时才写 DOM。
   */
  function syncAction(state, balance) {
    var cost = Game.recruit.rollCost(state, balance);
    var canAfford = state.bun >= cost;

    var costText = canAfford ? cost + ' 馒头' : '还差 ' + (cost - state.bun) + ' 馒头';
    if (cache.cost !== costText) {
      els.cost.textContent = costText;
      cache.cost = costText;
    }

    if (cache.disabled !== !canAfford) {
      els.recruitBtn.disabled = !canAfford;
      cache.disabled = !canAfford;
    }
  }

  /**
   * currentWave —— HUD 上显示的"当前第几波"。
   * waveIndex 是"下一波要开的波号"，所以要减回去。
   */
  function currentWave(state) {
    if (state.spawnWave > 0) {
      return state.spawnWave;
    }
    return Math.max(1, state.waveIndex - 1);   // 无限波：不封顶
  }

  function nextWaveLabel(state) {
    // 无限波没有"末波"：倒计时归零后下一帧就开新波，始终显示剩余秒数。
    return Math.max(0, Math.ceil(state.nextWaveIn)) + 's';
  }

  /**
   * toggleCardSelection —— 点一下选中，再点取消（拖拽没超过阈值时才会触发）。
   */
  function toggleCardSelection(id) {
    selectedCardId = selectedCardId === id ? null : id;
    benchRef = null;
    if (curState) {
      renderBench(curState);
    }
  }

  /**
   * shakeCard —— 卡不能上场时抖一下，明确告诉玩家"没吞你的卡"。
   */
  function shakeCard(id) {
    var el = cardEls[id];
    if (!el) {
      return;
    }
    el.classList.add('is-shake');
    setTimeout(function () {
      el.classList.remove('is-shake');
    }, 320);
  }

  /**
   * renderBench —— 把 5 格备战席画成 DOM 卡片。
   * 只有"换了一批卡"或"选中变了"才重建，平时一帧都不动。
   */
  function renderBench(state) {
    if (state.bench === benchRef && selectedCardId === lastSelected) {
      return;
    }
    benchRef = state.bench;
    lastSelected = selectedCardId;
    cardEls = {};

    els.bench.textContent = '';

    for (var i = 0; i < state.bench.length; i++) {
      var card = state.bench[i];

      if (!card) {
        var slot = document.createElement('div');
        slot.className = 'bench-slot';
        els.bench.appendChild(slot);
        continue;
      }

      var el = document.createElement('div');
      el.className = 'bench-card'
        + (card.type === 'heroChar' ? ' is-hero' : '')
        + (card.type === 'shovelCard' ? ' is-shovel' : '')
        + (card.id === selectedCardId ? ' is-selected' : '');
      el.setAttribute('role', 'button');
      el.setAttribute('data-card-id', String(card.id));

      if (card.type === 'shovelCard') {
        /* 加餐 E：铲子卡不写汉字，卡面画程序化图标（bench-art.js）。
         * 图标先占位、入 DOM 量到卡宽后再按 iconRatio 取尺寸，窗口缩放也不会溢出。 */
        el.setAttribute('title', '铲子 · 拖到深绿格挖开');
      } else {
        el.textContent = card.char;
      }

      // 从场上收回的兵卡带等级（B4）：右下角标出来，玩家才知道放回去不是 Lv1。
      if (card.lv > 1) {
        el.style.position = 'relative';
        el.setAttribute('data-lv', String(card.lv));
        el.setAttribute('title', 'Lv' + card.lv + ' · 放回场上保留等级');
        var tag = document.createElement('span');
        tag.textContent = 'Lv' + card.lv;
        tag.style.cssText = 'position:absolute;right:1px;bottom:0;font-size:9px;line-height:1;opacity:.75';
        el.appendChild(tag);
      }

      // 按下就开始拖；没超过阈值会在 drag.js 里当成点击处理。
      el.addEventListener('pointerdown', makeCardDrag(card));

      cardEls[card.id] = el;
      els.bench.appendChild(el);

      if (card.type === 'shovelCard') {
        var art = global.DATA.balance.art.bench.shovel;
        var side = Math.round(Math.min(el.clientWidth || 48, el.clientHeight || 48) * art.iconRatio);
        var icon = Game.benchArt ? Game.benchArt.shovelIcon(side) : null;
        if (icon) {
          el.appendChild(icon);
        }
      }
    }
  }

  function makeCardDrag(card) {
    return function (event) {
      if (event.button !== 0) {
        return;
      }
      Game.drag.beginFromCard(card, event);
    };
  }

  /**
   * showNote —— 操作区那一行小字（「已丢弃 N 张」）。
   * 不弹窗、不阻塞，1.8 秒后自己消失。
   */
  function showNote(text) {
    if (!els.note) {
      return;
    }

    els.note.textContent = text;

    if (noteTimer) {
      clearTimeout(noteTimer);
      noteTimer = 0;
    }
    if (text) {
      noteTimer = setTimeout(function () {
        els.note.textContent = '';
        noteTimer = 0;
      }, 1800);
    }
  }

  function clearSelection() {
    selectedCardId = null;
    benchRef = null;
  }

  /**
   * markBenchDirty —— 备战席内容被就地改过（比如某格置 null）时调用。
   * 不能只靠"数组引用有没有变"来判断重绘：dropCard 是原地把 bench[i] 设为 null，
   * 引用没变，缓存就会骗过渲染，卡片留在屏幕上变成"复制"。
   */
  function markBenchDirty() {
    benchRef = null;

    // 选中的那张如果已经被用掉，顺手取消选中，避免选一个不存在的 id。
    if (selectedCardId !== null && curState) {
      var still = false;
      for (var i = 0; i < curState.bench.length; i++) {
        if (curState.bench[i] && curState.bench[i].id === selectedCardId) {
          still = true;
        }
      }
      if (!still) {
        selectedCardId = null;
      }
    }

    if (curState) {
      renderBench(curState);
    }
  }

  function getSelectedCardId() {
    return selectedCardId;
  }

  /**
   * bunGainAlpha —— 把「剩余播放时间」换算成透明度。
   * 时间轴：0 ~ fadeIn 淡入，fadeIn ~ fadeIn+hold 全亮，最后 fadeOut 淡出。
   */
  function bunGainAlpha(state, balance) {
    var cfg = balance.hud;
    var total = cfg.gainFadeInSec + cfg.gainHoldSec + cfg.gainFadeOutSec;

    if (state.bunGainTimer <= 0) {
      return 0;
    }

    var passed = total - state.bunGainTimer;   // 已经播了多久

    if (passed < cfg.gainFadeInSec) {
      return passed / cfg.gainFadeInSec;
    }

    var fadeStart = cfg.gainFadeInSec + cfg.gainHoldSec;
    if (passed < fadeStart) {
      return 1;
    }

    return Math.max(0, 1 - (passed - fadeStart) / cfg.gainFadeOutSec);
  }

  /**
   * syncBunGain —— 馒头数字右侧的「+N」。
   * 文字和时间都由 state 决定，这里只负责搬到 DOM 上；
   * 透明度按 1% 一档缓存，避免每帧都写 style（写 style 会触发样式重算）。
   */
  function syncBunGain(state, balance) {
    if (!els.gain) {
      return;
    }

    var text = state.bunGainTimer > 0 ? state.bunGainText : '';
    if (cache.gainText !== text) {
      els.gain.textContent = text;
      cache.gainText = text;
    }

    var alpha = Math.round(bunGainAlpha(state, balance) * 100) / 100;
    if (cache.gainAlpha !== alpha) {
      els.gain.style.opacity = String(alpha);
      cache.gainAlpha = alpha;
    }
  }

  /**
   * sync —— 每帧调用一次，把两边的状态搬到 HUD 和面板上。
   * 波次只显示玩家这一侧：双方跑的是同一套节拍，数字本来就一样。
   */
  function sync(state, foeState, result, balance, metaReport) {
    if (!state || !foeState) {
      return;
    }

    curState = state;

    setText(els.bun, String(state.bun), 'bun');
    setText(els.foeBun, String(foeState.bun), 'foeBun');
    setText(els.wave, String(currentWave(state)), 'wave');   // 只显示「第 N 波」，不封顶
    setText(els.next, nextWaveLabel(state), 'next');

    syncHearts(state, foeState, balance);
    syncPanel(state, foeState, result, metaReport, balance);
    syncAction(state, balance);
    syncBunGain(state, balance);
    renderBench(state);
  }

  /**
   * reset —— 新开一局：清掉缓存和面板，下一帧会整体重刷。
   */
  function reset() {
    cache.bun = null;
    cache.foeBun = null;
    cache.hearts = null;
    cache.foeHearts = null;
    cache.wave = null;
    cache.next = null;
    cache.cost = null;
    cache.disabled = null;
    cache.gainText = null;
    cache.gainAlpha = null;

    panelOpen = false;
    if (els.panel) {
      els.panel.classList.remove('is-on');
    }
    if (els.panelMeta) {
      els.panelMeta.textContent = '';
    }
    if (els.panelDrop) {
      clearChildren(els.panelDrop);
    }

    /* 回首页 / 重开一局时收起武器库，避免面板残影。 */
    if (els.armory) {
      els.armory.classList.remove('is-on');
    }
    resetWipe();

    /* 备战席和选中状态一起清掉，否则「再来一次」会看到上一局的卡。 */
    benchRef = null;
    lastSelected = undefined;
    selectedCardId = null;

    if (els.bench) {
      els.bench.textContent = '';
    }
    if (els.note) {
      els.note.textContent = '';
    }
    if (noteTimer) {
      clearTimeout(noteTimer);
      noteTimer = 0;
    }
  }

  Game.ui = {
    init: init,
    sync: sync,
    syncMenu: syncMenu,
    bindArmoryControls: bindArmoryControls,
    toggleArmory: toggleArmory,
    renderArmory: renderArmory,
    closeArmory: closeArmory,
    reset: reset,
    showNote: showNote,
    clearSelection: clearSelection,
    getSelectedCardId: getSelectedCardId,
    toggleCardSelection: toggleCardSelection,
    shakeCard: shakeCard,
    markBenchDirty: markBenchDirty,
    bunGainAlpha: bunGainAlpha,     // 纯函数：只做时间→透明度的换算，便于单测
    nextWaveLabel: nextWaveLabel,   // 纯函数：HUD 倒计时文案
    panelSubText: panelSubText      // 纯函数：结算面板第二行文案
  };
})(globalThis);
