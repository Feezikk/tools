'use strict';

// modules/find-replace.js
// Find & Replace panel: search/replace state, regex building, match
// navigation, and panel drag handling.
// Depends on: state.js, modules/editor.js (cm).

// ─────────────────────────────────────────────────────────────────
// FIND AND REPLACE
// ─────────────────────────────────────────────────────────────────

const FRState = { matches: [], activeIdx: -1 };

function getSearchRegex() {
  const query = DOM.frFindInput.value;
  if (!query) return null;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = DOM.frOptWord.checked ? '\\b' : '';
  const flags = DOM.frOptCase.checked ? 'g' : 'gi';
  try { return new RegExp(boundary + escaped + boundary, flags); } catch(e) { return null; }
}

function getReplacementText() {
  let rep = DOM.frReplaceInput.value;
  if (DOM.frOptBold.checked && DOM.frOptItalic.checked) rep = `<strong><em>${rep}</em></strong>`;
  else if (DOM.frOptBold.checked) rep = `<strong>${rep}</strong>`;
  else if (DOM.frOptItalic.checked) rep = `<em>${rep}</em>`;
  return rep;
}

function findMatches() {
  const re = getSearchRegex();
  FRState.matches = [];
  if (!re) {
    DOM.frNavText.textContent = 'No results';
    return;
  }
  const text = cm.getValue();
  let m;
  while ((m = re.exec(text)) !== null) {
    FRState.matches.push({ index: m.index, length: m[0].length });
    if (!re.global) break;
  }
  if (FRState.matches.length === 0) {
    DOM.frNavText.textContent = 'No results';
    FRState.activeIdx = -1;
  } else {
    if (FRState.activeIdx >= FRState.matches.length) FRState.activeIdx = 0;
    if (FRState.activeIdx < 0) FRState.activeIdx = 0;
    DOM.frNavText.textContent = `${FRState.activeIdx + 1} of ${FRState.matches.length}`;
  }
}

function goToMatch(idx) {
  if (!FRState.matches.length) return;
  FRState.activeIdx = (idx + FRState.matches.length) % FRState.matches.length;
  const match = FRState.matches[FRState.activeIdx];
  const from = cm.posFromIndex(match.index);
  const to = cm.posFromIndex(match.index + match.length);
  cm.setSelection(from, to);
  cm.scrollIntoView({ line: from.line, ch: from.ch }, 100);
  DOM.frNavText.textContent = `${FRState.activeIdx + 1} of ${FRState.matches.length}`;
}

// Keep match locations perfectly synced if the text is edited while the panel is open
cm.on('change', () => {
  if (DOM.frPanel.classList.contains('visible')) {
    findMatches();
  }
});

DOM.frToggleBtn.addEventListener('click', () => {
  DOM.frPanel.classList.toggle('visible');
  if (DOM.frPanel.classList.contains('visible')) {
    DOM.frFindInput.focus();
    findMatches();
    if (FRState.matches.length) goToMatch(0);
  }
});

DOM.frClose.addEventListener('click', () => DOM.frPanel.classList.remove('visible'));

[DOM.frFindInput, DOM.frOptCase, DOM.frOptWord].forEach(el => {
  el.addEventListener('input', () => { findMatches(); if (FRState.matches.length) goToMatch(0); });
});

DOM.frFindInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    goToMatch(FRState.activeIdx + (e.shiftKey ? -1 : 1));
  }
});

DOM.frNextBtn.addEventListener('click', () => goToMatch(FRState.activeIdx + 1));
DOM.frPrevBtn.addEventListener('click', () => goToMatch(FRState.activeIdx - 1));

DOM.frReplaceBtn.addEventListener('click', () => {
  if (!FRState.matches.length) return;
  const sel = cm.getSelection();
  const re = getSearchRegex();
  // Ensure the current selection perfectly matches our active search pattern
  if (re && new RegExp('^' + re.source + '$', re.flags.replace('g','')).test(sel)) {
    cm.replaceSelection(getReplacementText());
    findMatches();
    if (FRState.matches.length) goToMatch(FRState.activeIdx);
  } else {
    goToMatch(FRState.activeIdx);
  }
});

DOM.frReplaceAllBtn.addEventListener('click', () => {
  const re = getSearchRegex();
  if (!re) return;
  const matches = [...cm.getValue().matchAll(re)];
  if (!matches.length) return;
  
  const rep = getReplacementText();
  // Apply changes backward so shifting indices don't corrupt the replacement locations
  cm.operation(() => {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const from = cm.posFromIndex(m.index);
      const to = cm.posFromIndex(m.index + m[0].length);
      cm.replaceRange(rep, from, to);
    }
  });
  findMatches();
  showToast(`✨ Replaced ${matches.length} occurrences.`);
});

// Make panel draggable
let isDraggingFR = false, dragStartX, dragStartY, panelStartX, panelStartY;
DOM.frHeader.addEventListener('pointerdown', (e) => {
  if (e.target === DOM.frClose) return;
  isDraggingFR = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = DOM.frPanel.getBoundingClientRect();
  panelStartX = rect.left;
  panelStartY = rect.top;
  DOM.frHeader.setPointerCapture(e.pointerId);
});
DOM.frHeader.addEventListener('pointermove', (e) => {
  if (!isDraggingFR) return;
  DOM.frPanel.style.left = `${panelStartX + (e.clientX - dragStartX)}px`;
  DOM.frPanel.style.top = `${panelStartY + (e.clientY - dragStartY)}px`;
  DOM.frPanel.style.right = 'auto'; // Break the CSS right binding on first drag
});
DOM.frHeader.addEventListener('pointerup', (e) => {
  isDraggingFR = false;
  DOM.frHeader.releasePointerCapture(e.pointerId);
});
