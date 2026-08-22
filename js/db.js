/* db.js — IndexedDB access layer. No app logic lives here. */
(function (root) {
  'use strict';

  var NAME = 'poketdaily';
  var VERSION = 1;
  var STORES = ['plan', 'logs', 'accounts', 'checklist', 'settings'];
  var _db = null;

  function open() {
    return new Promise(function (resolve, reject) {
      if (_db) return resolve(_db);
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        STORES.forEach(function (s) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        });
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(store, mode) {
    return open().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function all(store) {
    return tx(store, 'readonly').then(function (os) {
      return new Promise(function (res, rej) {
        var r = os.getAll();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function put(store, obj) {
    return tx(store, 'readwrite').then(function (os) {
      return new Promise(function (res, rej) {
        var r = os.put(obj);
        r.onsuccess = function () { res(obj); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function del(store, id) {
    return tx(store, 'readwrite').then(function (os) {
      return new Promise(function (res, rej) {
        var r = os.delete(id);
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function clear(store) {
    return tx(store, 'readwrite').then(function (os) {
      return new Promise(function (res, rej) {
        var r = os.clear();
        r.onsuccess = function () { res(); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }

  function putMany(store, list) {
    return tx(store, 'readwrite').then(function (os) {
      return new Promise(function (res, rej) {
        if (!list.length) return res();
        var left = list.length;
        list.forEach(function (o) {
          var r = os.put(o);
          r.onsuccess = function () { if (--left === 0) res(); };
          r.onerror = function () { rej(r.error); };
        });
      });
    });
  }

  root.DB = {
    STORES: STORES,
    open: open,
    all: all,
    put: put,
    del: del,
    clear: clear,
    putMany: putMany
  };
})(typeof self !== 'undefined' ? self : globalThis);
