// core.js — pure logic (no DOM) for the danmaku shield-regex generator.
// Loaded as a classic script; attaches helpers to window.DC.
// Used by generator.html (the regex builder shipped inside the extension).
(function () {
  'use strict';

  var SPECIAL = /[.*+?^${}()|[\]\\]/g;

  function escapeRegex(s) {
    return String(s == null ? '' : s).replace(SPECIAL, '\\$&');
  }

  function escapeSlashForLiteral(p) {
    return String(p == null ? '' : p).replace(/\//g, '\\/');
  }

  // non-overlapping start positions of needle in hay
  function findAll(hay, needle) {
    var out = [];
    if (!needle) return out;
    var step = Math.max(1, needle.length);
    var from = 0, idx;
    hay = hay || '';
    while ((idx = hay.indexOf(needle, from)) !== -1) {
      out.push({ start: idx, end: idx + needle.length });
      from = idx + step;
    }
    return out;
  }

  // occurrences of multiple shield words in text; overlaps resolved longest-first.
  // words: array of strings.
  function occurrences(text, words) {
    var occ = [];
    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      if (!word) continue;
      var pos = findAll(text, word);
      for (var i = 0; i < pos.length; i++) {
        occ.push({ start: pos[i].start, end: pos[i].end, wordIdx: w, word: word });
      }
    }
    occ.sort(function (a, b) {
      return (b.end - b.start) - (a.end - a.start) || a.start - b.start;
    });
    var kept = [];
    for (var j = 0; j < occ.length; j++) {
      var o = occ[j];
      var overlap = false;
      for (var k = 0; k < kept.length; k++) {
        var p = kept[k];
        if (o.start < p.end && p.start < o.end) { overlap = true; break; }
      }
      if (!overlap) kept.push(o);
    }
    kept.sort(function (a, b) { return a.start - b.start; });
    return kept;
  }

  // apply per-danmaku special handling to a resolved occurrence list
  function applySpecial(occ, mode) {
    if (mode === 'exclude') return [];
    if (mode === 'first') {
      if (!occ.length) return [];
      var earliest = occ[0];
      for (var i = 0; i < occ.length; i++) if (occ[i].start < earliest.start) earliest = occ[i];
      return [earliest];
    }
    return occ; // 'all'
  }

  // common substrings across positive danmaku, ranked.
  function findCommonCandidates(positives, opts) {
    opts = opts || {};
    var minLen = opts.minLen || 2;
    var maxLen = opts.maxLen || 10;
    var topN = opts.topN || 15;
    var n = positives.length;
    var docFreq = new Map();
    for (var i = 0; i < n; i++) {
      var s = positives[i] || '';
      var L = s.length;
      var seen = new Set();
      for (var a = 0; a < L; a++) {
        for (var len = minLen; len <= maxLen && a + len <= L; len++) {
          seen.add(s.substring(a, a + len));
        }
      }
      seen.forEach(function (sub) { docFreq.set(sub, (docFreq.get(sub) || 0) + 1); });
    }
    var cands = [];
    docFreq.forEach(function (df, sub) {
      if (df >= 2) cands.push({ word: sub, df: df, len: sub.length, score: df * sub.length });
    });
    cands.sort(function (a, b) { return b.score - a.score || b.len - a.len; });
    cands = cands.slice(0, 200);
    var filtered = [];
    for (var x = 0; x < cands.length; x++) {
      var cand = cands[x];
      var redundant = false;
      for (var y = 0; y < cands.length; y++) {
        if (x === y) continue;
        var other = cands[y];
        if (other.len > cand.len && other.df >= cand.df && other.word.indexOf(cand.word) !== -1) {
          redundant = true; break;
        }
      }
      if (!redundant) filtered.push(cand);
    }
    filtered.sort(function (a, b) {
      return b.score - a.score || b.df - a.df || b.len - a.len ||
        (a.word < b.word ? -1 : a.word > b.word ? 1 : 0);
    });
    if (filtered.length === 0 && n === 1 && positives[0] && positives[0].length > 0) {
      filtered.push({ word: positives[0], df: 1, len: positives[0].length, score: positives[0].length });
    }
    return filtered.slice(0, topN);
  }

  function dedupe(arr) {
    var seen = new Set(), out = [];
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      if (x && !seen.has(x)) { seen.add(x); out.push(x); }
    }
    return out;
  }

  // block regex info from shield words (array of strings or {word}).
  // fullPattern is fuzzy line-match; pattern is contains-mode group.
  function buildBlockInfo(words) {
    var ws = dedupe(words.map(function (w) { return w && w.word ? w.word : w; }).filter(Boolean));
    if (ws.length === 0) return null;
    var esc = ws.map(escapeRegex);
    var group = '(?:' + esc.join('|') + ')';
    return { keywords: ws, pattern: group, fullPattern: '.*' + group + '.*' };
  }

  // allow (whitelist) exact-match regex info.
  function buildAllowInfo(list) {
    var l = dedupe(list.filter(Boolean));
    if (l.length === 0) return { list: [], pattern: '' };
    var esc = l.map(escapeRegex);
    return { list: l, pattern: '^(?:' + esc.join('|') + ')$' };
  }

  function perDanmakuRegex(danmaku) {
    return '^' + escapeRegex(danmaku || '') + '$';
  }

  function toLiteral(pattern, flags) {
    return '/' + escapeSlashForLiteral(pattern || '') + '/' + (flags || '');
  }

  function makeRe(pattern, flags) {
    try { return new RegExp(pattern, flags || ''); } catch (e) { return null; }
  }

  // flags: { ci: bool }. global is copy-only.
  function testDanmaku(text, block, allow, flags) {
    flags = flags || {};
    var ci = !!flags.ci;
    var allowRe = allow && allow.pattern ? makeRe(allow.pattern, ci ? 'i' : '') : null;
    var whitelisted = allowRe ? allowRe.test(text) : false;
    var hits = [];
    if (block) {
      var re = makeRe(block.pattern, ci ? 'i' : '');
      if (re && re.test(text)) {
        hits = block.keywords.filter(function (k) {
          var hay = ci ? text.toLowerCase() : text;
          var nee = ci ? k.toLowerCase() : k;
          return hay.indexOf(nee) !== -1;
        });
      }
    }
    return { blocked: hits.length > 0 && !whitelisted, whitelisted: whitelisted, hits: hits };
  }

  // split text into plain/hit segments using resolved occurrences
  function segmentBy(text, occ) {
    occ = occ.slice().sort(function (a, b) { return a.start - b.start; });
    var segs = [];
    var i = 0;
    for (var j = 0; j < occ.length; j++) {
      var o = occ[j];
      if (o.start > i) segs.push({ type: 'plain', text: text.substring(i, o.start) });
      segs.push({ type: 'hit', text: text.substring(o.start, o.end), word: o.word, wordIdx: o.wordIdx });
      if (o.end > i) i = o.end;
    }
    if (i < text.length) segs.push({ type: 'plain', text: text.substring(i) });
    return segs;
  }

  window.DC = {
    escapeRegex: escapeRegex,
    findAll: findAll,
    occurrences: occurrences,
    applySpecial: applySpecial,
    findCommonCandidates: findCommonCandidates,
    dedupe: dedupe,
    buildBlockInfo: buildBlockInfo,
    buildAllowInfo: buildAllowInfo,
    perDanmakuRegex: perDanmakuRegex,
    toLiteral: toLiteral,
    makeRe: makeRe,
    testDanmaku: testDanmaku,
    segmentBy: segmentBy
  };
})();
