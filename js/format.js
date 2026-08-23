/* format.js — money formatting, ids, and the cent-first numeric input. */
(function (root) {
  'use strict';

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function group(n) {
    var neg = n < 0;
    var s = Math.abs(round2(n)).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  /* money(1234.5) -> "RM1,234.50" */
  function money(n, symbol) {
    var sym = symbol || (root.S && root.S.settings && root.S.settings.currency) || 'RM';
    var v = round2(n || 0);
    var neg = v < 0;
    return (neg ? '-' : '') + sym + group(Math.abs(v));
  }

  function moneyShort(n, symbol) {
    var sym = symbol || (root.S && root.S.settings && root.S.settings.currency) || 'RM';
    var v = Math.abs(n || 0);
    var s = v >= 1000000 ? (v / 1000000).toFixed(1) + 'm'
      : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'
        : String(Math.round(v));
    return (n < 0 ? '-' : '') + sym + s;
  }

  /* ---- Cent-first input -------------------------------------------------
     Digits fill from the cents place, like a POS terminal: "123" -> 1.23.
     Attach with CentInput.bind(inputEl). Read with CentInput.value(el). */
  var CentInput = {
    bind: function (el, initialAmount) {
      el.type = 'text';
      el.inputMode = 'numeric';
      el.autocomplete = 'off';
      el.dataset.digits = initialAmount != null && initialAmount !== ''
        ? String(Math.round(Math.abs(initialAmount) * 100)) : '';
      var paint = function () {
        var d = el.dataset.digits || '';
        el.value = d === '' ? '' : money(parseInt(d, 10) / 100);
      };
      var push = function (ch) {
        var d = (el.dataset.digits || '') + ch;
        d = d.replace(/^0+(?=\d)/, '');
        if (d.length > 12) return;
        el.dataset.digits = d;
      };
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace') {
          e.preventDefault();
          el.dataset.digits = (el.dataset.digits || '').slice(0, -1);
          paint();
        } else if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          push(e.key);
          paint();
        } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
        }
      });
      el.addEventListener('input', function () {
        /* covers mobile keyboards that don't fire usable keydown */
        var typed = el.value.replace(/[^0-9]/g, '');
        var current = el.dataset.digits || '';
        if (typed !== current) {
          el.dataset.digits = typed.replace(/^0+(?=\d)/, '').slice(0, 12);
        }
        paint();
      });
      el.addEventListener('focus', function () {
        setTimeout(function () { el.setSelectionRange(el.value.length, el.value.length); }, 0);
      });
      paint();
      return el;
    },
    value: function (el) {
      var d = el.dataset.digits || '';
      return d === '' ? 0 : round2(parseInt(d, 10) / 100);
    },
    /* Set the value from code. It has to paint el.value itself before firing
       'input': that handler re-reads el.value to catch mobile keyboards, so
       leaving the old text there made it overwrite the digits we just set and
       the call did nothing at all. */
    set: function (el, amount) {
      var digits = amount ? String(Math.round(Math.abs(amount) * 100)) : '';
      el.dataset.digits = digits;
      el.value = digits === '' ? '' : money(parseInt(digits, 10) / 100);
      el.dispatchEvent(new Event('input'));
    }
  };

  root.Fmt = {
    uid: uid, round2: round2, money: money, moneyShort: moneyShort, group: group
  };
  root.CentInput = CentInput;
})(typeof self !== 'undefined' ? self : globalThis);
