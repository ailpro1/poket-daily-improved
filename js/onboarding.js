/* onboarding.js — accounts first, plan second. Getting starting balances right
   is the whole point (spec 11). */
(function (root) {
  'use strict';

  var UI = root.UI, el = UI.el, Calc = root.Calc, Fmt = root.Fmt;

  function progressDots(step) {
    var wrap = el('div', { class: 'dots' });
    [0, 1, 2, 3].forEach(function (i) {
      wrap.appendChild(el('span', { class: 'dot' + (i === step ? ' on' : (i < step ? ' done' : '')) }));
    });
    return wrap;
  }

  function open(startStep) {
    var step = startStep || 0;
    var s = UI.sheet({
      title: 'Set up Poket Daily',
      render: function (body, api) { paint(body, api); }
    });

    function paint(body, api) {
      body.innerHTML = '';
      body.appendChild(progressDots(step));

      if (step === 0) {
        body.appendChild(el('h3', { class: 'ob-title', text: 'Two kinds of number' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Monthly Balance and Savings Balance show what you actually have — they are added up straight from your accounts.' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'The daily budget on Home is a forecast built from your Plan. Different job, different number.' }));
        body.appendChild(el('p', { class: 'ob-copy strong', text: 'Set up accounts first, Plan second. Skipping account setup is what makes those balances read zero later.' }));
        next(body, api, 'Start with accounts');
      }

      if (step === 1) {
        var gens = Calc.accountsOfType('general');
        body.appendChild(el('h3', { class: 'ob-title', text: 'Add your main spending account' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Checking account, wallet, e-wallet — whatever you actually pay with day to day.' }));
        body.appendChild(el('p', { class: 'ob-copy strong', text: 'Check your bank app right now and enter what is actually there. That figure becomes your Monthly Balance.' }));
        body.appendChild(existingList(gens));
        body.appendChild(el('button', {
          class: 'btn btn-primary btn-block', text: gens.length ? '+ Add another spending account' : '+ Add spending account',
          onclick: function () {
            root.Forms.account(null, { type: 'general', onSaved: function () { paint(body, api); } });
          }
        }));
        if (gens.length) next(body, api, 'Next: savings');
        else skipRow(body, api);
      }

      if (step === 2) {
        var savs = Calc.accountsOfType('saving');
        body.appendChild(el('h3', { class: 'ob-title', text: 'Keep savings separate?' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'ASB, fixed deposit, digital bank, tabung — add it here and its balance becomes your Savings Balance straight away. Optional.' }));
        body.appendChild(existingList(savs));
        body.appendChild(el('button', {
          class: 'btn btn-ghost btn-block', text: savs.length ? '+ Add another saving account' : '+ Add saving account',
          onclick: function () {
            root.Forms.account(null, { type: 'saving', onSaved: function () { paint(body, api); } });
          }
        }));
        next(body, api, 'Next: your plan');
      }

      if (step === 3) {
        body.appendChild(el('h3', { class: 'ob-title', text: 'Now set up your Plan' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'Income, commitments and savings goals. Each one gets assigned to an account you just created.' }));
        body.appendChild(el('p', { class: 'ob-copy', text: 'This powers the Daily Spending Budget forecast — separate from the account totals you just entered.' }));
        body.appendChild(el('div', { class: 'ob-summary' }, [
          summaryRow('Monthly Balance', Calc.monthlyBalance()),
          summaryRow('Savings Balance', Calc.savingsBalance())
        ]));
        body.appendChild(el('button', {
          class: 'btn btn-primary btn-block', text: 'Open the Plan tab',
          onclick: function () {
            finish();
            api.close();
            root.App.go('plan');
          }
        }));
        body.appendChild(el('button', {
          class: 'btn btn-ghost btn-block', text: 'Do this later',
          onclick: function () { finish(); api.close(); }
        }));
      }
    }

    function next(body, api, label) {
      body.appendChild(el('button', {
        class: 'btn btn-primary btn-block', text: label,
        onclick: function () { step += 1; paint(body, api); }
      }));
      if (step < 3) skipRow(body, api);
    }

    function skipRow(body, api) {
      body.appendChild(el('button', {
        class: 'btn btn-ghost btn-block btn-sm', text: 'Skip setup',
        onclick: function () {
          UI.confirm({
            title: 'Skip account setup?',
            message: 'Monthly Balance and Savings Balance will read zero until you add accounts with their real starting balances. You can restart this guide from Settings.',
            confirmLabel: 'Skip anyway'
          }).then(function (ok) { if (ok) { finish(); api.close(); } });
        }
      }));
    }

    function existingList(accs) {
      if (!accs.length) return el('p', { class: 'card-note', text: 'None added yet.' });
      var ul = el('ul', { class: 'mini-list' });
      accs.forEach(function (a) {
        ul.appendChild(el('li', {}, [
          el('span', { text: a.icon + ' ' + a.name }),
          el('b', { class: 'num', text: Fmt.money(Calc.accountBalance(a.id)) })
        ]));
      });
      return ul;
    }

    function summaryRow(label, value) {
      return el('div', { class: 'ob-sum-row' }, [
        el('span', { class: 'eyebrow', text: label }),
        el('b', { class: 'num', text: Fmt.money(value) })
      ]);
    }

    function finish() {
      root.Actions.saveSettings({ onboarded: true });
    }

    return s;
  }

  root.Onboarding = { open: open };
})(typeof self !== 'undefined' ? self : globalThis);
