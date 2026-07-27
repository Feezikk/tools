'use strict';

// modules/audit-runner.js
// Top-level actions that operate on the whole editor: clearAll() and
// runAudit() (invokes the validation engine and hands the report to
// rendering.js), plus the copyText clipboard helper.
// Depends on: state.js, config.js, validation.js, rendering.js.

// ─────────────────────────────────────────────────────────────────
// CORE ACTIONS
// ─────────────────────────────────────────────────────────────────
function clearAll() {
  ta.value = '';
  clearFile();
  clearLineMarks();
  
  // Clear any active table token highlights
  if (window._cmHighlightMark) {
    window._cmHighlightMark.clear();
    window._cmHighlightMark = null;
  }
  window._lastHighlightedTokenId = null;
  if (window._accentMarks) {
    window._accentMarks.forEach(m => m.clear());
    window._accentMarks = [];
  }
  
  fixedLines.clear();
  Object.keys(resultRegistry).forEach(k => delete resultRegistry[k]);
  AppState.lineMap = {};
  AppState.dashData = null;
  AppState.hasRunOnce = false;
  AppState.openCategories.clear();
  AppState.qLineMap = {};
  qModeWidgets.forEach(w => { try { w.clear(); } catch(e) {} });
  qModeWidgets = [];
  if (AppState.qMode) cm.setOption('lineNumberFormatter', n => n);
  AppState.qMode = false;
  DOM.qmodeBtn.classList.remove('active');
  DOM.qmodeBtn.style.display = 'none';
  DOM.resultsBody.innerHTML = EMPTY_STATE_HTML;
  DOM.summaryChips.style.display = 'none';
  DOM.qStrip.classList.remove('visible');
  DOM.qStrip.innerHTML = '';
  DOM.statusBar.classList.remove('visible');
  DOM.dashboardBtn.disabled = true;
  DOM.autoFixAllBtn.disabled = true;
  DOM.filterBar.classList.remove('visible');
  AppState.activeFilter = 'all';
  
  // Reset folder field and auto-detected state
  DOM.imgBasePath.value = '';
  DOM.imgBasePath.classList.remove('auto-detected');
  DOM.cdnAutoBadge.classList.remove('visible');
  AppState.imgCourseFolder = '';
  AppState.imgBasePath = '';
}
function runAudit(){
  const raw=ta.value.trim();
  if(!raw){alert('Please paste content or upload a file first.');return;}

  // Clear any active table token highlights
  if (window._cmHighlightMark) {
    window._cmHighlightMark.clear();
    window._cmHighlightMark = null;
  }
  window._lastHighlightedTokenId = null;
  if (window._accentMarks) {
    window._accentMarks.forEach(m => m.clear());
    window._accentMarks = [];
  }

  // ── Auto-detect course image folder from img src paths (only when field is blank) ──
  if (!DOM.imgBasePath.value.trim()) {
    const folderRe = /\/\/cdn\.flvs\.net\/assessment_images\/([^/\s"']+)\//gi;
    const tally = {};
    let m;
    while ((m = folderRe.exec(raw)) !== null) {
      const f = m[1];
      tally[f] = (tally[f] || 0) + 1;
    }
    const entries = Object.entries(tally);
    if (entries.length) {
      // Pick the most common folder name
      const best = entries.sort((a, b) => b[1] - a[1])[0][0];
      DOM.imgBasePath.value = best;
      AppState.imgCourseFolder = best;
      AppState.imgBasePath = CDN_BASE + best + '/';
      DOM.imgBasePath.classList.add('auto-detected');
      DOM.cdnAutoBadge.classList.add('visible');
    }
  }

  // Capture open categories before wiping the results panel
  if (AppState.hasRunOnce) {
    AppState.openCategories.clear();
    document.querySelectorAll('.category-section.open').forEach(sec => {
      if (sec.id) AppState.openCategories.add(sec.id);
    });
  }

  DOM.resultsBody.innerHTML='<div class="empty-state"><div class="spinner"></div><p>Running checks\u2026</p></div>';
  Object.keys(resultRegistry).forEach(k=>delete resultRegistry[k]);
  AppState.lineMap = {};
  fixedLines.clear();clearLineMarks();

// ── Pre-audit text sanitization (Quotes & Artifacts) ──────────────
  let cleaned = raw;
  
  const SMART_QUOTE_RE = /[\u2018\u2019\u201C\u201D\u2032\u2033]/g;
  let smartQuotesFound = false;
  if (SMART_QUOTE_RE.test(cleaned)) {
    smartQuotesFound = true;
    cleaned = cleaned
      .replace(/[\u2018\u2019\u2032]/g, "'")   // left/right single, prime → '
      .replace(/[\u201C\u201D\u2033]/g, '"');   // left/right double, double-prime → "
  }

  // Target `#^` and `###[1-3 digits]#^`
  const ARTIFACT_RE = /(?:###\d{1,3})?#\^/g;
  let artifactsFound = false;
  if (ARTIFACT_RE.test(cleaned)) {
    artifactsFound = true;
    cleaned = cleaned.replace(ARTIFACT_RE, '');
  }

  if (smartQuotesFound || artifactsFound) {
    ta.value = cleaned;
  }

  setTimeout(()=>{
    try{
      const currentVal = ta.value.trim();
      const lines = currentVal.split('\n');
      renderReport(AssessmentChecker.run(currentVal), lines);
      
      if (smartQuotesFound) {
        const notice = '<div class="smart-quote-notice" style="' +
          'display:flex;align-items:flex-start;gap:10px;' +
          'background:var(--warn-bg,#fff8e1);border-left:4px solid var(--warn,#f5a623);' +
          'border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:0.92em;color:var(--text,#222);">' +
          '<span style="font-size:1.2em;line-height:1.3">⚠️</span>' +
          '<div><strong>Smart/curly quotes detected and replaced.</strong><br>' +
          'Curly or typographic quote characters (\u2018\u2019\u201C\u201D) were found in your content and have been ' +
          'automatically replaced with straight quotes (\' ") in the editor. ' +
          'Please review and re-copy the corrected text.</div></div>';
        DOM.resultsBody.insertAdjacentHTML('afterbegin', notice);
      }
     if (artifactsFound) {
        const noticeArtifact = '<div class="artifact-notice" style="' +
          'display:flex;align-items:flex-start;gap:10px;' +
          'background:var(--warn-bg,#fff8e1);border-left:4px solid var(--warn,#f5a623);' +
          'border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:0.92em;color:var(--text,#222);">' +
          '<span style="font-size:1.2em;line-height:1.3">⚠️</span>' +
          '<div><strong>Educator artifacts removed.</strong><br>' +
          'Educator artifacts <code>#^</code> and <code>###[number]#^</code> were found and have been ' +
          'automatically removed. ' +
          'Please review and re-copy the corrected text.</div></div>';
        DOM.resultsBody.insertAdjacentHTML('afterbegin', noticeArtifact);
      }

      const ACCENT_RE = /[áéíóúÁÉÍÓÚñÑüÜ¿¡àâæçèêëîïôœùûÿÀÂÆÇÈÊËÎÏÔŒÙÛŸ]/;
	  if (ACCENT_RE.test(currentVal)) {
        let accentSnippets = '';
        lines.forEach((line, i) => {
          if (ACCENT_RE.test(line)) {
            let safeText = esc(line);
            // Add yellow highlight specifically around the accented letters
            safeText = safeText.replace(/([áéíóúÁÉÍÓÚñÑüÜ¿¡àâæçèêëîïôœùûÿÀÂÆÇÈÊËÎÏÔŒÙÛŸ])/g, '<mark style="background:#fef08a;color:#854d0e;padding:0 2px;border-radius:2px;font-weight:600">$1</mark>');
            
            // Build the clickable line badge
            const jumpBtn = '<span class="line-badge" onclick="jumpToLineAndHighlightAccents(' + (i + 1) + ');event.stopPropagation()">L' + (i + 1) + '</span>';
            
            accentSnippets += '<tr style="border-bottom:1px solid var(--border);vertical-align:top">' +
                              '<td style="padding:6px 10px;font-size:11px;font-family:var(--mono);width:60px;">' + jumpBtn + '</td>' +
                              '<td style="padding:6px 10px;font-size:12px;color:var(--text);word-break:break-word;white-space:pre-wrap;">' + safeText + '</td>' +
                              '</tr>';
          }
        });

        const noticeAccents = '<div class="accent-notice" style="' +
          'background:var(--warn-bg,#fff8e1);border-left:4px solid var(--warn,#f5a623);' +
          'border-radius:6px;margin-bottom:14px;font-size:0.92em;color:var(--text,#222);">' +
          '<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;cursor:pointer;" onclick="var d=document.getElementById(\'accent-details\');d.style.display=d.style.display===\'none\'?\'block\':\'none\'">' +
          '<span style="font-size:1.2em;line-height:1.3">⚠️</span>' +
          '<div style="flex:1;"><strong>Accented characters detected.</strong><br>' +
          'Accented letters were found in your content. ' +
          'Click to view locations or use the button to replace them.</div>' +
          // Note the event.stopPropagation() so clicking the button doesn't toggle the accordion
          '<button class="btn-autofix" onclick="applyAccentFix(); event.stopPropagation();" style="background:#0284c7; flex-shrink:0; padding:6px 12px; font-size:12px;">Replace All Accents</button></div>' +
          '<div id="accent-details" style="display:none;padding:0 14px 14px 46px;">' +
          '<div class="snippet-hdr" style="background:#fef3c7;color:#92400e;border:1px solid var(--border);border-bottom:none;border-radius:4px 4px 0 0;">Affected Text</div>' +
          '<div style="background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 4px 4px;max-height:250px;overflow-y:auto;margin-bottom:0;">' +
          '<table style="width:100%;border-collapse:collapse;">' + 
          '<tr style="background:var(--surface2);border-bottom:1px solid var(--border2);">' +
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);width:60px;">Line #</th>' +
          '<th style="padding:5px 10px;font-size:10px;font-weight:700;text-align:left;color:var(--text-dim);">Snippet</th>' +
          '</tr>' +
          accentSnippets + 
          '</table></div>' +
          '</div></div>';
        DOM.resultsBody.insertAdjacentHTML('afterbegin', noticeAccents);
      }
    }
    catch(err){DOM.resultsBody.innerHTML='<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error: '+esc(err.message)+'</p></div>';}
  }, AUDIT_RENDER_DELAY_MS);
}
async function copyText(btn) {
  const text = ta.value;
  if (!text.trim()) { alert('Nothing to copy.'); return; }
  let success = false;
  try {
    await navigator.clipboard.writeText(text);
    success = true;
  } catch {
    // Fallback for non-HTTPS contexts (e.g. file://) where the Clipboard API
    // is unavailable. document.execCommand('copy') is deprecated but remains
    // the only option in these environments.
    try {
      const tmp = Object.assign(document.createElement('textarea'), {
        value: text, style: 'position:fixed;top:-9999px;opacity:0'
      });
      document.body.appendChild(tmp);
      tmp.select();
      success = document.execCommand('copy');
      document.body.removeChild(tmp);
    } catch {
      success = false;
    }
  }
  if (success) {
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '⎘ Copy Text'; btn.classList.remove('copied'); }, 2000);
  } else {
    btn.textContent = '✗ Copy failed';
    setTimeout(() => { btn.textContent = '⎘ Copy Text'; }, 2000);
  }
}
