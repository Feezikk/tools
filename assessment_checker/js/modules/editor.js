'use strict';

// modules/editor.js
// CodeMirror editor instance + the 'ta' textarea-like wrapper, Q-Mode
// (question-number gutter), line highlighting/jump-to-line, tab
// switching, and file upload handling.
// Depends on: state.js (DOM), config.js.

// ─────────────────────────────────────────────────────────────────
// CODEMIRROR EDITOR
// ─────────────────────────────────────────────────────────────────
const cm = CodeMirror(DOM.cmEditor, {
  lineNumbers: true, lineWrapping: true, mode: 'text/plain', theme: 'default', tabSize: 2,
  gutters: ['CodeMirror-linenumbers'],
  lineNumberFormatter: n => n,
  extraKeys: { 'Ctrl-Enter': () => runAudit(), 'Cmd-Enter': () => runAudit() }
});

// Thin wrapper so handlers can read/write editor value like a textarea
const ta = {
  get value()  { return cm.getValue(); },
  set value(v) { cm.setValue(v); },
  focus()      { cm.focus(); }
};

// ─────────────────────────────────────────────────────────────────
// Q-MODE — question-number gutter
// ─────────────────────────────────────────────────────────────────
let qModeWidgets = []; // line widget handles for group dividers

function buildQLineMap(questions) {
  // Build lineNum → { qNum, cNum, group, isStart } from parsed questions
  const map = {};
  questions.forEach(q => {
    map[q.startLine] = { qNum: q.num, group: q.group, isStart: true };
    if (q.answers && q.answers.length) {
      q.answers.forEach((ans, idx) => {
        map[ans.lineNum] = { cNum: idx + 1, isStart: false };
      });
    }
  });
  AppState.qLineMap = map;
}

function applyQMode() {
  const map = AppState.qLineMap;

  // Remove existing group divider widgets
  qModeWidgets.forEach(w => { try { w.clear(); } catch(e) {} });
  qModeWidgets = [];

  if (!AppState.qMode) {
    // Restore plain line numbers
    cm.setOption('lineNumberFormatter', n => n);
    cm.refresh();
    return;
  }

  // Set formatter: show Qn on question start lines, Cn on choices, blank elsewhere
  cm.setOption('lineNumberFormatter', n => {
    const entry = map[n];
    if (entry) {
      if (entry.qNum) return 'Q' + entry.qNum;
      if (entry.cNum) return 'C' + entry.cNum;
    }
    return ' ';
  });

  // Insert group divider line widgets — one above each question that starts a new group
  let lastGroup = null;
  const lineCount = cm.lineCount();
  // Collect all question start lines sorted
  const qStarts = Object.keys(map).map(Number).filter(ln => map[ln].isStart).sort((a,b)=>a-b);
  qStarts.forEach(ln => {
    const entry = map[ln];
    if (entry.group !== null && entry.group !== lastGroup) {
      lastGroup = entry.group;
      const lineHandle = cm.getLineHandle(ln - 1);
      if (!lineHandle) return;
      const el = document.createElement('div');
      el.className = 'cm-group-divider';
      el.textContent = '// ───────── Group ' + entry.group + ' ───────── //';
      const widget = cm.addLineWidget(ln - 1, el, { above: true, noHScroll: true });
      qModeWidgets.push(widget);
    }
  });

  cm.refresh();
}

function toggleQMode() {
  AppState.qMode = !AppState.qMode;
  DOM.qmodeBtn.classList.toggle('active', AppState.qMode);
  applyQMode();
}

let lineMarkHandles = [];
const fixedLines = new Set();

function clearLineMarks() {
  lineMarkHandles.forEach(h => {
    try {
      cm.removeLineClass(h, 'background', 'cm-error-line');
      cm.removeLineClass(h, 'background', 'cm-warn-line');
      cm.removeLineClass(h, 'background', 'cm-fixed-line');
      cm.removeLineClass(h, 'gutter', 'cm-error-gutter');
      cm.removeLineClass(h, 'gutter', 'cm-warn-gutter');
      cm.removeLineClass(h, 'gutter', 'cm-fixed-gutter');
    } catch(e) {}
  });
  lineMarkHandles = [];
}

function highlightLines(errLines, warnLines) {
  clearLineMarks();
  fixedLines.forEach(n => {
    const h = cm.getLineHandle(n - 1); if (!h) return;
    cm.addLineClass(h, 'background', 'cm-fixed-line');
    cm.addLineClass(h, 'gutter', 'cm-fixed-gutter');
    lineMarkHandles.push(h);
  });
  (warnLines || []).forEach(n => {
    if (fixedLines.has(n)) return;
    const h = cm.getLineHandle(n - 1); if (!h) return;
    cm.addLineClass(h, 'background', 'cm-warn-line');
    cm.addLineClass(h, 'gutter', 'cm-warn-gutter');
    lineMarkHandles.push(h);
  });
  (errLines || []).forEach(n => {
    if (fixedLines.has(n)) return;
    const h = cm.getLineHandle(n - 1); if (!h) return;
    cm.addLineClass(h, 'background', 'cm-error-line');
    cm.addLineClass(h, 'gutter', 'cm-error-gutter');
    lineMarkHandles.push(h);
  });
}

function markLineFixed(n) {
  fixedLines.add(n);
  const h = cm.getLineHandle(n - 1); if (!h) return;
  cm.removeLineClass(h, 'background', 'cm-error-line');
  cm.removeLineClass(h, 'background', 'cm-warn-line');
  cm.removeLineClass(h, 'gutter', 'cm-error-gutter');
  cm.removeLineClass(h, 'gutter', 'cm-warn-gutter');
  cm.addLineClass(h, 'background', 'cm-fixed-line');
  cm.addLineClass(h, 'gutter', 'cm-fixed-gutter');
}

function jumpToLine(n) {
  const coords = cm.charCoords({ line: n - 1, ch: 0 }, 'local');
  cm.scrollTo(null, Math.max(0, coords.top - cm.defaultTextHeight() * 4));
  cm.setCursor({ line: n - 1, ch: 0 });
  cm.focus();
}

window._accentMarks = [];
window.jumpToLineAndHighlightAccents = function(n) {
  jumpToLine(n);
  // Clear any existing accent highlights
  if (window._accentMarks) {
    window._accentMarks.forEach(m => m.clear());
  }
  window._accentMarks = [];
  
  const lineIdx = n - 1;
  const lineText = cm.getLine(lineIdx);
  if (!lineText) return;
  
  const ACCENT_RE = /[áéíóúÁÉÍÓÚñÑüÜ¿¡àâæçèêëîïôœùûÿÀÂÆÇÈÊËÎÏÔŒÙÛŸ]/g;
  let m;
  while ((m = ACCENT_RE.exec(lineText)) !== null) {
    const mark = cm.markText(
      {line: lineIdx, ch: m.index},
      {line: lineIdx, ch: m.index + m[0].length},
      {className: 'cm-token-highlight'}
    );
    window._accentMarks.push(mark);
  }
};

function toggleItem(uid, lineNum) {
  // Clear any active table token highlights when interacting with the results panel
  if (window._cmHighlightMark) {
    window._cmHighlightMark.clear();
    window._cmHighlightMark = null;
  }
  window._lastHighlightedTokenId = null;

  const el = document.getElementById(uid);
  if (!el) return;
  const wasExpanded = el.classList.contains('details-open');
  el.classList.toggle('details-open');
  // When opening an item that has a line number, jump the editor to that line
  if (!wasExpanded && lineNum) {
    jumpToLine(lineNum);
  }
}
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'paste') requestAnimationFrame(() => { cm.refresh(); cm.focus(); });
}

// ─────────────────────────────────────────────────────────────────
// FILE HANDLING
// ─────────────────────────────────────────────────────────────────
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    ta.value = ev.target.result;
    // Switch to Paste Text tab so user can review/edit
    const pasteTab = document.querySelector('.tab[data-tab="paste"]');
    switchTab('paste', pasteTab);
    requestAnimationFrame(() => { cm.refresh(); cm.scrollTo(0, 0); });
    // Reset upload zone for next use
    DOM.uploadZone.style.display = 'flex';
    DOM.filePill.style.display = 'none';
    DOM.fileInput.value = '';
  };
  reader.readAsText(file);
}

function clearFile() {
  DOM.uploadZone.style.display = 'flex';
  DOM.filePill.style.display = 'none';
  DOM.fileInput.value = '';
}

DOM.uploadZone.addEventListener('dragover', e => { e.preventDefault(); DOM.uploadZone.classList.add('drag-over'); });
DOM.uploadZone.addEventListener('dragleave', () => DOM.uploadZone.classList.remove('drag-over'));
DOM.uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  DOM.uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile({ target: { files: [file] } });
});

