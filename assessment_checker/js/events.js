'use strict';

// events.js
// User-interaction handlers for the results panel: expand/collapse,
// copy-diff, toast messages, the bulk auto-fix engine (single-item and
// apply-all), category toggling, and the error/warning filter.
// Depends on: state.js, validation.js, modules/auto-fixers.js, rendering.js.


function toggleDetails(uid, event) {
  if (event) event.stopPropagation();
  const el = document.getElementById(uid);
  if (!el) return;
  el.classList.toggle('details-open');
}

function copyDiff(uid, event) {
  if (event) event.stopPropagation();
  const result = resultRegistry[uid];
  if (!result || !result.extra) return;
  let text = '';
  if (result.extra.type === 'spacing-insert-blank') {
    text = (result.extra.lastCurrLine || '') + '\n\n';
  } else if (result.extra.type === 'spacing-remove-blanks') {
    text = (result.extra.lastCurrLine || '') + '\n\n';
  } else {
    text = result.extra.expected || result.extra.attrExpected || '';
  }
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────
// BULK AUTO-FIX ENGINE  (Two-Pass approach per spec)
//
// Pass 1 — Global/stateless fixers (see GLOBAL_FIXERS in AUTO-FIXERS
//           section): whole-string .replace() with no line-number
//           dependency. Chained sequentially, safe.
// Silent re-audit — re-parse so line numbers are accurate before Pass 2.
// Pass 2 — Contextual/line-based fixers: applied bottom-up (highest
//           line number first) so earlier fixes can't shift later ones.
// Final commit — single cm.operation() → one Ctrl-Z undoes everything.
// ─────────────────────────────────────────────────────────────────

function showToast(msg) {
  const old = document.querySelector('.autofix-toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'autofix-toast';
  el.innerHTML = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 420);
  }, 3000);
}

// Collect all fixable, non-fixed result objects.
// If catId is given, restrict to items inside that category section element.
function collectFixableResults(catId) {
  const results = [];
  // Most global fixers are stateless so we only need one result object each.
  // special-chars-auto is result-aware (it skips the en dash when it was
  // suppressed as a possible minus), so we collect ALL its results so the
  // per-result pass in runBulkFix can apply the correct suppression per question.
  const seenGlobal = new Set();
  for (const [uid, r] of Object.entries(resultRegistry)) {
    if (r.status === 'pass') continue;
    if (typeof autoFixers[r.rule.id] !== 'function') continue;
    if (r.rule.manualFixOnly) continue; // Exclude from bulk autofix arrays
    const el = document.getElementById(uid);
    if (!el || el.classList.contains('fixed')) continue;
    if (catId) {
      const sec = document.getElementById(catId);
      if (!sec || !sec.contains(el)) continue;
    }
    if (GLOBAL_FIXERS.has(r.rule.id) && r.rule.id !== 'special-chars-auto') {
      if (seenGlobal.has(r.rule.id)) continue;
      seenGlobal.add(r.rule.id);
    }
    results.push({ uid, r });
  }
  return results;
}

function runBulkFix(fixableResults, catId) {
  if (!fixableResults.length) { showToast('✨ Nothing new to auto-fix.'); return; }

  const rawBefore = ta.value;
  let text = rawBefore;

  // If a specific category/group is targeted, find its line boundaries
  let groupStart = 1;
  let groupEnd = text.split('\n').length;
  let isChunked = false;

  if (catId && catId.startsWith('grp-')) {
    const groupNum = parseInt(catId.replace('grp-', ''));
    if (!isNaN(groupNum)) {
      const parsed = window._checker_run ? window._checker_run(text) : null;
      if (parsed && parsed.questions) {
        let foundMin = Infinity, foundMax = -1;
        for (let i = 0; i < parsed.questions.length; i++) {
          const q = parsed.questions[i];
          if (q.group === groupNum) {
            if (q.startLine < foundMin) foundMin = q.startLine;
            const nextQ = parsed.questions[i+1];
            const qEnd = nextQ ? nextQ.startLine - 1 : text.split('\n').length;
            if (qEnd > foundMax) foundMax = qEnd;
          }
        }
        if (foundMin !== Infinity) {
          groupStart = foundMin;
          groupEnd = foundMax;
          isChunked = true;
        }
      }
    }
  }

  // ── Pass 1: global stateless fixers ──────────────────────────────
  // Most global fixers are truly stateless and only need to run once.
  // special-chars-auto is an exception: it is result-aware (it skips replacing
  // the en dash when that question's en dash was suppressed as a possible minus).
  // So we run it once per result instead of deduplicating it to a single call.
  
  let prefix = '', chunk = text, suffix = '';
  if (isChunked) {
     const allLines = text.split('\n');
     prefix = allLines.slice(0, groupStart - 1).join('\n');
     chunk = allLines.slice(groupStart - 1, groupEnd).join('\n');
     suffix = allLines.slice(groupEnd).join('\n');
     if (prefix) prefix += '\n';
     if (suffix) suffix = '\n' + suffix;
  }

  const pass1Ids = new Set();
  for (const { r } of fixableResults) {
    if (!GLOBAL_FIXERS.has(r.rule.id)) continue;
    if (r.rule.id !== 'special-chars-auto') {
      if (pass1Ids.has(r.rule.id)) continue;
      pass1Ids.add(r.rule.id);
    }
    const after = autoFixers[r.rule.id](chunk, r);
    if (after !== undefined) chunk = after;
  }
  
  if (isChunked) {
     text = prefix + chunk + suffix;
  } else {
     text = chunk;
  }

  // ── Silent re-audit for fresh line numbers ────────────────────────
  // Run the checker privately so Pass 2 has accurate coordinates.
  let freshByRule = {};
  try {
    const freshReport = window._checker_run ? window._checker_run(text) : null;
    if (freshReport) {
      for (const r of freshReport.results || []) {
        if (r.status !== 'fail' || typeof autoFixers[r.rule.id] !== 'function') continue;
        (freshByRule[r.rule.id] = freshByRule[r.rule.id] || []).push(r);
      }
    }
  } catch(e) {}

  // ── Pass 2: contextual line-based fixers, bottom-up ──────────────
  const contextual = fixableResults.filter(({ r }) => !GLOBAL_FIXERS.has(r.rule.id));
  const pass2List = [];
  const usedFresh = {};
  for (const { r } of contextual) {
    const pool = freshByRule[r.rule.id] || [];
    // Match by closest original line number to handle any offset from Pass 1
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      if ((usedFresh[r.rule.id] || new Set()).has(i)) continue;
      const d = Math.abs((pool[i].lineNum || 0) - (r.lineNum || 0));
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx !== -1) {
      if (!usedFresh[r.rule.id]) usedFresh[r.rule.id] = new Set();
      usedFresh[r.rule.id].add(bestIdx);
      pass2List.push(pool[bestIdx]);
    } else {
      pass2List.push(r); // fallback: stale result (lines may not have shifted)
    }
  }
  // Bottom-up: apply from the highest line number down
  pass2List.sort((a, b) => (b.lineNum || 0) - (a.lineNum || 0));
  for (const fr of pass2List) {
    const after = autoFixers[fr.rule.id](text, fr);
    if (after !== undefined && after !== text) text = after;
  }

  const specialCharsAutoCount = fixableResults.filter(({ r }) => r.rule.id === 'special-chars-auto').length;
  const totalFixed = pass1Ids.size + specialCharsAutoCount + pass2List.length;

  if (text === rawBefore) {
    showToast('✨ Nothing changed — fixes may already be applied.');
    return;
  }

  // ── Final commit: single undoable operation ───────────────────────
  cm.operation(() => { cm.setValue(text); });

  // Mark all corresponding UI cards as fixed
  for (const { uid, r } of fixableResults) {
    const el = document.getElementById(uid);
    if (!el || el.classList.contains('fixed')) continue;
    el.classList.remove('err','warn'); el.classList.add('fixed');
    const ic = el.querySelector('.sev-icon'); if (ic) ic.textContent = '✦';
    el.querySelectorAll('.wand-btn[data-auto="true"],.diff-apply-btn').forEach(w => {
      w.textContent = '✓ Applied'; w.classList.add('applied');
      w.disabled = true; w.removeAttribute('data-auto');
    });
    if (r.lineNum) markLineFixed(r.lineNum);
  }

  const label = totalFixed === 1 ? '1 fix' : totalFixed + ' fixes';
  showToast('✨ <strong>' + label + '</strong> applied — re-running audit…');

  // Re-run audit so the results panel reflects the clean state
  setTimeout(() => runAudit(), 60);
}

// Enable the Auto-Fix All button only when at least one unfixed, auto-fixable
// result exists in the registry. Called after every audit and after every fix.
function syncAutoFixAllBtn() {
  const hasAny = collectFixableResults(null).length > 0;
  DOM.autoFixAllBtn.disabled = !hasAny;
  DOM.autoFixAllBtn.title = hasAny
    ? 'Apply all safe auto-fixes at once'
    : 'No remaining auto-fixes — all fixable issues have been resolved';
}

function applyAllFixes(event) {
  if (event) event.stopPropagation();
  runBulkFix(collectFixableResults(null), null);
}
function applyGroupFixes(catId, event) {
  if (event) event.stopPropagation();
  runBulkFix(collectFixableResults(catId), catId);
}

function reapplyHighlights() {
  const errLines = [], warnLines = [];
  for (const [uid, r] of Object.entries(resultRegistry)) {
    if (!r.lineNum) continue;
    const el = document.getElementById(uid);
    if (!el) continue;
    if (el.classList.contains('fixed')) {
      // Already fixed — green highlight handled by markLineFixed
      continue;
    }
    if (r.rule.severity === 'error') errLines.push(r.lineNum);
    else warnLines.push(r.lineNum);
  }
  highlightLines(errLines, warnLines);
  // Re-apply green for all fixed lines (highlightLines clears everything first)
  fixedLines.forEach(n => markLineFixed(n));
}

function applyFix(uid,event){
  if(event) event.stopPropagation();
  const result=resultRegistry[uid]; if(!result) return;
  const{rule}=result;
  const itemEl=document.getElementById(uid); if(!itemEl) return;
  if(itemEl.classList.contains('fixed')){itemEl.classList.toggle('details-open');return;}
  const fixer=autoFixers[rule.id];
      if(typeof fixer==='function'){
        // Save scroll position — cm.setValue() resets it to the top
        const scrollInfo = cm.getScrollInfo();
        const cursor = cm.getCursor();
        const before=cm.getValue();
        let after = before;
        
        // Isolate the fix to the specific issue to prevent global replacements
        if (result.extra && result.extra.type === 'contextual-diff' && result.extra.actual && result.extra.expected && !result.extra.removeToken) {
           if (result.extra.actual.includes('\n')) {
              after = before.replace(result.extra.actual, result.extra.expected);
           } else if (result.lineNum) {
              const lines = before.split('\n');
              const idx = result.lineNum - 1;
              if (lines[idx] !== undefined) lines[idx] = lines[idx].replace(result.extra.actual, result.extra.expected);
              after = lines.join('\n');
           } else {
              after = before.replace(result.extra.actual, result.extra.expected);
           }
        } else if (GLOBAL_FIXERS.has(rule.id)) {
           const lines = before.split('\n');
           if (rule.id === 'special-chars-auto' && result.extra && result.extra.chars) {
              const affectedLines = [...new Set(result.extra.chars.flatMap(c => c.lineNums))];
              affectedLines.forEach(ln => {
                 const idx = ln - 1;
                 if (lines[idx] !== undefined) lines[idx] = fixer(lines[idx], result);
              });
              after = lines.join('\n');
           } else if (result.lineNum) {
              const idx = result.lineNum - 1;
              if (lines[idx] !== undefined) lines[idx] = fixer(lines[idx], result);
              after = lines.join('\n');
           } else {
              after = fixer(before, result);
           }
        } else {
           after = fixer(before, result);
        }

        if(after===before){
          itemEl.classList.add('details-open');
          return;
        }
        cm.operation(()=>{ cm.setValue(after); });
    
    // Update UI only for the clicked item
    itemEl.classList.remove('err', 'warn');
    itemEl.classList.add('fixed');
    
    const ic = itemEl.querySelector('.sev-icon');
    if (ic) ic.textContent = '✦';
    
    itemEl.querySelectorAll('.wand-btn[data-auto="true"], .diff-apply-btn').forEach(w => {
      w.textContent = '✓ Applied';
      w.classList.add('applied');
      w.disabled = true;
      w.removeAttribute('data-auto');
    });
    
    if (result.lineNum) markLineFixed(result.lineNum);
    // Restore highlights (cm.setValue wipes all line marks), scroll, and cursor
    reapplyHighlights();
    cm.scrollTo(scrollInfo.left, scrollInfo.top);
    cm.setCursor(cursor);
    // Sync button state — may have just fixed the last auto-fixable item
    syncAutoFixAllBtn();
    // Show the fix panel so the applied banner is visible
    itemEl.classList.add('details-open');
    const banner = itemEl.querySelector('.fix-applied-banner');
    if (banner) banner.style.display = 'flex';
  } else {
    itemEl.classList.toggle('details-open');
  }
}

function toggleCat(id){document.getElementById(id).classList.toggle('open');}

function setFilter(mode){
  AppState.activeFilter = mode;
  // Update button states
  DOM.filterAll.className  = 'filter-btn' + (mode==='all'  ? ' active-all'  : '');
  DOM.filterErr.className  = 'filter-btn' + (mode==='err'  ? ' active-err'  : '');
  DOM.filterWarn.className = 'filter-btn' + (mode==='warn' ? ' active-warn' : '');
  // Show/hide individual result cards
  document.querySelectorAll('.result-item').forEach(el => {
    const isErr  = el.classList.contains('err');
    const isWarn = el.classList.contains('warn');
    const hide = (mode==='err' && !isErr) || (mode==='warn' && !isWarn);
    el.classList.toggle('hidden-by-filter', hide);
  });
  // Hide entire category sections if all their cards are filtered out
  document.querySelectorAll('.category-section').forEach(sec => {
    const visible = sec.querySelectorAll('.result-item:not(.hidden-by-filter)').length;
    sec.classList.toggle('all-hidden', visible === 0);
  });
}

function closeAllResults() {
  document.querySelectorAll('.category-section.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.result-item.details-open').forEach(el => el.classList.remove('details-open'));
}
