'use strict';

// rendering.js
// Turns a validation report into HTML: category sections, per-issue
// result cards, diff blocks, and table-highlight formatting.
// Depends on: state.js, config.js.

// ─────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────
// Pretty-print table HTML with error highlights injected as <mark> spans.
// html: raw table HTML string; issues: array of { hIndex, matchLen } from table-issues extra.
// mismatchRanges: optional array of { start, end } char ranges for mismatched <tr> rows.
function formatTableHTMLWithHighlights(html, issues, mismatchRanges, uid) {
  // ── Step 1: trim html to just the <table>…</table> span ──
  // The extractor stores full source lines which may include question text before
  // the opening <table> tag. We slice to table-only so the pretty-print is clean.
  const tableStart = html.search(/<table\b/i);
  const tableEndMatch = html.match(/[\s\S]*(<\/table>)/i);
  const tableEnd = tableEndMatch ? html.lastIndexOf('</table>') + '</table>'.length : html.length;
  const tableOnly = tableStart >= 0 ? html.substring(tableStart, tableEnd) : html;
  // Offset added to hIndex values so error ranges still map into tableOnly correctly
  const hOffset = tableStart >= 0 ? tableStart : 0;

  // ── Step 2 (was Step 1): split tableOnly into tokens, tracking original char offsets ──
  const tokens = [];
  const tokenRe = /(<[^>]*>|[^<]+)/g;
  let tm;
  while ((tm = tokenRe.exec(tableOnly)) !== null) {
    tokens.push({ text: tm[0], start: hOffset + tm.index });
  }

  // ── Step 3: format (same logic as formatTableHTML) ──
  const blockTags = ['table','thead','tbody','tfoot','tr','caption'];
  let pad = 0;
  // Each entry: { raw, start } where start = offset in original html
  const formattedLines = []; // { text: string, origStart: number, origEnd: number }

  for (const tok of tokens) {
    const trimmed = tok.text.trim();
    if (!trimmed) continue;
    const isClosing = /^<\//.test(trimmed);
    const isOpening = /^<[^\/!]/.test(trimmed);
    const tagMatch  = trimmed.match(/<\/?([a-zA-Z0-9]+)/);
    const tagName   = tagMatch ? tagMatch[1].toLowerCase() : '';

    if (isClosing && blockTags.includes(tagName)) pad = Math.max(0, pad - 1);
    formattedLines.push({
      text: '\t'.repeat(pad) + trimmed,
      origStart: tok.start,
      origEnd: tok.start + tok.text.length
    });
    if (isOpening && blockTags.includes(tagName) && !trimmed.endsWith('/>')) pad++;
  }

  // ── Step 4: compress <td>/<th> content onto one line ──
  // Find consecutive open-cell / content / close-cell triples and merge them
  const merged = [];
  let i = 0;
  while (i < formattedLines.length) {
    const line = formattedLines[i];
    const cellOpen = line.text.trim().match(/^(<(?:td|th)\b[^>]*>)$/i);
    if (cellOpen && i + 2 < formattedLines.length) {
      const content = formattedLines[i + 1];
      const closeL  = formattedLines[i + 2];
      const cellClose = closeL.text.trim().match(/^(<\/(?:td|th)\s*>)$/i);
      if (cellClose) {
        const indent = line.text.match(/^\t*/)[0];
        merged.push({
          text: indent + line.text.trim() + content.text.trim() + closeL.text.trim(),
          origStart: line.origStart,
          origEnd: closeL.origEnd
        });
        i += 3;
        continue;
      }
    }
    merged.push(line);
    i++;
  }

  // ── Step 5: build error ranges (adjusted for hOffset) ──
  // Each issue carries hIndex + matchLen pointing into the original html string.
  const errorRanges = (issues || [])
    .filter(iss => iss.hIndex != null)
    .map(iss => ({ start: iss.hIndex, end: iss.hIndex + iss.matchLen }));
  // (hIndex values are offsets into the original full html; tokens also use those same
  //  absolute offsets via hOffset, so no adjustment needed — they share the same frame.)

  // ── Step 5b: also detect malformed tags not already covered by issues ──
  // These are tag fragments missing their '>' (e.g. "<tr" followed immediately by another
  // '<') or orphaned tag tails missing their '<' (e.g. "/tr>" with no '<' before it).
  // We scan tableOnly for these and add them to errorRanges.
  const STRUCT_TAG_NAMES = 'table|thead|tbody|tfoot|tr|th|td|caption';
  // Malformed open/close: <tagname or </tagname with no '>' before next '<'
  const malformedOpenRe = new RegExp('<\\/?('+STRUCT_TAG_NAMES+')\\b[^<>]*(?=<|$)', 'gi');
  let malMtch;
  while ((malMtch = malformedOpenRe.exec(tableOnly)) !== null) {
    const fragment = tableOnly.substring(malMtch.index);
    const nextLt = fragment.indexOf('<', 1);
    const nextGt = fragment.indexOf('>');
    if (nextGt === -1 || (nextLt !== -1 && nextLt < nextGt)) {
      const absStart = hOffset + malMtch.index;
      // Only add if not already covered
      if (!errorRanges.some(r => r.start <= absStart && r.end >= absStart + malMtch[0].length)) {
        errorRanges.push({ start: absStart, end: absStart + malMtch[0].length });
      }
    }
  }
  // Orphaned closing tail: /tagname> or tagname> with no '<' before it on the same "token"
  // These show up in tableOnly as text nodes (not matched as tags by the <[^>]*> pattern)
  // e.g. the text "/tr>" sitting between two tags.
  const orphanTailRe = new RegExp('(?:^|(?<=>|\\s))\\/?(?:'+STRUCT_TAG_NAMES+')(?:[^<>]*)>', 'gi');
  let orphMtch;
  while ((orphMtch = orphanTailRe.exec(tableOnly)) !== null) {
    // Confirm there is no '<' within this match (it would have been caught as a proper tag)
    if (orphMtch[0].includes('<')) continue;
    const absStart = hOffset + orphMtch.index + (orphMtch[0].match(/^(\s*)/) || [''])[0].length;
    const absEnd   = hOffset + orphMtch.index + orphMtch[0].length;
    if (!errorRanges.some(r => r.start <= absStart && r.end >= absEnd)) {
      errorRanges.push({ start: absStart, end: absEnd });
    }
  }

  // ── Step 6: render, injecting highlights on lines that overlap error ranges ──
  const mismatchSet = (mismatchRanges || []);
  return merged.map(line => {
    const hasError = errorRanges.some(r =>
      r.start < line.origEnd && r.end > line.origStart
    );
    const hasMismatch = !hasError && mismatchSet.some(r =>
      r.start < line.origEnd && r.end > line.origStart
    );
    
    // If we aren't building an interactive table (no uid) and there are no errors, short-circuit
    if (!uid && !hasError && !hasMismatch) return esc(line.text);

    // Find the specific token(s) on this line that overlap an error range and
    // highlight just them (rather than the whole line) for precision.
    // We re-tokenize just this line's original source span.
    const lineSource = html.substring(line.origStart, line.origEnd);
    const indent = line.text.match(/^\t*/)[0];

    let result = esc(indent);
    const localTokenRe = /(<[^>]*>|[^<]+)/g;
    let lt;
    while ((lt = localTokenRe.exec(lineSource)) !== null) {
      const tokStart = line.origStart + lt.index;
      const tokEnd   = tokStart + lt[0].length;
      const isErr      = errorRanges.some(r => r.start < tokEnd && r.end > tokStart);
      const isMismatch = !isErr && mismatchSet.some(r => r.start < tokEnd && r.end > tokStart);
      const content = esc(lt[0]);
      const baseStyle = isErr ? 'background:#fecaca;color:#991b1b;padding:0 2px;border-radius:2px;font-weight:600;' : 
                        isMismatch ? 'background:#fef08a;color:#854d0e;padding:0 2px;border-radius:2px;font-weight:600;' : '';
      
      if (uid) {
        result += '<span class="table-token" style="' + baseStyle + '" onclick="highlightCMToken(\'' + uid + '\', ' + tokStart + ', ' + tokEnd + '); event.stopPropagation()">' + content + '</span>';
      } else {
        if (isErr || isMismatch) {
          result += '<mark style="' + baseStyle + '">' + content + '</mark>';
        } else {
          result += content;
        }
      }
    }
    return result;
  }).join('\n');
}

window.highlightCMToken = function(uid, tokStart, tokEnd) {
  const r = resultRegistry[uid];
  if (!r || !r.extra || !r.extra.rawHtml || !r.extra.tableStartLine) return;
  
  const html = r.extra.rawHtml;
  const startLine = r.extra.tableStartLine - 1; // 0-based for CodeMirror

  // Calculate precise Line and Character offset for the start of the token
  const beforeStart = html.substring(0, tokStart);
  const lineOffsetStart = (beforeStart.match(/\n/g) || []).length;
  const lineStart = startLine + lineOffsetStart;
  const lastNlStart = beforeStart.lastIndexOf('\n');
  const chStart = tokStart - (lastNlStart === -1 ? 0 : lastNlStart + 1);

  // Calculate precise Line and Character offset for the end of the token
  const beforeEnd = html.substring(0, tokEnd);
  const lineOffsetEnd = (beforeEnd.match(/\n/g) || []).length;
  const lineEnd = startLine + lineOffsetEnd;
  const lastNlEnd = beforeEnd.lastIndexOf('\n');
  const chEnd = tokEnd - (lastNlEnd === -1 ? 0 : lastNlEnd + 1);

  const currentTokenId = uid + '-' + tokStart + '-' + tokEnd;

    // If a highlight already exists, clear it
    if (window._cmHighlightMark) {
      window._cmHighlightMark.clear();
      window._cmHighlightMark = null;

      // If the user clicked the exact same token, we just toggle it off and stop here
      if (window._lastHighlightedTokenId === currentTokenId) {
        window._lastHighlightedTokenId = null;
        return;
      }
    }

    // Scroll to position
    cm.scrollIntoView({line: lineStart, ch: chStart}, 100);
    
    // Store the new token ID and highlight the token in the editor
    window._lastHighlightedTokenId = currentTokenId;
    window._cmHighlightMark = cm.markText(
      {line: lineStart, ch: chStart}, 
      {line: lineEnd, ch: chEnd}, 
      {className: 'cm-token-highlight'}
    );
  };
const CHEVRON='<svg class="caret-svg" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';
const resultRegistry={};

function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function highlight(text,errorStr){
  let s=esc(text);
  if(errorStr){
    const e=esc(errorStr).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    s=s.replace(new RegExp('('+e+')','gi'),'<mark class="error-highlight">$1</mark>');
  }
  return s;
}

function renderReport(report,lines){
  DOM.summaryChips.style.display='flex';
  DOM.chipError.textContent=pluralise(report.totalErrors,'Error');
  DOM.chipWarn.textContent=pluralise(report.totalWarnings,'Warning');
  DOM.chipPass.textContent='✓ '+report.totalPasses+' Passed';
  DOM.qStrip.classList.add('visible');

  // Build group counts from questions
  const groupCounts = {};
  report.questions.forEach(q => {
    if (q.group !== null) groupCounts[q.group] = (groupCounts[q.group]||0) + 1;
  });
  const groupNums = Object.keys(groupCounts).map(Number).sort((a,b)=>a-b);

  // Build type counts (only show types present)
  const typeMap = [
    ['mc',       'mc:radio:'],
    ['essay',    'essay:'],
    ['fib',      'fib:'],
    ['tf',       'tf:'],
    ['matching', 'matching:label:']
  ];
  const typeCounts = typeMap
    .map(([label, code]) => ({ label, count: report.questions.filter(q=>q.code===code).length }))
    .filter(t => t.count > 0);

 const stat = (label, val) => `<div class="q-stat">${label}: <strong>${val}</strong></div>`;
  const pipe = `<div class="q-pipe"></div>`;

  let parts = [];

  // Build and cache dashboard data + qMode line map first so we can use it
  AppState.dashData = buildDashboardData(report.questions);
  AppState.dashMeta = { questions: report.questionCount, groups: groupNums.length };
  buildQLineMap(report.questions);

  // Calculate total points & dashboard warnings
  let totalPoints = 0;
  const countFreq = {};
  let maxFreq = 0;
  let majorityCount = null;
  
  AppState.dashData.forEach(row => {
    if (row.points && row.points.length > 0) {
      totalPoints += row.points[0] || 0;
    }
    countFreq[row.count] = (countFreq[row.count] || 0) + 1;
  });
  
  for (const [countStr, freq] of Object.entries(countFreq)) {
    if (freq > maxFreq) {
      maxFreq = freq;
      majorityCount = parseInt(countStr);
    }
  }

  let dashIssuesCount = 0;
  AppState.dashData.forEach(row => {
    if (row.types.length > 1) dashIssuesCount++;
    if (row.points.length > 1) dashIssuesCount++;
    if (row.complexities.length > 1) dashIssuesCount++;
    if (row.suffixes && row.suffixes.length > 1) dashIssuesCount++;
    
    const isCountMismatch = Object.keys(countFreq).length > 1 && row.count !== majorityCount;
    if (isCountMismatch) dashIssuesCount++;
  });

  // 1. Dashboard Issues Badge (First Item)
  if (AppState.dashData.length > 0) {
    if (dashIssuesCount > 0) {
      parts.push(`<div class="q-stat" style="background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-border);padding:3px 8px;border-radius:4px;font-weight:700;cursor:pointer;transition:filter .15s" onclick="openDashboard()" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'" title="Click to view dashboard">⚠ ${dashIssuesCount} Dashboard Issue${dashIssuesCount !== 1 ? 's' : ''}</div>`);
    } else {
      parts.push(`<div class="q-stat" style="background:var(--pass-bg);color:var(--pass);border:1px solid var(--pass-border);padding:3px 8px;border-radius:4px;font-weight:700;cursor:pointer;transition:filter .15s" onclick="openDashboard()" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'" title="Click to view dashboard">✓ 0 Dashboard Issues</div>`);
    }
    parts.push(pipe);
  }

  // 2. Questions + Groups + Total Points
  parts.push(stat('Questions', report.questionCount));
  if (groupNums.length) {
    parts.push(stat('Groups', groupNums.length));
    parts.push(stat('Total Points', totalPoints));
  }

  // Per-type counts
  if (typeCounts.length) {
    parts.push(pipe);
    typeCounts.forEach(t => parts.push(stat(t.label, t.count)));
  }

  DOM.qStrip.innerHTML = parts.join('');
  DOM.qmodeBtn.style.display = '';
  if (AppState.qMode) applyQMode();
  DOM.dashboardBtn.disabled = false;
  DOM.statusBar.classList.add('visible');
  DOM.statusText.innerHTML=
    '<strong>'+report.total+'</strong> rules &nbsp;·&nbsp; '+
    '<strong style="color:var(--error)">'+report.totalErrors+'</strong> errors &nbsp;·&nbsp; '+
    '<strong style="color:var(--warn)">'+report.totalWarnings+'</strong> warnings &nbsp;·&nbsp; '+
    '<strong style="color:var(--pass)">'+report.totalPasses+'</strong> passed';

  if(report.totalErrors===0&&report.totalWarnings===0){
    DOM.resultsBody.innerHTML='<div class="all-pass-banner"><div class="check">✅</div><h2>All checks passed!</h2><p>'+report.questionCount+' questions parsed. No formatting issues found.</p></div>';
    syncAutoFixAllBtn();
    return;
  }
  const errLines=[],warnLines=[];

  // ── Build a line→question map so we can assign errors to groups ──
  const questions = report.questions;
  // For each question, determine its line range [startLine, endLine)
  const qRanges = questions.map((q, qi) => {
    const start = q.startLine;
    const end = qi + 1 < questions.length ? questions[qi+1].startLine - 1 : lines.length;
    return { q, start, end };
  });
  function groupForLine(ln) {
    if (!ln) return null;
    for (const { q, start, end } of qRanges) {
      if (ln >= start && ln <= end) return q.group;
    }
    return null;
  }
  function questionNumForLine(ln) {
    if (!ln) return null;
    for (const { q, start, end } of qRanges) {
      if (ln >= start && ln <= end) return q.num;
    }
    return null;
  }

  // Collect all failures across all categories
  const allFailures = [];
  for (const catData of Object.values(report.grouped)) {
    for (const r of catData.failures) allFailures.push(r);
  }

  // ── Assign each failure to a group bucket ──
  // Strategy: prefer lineNum→group lookup; fall back to parsing message for "group:" or "Question N"
  const byGroup = {}; // groupKey (number or 'general') → [{r, groupKey}]
  for (const r of allFailures) {
    let groupKey = null;

    // 1. Try resolving via lineNum
    if (r.lineNum) groupKey = groupForLine(r.lineNum);

    // 2. If still null, try extra data (group-points-consistency, group-sequence carry group info)
    if (groupKey === null && r.extra) {
      if (r.extra.group != null) groupKey = parseInt(r.extra.group);
      else if (r.extra.sequence) {
        // group-sequence: find the first out-of-order group
        const seq = r.extra.sequence;
        let prev = 0;
        for (const item of seq) {
          if (item.group < prev) { groupKey = item.group; break; }
          prev = item.group;
        }
      }
    }

    // 3. Try parsing "Question N" from the message to get group via qRanges
    if (groupKey === null && r.message) {
      const mQ = r.message.match(/[Qq]uestion\s+(\d+)/);
      if (mQ) {
        const qNum = parseInt(mQ[1]);
        const found = questions.find(q => q.num === qNum);
        if (found) groupKey = found.group;
      }
    }

    const bucket = groupKey !== null ? groupKey : 'general';
    if (!byGroup[bucket]) byGroup[bucket] = [];
    byGroup[bucket].push(r);
  }

  // ── Sort group keys: numbered groups ascending, then 'general' ──
  const groupKeys = Object.keys(byGroup).sort((a, b) => {
    if (a === 'general') return 1;
    if (b === 'general') return -1;
    return parseInt(a) - parseInt(b);
  });

  let html = '';
  for (const gk of groupKeys) {
    const fails = byGroup[gk];
    const errCount = fails.filter(f => f.rule.severity === 'error').length;
    const warnCount = fails.filter(f => f.rule.severity === 'warning').length;
    const hCls = errCount ? 'has-errors' : 'has-warnings';
    const badges =
      (errCount ? '<span class="cat-count cat-count-error">'+pluralise(errCount,'Error')+'</span>' : '') +
      (warnCount ? '<span class="cat-count cat-count-warn">'+pluralise(warnCount,'Warning')+'</span>' : '');

    let label, qLabel = '';
    if (gk === 'general') {
      label = '⚠ File-level / General Checks';
    } else {
      // Find question numbers in this group for the subtitle
      const qNums = [...new Set(fails.map(r => {
        const n = r.lineNum ? questionNumForLine(r.lineNum) : null;
        if (n) return n;
        // fall back: find questions with this group
        const q = questions.find(q => q.group === parseInt(gk));
        return q ? q.num : null;
      }).filter(Boolean))].sort((a,b)=>a-b);
      label = 'Group ' + gk;
      if (qNums.length) qLabel = '<span class="cat-q-label">(Q' + qNums.join(', Q') + ')</span>';
    }

    let items = '';
    // Sort within group: errors before warnings
    const sorted = [...fails].sort((a, b) => {
      const sev = s => s.rule.severity === 'error' ? 0 : 1;
      return sev(a) - sev(b);
    });
    for (const r of sorted) {
      items += renderItem(r, lines);
      if (r.lineNum) (r.rule.severity === 'error' ? errLines : warnLines).push(r.lineNum);
    }
    const catId = 'grp-' + gk;
    // Collect uids stamped by renderItem — only items that have an auto-fixer
    const fixableUids = sorted
      .filter(r => r._uid && typeof autoFixers[r.rule.id] === 'function' && !r.rule.manualFixOnly && !(r.extra && r.extra.noAutoFix))
      .map(r => r._uid);
    const catFixBtn = fixableUids.length
      ? '<button class="cat-fix-all" onclick="applyGroupFixes(\''+catId+'\',event)" title="Apply all safe auto-fixes in this group">✨ Auto Fix ('+ fixableUids.length +')</button>'
      : '';
    html += '<div class="category-section" id="'+catId+'">'+
      '<div class="category-header '+hCls+'" onclick="toggleCat(\''+catId+'\')">'+
      label+' '+qLabel+' '+badges+
      (catFixBtn ? catFixBtn : '<span style="margin-left:auto"></span>')+
      '<span class="cat-chevron">'+CHEVRON+'</span></div>'+
      '<div class="category-items">'+items+'</div></div>';
  }
  DOM.resultsBody.innerHTML = html;
  highlightLines(errLines, warnLines);
  
  // Restore category open state on subsequent runs, keep all closed on first run
  if (!AppState.hasRunOnce) {
    AppState.hasRunOnce = true;
  } else {
    document.querySelectorAll('.category-section').forEach(sec => {
      if (AppState.openCategories.has(sec.id)) sec.classList.add('open');
    });
  }
  
  // Show filter bar
  AppState.activeFilter = 'all';
  DOM.filterBar.classList.add('visible');
  ['filterAll','filterErr','filterWarn'].forEach(k => DOM[k].className = 'filter-btn');
  DOM.filterAll.classList.add('active-all');
  syncAutoFixAllBtn();
}

function makeDiffLine(actual, expected) {
  // Produces the two-line dark diff: ~~old~~ / + new with character-level highlights
  let pLen = 0;
  while (pLen < actual.length && pLen < expected.length && actual[pLen] === expected[pLen]) pLen++;
  let sLen = 0;
  while (sLen < actual.length - pLen && sLen < expected.length - pLen && actual[actual.length-1-sLen] === expected[expected.length-1-sLen]) sLen++;
  
  const aPre = esc(actual.substring(0, pLen));
  const aSuf = esc(actual.substring(actual.length - sLen));
  const eDel = esc(actual.substring(pLen, actual.length - sLen));
  const eIns = esc(expected.substring(pLen, expected.length - sLen));
  
  const delLine =
    (aPre ? '<span style="opacity:.45">'+aPre+'</span>' : '') +
    (eDel ? '<del style="background:rgba(239,68,68,.35);color:#fca5a5;text-decoration:line-through;border-radius:2px;padding:0 2px;">'+eDel+'</del>' : '') +
    (aSuf ? '<span style="opacity:.45">'+aSuf+'</span>' : '');
  const insLine =
    (aPre ? '<span style="opacity:.45">'+aPre+'</span>' : '') +
    (eIns ? '<ins style="background:rgba(34,197,94,.3);color:#4ade80;font-weight:700;text-decoration:none;border-radius:2px;padding:0 2px;">'+eIns+'</ins>' : '') +
    (aSuf ? '<span style="opacity:.45">'+aSuf+'</span>' : '');
  return { delLine, insLine };
}

function renderDiffBlock(uid, actual, expected, lineNum, hasAuto, applyLabel) {
  const applyBtn = hasAuto
    ? '<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" title="Apply fix in editor">\u2713 Apply Fix</button>'
    : '';
  const copyBtn = '<button class="diff-action-btn diff-copy-btn" onclick="copyDiff(\''+uid+'\',event)" title="Copy corrected text">\u2398</button>';
  const lineLabel = lineNum ? 'Line '+lineNum : '';

  const aLines = actual.split('\n');
  const eLines = expected.split('\n');
  let bodyHtml = '';

  if (aLines.length === 1 && eLines.length === 1) {
    // Single-line: character-level highlight
    const { delLine, insLine } = makeDiffLine(actual, expected);
    bodyHtml =
      '<div class="diff-line diff-line-del"><span class="diff-sigil">~~</span><span class="diff-text">'+delLine+'</span></div>'+
      '<div class="diff-line diff-line-ins"><span class="diff-sigil">+&nbsp;</span><span class="diff-text">'+insLine+'</span></div>';
  } else {
    // Multi-line: LCS-based diff — all dels in a hunk before all ins
    const renderCtx = l => '<div class="diff-line" style="color:#a0a0b8"><span class="diff-sigil" style="opacity:.4">&nbsp;&nbsp;</span><span class="diff-text">'+(l===''?'<span style="opacity:.3;font-style:italic">&#x23CE; blank line</span>':esc(l))+'</span></div>';
    const renderDel = l => '<div class="diff-line diff-line-del"><span class="diff-sigil">~~</span><span class="diff-text">'+(l===''?'<span style="font-style:italic">&#x23CE; blank line</span>':esc(l))+'</span></div>';
    const renderIns = l => '<div class="diff-line diff-line-ins"><span class="diff-sigil">+&nbsp;</span><span class="diff-text">'+(l===''?'<span style="font-style:italic">&#x23CE; blank line</span>':esc(l))+'</span></div>';

    // Build LCS table
    const m = aLines.length, n = eLines.length;
    const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
    for (let i = m-1; i >= 0; i--)
      for (let j = n-1; j >= 0; j--)
        dp[i][j] = aLines[i] === eLines[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);

    // Walk LCS to produce edit script: 'ctx', 'del', 'ins'
    const ops = []; // {type, line}
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && aLines[i] === eLines[j]) {
        ops.push({type:'ctx', line:aLines[i]}); i++; j++;
      } else if (j < n && (i >= m || dp[i][j+1] >= dp[i+1][j])) {
        ops.push({type:'ins', line:eLines[j]}); j++;
      } else {
        ops.push({type:'del', line:aLines[i]}); i++;
      }
    }

    // Render: group consecutive del/ins runs so all dels come before all ins in each hunk
    let k = 0;
    while (k < ops.length) {
      if (ops[k].type === 'ctx') {
        bodyHtml += renderCtx(ops[k].line); k++;
      } else {
        // Collect the full del+ins hunk
        const hunkDels = [], hunkIns = [];
        while (k < ops.length && ops[k].type === 'del') hunkDels.push(ops[k++].line);
        while (k < ops.length && ops[k].type === 'ins') hunkIns.push(ops[k++].line);
        // If ins came before del in ops (shouldn't with our LCS direction but guard anyway)
        while (k < ops.length && ops[k].type === 'del') hunkDels.push(ops[k++].line);
        hunkDels.forEach(l => { bodyHtml += renderDel(l); });
        hunkIns.forEach(l  => { bodyHtml += renderIns(l); });
      }
    }
  }

  return '<div class="diff-block">'+
    '<div class="diff-block-hdr"><span class="diff-label">'+(applyLabel||'Suggested Fix')+(lineLabel?' <span style="opacity:.5;font-weight:400">('+lineLabel+')</span>':'')+'</span>'+applyBtn+copyBtn+'</div>'+
    '<div class="diff-block-body">'+bodyHtml+'</div></div>';
}

function renderItem(r,lines){
  const isPassing=r.status==='pass';
  const cls=isPassing?'pass':r.rule.severity==='error'?'err':'warn';
  const icon=isPassing?'✓':r.rule.severity==='error'?'🔴':'🟡';
  const uid='ri-'+r.rule.id+(r.lineNum||'')+Math.random().toString(36).slice(2,6);
  r._uid = uid; // stamp so category Fix All can reference it
  resultRegistry[uid]=r;
  if(r.lineNum) {
      if (!AppState.lineMap[r.lineNum]) AppState.lineMap[r.lineNum] = [];
      AppState.lineMap[r.lineNum].push(uid);
  }
  function getQLabel(lineNum) {
    if (!lineNum || !AppState.qMode) return lineNum ? 'L'+lineNum : null;
    // Direct hit on a question start
    const entry = AppState.qLineMap[lineNum];
    if (entry && entry.isStart) return 'Q'+entry.qNum;
    
    // Find the question whose start line is <= this line (nearest question above)
    const starts = Object.keys(AppState.qLineMap).map(Number).filter(n => AppState.qLineMap[n].isStart).sort((a,b)=>a-b);
    let best = null;
    for (const s of starts) { if (s <= lineNum) best = s; else break; }
    return best ? 'Q'+AppState.qLineMap[best].qNum : 'L'+lineNum;
  }
  const badgeLabel = getQLabel(r.lineNum);
  const lineBadge = badgeLabel ? '<span class="line-badge" onclick="jumpToLine('+r.lineNum+');event.stopPropagation()">'+badgeLabel+'</span>' : '';
  const hasFixer=!isPassing&&!!r.rule.fix;
  const hasAuto=hasFixer&&typeof autoFixers[r.rule.id]==='function'&&!(r.extra&&r.extra.noAutoFix);

  // "Show Details / Code Fix" toggle — Apply Fix is only inside the fix panel, not the row
  const showDetailsBtn = hasFixer
    ? '<button class="show-details-btn" onclick="toggleDetails(\''+uid+'\',event)">Details / Fix <svg style="width:11px;height:11px;display:inline-block;vertical-align:middle;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>'
    : '';

  const displayMsg=isPassing?'':highlight(r.message||'',r.errorStr);

  // ── Build fix panel content ──
  let fixPanelContent = '';
  if (hasFixer) {
    const userLine = r.lineNum && lines ? lines[r.lineNum-1] : '';

    // Context / Best Practice panel (replaces old italic rationale)
    const contextPanel = r.rule.rationale
      ? '<div class="context-panel"><div class="context-panel-hdr">💡 Context / Best Practice</div>'+esc(r.rule.rationale)+'</div>'
      : '';

    if (r.extra && r.extra.type === 'spacing-insert-blank') {
      // Missing blank line — show last line of question as context, then green inserted blank
      const applyBtn = hasAuto
        ? '<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" title="Apply fix in editor">✓ Apply Fix</button>'
        : '';
      const copyBtn = '<button class="diff-action-btn diff-copy-btn" onclick="copyDiff(\''+uid+'\',event)" title="Copy corrected text">⎘</button>';
      const contextLine = r.extra.lastCurrLine ? '<div class="diff-line" style="color:#a0a0b8"><span class="diff-sigil" style="opacity:.4">&nbsp;&nbsp;</span><span class="diff-text">'+esc(r.extra.lastCurrLine)+'</span></div>' : '';
      const insertedBlank = '<div class="diff-line diff-line-ins"><span class="diff-sigil">+&nbsp;</span><span class="diff-text" style="font-style:italic">&#x23CE; blank line</span></div>';
      const nextPreview = r.extra.firstNextLine ? (r.extra.firstNextLine.length > 60 ? r.extra.firstNextLine.slice(0,60)+'…' : r.extra.firstNextLine) : '';
      const nextLine = nextPreview ? '<div class="diff-line" style="color:#a0a0b8"><span class="diff-sigil" style="opacity:.4">&nbsp;&nbsp;</span><span class="diff-text">'+esc(nextPreview)+'</span></div>' : '';
      fixPanelContent = '<div class="diff-block">'+
        '<div class="diff-block-hdr"><span class="diff-label">Suggested Fix</span>'+applyBtn+copyBtn+'</div>'+
        '<div class="diff-block-body">'+contextLine+insertedBlank+nextLine+'</div></div>' + contextPanel;

    } else if (r.extra && r.extra.type === 'spacing-remove-blanks') {
      // Too many blank lines — show explicit before block then fix block
      const applyBtn = hasAuto
        ? '<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" title="Apply fix in editor">✓ Apply Fix</button>'
        : '';
      const copyBtn = '<button class="diff-action-btn diff-copy-btn" onclick="copyDiff(\''+uid+'\',event)" title="Copy corrected text">⎘</button>';

      // ── Suggested Fix block only: context line, one blank kept, excess struck, next question line ──
      const keepCount = 1;
      const removeCount = r.extra.blanks - keepCount;
      const blankKept = '<div class="diff-line" style="color:#a0a0b8"><span class="diff-sigil" style="opacity:.4">&nbsp;&nbsp;</span><span class="diff-text" style="font-style:italic">&#x23CE; blank line</span></div>';
      const blankRemoved = '<div class="diff-line diff-line-del"><span class="diff-sigil">~~</span><span class="diff-text" style="font-style:italic">&#x23CE; blank line</span></div>';
      let afterRows = '';
      if (r.extra.lastCurrLine) afterRows += '<div class="diff-line" style="color:#a0a0b8"><span class="diff-sigil" style="opacity:.4">&nbsp;&nbsp;</span><span class="diff-text">'+esc(r.extra.lastCurrLine)+'</span></div>';
      afterRows += blankKept;
      for (let i = 0; i < removeCount; i++) afterRows += blankRemoved;
      if (r.extra.firstNextLine) {
        const preview = r.extra.firstNextLine.length > 60 ? r.extra.firstNextLine.slice(0, 60) + '…' : r.extra.firstNextLine;
        afterRows += '<div class="diff-line" style="color:#a0a0b8"><span class="diff-sigil" style="opacity:.4">&nbsp;&nbsp;</span><span class="diff-text">'+esc(preview)+'</span></div>';
      }
      const afterBlock = '<div class="diff-block">'+
        '<div class="diff-block-hdr"><span class="diff-label">Suggested Fix</span>'+applyBtn+copyBtn+'</div>'+
        '<div class="diff-block-body">'+afterRows+'</div></div>';

      fixPanelContent = afterBlock + contextPanel;

    } else if (r.extra && r.extra.type === 'contextual-diff') {
      if (r.extra.noAutoFix) {
        // Show the actual source line with only the two mismatched values highlighted:
        //   • span content text  (r.extra.actual  — what's written inside the span)
        //   • the complexity token inside the attributes (derived from r.extra.truthAttr)
        // No "Apply Fix" — the correct values must be verified manually.
        const rawLine = userLine || '';

        // The two values to highlight
        const spanContent  = r.extra.actual || '';   // e.g. "(03.02 MC)"
        // Extract complexity value from truthAttr (the raw attribute string)
        const truthAttr = r.extra.truthAttr || '';
        const cmMatch = truthAttr.match(/data-complexity\s*=\s*"([^"]*)"/i);
        const cmValue = cmMatch ? cmMatch[1].trim() : '';

        // Escape the full line, then mark just the two substrings
        let displayLine = esc(rawLine);

        // Helper: highlight a literal escaped substring (escape it first so it matches in the esc'd string)
        function markInLine(haystack, needle, bg, fg, title) {
          if (!needle) return haystack;
          const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Only mark the first occurrence to avoid over-marking
          return haystack.replace(
            new RegExp(escapedNeedle),
            '<mark style="background:' + bg + ';color:' + fg + ';border-radius:3px;padding:0 2px;font-weight:700;" title="' + title + '">' + esc(needle) + '</mark>'
          );
        }

        // 1. Highlight span content text — amber (e.g. "(03.02 MC)")
        if (spanContent) {
          displayLine = markInLine(displayLine, spanContent, '#fef3c7', '#92400e', 'Span content text');
        }
        // 2. Highlight complexity attribute value — blue (e.g. "MC")
        if (cmValue) {
          // Match only the value inside data-complexity="..."
          displayLine = displayLine.replace(
            /(data-complexity\s*=\s*&quot;)([\s\S]*?)(&quot;)/,
            function(_, pre, val, post) {
              return pre + '<mark style="background:#dbeafe;color:#1e40af;border-radius:3px;padding:0 2px;font-weight:700;" title="data-complexity value">' + val + '</mark>' + post;
            }
          );
        }

        const lineLabel = r.lineNum ? ' <span style="opacity:.5;font-weight:400">(Line ' + r.lineNum + ')</span>' : '';
        fixPanelContent =
          '<div class="diff-block">' +
          '<div class="diff-block-hdr"><span class="diff-label">Current Line' + lineLabel + '</span></div>' +
          '<div class="diff-block-body"><div style="font-family:var(--mono);font-size:12px;line-height:1.7;color:#e2e8f0;white-space:pre-wrap;word-break:break-all;">' + displayLine + '</div></div>' +
          '</div>' + contextPanel;
      } else {
        fixPanelContent = renderDiffBlock(uid, r.extra.actual, r.extra.expected, r.lineNum, hasAuto) + contextPanel;
      }

    } else if (r.extra && r.extra.type === 'dual-pad-fix') {
      const attrDiff    = renderDiffBlock(uid+'a', r.extra.attrActual,    r.extra.attrExpected,    r.lineNum, false, '① data-associatedlessons');
      const contentDiff = renderDiffBlock(uid+'b', r.extra.contentActual, r.extra.contentExpected, r.lineNum, false, '② Span content text');
      const applyBoth = '<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" style="margin-bottom:8px;display:inline-flex;">✓ Apply Both Fixes</button>';
      fixPanelContent = applyBoth + attrDiff + contentDiff + contextPanel;

   } else if (r.extra && (r.extra.type === 'table-issues' || r.extra.type === 'formatted-code' ||
                   r.extra.type === 'group-points' || r.extra.type === 'group-type-consistency' ||
                   r.extra.type === 'group-meta-consistency' ||
                   r.extra.type === 'group-numbering' || r.extra.type === 'group-sequence' ||
                   r.extra.type === 'special-chars' || r.extra.type === 'br-ambiguous' ||
                   r.extra.type === 'en-dash-context' || r.extra.type === 'minus-context' || 
                   r.extra.type === 'matching-length' || r.extra.type === 'matching-html-right')) {
      // These have their own rich extra panels — build them the existing way then wrap
      fixPanelContent = buildExtraPanel(r, lines, uid, hasAuto) + contextPanel;

    } else {
      // Standard: if hasAuto, compute a live diff from the autofixer; otherwise show example snippet
      const escSnip = esc(r.rule.fix.snippet||'');
      if (hasAuto && userLine) {
        // Run the fixer on just this line to produce a before/after diff
        const fixer = autoFixers[r.rule.id];
        let fixedLine = userLine;
        try { fixedLine = fixer(userLine, r); } catch(e) {}
        if (fixedLine !== userLine) {
          fixPanelContent = renderDiffBlock(uid, userLine.trim(), fixedLine.trim(), r.lineNum, true) + contextPanel;
        } else {
          // Fixer runs globally — show example snippet as fallback
          const exSnippet = escSnip ? '<div><div class="snippet-hdr" style="background:var(--pass-bg);color:var(--pass);">Example Fix</div><pre class="fix-snippet" style="background:var(--surface);">'+escSnip+'</pre></div>' : '';
          const applyBtn = '<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" style="margin-bottom:8px;display:inline-flex;">✓ Apply Fix</button>';
          fixPanelContent = applyBtn + exSnippet + contextPanel;
        }
      } else {
        const userSnippet = userLine
          ? '<div style="margin-bottom:8px;"><div class="snippet-hdr" style="background:var(--error-bg);color:var(--error);">Your Text (Line '+r.lineNum+')</div><pre class="fix-snippet" style="background:var(--surface);color:var(--error);">'+highlight(userLine.trim(),r.errorStr)+'</pre></div>'
          : '';
        const exSnippet = escSnip ? '<div><div class="snippet-hdr" style="background:var(--pass-bg);color:var(--pass);">Suggested Fix</div><pre class="fix-snippet" style="background:var(--surface);">'+escSnip+'</pre></div>' : '';
        fixPanelContent = userSnippet + exSnippet + contextPanel;
      }
    }

    // SECURITY: htmlDescription must only ever be set in the static RULES_DATA constant —
    // never from user-supplied content. It is injected as raw HTML intentionally to allow
    // rich fix guidance (tables, code spans). If you add new rules, use fix.description
    // (plain text, will be escaped) unless rich HTML is genuinely needed.
    let descRaw = r.rule.fix.htmlDescription || esc(r.rule.fix.description);
    if (descRaw.includes('{{SWAP_BTN}}')) {
      const btnHtml = '<button class="diff-action-btn diff-apply-btn" onclick="applyFix(\''+uid+'\',event)" style="margin:0 0 0 6px;padding:2px 8px;font-size:10px;display:inline-flex;vertical-align:middle;">✓ Auto-Swap</button>';
      descRaw = descRaw.replace('{{SWAP_BTN}}', btnHtml);
    }
    const descHtml = '<div class="fix-description">' + descRaw + '</div>';
    fixPanelContent = '<div class="fix-panel" id="fp-'+uid+'"><div class="fix-applied-banner" style="display:none">✦ Fix applied — review and re-audit when done</div>' + descHtml + fixPanelContent + '</div>';
  }

  return '<div class="result-item '+cls+'" id="'+uid+'">'+
    '<div class="result-row" onclick="toggleItem(\''+uid+'\','+( r.lineNum || 'null' )+')">'+
    '<span class="result-col-icon"><span class="sev-icon">'+icon+'</span>'+lineBadge+'</span>'+
    '<div class="result-text">'+
      '<div class="result-rule-name">'+esc(r.rule.description)+'</div>'+
      (displayMsg?'<div class="result-msg">'+displayMsg+'</div>':'')+
    '</div>'+
    (hasFixer ? '<span class="result-col-action">' + showDetailsBtn + '</span>' : '<span class="result-col-action"></span>') +
    '</div>'+
    (fixPanelContent||'')+'</div>';
}
// ─────────────────────────────────────────────────────────────────
// RENDER HELPERS
// ─────────────────────────────────────────────────────────────────
// Returns a clickable "L{n}" badge that jumps the editor to that line,
// or an empty string when n is falsy (used inside result detail panels).
function mkLineBadge(n) {
  return n
    ? '<span class="line-badge" onclick="jumpToLine('+n+');event.stopPropagation()">L'+n+'</span>'
    : '';
}

// Pluralises a noun: pluralise(3,'Error') → '3 Errors', pluralise(1,'Error') → '1 Error'
function pluralise(n, word) { return n + ' ' + word + (n !== 1 ? 's' : ''); }

function buildExtraPanel(r, lines, uid, hasAuto) {
  let extraPanel = '';
  const type = r.extra && r.extra.type;
  if(type==='table-issues'){
      const {issues, rawHtml} = r.extra;
      const TYPE_ICON = { malformed:'⚠', unclosed:'', extra:'', order:'' };
      const TYPE_COLOR = { malformed:'var(--error)', unclosed:'var(--error)', extra:'var(--error)', order:'var(--warn)' };
      const rows = issues.map(issue => {
        const jump = mkLineBadge(issue.lineNum);
        const ic = TYPE_ICON[issue.type] || '';
        const color = TYPE_COLOR[issue.type] || 'var(--error)';
        const tagBadge = '<code style="font-family:var(--mono);font-size:10px;background:var(--surface2);border:1px solid var(--border2);border-radius:3px;padding:1px 5px;color:var(--text-mid);margin-right:6px">&lt;'+esc(issue.tag)+'&gt;</code>';
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 8px;font-size:13px;color:'+color+';width:22px;text-align:center">'+ic+'</td>'+
          '<td style="padding:5px 6px">'+tagBadge+'</td>'+
          '<td style="padding:5px 8px;font-size:11px;color:var(--text);flex:1">'+esc(issue.label)+'</td>'+
          '<td style="padding:5px 8px;text-align:right;white-space:nowrap">'+jump+'</td>'+
          '</tr>';
      }).join('');
      extraPanel =
        '<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--error);text-transform:uppercase;letter-spacing:.5px;background:var(--error-bg)"> '+pluralise(issues.length,'Issue')+' Found</div>'+
        '<table style="width:100%;border-collapse:collapse;border-left:1px solid var(--border);border-right:1px solid var(--border)">'+
          '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2)">'+
            '<th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);width:22px"></th>'+
            '<th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Tag</th>'+
            '<th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Issue</th>'+
            '<th style="padding:5px 8px;font-size:10px;font-weight:700;text-align:right;color:var(--text-dim)">Line</th>'+
          '</tr>'+rows+
        '</table>'+
        '<div style="border-left:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:6px 12px 8px;font-size:11px;color:var(--text-mid)">Fix each issue above in order — malformed tags can cause cascading errors below.</div>'+
        '<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.5px">Formatted Table (For Reference)</div>'+
        '<div style="padding:0 12px 10px 12px"><pre class="fix-snippet" style="background:var(--surface);color:var(--text);tab-size:4;border-radius:var(--r);border-top:1px solid var(--border);margin:0">'+formatTableHTMLWithHighlights(rawHtml, issues, null, uid)+'</pre></div>';
  } else if(type==='formatted-code'){
      const rawHtml = r.extra.rawHtml || r.extra.code || '';
      const mismatchRanges = r.extra.mismatchRanges || [];
      const colCount = r.extra.colCount || null;
      const mismatchCount = mismatchRanges.length;
      const headerLabel = mismatchCount
        ? mismatchCount + ' mismatched row'+(mismatchCount!==1?'s':'')+' highlighted below'
        : 'Formatted Table (For Reference)';
      const headerColor = mismatchCount ? 'var(--warn)' : 'var(--text-mid)';
      const headerBg    = mismatchCount ? 'var(--warn-bg)' : 'var(--surface2)';
      const legend = mismatchCount && colCount
        ? '<div style="padding:4px 12px 6px;font-size:11px;color:var(--text-mid);border-left:1px solid var(--border);border-right:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap">'+
            '<span><mark style="background:#fef08a;color:#854d0e;padding:0 4px;border-radius:2px;font-weight:600">amber</mark> = mismatched row (wrong column count)</span>'+
            '<span style="color:var(--text-dim)">Header expects <strong style="color:var(--text)">'+colCount+'</strong> column'+(colCount!==1?'s':'')+'</span>'+
          '</div>'
        : '';
      extraPanel =
        '<div style="border-top:1px solid var(--border);padding:7px 12px;font-size:11px;font-weight:700;color:'+headerColor+';text-transform:uppercase;letter-spacing:.5px;background:'+headerBg+'">'+headerLabel+'</div>'+
        legend+
        '<div style="padding:0 12px 10px 12px;border-top:1px solid var(--border)"><pre class="fix-snippet" style="background:var(--surface);color:var(--text);tab-size:4;border-radius:0 0 var(--r) var(--r);border:none;margin:0;">'+
          formatTableHTMLWithHighlights(rawHtml, [], mismatchRanges, uid)+
        '</pre></div>';
  } else if(type==='br-ambiguous'){
      const {rawLine, img, side} = r.extra;
      const BRhighlight = (tag) => '<mark style="background:#fef08a;color:#854d0e;padding:0 2px;border-radius:3px;font-weight:700">'+esc(tag)+'</mark>';
      const IMGdim = (tag) => '<span style="opacity:.4;font-style:italic">'+esc(tag)+'</span>';
      let annotated = '', pos = 0;
      const tokenRe = /(<[^>]*>)/g; let tm;
      while ((tm = tokenRe.exec(rawLine)) !== null) {
        if (tm.index > pos) annotated += esc(rawLine.substring(pos, tm.index));
        const tok = tm[1];
        if (/^<\/?\s*br\b/i.test(tok)) annotated += BRhighlight(tok);
        else if (tok === img) annotated += IMGdim(tok);
        else annotated += esc(tok);
        pos = tm.index + tok.length;
      }
      if (pos < rawLine.length) annotated += esc(rawLine.substring(pos));
      const sideLabel = side === 'before' ? '⬆ <code style="font-family:var(--mono)">&lt;br /&gt;</code> is <strong>before</strong> the image — none after' : '⬇ <code style="font-family:var(--mono)">&lt;br /&gt;</code> is <strong>after</strong> the image — none before';
      extraPanel =
        '<div style="border-top:1px solid var(--border);padding:8px 12px 6px;font-size:11px;font-weight:700;color:var(--warn);text-transform:uppercase;letter-spacing:.5px;background:var(--warn-bg)">⚠ Ambiguous Image Placement</div>'+
        '<div style="padding:6px 14px 4px;font-size:11px;color:var(--text-mid)">'+sideLabel+'</div>'+
        '<div style="padding:4px 12px 10px"><pre class="fix-snippet" style="background:var(--surface);color:var(--text);white-space:pre-wrap;word-break:break-all;margin:0">'+annotated+'</pre></div>';
  } else if(type==='group-points'){
      const{group,items}=r.extra;
      const rows=items.map(item=>{
        const jump = mkLineBadge(item.line);
        return '<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px 10px;font-size:11px;font-family:var(--mono)">Q'+item.num+'</td><td style="padding:5px 10px;font-size:12px;font-family:var(--mono)">points:'+item.points+'</td><td style="padding:5px 10px;text-align:right">'+jump+'</td></tr>';
      }).join('');
      extraPanel='<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.5px">Group '+group+' — Point Values</div><table style="width:100%;border-collapse:collapse"><tr style="background:var(--surface2);border-bottom:1px solid var(--border2)"><th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Question #</th><th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Points</th><th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:right;color:var(--text-dim)">Line</th></tr>'+rows+'</table><div style="padding:6px 12px 8px;font-size:11px;color:var(--text-mid)">All questions in the same group must have the same point value. Compare the rows above and update any that do not match.</div>';
  } else if(type==='group-numbering'){
      const {violations, seq} = r.extra;
      const badGroups = new Set(violations.map(v => v.found));
      const groupsSeen = new Map();
      seq.forEach(item => { if(!groupsSeen.has(item.group)) groupsSeen.set(item.group, item); });
      const sortedGroups = [...groupsSeen.keys()].sort((a,b)=>a-b);
      const displayItems = [];
      for (let i = 0; i < sortedGroups.length; i++) {
        const g = sortedGroups[i];
        if (i === 0 && g !== 1) { displayItems.push({ type:'missing', group:1 }); for (let m = 2; m < g; m++) displayItems.push({ type:'missing', group:m }); }
        displayItems.push({ type:'present', group:g, item:groupsSeen.get(g) });
        if (i + 1 < sortedGroups.length) { const next = sortedGroups[i+1]; for (let m = g+1; m < next; m++) displayItems.push({ type:'missing', group:m }); }
      }
      const rows = displayItems.map(di => {
        if (di.type === 'missing') return '<tr style="background:var(--error-bg);border-bottom:1px solid var(--border)"><td style="padding:5px 10px;font-size:11px;font-family:var(--mono);color:var(--text-dim)">—</td><td style="padding:5px 10px;font-size:12px;font-family:var(--mono);font-weight:600;color:var(--error)">group:'+di.group+'<span style="font-size:10px;background:var(--error);color:#fff;border-radius:3px;padding:1px 5px;margin-left:6px">missing</span></td><td style="padding:5px 10px;text-align:right"></td></tr>';
        const isBad = badGroups.has(di.group);
        const jump = mkLineBadge(di.item.line);
        return '<tr style="'+(isBad?'background:var(--error-bg)':'')+';border-bottom:1px solid var(--border)"><td style="padding:5px 10px;font-size:11px;font-family:var(--mono);color:var(--text-dim)">Q'+di.item.num+'…</td><td style="padding:5px 10px;font-size:12px;font-family:var(--mono);font-weight:600">group:'+di.group+(isBad?'<span style="font-size:10px;background:var(--error);color:#fff;border-radius:3px;padding:1px 5px;margin-left:6px">⚠ wrong</span>':'')+'</td><td style="padding:5px 10px;text-align:right">'+jump+'</td></tr>';
      }).join('');
      extraPanel='<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.5px">Group Numbering — All Groups</div><table style="width:100%;border-collapse:collapse">'+rows+'</table><div style="padding:6px 12px 8px;font-size:11px;color:var(--text-mid)">Groups must form an unbroken sequence starting at 1.</div>';
  } else if(type==='group-sequence'){
      let prev=null;
      const rows=r.extra.sequence.map(item=>{
        const isBreak=prev!==null&&item.group<prev; prev=item.group;
        const jump = mkLineBadge(item.line);
        return '<tr style="'+(isBreak?'background:var(--error-bg)':'')+';border-bottom:1px solid var(--border)"><td style="padding:5px 10px;font-size:11px;font-family:var(--mono)">Q'+item.num+'</td><td style="padding:5px 10px;font-size:12px;font-family:var(--mono);font-weight:600">group:'+item.group+(isBreak?'<span style="font-size:10px;background:var(--error);color:#fff;border-radius:3px;padding:1px 5px;margin-left:6px">↑ out of order</span>':'')+'</td><td style="padding:5px 10px;text-align:right">'+jump+'</td></tr>';
      }).join('');
      extraPanel='<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.5px">Group Sequence — All Questions</div><table style="width:100%;border-collapse:collapse">'+rows+'</table><div style="padding:6px 12px 8px;font-size:11px;color:var(--text-mid)">Highlighted rows are out of order. Questions in the same group must appear together.</div>';
  } else if(type==='special-chars'){
      const isAuto=r.extra.tier==='auto';
      const hdrColor=isAuto?'var(--error)':'var(--warn)';
      const hdrBg=isAuto?'var(--error-bg)':'var(--warn-bg)';
      const affectedLines = [...new Set(r.extra.chars.flatMap(c => c.lineNums))].sort((a,b)=>a-b);
      let snippetHtml = '';
      affectedLines.forEach(ln => {
        let text = lines[ln-1] || '';
        let safeText = esc(text);
       r.extra.chars.forEach(c => {
      if (c.lineNums.includes(ln)) {
      const charRegex = new RegExp(esc(c.char).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g');
      const markStyle = c.minusOverlap
        ? 'background:#fef3c7;color:#92400e;padding:0 2px;border-radius:2px;font-weight:bold;'
        : 'background:#fee2e2;color:#991b1b;padding:0 2px;border-radius:2px;font-weight:bold;';
      safeText = safeText.replace(charRegex, '<mark style="'+markStyle+'">'+esc(c.char)+'</mark>');
      }
    });
        snippetHtml += '<div style="color:var(--text-dim);font-size:9px;margin-bottom:2px;user-select:none;text-transform:uppercase;">Line '+ln+'</div><div style="margin-bottom:8px;">'+safeText+'</div>';
      });
      const previewPanel = '<div><div class="snippet-hdr" style="background:'+hdrBg+';color:'+hdrColor+';border-bottom:1px solid var(--border);">Affected Text</div><pre class="fix-snippet" style="background:var(--surface);color:var(--text);border-bottom:none;margin-bottom:0;border-radius:0;">'+snippetHtml+'</pre></div>';
      const rows=r.extra.chars.map(c=>{
        const lineList=c.lineNums.map(n=>'<span class="line-badge" onclick="jumpToLine('+n+');event.stopPropagation()">L'+n+'</span>').join(' ');
        return '<tr style="border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-size:16px;text-align:center;width:32px">'+c.char+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;font-family:var(--mono);color:var(--text-mid)">U+'+c.char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')+'</td>'+
          '<td style="padding:5px 10px;font-size:12px">'+esc(c.name)+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;font-family:var(--mono);color:var(--pass);font-weight:600">'+(c.minusOverlap?'<em style="font-style:italic;font-family:var(--sans);color:var(--text-mid);font-size:11px">see below</em>':esc(c.fix))+'</td>'+
          '<td style="padding:5px 10px;text-align:right">'+lineList+'</td>'+
          '</tr>'+(c.minusOverlap?'<tr><td colspan="5" style="padding:6px 10px 10px;background:var(--warn-bg);border-top:1px solid var(--warn-border)"><div style="font-size:11px;font-weight:600;color:var(--warn);margin-bottom:6px;">En dash detected — possible minus sign or a special character. Review context.</div><table style="border-collapse:collapse;font-size:11px;font-family:var(--mono);"><tr><td style="padding:2px 14px 2px 0;font-weight:700;color:var(--text);">&amp;minus;</td><td style="color:var(--text-mid);">Minus Sign</td></tr><tr><td style="padding:2px 14px 2px 0;font-weight:700;color:var(--text);">&amp;ndash;</td><td style="color:var(--text-mid);">En dash</td></tr></table></td></tr>':'');
      }).join('');
      extraPanel = previewPanel +
        '<div style="border-top:1px solid var(--border);border-left:1px solid var(--border);border-right:1px solid var(--border);padding:6px 12px 4px;font-size:11px;font-weight:700;color:'+hdrColor+';background:'+hdrBg+';text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;">'+(isAuto?'✕ Must Fix':'⚠ Review Required')+' — Special Characters Found'+(isAuto?'<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" title="Apply fix in editor" style="margin-left:auto;text-transform:none;letter-spacing:0;flex-shrink:0;">✓ Apply Fix</button>':'')+'</div>'+
        '<table style="width:100%;border-collapse:collapse;border-left:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);border-radius:0 0 var(--r) var(--r);margin-bottom:10px;">'+
        '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2)">'+
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Char</th>'+
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Code</th>'+
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Name</th>'+
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Replace with</th>'+
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:right;color:var(--text-dim)">Line(s)</th>'+
        '</tr>'+rows+'</table>';
      if(!isAuto) extraPanel+='<div style="padding:0 12px 8px;font-size:11px;color:var(--text-mid)">Review each character and confirm the replacement is appropriate for the context before editing.</div>';
  } else if(type==='en-dash-context'){
      const lineLinks = r.extra.lineNums.map(n=>'<span class="line-badge" onclick="jumpToLine('+n+');event.stopPropagation()">L'+n+'</span>').join(' ');
      extraPanel =
        '<div style="border-top:1px solid var(--border);border-left:1px solid var(--border);border-right:1px solid var(--border);padding:8px 12px 6px;font-size:11px;font-weight:700;color:var(--warn);background:var(--warn-bg);text-transform:uppercase;letter-spacing:.5px">⚠ En Dash — Context Review Required</div>'+
        (()=>{
          let snippetHtml='';
          r.extra.lineNums.forEach(ln=>{
            let safeText=esc(lines[ln-1]||'');
            safeText=safeText.replace(/\u2013/g,'<mark style="background:#fef3c7;color:#92400e;padding:0 2px;border-radius:2px;font-weight:bold;">\u2013</mark>');
            snippetHtml+='<div style="color:var(--text-dim);font-size:9px;margin-bottom:2px;user-select:none;text-transform:uppercase;">Line '+ln+'</div><div style="margin-bottom:8px;">'+safeText+'</div>';
          });
          return '<div class="snippet-hdr" style="background:var(--warn-bg);color:var(--warn);border-bottom:1px solid var(--border);">Affected Text</div><pre class="fix-snippet" style="background:var(--surface);color:var(--text);border-bottom:none;margin-bottom:0;border-radius:0 0 var(--r) var(--r);">'+snippetHtml+'</pre>';
        })()+
        '<div style="border:1px solid var(--border);border-top:none;border-radius:0 0 var(--r) var(--r);padding:10px 12px 12px;margin-bottom:10px;">'+
          '<div style="font-size:12px;color:var(--text);margin-bottom:10px;">En dash detected — possible minus sign or a special character. Review context.</div>'+
          '<table style="border-collapse:collapse;font-size:12px;width:auto;">'+
            '<tr style="border-bottom:1px solid var(--border)">'+
              '<td style="padding:5px 14px 5px 0;font-family:var(--mono);font-weight:700;color:var(--text);">&amp;minus;</td>'+
              '<td style="padding:5px 0;color:var(--text-mid);">Minus Sign &nbsp;<span style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">(subtraction, negative numbers)</span></td>'+
            '</tr>'+
            '<tr>'+
              '<td style="padding:5px 14px 5px 0;font-family:var(--mono);font-weight:700;color:var(--text);">&amp;ndash;</td>'+
              '<td style="padding:5px 0;color:var(--text-mid);">En dash &nbsp;<span style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">(ranges, e.g. 2–4)</span></td>'+
            '</tr>'+
          '</table>'+
          '<div style="margin-top:8px;font-size:11px;color:var(--text-dim);">Appears on: '+lineLinks+'</div>'+
        '</div>';
  } else if(type==='minus-context'){
      const lineLinks = r.extra.lineNums.map(n=>'<span class="line-badge" onclick="jumpToLine('+n+');event.stopPropagation()">L'+n+'</span>').join(' ');
      extraPanel =
        '<div style="border-top:1px solid var(--border);border-left:1px solid var(--border);border-right:1px solid var(--border);padding:8px 12px 6px;font-size:11px;font-weight:700;color:var(--warn);background:var(--warn-bg);text-transform:uppercase;letter-spacing:.5px">⚠ Dash — Context Review Required</div>'+
        (()=>{
          let snippetHtml='';
          r.extra.lineNums.forEach(ln=>{
            let safeText=esc(lines[ln-1]||'');
            safeText=safeText.replace(/(?<=\s)(-)(?=\d|\s)/g,'<mark style="background:#fef3c7;color:#92400e;padding:0 2px;border-radius:2px;font-weight:bold;">-</mark>');
            snippetHtml+='<div style="color:var(--text-dim);font-size:9px;margin-bottom:2px;user-select:none;text-transform:uppercase;">Line '+ln+'</div><div style="margin-bottom:8px;">'+safeText+'</div>';
          });
          return '<div class="snippet-hdr" style="background:var(--warn-bg);color:var(--warn);border-bottom:1px solid var(--border);">Affected Text</div><pre class="fix-snippet" style="background:var(--surface);color:var(--text);border-bottom:none;margin-bottom:0;border-radius:0 0 var(--r) var(--r);">'+snippetHtml+'</pre>';
        })()+
        '<div style="border:1px solid var(--border);border-top:none;border-radius:0 0 var(--r) var(--r);padding:10px 12px 12px;margin-bottom:10px;">'+
          '<div style="font-size:12px;color:var(--text);margin-bottom:10px;">Dash detected — possible math minus sign. Review context.</div>'+
          '<table style="border-collapse:collapse;font-size:12px;width:auto;">'+
            '<tr style="border-bottom:1px solid var(--border)">'+
              '<td style="padding:5px 14px 5px 0;font-family:var(--mono);font-weight:700;color:var(--text);">&amp;minus;</td>'+
              '<td style="padding:5px 0;color:var(--text-mid);">Minus Sign &nbsp;<span style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">(subtraction, negative numbers)</span></td>'+
            '</tr>'+
            '<tr>'+
              '<td style="padding:5px 14px 5px 0;font-family:var(--mono);font-weight:700;color:var(--text);">-</td>'+
              '<td style="padding:5px 0;color:var(--text-mid);">Hyphen &nbsp;<span style="font-size:10px;color:var(--text-dim);font-family:var(--mono);">(leave as-is if used as a hyphen)</span></td>'+
            '</tr>'+
          '</table>'+
          '<div style="margin-top:8px;font-size:11px;color:var(--text-dim);">Appears on: '+lineLinks+'</div>'+
        '</div>';
  } else if(type==='group-type-consistency'){
      const {group, items} = r.extra;
      const types = [...new Set(items.map(i=>i.label))];
      const rows = items.map(item => {
        const isOdd = types.indexOf(item.label) !== 0;
        const jump = mkLineBadge(item.line);
        return '<tr style="'+(isOdd?'background:var(--error-bg)':'')+';border-bottom:1px solid var(--border)">'+
          '<td style="padding:5px 10px;font-size:11px;font-family:var(--mono);color:var(--text)">Q'+item.num+'</td>'+
          '<td style="padding:5px 10px;font-size:11px;font-family:var(--mono);'+(isOdd?'color:var(--error);font-weight:700':'color:var(--text-mid)')+'">'+esc(item.label)+'</td>'+
          '<td style="padding:5px 10px;text-align:right">'+jump+'</td>'+
          '</tr>';
      }).join('');
      extraPanel =
        '<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.5px">Group '+group+' — Question Types</div>'+
        '<table style="width:100%;border-collapse:collapse">'+
          '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2)">'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Question #</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Assessment Type</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:right;color:var(--text-dim)">Line</th>'+
          '</tr>'+rows+
        '</table>';
  } else if(type==='group-meta-consistency'){
      const {group, items} = r.extra;
      
      // Compare all spans to find out which specific attributes differ
      const allSpans = items.map(i => i.span).filter(Boolean);
      const extract = (span) => {
         const cx = (span.match(/data-complexity\s*=\s*"([^"]*)"/i) || [])[1];
         const al = (span.match(/data-associatedlessons\s*=\s*"([^"]*)"/i) || [])[1];
         const st = (span.match(/(data-standard-[a-z0-9_-]+\s*=\s*"[^"]*")/i) || [])[1]; 
         const ct = (span.match(/>([^<]*)</) || [])[1];
         return { cx, al, st, ct };
      };
      const parsed = allSpans.map(extract);
      const unique = (key) => new Set(parsed.map(p => p[key])).size > 1;
      
      const diffCx = unique('cx');
      const diffAl = unique('al');
      const diffSt = unique('st');
      const diffCt = unique('ct');
      const markStyle = 'background:#fef08a;color:#854d0e;padding:0 2px;border-radius:2px;font-weight:600';

      const rows = items.map(item => {
        const jump = mkLineBadge(item.line);
        
        let highlightedSpan = '';
        if (item.span) {
          highlightedSpan = esc(item.span);
          // Apply highlights only to the mismatched values
          if (diffCx) highlightedSpan = highlightedSpan.replace(/(data-complexity\s*=\s*&quot;)(.*?)(&quot;)/i, `$1<mark style="${markStyle}">$2</mark>$3`);
          if (diffAl) highlightedSpan = highlightedSpan.replace(/(data-associatedlessons\s*=\s*&quot;)(.*?)(&quot;)/i, `$1<mark style="${markStyle}">$2</mark>$3`);
          if (diffSt) highlightedSpan = highlightedSpan.replace(/(data-standard-[a-z0-9_-]+\s*=\s*&quot;)(.*?)(&quot;)/i, `$1<mark style="${markStyle}">$2</mark>$3`);
          if (diffCt) highlightedSpan = highlightedSpan.replace(/(&gt;)(.*?)(&lt;\/span)/i, `$1<mark style="${markStyle}">$2</mark>$3`);
        }

        const spanDisplay = item.span
          ? '<code style="font-family:var(--mono);font-size:10px;word-break:break-all;white-space:pre-wrap;color:var(--text)">'+highlightedSpan+'</code>'
          : '<span style="color:var(--text-dim);font-style:italic;font-size:10px">no span found</span>';
          
        return '<tr style="border-bottom:1px solid var(--border);vertical-align:top">'+
          '<td style="padding:6px 10px;font-size:11px;font-family:var(--mono);color:var(--text);white-space:nowrap">Q'+item.num+'</td>'+
          '<td style="padding:6px 10px;font-size:11px">'+spanDisplay+'</td>'+
          '<td style="padding:6px 10px;text-align:right;white-space:nowrap">'+jump+'</td>'+
          '</tr>';
      }).join('');
      extraPanel =
        '<div style="border-top:1px solid var(--border);padding:8px 12px 4px;font-size:11px;font-weight:700;color:var(--error);text-transform:uppercase;letter-spacing:.5px;background:var(--error-bg)">Group '+group+' — Span Metadata Mismatch</div>'+
        '<div style="padding:6px 12px 6px;font-size:11px;color:var(--text-mid);border-left:1px solid var(--border);border-right:1px solid var(--border)">Review the Meta Data below:</div>'+
        '<table style="width:100%;border-collapse:collapse;border-left:1px solid var(--border);border-right:1px solid var(--border)">'+
          '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2)">'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);white-space:nowrap">Question #</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Full Span Data</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:right;color:var(--text-dim);white-space:nowrap">Line #</th>'+
          '</tr>'+rows+
        '</table>'+
        '<div style="border-left:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:6px 12px 8px;font-size:11px;color:var(--text-mid)">All questions in the same group must have an identical &lt;span&gt; tag. Compare the rows above and update any that do not match.</div>';
  } else if(type==='matching-length'){
      const { violations } = r.extra;
      const rows = violations.map(v => {
        const jump = '<span class="line-badge" onclick="jumpToLine('+v.lineNum+');event.stopPropagation()">L'+v.lineNum+'</span>';
        return '<tr style="border-bottom:1px solid var(--border);vertical-align:top">'+
          '<td style="padding:6px 10px;font-size:11px;font-family:var(--mono);">'+jump+'</td>'+
          '<td style="padding:6px 10px;font-size:11px;font-family:var(--mono);color:var(--error);font-weight:700">'+v.length+'</td>'+
          '<td style="padding:6px 10px;font-size:11px;color:var(--text-mid);word-break:break-word;">'+esc(v.text)+'</td>'+
        '</tr>';
      }).join('');
      extraPanel =
        '<table style="width:100%;border-collapse:collapse;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:8px;">'+
          '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2)">'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);width:60px">Line #</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);width:60px">Length</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Current Text</th>'+
          '</tr>'+rows+
        '</table>';
  } else if(type==='matching-html-right'){
      const { violations } = r.extra;
      const rows = violations.map(v => {
        const jump = '<span class="line-badge" onclick="jumpToLine('+v.lineNum+');event.stopPropagation()">L'+v.lineNum+'</span>';
        return '<tr style="border-bottom:1px solid var(--border);vertical-align:top">'+
          '<td style="padding:6px 10px;font-size:11px;font-family:var(--mono);">'+jump+'</td>'+
          '<td style="padding:6px 10px;font-size:11px;color:var(--text-mid);word-break:break-word;">'+esc(v.text)+'</td>'+
        '</tr>';
      }).join('');
      
      const applyBtn = hasAuto ? '<button class="diff-action-btn diff-apply-btn" id="dab-'+uid+'" onclick="applyFix(\''+uid+'\',event)" title="Apply fix in editor" style="margin-left:auto;text-transform:none;letter-spacing:0;flex-shrink:0;">✓ Apply Fix</button>' : '';
      
      extraPanel =
        '<div style="border-top:1px solid var(--border);border-left:1px solid var(--border);border-right:1px solid var(--border);padding:6px 12px 4px;font-size:11px;font-weight:700;color:var(--error);background:var(--error-bg);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;">HTML on Right Side' + applyBtn + '</div>'+
        '<table style="width:100%;border-collapse:collapse;border-left:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);border-radius:0 0 var(--r) var(--r);margin-bottom:8px;">'+
          '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2)">'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);width:60px">Line #</th>'+
            '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim)">Current Text</th>'+
          '</tr>'+rows+
        '</table>';
  }
  return extraPanel;
}
