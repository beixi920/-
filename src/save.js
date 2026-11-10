/* 单骑 · 汉字塔防 —— 存档（localStorage）
 * 规矩：读写都包在 try/catch 里；任何坏档（非法 JSON / 旧版本 / 字段缺失 / 字段对不上）
 *       一律回退成新档，绝不把异常抛给界面（不白屏）。
 *
 * 存档 key 用 sr_save，与已有的 sr_started / sr_difficulty 同前缀；
 * 难度选择继续沿用 sr_difficulty，本文件不碰它。
 */
(function (global) {
  'use strict';

  var Game = global.Game = global.Game || {};
  var KEY = 'sr_save';

  function newProfile(balance) {
    return Game.meta.createProfile(balance);
  }

  /**
   * migrate —— 版本迁移。
   * 当前只有 v1：version 不等于 v1（缺失、旧版、未来版本）都视为无法迁移 → null → 新档。
   * 以后加字段时把 saveVersion +1，并在这里补「v1 → v2」的升级分支即可。
   */
  function migrate(raw, balance) {
    if (!raw || typeof raw !== 'object' || raw.version !== balance.meta.saveVersion) {
      return null;
    }
    return raw;
  }

  function heroKeyExists(balance, key) {
    var list = balance.heroes.list;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) {
        return true;
      }
    }
    return false;
  }

  function hasWeapon(inventory, weaponId) {
    for (var i = 0; i < inventory.length; i++) {
      if (inventory[i].id === weaponId) {
        return true;
      }
    }
    return false;
  }

  /**
   * normalize —— 字段齐全、类型合法、引用能对上才算一份好档。
   * 任何一项不合格返回 null，由 load() 回退新档。
   */
  function normalize(raw, balance) {
    if (!isFinite(raw.gold) || raw.gold < 0 || !isFinite(raw.seed) ||
        !isFinite(raw.rank) || !isFinite(raw.stars)) {
      return null;
    }
    if (raw.rank < 0 || raw.rank >= balance.meta.ranks.length) {
      return null;
    }
    if (raw.stars < 0 || raw.stars > balance.meta.starsPerRank) {
      return null;
    }
    if (!Array.isArray(raw.inventory) || !raw.equipped ||
        typeof raw.equipped !== 'object' || Array.isArray(raw.equipped)) {
      return null;
    }

    for (var i = 0; i < raw.inventory.length; i++) {
      var it = raw.inventory[i];
      if (!it || !isFinite(it.id) || typeof it.defId !== 'string') {
        return null;
      }
      if (!Game.meta.weaponDef(balance, it.defId)) {
        return null;
      }
    }

    for (var key in raw.equipped) {
      if (!heroKeyExists(balance, key) || !hasWeapon(raw.inventory, raw.equipped[key])) {
        return null;
      }
    }

    var p = newProfile(balance);
    p.gold = raw.gold;
    p.rank = raw.rank;
    p.stars = raw.stars;
    p.seed = raw.seed >>> 0;
    p.inventory = raw.inventory;
    p.equipped = raw.equipped;
    return p;
  }

  /** load —— 读档；失败一律返回新档。 */
  function load(balance) {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) {
        return newProfile(balance);
      }
      var parsed = JSON.parse(raw);
      var migrated = migrate(parsed, balance);
      if (!migrated) {
        return newProfile(balance);
      }
      return normalize(migrated, balance) || newProfile(balance);
    } catch (err) {
      return newProfile(balance);
    }
  }

  /** write —— 写档（白名单字段，内存里的临时状态不落盘）。 */
  function write(profile, balance) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify({
        version: balance.meta.saveVersion,
        gold: profile.gold,
        rank: profile.rank,
        stars: profile.stars,
        inventory: profile.inventory,
        equipped: profile.equipped,
        seed: profile.seed
      }));
      return true;
    } catch (err) {
      return false;
    }
  }

  /** clear —— 清空存档（按钮二次确认后调用）。 */
  function clear() {
    try {
      global.localStorage.removeItem(KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  Game.save = {
    KEY: KEY,
    load: load,
    write: write,
    clear: clear,
    migrate: migrate
  };
})(globalThis);
