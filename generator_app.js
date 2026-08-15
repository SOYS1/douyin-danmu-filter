/* app.js — UI + interaction for the danmaku shield-regex generator (V2).
   Depends on core.js (window.DC). Classic script (works on file://). */
(function () {
  'use strict';
  var DC = window.DC;

  // varied highlight palette; each confirmed shield word gets one
  var PALETTE = [
    { fg: '#9a5b00', bg: '#fbeacb' }, // amber
    { fg: '#2f4dc0', bg: '#e9edfd' }, // indigo
    { fg: '#ad2e7e', bg: '#f9dfee' }, // magenta
    { fg: '#6a3fb0', bg: '#f0e8fb' }, // violet
    { fg: '#0e7c9a', bg: '#d4f0f6' }, // cyan
    { fg: '#5f7d1a', bg: '#eef3d6' }  // lime
  ];
  function colorOf(i) { return PALETTE[i % PALETTE.length]; }

  var EXAMPLE_POS = ['第一', '你不是第一了', '第一第一名是假的'];
  var EXAMPLE_NEG = ['第一次玩'];

  var state = {
    loaded: false,
    positives: [],
    negatives: [],
    candidates: [],
    shieldWords: [],     // [{word, color}]
    special: {},         // {rowIndex: 'all'|'first'|'exclude'}
    selection: null,     // {row, a, b}
    activeRow: 0,
    undoStack: [],
    copyFmt: 'js',       // 'js' | 'pattern'
    flags: { g: true, i: false }
  };
  var UNDO_CAP = 60;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '\x26amp;').replace(/</g, '\x26lt;').replace(/>/g, '\x26gt;')
      .replace(/"/g, '\x26quot;').replace(/'/g, '\x26#39;');
  }
  function parseLines(t) {
    if (!t) return [];
    return t.replace(/\r/g, '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function dedupe(a) {
    var s = {}, out = [];
    for (var i = 0; i < a.length; i++) { if (!s[a[i]]) { s[a[i]] = 1; out.push(a[i]); } }
    return out;
  }

  // ---- toast ----
  var toastTimer = null;
  function toast(msg) {
    var t = el('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.hidden = true; }, 220); }, 1500);
  }

  // ---- clipboard ----
  function copyText(str) {
    if (!str) { toast('无内容可复制'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(function () { toast('已复制'); }, function () { fallbackCopy(str); });
    } else { fallbackCopy(str); }
  }
  function fallbackCopy(str) {
    var ta = document.createElement('textarea');
    ta.value = str; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动复制'); }
    document.body.removeChild(ta);
  }

  // ---- flag/format helpers ----
  function flagsStr() { return (state.flags.g ? 'g' : '') + (state.flags.i ? 'i' : ''); }
  function fmt(pattern) { return state.copyFmt === 'js' ? DC.toLiteral(pattern, flagsStr()) : pattern; }

  // ---- loading ----
  function loadDanmaku() {
    var pos = dedupe(parseLines(el('posInput').value));
    var neg = dedupe(parseLines(el('negInput').value));
    if (pos.length === 0 && neg.length === 0) { toast('请先输入弹幕'); return; }
    state.loaded = true;
    state.positives = pos;
    state.negatives = neg;
    state.shieldWords = [];
    state.undoStack = [];
    state.special = {};
    state.selection = null;
    state.activeRow = pos.length ? 0 : 0;
    state.candidates = DC.findCommonCandidates(pos);
    // auto-confirm top candidate as a starting suggestion (user can remove)
    if (state.candidates.length > 0) {
      state.shieldWords.push({ word: state.candidates[0].word, color: 0 });
    }
    state.positives.forEach(function (_, i) { if (!state.special[i]) state.special[i] = 'all'; });
    // pre-fill test area with the loaded danmaku for instant feedback
    el('testInput').value = pos.concat(neg).join('\n');
    renderAll();
    toast('已载入 ' + pos.length + ' 条正向 / ' + neg.length + ' 条反向');
    el('step-confirm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearAll() {
    state.loaded = false;
    state.positives = []; state.negatives = [];
    state.shieldWords = []; state.candidates = []; state.special = {};
    state.selection = null; state.undoStack = [];
    el('posInput').value = ''; el('negInput').value = ''; el('testInput').value = '';
    renderAll();
    toast('已清空');
  }

  function loadExample() {
    el('posInput').value = EXAMPLE_POS.join('\n');
    el('negInput').value = EXAMPLE_NEG.join('\n');
    loadDanmaku();
  }

  // ---- shield word mutations ----
  function assignColor() { return state.shieldWords.length; }
  function pushUndo() {
    state.undoStack.push(JSON.stringify(state.shieldWords));
    if (state.undoStack.length > UNDO_CAP) state.undoStack.shift();
  }
  function undo() {
    if (state.undoStack.length === 0) { toast('没有可撤销的操作'); return; }
    state.shieldWords = JSON.parse(state.undoStack.pop());
    renderAll();
    toast('已撤销');
  }
  function addShieldWord(word) {
    if (!word) return;
    if (state.shieldWords.some(function (w) { return w.word === word; })) { toast('已是屏蔽词：' + word); return; }
    pushUndo();
    state.shieldWords.push({ word: word, color: assignColor() });
    state.selection = null;
    renderAll();
    toast('已加入屏蔽词：' + word);
  }
  function removeShieldWord(idx) {
    pushUndo();
    state.shieldWords.splice(idx, 1);
    renderAll();
  }
  function confirmSelection() {
    var sel = state.selection;
    if (!sel) { toast('请先在弹幕上选择字符'); return; }
    var text = state.positives[sel.row] || '';
    var word = text.substring(sel.a, sel.b + 1);
    if (!word) return;
    addShieldWord(word);
  }
  function clearSelection() { state.selection = null; paintSelection(); updateConfirmBar(); }
  function setSpecial(row, mode) {
    state.special[row] = mode;
    renderRows(); renderOutputs(); renderTest(); paintSelection(); updateConfirmBar();
  }

  // ---- rendering ----
  function renderAll() {
    renderConfirm();
    renderOutputs();
    renderTest();
    paintSelection();
    updateConfirmBar();
  }

  function renderConfirm() {
    var empty = el('confirmEmpty'), work = el('confirmWork');
    if (!state.loaded) {
      empty.style.display = ''; work.hidden = true; empty.textContent = '载入弹幕后在此确认屏蔽词';
      return;
    }
    empty.style.display = 'none'; work.hidden = false;
    renderChips();
    renderRows();
  }

  function renderChips() {
    var words = state.shieldWords.map(function (w) { return w.word; });
    // confirmed shield-word chips
    var shieldHtml = '';
    state.shieldWords.forEach(function (w, i) {
      var c = colorOf(w.color);
      shieldHtml += '<span class="chip chip-shield">' +
        '<span class="dot" style="background:' + c.fg + '"></span>' + esc(w.word) +
        '<button class="x" data-remove="' + i + '" title="移除" aria-label="移除">×</button></span>';
    });
    if (!shieldHtml) shieldHtml = '<span style="color:var(--text-3);font-size:13px">点击下方字符选择屏蔽词</span>';
    el('shieldChips').innerHTML = shieldHtml;

    // suggested chips (candidates not yet confirmed)
    var inSet = {}; words.forEach(function (w) { inSet[w] = 1; });
    var sugg = state.candidates.filter(function (c) { return !inSet[c.word]; }).slice(0, 10);
    var suggHtml = '';
    sugg.forEach(function (c) {
      suggHtml += '<button class="chip" data-suggest="' + esc(c.word) + '" title="出现在 ' + c.df + ' 条弹幕中">' +
        '<span class="plus">+</span>' + esc(c.word) +
        '<span style="color:var(--text-3);font-size:11px">×' + c.df + '</span></button>';
    });
    if (!suggHtml) suggHtml = '<span style="color:var(--text-3);font-size:12px">无更多建议</span>';
    el('suggestChips').innerHTML = suggHtml;
  }

  function renderRows() {
    var cont = el('danmakuRows');
    if (!state.loaded) { cont.innerHTML = ''; return; }
    var words = state.shieldWords.map(function (w) { return w.word; });
    var html = '';
    state.positives.forEach(function (text, row) {
      var occ = DC.occurrences(text, words);
      var mode = state.special[row] || 'all';
      var applied = DC.applySpecial(occ, mode);
      var excluded = mode === 'exclude';

      var hitMap = {};
      applied.forEach(function (o) { for (var k = o.start; k < o.end; k++) hitMap[k] = o.wordIdx; });

      var chars = '';
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var cls = 'char'; var style = '';
        if (excluded) cls += ' x';
        var widx = hitMap[i];
        if (widx != null && state.shieldWords[widx]) {
          cls += ' hit';
          var c = colorOf(state.shieldWords[widx].color);
          style = ' style="--c:' + c.fg + ';--cbg:' + c.bg + '"';
        }
        chars += '<button class="' + cls + '" data-row="' + row + '" data-idx="' + i + '"' + style + '>' + esc(ch) + '</button>';
      }

      var occCount = occ.length;
      var stat = excluded ? '已排除此弹幕' : (text.length + ' 字 · 命中 ' + occCount + ' 处');
      var seg = function (label, val, active, disabled) {
        return '<button class="seg' + (active ? ' active' : '') + '" data-mode="' + val + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
      };
      var ctrl =
        '<div class="row-ctrl">' +
        seg('全部', 'all', mode === 'all', false) +
        seg('首个', 'first', mode === 'first', occCount < 2) +
        seg('排除', 'exclude', mode === 'exclude', false) +
        '</div>';

      html += '<div class="row' + (excluded ? ' x-row' : '') + '">' +
        '<div class="row-meta">' +
        '<span class="row-no">' + (row + 1) + '</span>' +
        '<span class="row-stat">' + esc(stat) + '</span>' +
        ctrl +
        '</div>' +
        '<div class="chars">' + chars + '</div>' +
        '<div class="confirm-bar" data-row="' + row + '" hidden>' +
        '<span>将 <code class="sel-text"></code> <span class="sel-len"></span>加入屏蔽词</span> ' +
        '<button class="btn primary xs js-confirm">确认</button>' +
        '<button class="btn ghost xs js-clearsel">清除选择</button>' +
        '</div>' +
        '</div>';
    });
    cont.innerHTML = html;
  }

  function paintSelection() {
    var all = document.querySelectorAll('.char.sel');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('sel');
    var sel = state.selection;
    if (!sel) return;
    for (var k = sel.a; k <= sel.b; k++) {
      var b = document.querySelector('.char[data-row="' + sel.row + '"][data-idx="' + k + '"]');
      if (b) b.classList.add('sel');
    }
  }

  function updateConfirmBar() {
    var bars = document.querySelectorAll('.confirm-bar');
    for (var i = 0; i < bars.length; i++) bars[i].hidden = true;
    var sel = state.selection;
    if (!sel) return;
    var bar = document.querySelector('.confirm-bar[data-row="' + sel.row + '"]');
    if (!bar) return;
    var text = state.positives[sel.row] || '';
    var sub = text.substring(sel.a, sel.b + 1);
    var t = bar.querySelector('.sel-text'); if (t) t.textContent = sub;
    var l = bar.querySelector('.sel-len'); if (l) l.textContent = '（' + sub.length + ' 字）';
    bar.hidden = false;
  }

  // ---- selection via pointer drag + click ----
  var down = null, dragging = false;
  function onPointerDown(e) {
    var b = e.target.closest && e.target.closest('.char');
    if (!b || b.classList.contains('x')) return;
    down = { row: +b.dataset.row, i: +b.dataset.idx, x: e.clientX, y: e.clientY };
    dragging = false;
  }
  function onPointerMove(e) {
    if (!down) return;
    if (!dragging) {
      if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 6) return;
      dragging = true;
      state.selection = { row: down.row, a: down.i, b: down.i };
    }
    var em = document.elementFromPoint(e.clientX, e.clientY);
    var c = em && em.closest && em.closest('.char');
    if (c) {
      var r = +c.dataset.row, ci = +c.dataset.idx;
      if (r === down.row) {
        state.selection = { row: down.row, a: Math.min(down.i, ci), b: Math.max(down.i, ci) };
      }
    }
    paintSelection(); updateConfirmBar();
  }
  function onPointerUp() {
    if (!down) return;
    if (!dragging) {
      // single click on a char: extend a contiguous selection on the same row, else reset
      var row = down.row, i = down.i;
      if (state.special[row] === 'exclude') { down = null; return; }
      var sel = state.selection;
      if (sel && sel.row === row) {
        if (i === sel.a - 1) sel = { row: row, a: i, b: sel.b };
        else if (i === sel.b + 1) sel = { row: row, a: sel.a, b: i };
        else if (i >= sel.a && i <= sel.b) sel = { row: row, a: i, b: i };
        else sel = { row: row, a: i, b: i };
      } else {
        sel = { row: row, a: i, b: i };
      }
      state.selection = sel;
      paintSelection(); updateConfirmBar();
    }
    dragging = false;
    down = null;
  }

  // delegated clicks inside the danmaku rows
  function onRowsClick(e) {
    var seg = e.target.closest && e.target.closest('.seg');
    if (seg) {
      var ctrl = seg.parentElement;
      setSpecial(+ctrl.dataset.row, seg.dataset.mode);
      return;
    }
    if (e.target.closest && e.target.closest('.js-confirm')) { confirmSelection(); return; }
    if (e.target.closest && e.target.closest('.js-clearsel')) { clearSelection(); return; }
  }

  // delegated clicks on chips
  function onChipsClick(e) {
    var remove = e.target.closest && e.target.closest('[data-remove]');
    if (remove) { removeShieldWord(+remove.dataset.remove); return; }
    var sug = e.target.closest && e.target.closest('[data-suggest]');
    if (sug) { addShieldWord(sug.dataset.suggest); return; }
  }

  // ---- regex output ----
  function wordsList() { return state.shieldWords.map(function (w) { return w.word; }); }
  function excludedPositives() {
    var out = [];
    state.positives.forEach(function (t, i) { if (state.special[i] === 'exclude') out.push(t); });
    return out;
  }
  function allowList() { return state.negatives.concat(excludedPositives()); }

  function setCode(id, pattern, emptyMsg) {
    var node = el(id);
    if (!pattern) { node.textContent = emptyMsg; node.classList.add('empty'); node.dataset.copyText = ''; return; }
    var txt = fmt(pattern);
    node.textContent = txt; node.classList.remove('empty'); node.dataset.copyText = txt;
  }

  function renderOutputs() {
    var words = wordsList();
    var block = DC.buildBlockInfo(words);
    var allow = DC.buildAllowInfo(allowList());

    setCode('rgxFull', block ? block.fullPattern : '', '（暂无屏蔽词，请在上方确认）');
    setCode('rgxPattern', block ? block.pattern : '', '（暂无屏蔽词）');
    setCode('rgxAllow', allow.pattern, '（暂无白名单）');

    // keywords chips + newline-joined copy data
    var kw = el('rgxKeywords');
    if (!words.length) {
      kw.innerHTML = '<span class="kwlist empty">无</span>'; kw.dataset.copyText = '';
    } else {
      var kh = '';
      words.forEach(function (w, i) {
        var c = colorOf(state.shieldWords[i].color);
        kh += '<span class="kw" style="background:' + c.bg + ';color:' + c.fg + ';border:1px solid ' + c.fg + '">' + esc(w) + '</span>';
      });
      kw.innerHTML = kh;
      kw.dataset.copyText = words.join('\n');
    }

    // excluded list note
    var ex = excludedPositives();
    var extra = el('allowExtra');
    if (!ex.length) { extra.textContent = '无'; extra.className = 'kwlist muted'; }
    else {
      extra.textContent = ex.map(function (t) { return '“' + t + '”'; }).join('、');
      extra.className = 'kwlist muted';
    }

    // per-danmaku exact regexes
    var per = el('perList'); var hh = '';
    state.positives.forEach(function (t, i) {
      var excl = state.special[i] === 'exclude';
      var exact = DC.perDanmakuRegex(t);
      var disp = fmt(exact);
      var occ = DC.occurrences(t, words);
      var occWords = [];
      var seen = {};
      occ.forEach(function (o) { if (!seen[o.word]) { seen[o.word] = 1; occWords.push({ word: o.word, idx: o.wordIdx }); } });
      var badges = '';
      if (excl) badges = '<span class="badge exc">已排除 ⇒ 白名单</span>';
      else if (occWords.length) badges = '<span class="badge hitb">' + occWords.map(function (ow) {
        var c = colorOf(state.shieldWords[ow.idx].color);
        return '<span class="hitw" style="--c:' + c.fg + ';--cbg:' + c.bg + '">' + esc(ow.word) + '</span>';
      }).join('') + '</span>';
      else badges = '<span class="badge exc">未命中</span>';
      hh += '<div class="perrow' + (excl ? ' excl' : '') + '">' +
        '<span class="pidx">' + (i + 1) + '.</span>' +
        '<span class="ptext">' + esc(t) + '</span>' +
        badges +
        '<code class="pcode">' + esc(disp) + '</code>' +
        '<button class="icopy" data-copy="' + esc(disp) + '">复制</button>' +
        '</div>';
    });
    per.innerHTML = hh || '<div class="kwlist empty">暂无弹幕</div>';
  }

  function buildFullReport() {
    var words = wordsList();
    var block = DC.buildBlockInfo(words);
    var allow = DC.buildAllowInfo(allowList());
    var L = [];
    L.push('# 弹幕屏蔽正则（V2）');
    L.push('');
    if (block) {
      L.push('## 正向屏蔽（合并）');
      L.push('模糊整行：' + fmt(block.fullPattern));
      L.push('包含模式：' + fmt(block.pattern));
      L.push('关键词列表：');
      block.keywords.forEach(function (w) { L.push('  ' + w); });
      L.push('');
    } else {
      L.push('## 正向屏蔽（合并）');
      L.push('（暂无屏蔽词）');
      L.push('');
    }
    L.push('## 反向白名单（精确）');
    L.push(allow.pattern ? fmt(allow.pattern) : '（暂无白名单）');
    if (allow.list.length) { L.push('白名单弹幕：'); allow.list.forEach(function (w) { L.push('  ' + w); }); }
    L.push('');
    var ex = excludedPositives();
    if (ex.length) { L.push('## 已排除的正向弹幕（加入白名单）'); ex.forEach(function (t) { L.push('  ' + t); }); L.push(''); }
    L.push('## 每条弹幕精确正则');
    state.positives.forEach(function (t, i) {
      L.push((i + 1) + '. ' + DC.perDanmakuRegex(t) + (state.special[i] === 'exclude' ? '  (已排除)' : ''));
    });
    if (!state.positives.length) L.push('  （暂无弹幕）');
    return L.join('\n');
  }

  // ---- test ----
  function testHighlights(text, words, ci) {
    var occ = [];
    for (var w = 0; w < words.length; w++) {
      var nee = ci ? words[w].toLowerCase() : words[w];
      var hay = ci ? text.toLowerCase() : text;
      var from = 0, idx;
      while ((idx = hay.indexOf(nee, from)) !== -1) { occ.push({ start: idx, end: idx + nee.length, wordIdx: w }); from = idx + nee.length; }
    }
    occ.sort(function (a, b) { return (b.end - b.start) - (a.end - a.start) || a.start - b.start; });
    var kept = [];
    for (var j = 0; j < occ.length; j++) {
      var ov = false; var o = occ[j];
      for (var k = 0; k < kept.length; k++) { var p = kept[k]; if (o.start < p.end && p.start < o.end) { ov = true; break; } }
      if (!ov) kept.push(o);
    }
    kept.sort(function (a, b) { return a.start - b.start; });
    return kept;
  }

  function renderTest() {
    var cont = el('testResults'), sum = el('testSummary');
    if (!state.loaded) {
      cont.innerHTML = '<div class="tempty">载入弹幕后，在此测试正反向正则的匹配效果</div>';
      sum.textContent = ''; return;
    }
    var words = wordsList();
    var block = DC.buildBlockInfo(words);
    var allow = DC.buildAllowInfo(allowList());
    var lines = parseLines(el('testInput').value);
    if (!lines.length) {
      cont.innerHTML = '<div class="tempty">输入测试弹幕查看匹配结果</div>';
      sum.textContent = ''; return;
    }
    var blocked = 0, passed = 0, wl = 0;
    var html = '';
    lines.forEach(function (line) {
      var r = DC.testDanmaku(line, block, allow, { ci: state.flags.i });
      if (r.blocked) blocked++; else passed++;
      if (r.whitelisted) wl++;
      var occ = testHighlights(line, words, state.flags.i);
      var segs = DC.segmentBy(line, occ.map(function (o) { return { start: o.start, end: o.end, wordIdx: o.wordIdx, word: words[o.wordIdx] }; }));
      var parts = '';
      segs.forEach(function (s) {
        if (s.type === 'hit') {
          var c = colorOf(state.shieldWords[s.wordIdx].color);
          parts += '<span class="hl" style="background:' + c.bg + ';color:' + c.fg + ';border-bottom:2px solid ' + c.fg + '">' + esc(s.text) + '</span>';
        } else { parts += esc(s.text); }
      });
      var badge = r.blocked ? '<span class="tstat">屏蔽</span>' : '<span class="tstat">通过</span>';
      var hitsInfo = '';
      if (r.blocked && r.hits.length) {
        hitsInfo = '<div class="thits">' + (r.whitelisted ? '<span class="wltag">白名单已豁免</span>' : '') +
          r.hits.map(function (h) {
          var idx = words.indexOf(h); var c = idx >= 0 ? colorOf(state.shieldWords[idx].color) : { fg: '#111', bg: '#eee' };
          return '<span class="hitw" style="--c:' + c.fg + ';--cbg:' + c.bg + '">' + esc(h) + '</span>';
        }).join('') + '</div>';
      } else if (r.whitelisted) {
        hitsInfo = '<div class="thits"><span class="wltag">命中白名单</span></div>';
      }
      html += '<div class="trow ' + (r.blocked ? 'blocked' : 'passed') + '">' + badge +
        '<div style="flex:1;min-width:0"><div class="ttext">' + (parts || esc(line)) + '</div>' + hitsInfo + '</div></div>';
    });
    cont.innerHTML = html;
    sum.innerHTML = '共 <b>' + lines.length + '</b> 条　·　屏蔽 <b style="color:var(--danger)">' + blocked + '</b> 条　·　通过 <b style="color:var(--success)">' + passed + '</b> 条' + (wl ? '　·　白名单豁免 <b>' + wl + '</b> 条' : '');
  }

  // ---- step indicator ----
  function setupStepObserver() {
    var sections = ['step-input', 'step-confirm', 'step-regex'].map(el).filter(Boolean);
    var links = document.querySelectorAll('.steps a');
    var activeId = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var id = en.target.id;
          if (id === 'step-input' || id === 'step-confirm' || id === 'step-regex') activeId = id;
        }
      });
      links.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + activeId);
      });
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  // ---- live count of inputs ----
  function updateCounts() {
    el('posCount').textContent = parseLines(el('posInput').value).length + ' 条';
    el('negCount').textContent = parseLines(el('negInput').value).length + ' 条';
  }

  // ---- init ----
  function init() {
    el('btnLoad').addEventListener('click', loadDanmaku);
    el('btnClearAll').addEventListener('click', clearAll);
    el('btnLoadExample').addEventListener('click', loadExample);
    el('btnExample').addEventListener('click', loadExample);
    el('btnClear').addEventListener('click', clearAll);
    el('btnUndo').addEventListener('click', undo);

    el('flagG').addEventListener('change', function () { state.flags.g = el('flagG').checked; renderOutputs(); renderTest(); });
    el('flagI').addEventListener('change', function () { state.flags.i = el('flagI').checked; renderOutputs(); renderTest(); });

    document.querySelectorAll('.fmt-toggle button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.copyFmt = b.dataset.fmt;
        document.querySelectorAll('.fmt-toggle button').forEach(function (x) { x.classList.toggle('active', x === b); });
        renderOutputs();
      });
    });

    var rows = el('danmakuRows');
    rows.addEventListener('click', onRowsClick);
    rows.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    el('shieldChips').addEventListener('click', onChipsClick);
    el('suggestChips').addEventListener('click', onChipsClick);

    el('testInput').addEventListener('input', renderTest);
    el('posInput').addEventListener('input', updateCounts);
    el('negInput').addEventListener('input', updateCounts);

    // copy buttons
    document.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('.icopy');
      if (!c) return;
      var txt = c.dataset.copy || (c.dataset.copyTarget && (function () {
        var t = el(c.dataset.copyTarget); return t && (t.dataset.copyText || t.textContent) || '';
      })()) || '';
      copyText(txt);
    });
    el('btnCopyAll').addEventListener('click', function () { copyText(buildFullReport()); });
    el('btnCopyBlock').addEventListener('click', function () { copyText(state.shieldWords.length ? fmt(DC.buildBlockInfo(wordsList()).fullPattern) : '（暂无屏蔽词）'); });
    el('btnCopyAllow').addEventListener('click', function () { var a = DC.buildAllowInfo(allowList()); copyText(a.pattern ? fmt(a.pattern) : '（暂无白名单）'); });

    setupStepObserver();
    updateCounts();
    renderAll();

    if (location.search.indexOf('demo=1') !== -1) { loadExample(); return; }
  }


  // ---- 填入抖音净化器设置 ----
  el('btnFillConfig').addEventListener('click', function () {
    if (!state.shieldWords.length) { toast('请先确认屏蔽词'); return; }
    var block = DC.buildBlockInfo(wordsList());
    var allow = DC.buildAllowInfo(allowList());
    var pattern = block ? block.fullPattern : '';
    var allowPattern = allow && allow.pattern ? allow.pattern : '';
    var flags = flagsStr();
    var regexValue = pattern ? ('/' + pattern.replace(/\//g, '\\/') + '/' + flags) : '';
    var allowValue = allowPattern ? ('/^' + allowPattern.replace(/\//g, '\\/') + '$/' + (flags.indexOf('i') !== -1 ? 'i' : '')) : '';
    chrome.storage.sync.set({ douyinFilterConfig: {
      enabled: true,
      danmuEnabled: true,
      danmuRegex: regexValue,
      danmuAllowRegex: allowValue
    }}, function () {
      if (chrome.runtime.lastError) {
        toast('保存失败：' + chrome.runtime.lastError.message);
        return;
      }
      toast('已填入设置，关闭此页后在弹窗中保存');
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
