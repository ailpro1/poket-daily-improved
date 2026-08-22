/* ui.js — shared UI primitives. No money maths here; ask Calc for numbers. */
(function (root) {
  'use strict';

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'dataset') Object.keys(attrs[k]).forEach(function (d) { e.dataset[d] = attrs[k][d]; });
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms || 8); }

  /* ---------- sheet (bottom modal) --------------------------------------- */
  var openSheets = [];

  function sheet(opts) {
    var body = el('div', { class: 'sheet-body' });
    var closeBtn = el('button', { class: 'icon-btn', 'aria-label': 'Close', html: '&times;', onclick: function () { close(); } });
    var head = el('header', { class: 'sheet-head' }, [
      el('h2', { class: 'sheet-title', text: opts.title || '' }),
      closeBtn
    ]);
    var panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' }, [head, body]);
    var scrim = el('div', { class: 'scrim', onclick: function () { if (opts.dismissible !== false) close(); } });
    var wrap = el('div', { class: 'sheet-wrap' }, [scrim, panel]);
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(function () { wrap.classList.add('open'); });

    function close(result) {
      wrap.classList.remove('open');
      setTimeout(function () {
        wrap.remove();
        openSheets = openSheets.filter(function (s) { return s !== api; });
        if (!openSheets.length) {
          document.body.classList.remove('no-scroll');
          flushIdle();
        }
      }, 220);
      if (opts.onClose) opts.onClose(result);
    }

    var api = { el: panel, body: body, close: close };
    openSheets.push(api);
    if (opts.render) opts.render(body, api);
    var first = body.querySelector('input, select, textarea, button');
    if (first && opts.autofocus !== false) setTimeout(function () { first.focus(); }, 260);
    return api;
  }

  function closeTopSheet() { if (openSheets.length) openSheets[openSheets.length - 1].close(); }

  /* Is the user in the middle of something? Used by anything that must not
     interrupt a half-filled form — a reload for a new app version, say. */
  function busy() { return openSheets.length > 0; }

  var idleWaiters = [];

  function onIdle(fn) {
    if (!busy()) { fn(); return; }
    idleWaiters.push(fn);
  }

  function flushIdle() {
    var fns = idleWaiters;
    idleWaiters = [];
    fns.forEach(function (f) { f(); });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeTopSheet();
  });

  /* ---------- toast + undo ----------------------------------------------- */
  var toastTimer = null;

  function toast(message, opts) {
    opts = opts || {};
    var host = $('#toast-host');
    host.innerHTML = '';
    clearInterval(toastTimer);
    var seconds = opts.seconds || 0;
    var count = el('span', { class: 'toast-count', text: seconds ? String(seconds) : '' });
    var node = el('div', { class: 'toast' + (opts.tone ? ' toast-' + opts.tone : '') }, [
      el('span', { class: 'toast-msg', text: message })
    ]);
    if (opts.actionLabel) {
      node.appendChild(el('button', {
        class: 'toast-action',
        onclick: function () { clearInterval(toastTimer); host.innerHTML = ''; opts.onAction && opts.onAction(); }
      }, [document.createTextNode(opts.actionLabel), count]));
    }
    host.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('in'); });
    var left = seconds || 3;
    toastTimer = setInterval(function () {
      left -= 1;
      count.textContent = seconds && left > 0 ? String(left) : '';
      if (left <= 0) {
        clearInterval(toastTimer);
        node.classList.remove('in');
        setTimeout(function () { if (node.parentNode) node.remove(); }, 220);
        if (opts.onExpire) opts.onExpire();
      }
    }, 1000);
  }

  /* ---------- update bar -------------------------------------------------
     A persistent strip along the bottom while a new version installs. Not a
     toast: toast() wipes its whole host on every call, and this has to
     outlive whatever else the app happens to be saying. Borrows the toast's
     looks, positions itself, and sits above the splash — a first-open update
     lands while the artwork is still holding the screen.
     Call updateBar(false) to take it away. */
  var updateNode = null;

  function updateBar(message, opts) {
    opts = opts || {};
    if (message === false) {
      if (!updateNode) return null;
      var going = updateNode;
      updateNode = null;
      going.classList.remove('in');
      setTimeout(function () { if (going.parentNode) going.remove(); }, 220);
      return null;
    }
    if (!updateNode) {
      updateNode = el('div', { class: 'toast update-bar', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(updateNode);
      requestAnimationFrame(function () { updateNode.classList.add('in'); });
    }
    updateNode.innerHTML = '';
    updateNode.appendChild(el('span', { class: 'toast-msg', text: message }));
    if (opts.actionLabel) {
      updateNode.appendChild(el('button', {
        class: 'toast-action', text: opts.actionLabel, onclick: opts.onAction
      }));
    }
    return updateNode;
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var s = sheet({
        title: opts.title || 'Are you sure?',
        render: function (body) {
          body.appendChild(el('p', { class: 'sheet-note', text: opts.message || '' }));
          body.appendChild(el('div', { class: 'row-actions' }, [
            el('button', { class: 'btn btn-ghost', text: opts.cancelLabel || 'Cancel', onclick: function () { s.close(); resolve(false); } }),
            el('button', {
              class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
              text: opts.confirmLabel || 'Confirm',
              onclick: function () { s.close(); resolve(true); }
            })
          ]));
        },
        onClose: function () { resolve(false); }
      });
    });
  }

  /* ---------- small form builders ---------------------------------------- */

  function field(label, control, hint) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: label }),
      control,
      hint ? el('span', { class: 'field-hint', text: hint }) : null
    ]);
  }

  function select(options, value, attrs) {
    var s = el('select', Object.assign({ class: 'input' }, attrs || {}));
    options.forEach(function (o) {
      var opt = el('option', { value: o.value, text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }

  function segmented(options, value, onChange) {
    var wrap = el('div', { class: 'segmented', role: 'tablist' });
    options.forEach(function (o) {
      var b = el('button', {
        class: 'seg' + (String(o.value) === String(value) ? ' on' : ''),
        type: 'button',
        text: o.label,
        onclick: function () {
          $$('.seg', wrap).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          onChange(o.value);
        }
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function emptyState(title, message, actionLabel, onAction) {
    return el('div', { class: 'empty' }, [
      el('p', { class: 'empty-title', text: title }),
      el('p', { class: 'empty-msg', text: message }),
      actionLabel ? el('button', { class: 'btn btn-primary', text: actionLabel, onclick: onAction }) : null
    ]);
  }

  root.UI = {
    $: $, $$: $$, el: el, esc: esc, buzz: buzz,
    sheet: sheet, toast: toast, confirm: confirmDialog,
    updateBar: updateBar, busy: busy, onIdle: onIdle,
    field: field, select: select, segmented: segmented, emptyState: emptyState
  };
})(typeof self !== 'undefined' ? self : globalThis);
