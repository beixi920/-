/* 单骑 · 汉字塔防 —— 局外循环：金币 / 军衔 / 武器
 * 规矩：纯逻辑，只读写传进来的 profile / balance，不碰 DOM / Canvas / window。
 *
 * profile = {
 *   gold, rank, stars,                  金币 / 段位下标 / 本段星数
 *   inventory: [{ id, defId }],         武器背包；id 是实例唯一号，defId 指向 balance.weapons.list
 *   equipped:  { heroKey: weaponId },  武将 → 背包里那把武器的 id
 *   seed                                掉落随机种子（seeded rng，禁止 Math.random）
 * }
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};

  function createProfile(balance) {
    return {
      gold: balance.meta.startGold,
      rank: 0,
      stars: 0,
      inventory: [],
      equipped: {},
      seed: balance.meta.dropSeed
    };
  }

  function rankName(profile, balance) {
    var list = balance.meta.ranks;
    return list[Math.max(0, Math.min(list.length - 1, profile.rank))];
  }

  /** starLabel —— 实心★ + 空心☆，长度恒等于每段星数（满星皇帝会显示 3 颗）。 */
  function starLabel(profile, balance) {
    var n = balance.meta.starsPerRank;
    var out = '';
    for (var i = 0; i < n; i++) {
      out += i < profile.stars ? '★' : '☆';
    }
    return out;
  }

  /** addGold —— 单独加金币（结算与测试用），返回加完后的总数。 */
  function addGold(profile, amount, balance) {
    profile.gold += amount;
    return profile.gold;
  }

  /* ============ 武器 ============ */

  function weaponDef(balance, defId) {
    var list = balance.weapons.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === defId) {
        return list[i];
      }
    }
    return null;
  }

  function findWeapon(profile, weaponId) {
    for (var i = 0; i < profile.inventory.length; i++) {
      if (profile.inventory[i].id === weaponId) {
        return profile.inventory[i];
      }
    }
    return null;
  }

  /**
   * rollWeaponDrop —— 胜利掉 1 把：先按概率抽品质，再从该品质里等概率抽一件。
   * 随机走 profile.seed（seeded rng），刷新后从存档里的 seed 续上，不会重刷同一把。
   */
  function rollWeaponDrop(profile, balance) {
    var cfg = balance.weapons;
    var chances = cfg.dropChance;
    var keys = Object.keys(chances);
    var total = 0;
    var i;

    for (i = 0; i < keys.length; i++) {
      total += chances[keys[i]];
    }

    var roll = Game.rng.next(profile) * total;
    var quality = keys[keys.length - 1];
    var acc = 0;
    for (i = 0; i < keys.length; i++) {
      acc += chances[keys[i]];
      if (roll < acc) {
        quality = keys[i];
        break;
      }
    }

    var pool = [];
    for (i = 0; i < cfg.list.length; i++) {
      if (cfg.list[i].quality === quality) {
        pool.push(cfg.list[i]);
      }
    }
    if (!pool.length) {
      return null;
    }

    var def = pool[Game.rng.int(profile, pool.length)];
    var item = { id: profile.inventory.length + 1, defId: def.id };
    profile.inventory.push(item);

    return { id: item.id, name: def.name, quality: def.quality, bonus: def.bonus };
  }

  /**
   * equip —— 把背包里某把武器装到某个武将（按 heroKey 绑定）。
   * 同一武将只留一把（覆盖旧的），同一把武器只能装一处（先从别人身上摘掉）。
   */
  function equip(profile, weaponId, heroKey, balance) {
    if (!findWeapon(profile, weaponId) || !heroKey) {
      return false;
    }
    for (var k in profile.equipped) {
      if (profile.equipped[k] === weaponId) {
        delete profile.equipped[k];
      }
    }
    profile.equipped[heroKey] = weaponId;
    return true;
  }

  /** unequip —— 把某把武器从所有武将身上摘下来，返回是否真的摘到了。 */
  function unequip(profile, weaponId) {
    var removed = false;
    for (var k in profile.equipped) {
      if (profile.equipped[k] === weaponId) {
        delete profile.equipped[k];
        removed = true;
      }
    }
    return removed;
  }

  /** weaponBonus —— 某个武将当前装备提供的伤害倍率增量（没装就是 0）。 */
  function weaponBonus(profile, heroKey, balance) {
    var id = profile.equipped[heroKey];
    if (id === undefined) {
      return 0;
    }
    var item = findWeapon(profile, id);
    if (!item) {
      return 0;
    }
    var def = weaponDef(balance, item.defId);
    return def ? def.bonus : 0;
  }

  /** heroBonusMap —— 开局时算成 { heroKey: bonus }，交给 state.heroBonus。 */
  function heroBonusMap(profile, balance) {
    var map = {};
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      map[list[i].key] = weaponBonus(profile, list[i].key, balance);
    }
    return map;
  }

  /**
   * applyResult —— 一局结束：发金币、胜 +1 星 / 负 −1 星、升段或掉段、胜利掉 1 把武器。
   * 攒满 3 星 → 升一段并归零；星掉到 0 以下 → 掉一段并补成 2 星。
   * 两端封顶：皇帝满 3 星不再升，军士 0 星不再掉。
   * 返回的 report 只给界面显示用，界面不自己算任何数值。
   */
  function applyResult(profile, win, balance) {
    var cfg = balance.meta;
    var maxRank = cfg.ranks.length - 1;
    var goldDelta = win ? cfg.winGold : cfg.loseGold;
    var starDelta = win ? 1 : -1;
    var rankChanged = '';

    profile.gold += goldDelta;
    profile.stars += starDelta;

    if (profile.stars >= cfg.starsPerRank) {
      if (profile.rank < maxRank) {
        profile.rank += 1;
        profile.stars = 0;
        rankChanged = 'up';
      } else {
        profile.stars = cfg.starsPerRank;      // 皇帝满星封顶
      }
    } else if (profile.stars < 0) {
      if (profile.rank > 0) {
        profile.rank -= 1;
        profile.stars = cfg.starsPerRank - 1; // 掉段后是上一段的 2 星
        rankChanged = 'down';
      } else {
        profile.stars = 0;                    // 军士 0 星保底
      }
    }

    return {
      goldDelta: goldDelta,
      goldAfter: profile.gold,
      starDelta: starDelta,
      rankChanged: rankChanged,
      rankName: rankName(profile, balance),
      starLabel: starLabel(profile, balance),
      starsAfter: profile.stars,
      drop: win ? rollWeaponDrop(profile, balance) : null
    };
  }

  Game.meta = {
    createProfile: createProfile,
    addGold: addGold,
    applyResult: applyResult,
    rankName: rankName,
    starLabel: starLabel,
    weaponDef: weaponDef,
    findWeapon: findWeapon,
    rollWeaponDrop: rollWeaponDrop,
    equip: equip,
    unequip: unequip,
    weaponBonus: weaponBonus,
    heroBonusMap: heroBonusMap
  };
})(globalThis);
