/* charts.js — dependency-free SVG charts. Takes already-computed series from
   Calc; never does its own money maths. */
(function (root) {
  'use strict';

  function esc(s) { return root.UI ? root.UI.esc(s) : String(s); }

  /* Catmull-Rom -> cubic bezier, so lines read as curves not zigzags. */
  function curvePath(pts) {
    if (!pts.length) return '';
    if (pts.length < 3) return 'M' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' L');
    var d = 'M' + pts[0].x + ',' + pts[0].y;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) +
        ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
    }
    return d;
  }

  /* series: [{label, value}], forecast: optional [{label,value}] continuing on */
  function line(series, opts) {
    opts = opts || {};
    var W = opts.width || 340, H = opts.height || 190;
    var padL = 8, padR = 8, padT = 14, padB = 26;
    var all = series.concat(opts.forecast || []);
    if (!all.length) return '<div class="chart-empty">Nothing logged yet.</div>';
    var vals = all.map(function (p) { return p.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var span = max - min, headroom = span * 0.15;
    min -= headroom; max += headroom;
    var n = all.length;
    var xAt = function (i) { return padL + (n === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1)); };
    var yAt = function (v) { return padT + (max - v) / (max - min) * (H - padT - padB); };

    var mainPts = series.map(function (p, i) { return { x: xAt(i), y: yAt(p.value) }; });
    var fcPts = (opts.forecast || []).map(function (p, i) { return { x: xAt(series.length + i), y: yAt(p.value) }; });
    if (mainPts.length && fcPts.length) fcPts.unshift(mainPts[mainPts.length - 1]);

    var area = mainPts.length > 1
      ? curvePath(mainPts) + ' L' + mainPts[mainPts.length - 1].x + ',' + (H - padB) + ' L' + mainPts[0].x + ',' + (H - padB) + ' Z'
      : '';

    var zeroLine = (min < 0 && max > 0)
      ? '<line class="chart-zero" x1="' + padL + '" y1="' + yAt(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yAt(0).toFixed(1) + '"/>' : '';

    var labels = '';
    var idxs = n <= 4 ? all.map(function (_, i) { return i; }) : [0, Math.floor((n - 1) / 2), n - 1];
    idxs.forEach(function (i) {
      var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      labels += '<text class="chart-xlab" x="' + xAt(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' +
        esc(shortLabel(all[i].label)) + '</text>';
    });

    var lastMain = mainPts[mainPts.length - 1];
    var dots = lastMain ? '<circle class="chart-dot" cx="' + lastMain.x.toFixed(1) + '" cy="' + lastMain.y.toFixed(1) + '" r="4"/>' : '';

    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || 'Balance over time') + '">' +
      '<defs><linearGradient id="cg-' + (opts.id || 'a') + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" class="cg-top"/><stop offset="100%" class="cg-bot"/></linearGradient></defs>' +
      (area ? '<path class="chart-area" fill="url(#cg-' + (opts.id || 'a') + ')" d="' + area + '"/>' : '') +
      zeroLine +
      '<path class="chart-line" d="' + curvePath(mainPts) + '"/>' +
      (fcPts.length > 1 ? '<path class="chart-forecast" d="' + curvePath(fcPts) + '"/>' : '') +
      dots + labels +
      '</svg>';
  }

  function shortLabel(l) {
    if (!l) return '';
    var s = String(l);
    if (s.length <= 12) return s;
    return s.slice(0, 11) + '…';
  }

  /* slices: [{name, amount, share}] */
  function doughnut(slices, opts) {
    opts = opts || {};
    var size = opts.size || 200, r = size / 2, inner = r * 0.62, cx = r, cy = r;
    if (!slices.length) return '<div class="chart-empty">Nothing to break down yet.</div>';
    var a0 = -Math.PI / 2, out = '';
    slices.forEach(function (s, i) {
      var frac = Math.max(s.share, 0.0001);
      var a1 = a0 + frac * Math.PI * 2;
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      var p = function (ang, rad) { return [(cx + rad * Math.cos(ang)).toFixed(2), (cy + rad * Math.sin(ang)).toFixed(2)]; };
      var o0 = p(a0, r - 2), o1 = p(a1, r - 2), i1 = p(a1, inner), i0 = p(a0, inner);
      /* data-i is how the Breakdown tab ties a slice to its list row; the
         path is focusable so the chart is usable without a pointer. */
      out += '<path class="slice" data-i="' + i + '" tabindex="0" role="button"' +
        ' aria-label="' + esc(s.name) + '" fill="var(--cat-' + (i % 8) + ')" d="M' + o0 +
        ' A' + (r - 2) + ',' + (r - 2) + ' 0 ' + large + ' 1 ' + o1 +
        ' L' + i1 + ' A' + inner + ',' + inner + ' 0 ' + large + ' 0 ' + i0 + ' Z"><title>' + esc(s.name) + '</title></path>';
      a0 = a1;
    });
    return '<svg class="doughnut" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Spending by category">' + out +
      (opts.centerTop ? '<text class="dn-top" x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle">' + esc(opts.centerTop) + '</text>' : '') +
      (opts.centerSub ? '<text class="dn-sub" x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle">' + esc(opts.centerSub) + '</text>' : '') +
      '</svg>';
  }

  /* The signature: one tick per day of the cycle.
     bars: [{iso, spend, allowance, state:'past'|'today'|'future'|'pre'}]
     'pre' is a day before budgeting began — it carries no allowance, so it is
     drawn like a future day rather than judged against a rate it never had. */
  function dayStrip(bars, opts) {
    opts = opts || {};
    var W = opts.width || 320, H = 44, gap = 1.5;
    var n = bars.length || 1;
    var bw = Math.max(1.5, (W - gap * (n - 1)) / n);
    var peak = Math.max.apply(null, bars.map(function (b) { return b.spend; }).concat([1]));
    /* Scale and reference line come from the first bar that HAS an allowance,
       not bars[0], which is zero for a cycle joined part-way through. */
    var ref = bars.filter(function (b) { return b.allowance > 0; })[0] || bars[0] || { allowance: 1 };
    var scale = Math.max(peak, ref.allowance * 1.4);
    var out = '';
    bars.forEach(function (b, i) {
      var x = i * (bw + gap);
      var h = Math.max(1.5, Math.min(1, b.spend / scale) * (H - 10));
      var cls = (b.state === 'future' || b.state === 'pre') ? 'ds-future'
        : (b.spend > b.allowance ? 'ds-over' : 'ds-under');
      if (b.state === 'today') cls += ' ds-today';
      out += '<rect class="' + cls + '" x="' + x.toFixed(2) + '" y="' + (H - h).toFixed(2) + '" width="' + bw.toFixed(2) +
        '" height="' + h.toFixed(2) + '" rx="' + Math.min(1.5, bw / 2).toFixed(2) + '"><title>' +
        esc(b.label + ': ' + b.spendLabel) + '</title></rect>';
    });
    var line = (H - Math.min(1, ref.allowance / scale) * (H - 10)).toFixed(2);
    return '<svg class="daystrip" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Daily spending across this cycle">' +
      '<line class="ds-line" x1="0" y1="' + line + '" x2="' + W + '" y2="' + line + '"/>' + out + '</svg>';
  }

  root.Charts = { line: line, doughnut: doughnut, dayStrip: dayStrip };
})(typeof self !== 'undefined' ? self : globalThis);
