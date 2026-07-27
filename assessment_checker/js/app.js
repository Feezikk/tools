'use strict';

// app.js
// Application bootstrap: wires up every event listener (buttons,
// resizable divider, editor-to-results two-way binding, save-file
// logic, accent-fix helper). Loads LAST, after every other module,
// since it references functions/elements defined throughout the app.
// Depends on: all other modules.

// ─────────────────────────────────────────────────────────────────
// RESIZABLE DIVIDER
// ─────────────────────────────────────────────────────────────────
(function initResizableDivider() {
  const leftPanel = document.querySelector('.left-panel');
  const workspace = document.querySelector('.workspace');
  let dragging = false, startX = 0, startW = 0;

  DOM.divider.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startW = leftPanel.getBoundingClientRect().width;
    DOM.divider.classList.add('dragging');
    document.body.style.cssText = 'cursor:col-resize;user-select:none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const maxW = workspace.getBoundingClientRect().width - 245;
    leftPanel.style.width = Math.max(240, Math.min(startW + e.clientX - startX, maxW)) + 'px';
    cm.refresh();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    DOM.divider.classList.remove('dragging');
    document.body.style.cssText = '';
  });
}());

// ─────────────────────────────────────────────────────────────────
// TWO-WAY BINDING (EDITOR CLICK TO RESULTS)
// ─────────────────────────────────────────────────────────────────
cm.on('mousedown', (instance, e) => {
  // Ignore clicks on scrollbars
  if (e.target.closest('.CodeMirror-vscrollbar') || e.target.closest('.CodeMirror-hscrollbar')) return;

  const pos = instance.coordsChar({left: e.clientX, top: e.clientY});
  const lineNum = pos.line + 1; // Convert 0-indexed CM to 1-indexed

  if (AppState.lineMap && AppState.lineMap[lineNum]) {
    const uids = AppState.lineMap[lineNum];
    if (!uids || !uids.length) return;

    // Take the first issue found on this line
    const targetId = uids[0];
    const resultEl = document.getElementById(targetId);
    if (!resultEl) return;

    // 1. Expand the parent Category drawer if closed
    const categorySection = resultEl.closest('.category-section');
    if (categorySection && !categorySection.classList.contains('open')) {
      categorySection.classList.add('open');
    }

    // 2. Expand the specific result item if closed
    if (!resultEl.classList.contains('details-open')) {
      resultEl.classList.add('details-open');
    }

    // 3. Smooth scroll the right panel to show this item
    setTimeout(() => {
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Briefly flash the background to draw the eye
      const originalBg = resultEl.style.backgroundColor;
      resultEl.style.transition = 'background-color 0.3s ease';
      resultEl.style.backgroundColor = 'var(--accent-light)';
      
      setTimeout(() => {
        resultEl.style.backgroundColor = originalBg;
        setTimeout(() => { resultEl.style.transition = ''; }, 300); // cleanup
      }, 700);
    }, 50);
  }
});

requestAnimationFrame(()=>{cm.refresh();cm.focus();});

// ─────────────────────────────────────────────────────────────────
// EVENT LISTENERS — wired here instead of inline HTML attributes
// ─────────────────────────────────────────────────────────────────

// Header: course type select
DOM.courseTypeSelect.addEventListener('change', function() {
  AppState.courseType = this.value;
});

// Header: Math Course checkbox — changes data-associatedlessons validation
DOM.mathCourseCheckbox.addEventListener('change', function() {
  AppState.mathCourse = this.checked;
});

// Header: course image folder input
DOM.imgBasePath.addEventListener('input', function() {
  AppState.imgCourseFolder = this.value.trim();
  AppState.imgBasePath = CDN_BASE + (AppState.imgCourseFolder ? AppState.imgCourseFolder + '/' : '');
  // If the user is typing manually, clear the auto-detected styling
  this.classList.remove('auto-detected');
  DOM.cdnAutoBadge.classList.remove('visible');
});

// Action bar
DOM.runAuditBtn.addEventListener('click', () => runAudit());
DOM.copyBtn.addEventListener('click', () => copyText(DOM.copyBtn));
DOM.clearAllBtn.addEventListener('click', () => clearAll());
DOM.autoFixAllBtn.addEventListener('click', e => applyAllFixes(e));

window.applyAccentFix = function() {
  const ACCENT_MAP = {
    'á':'&aacute;', 'é':'&eacute;', 'í':'&iacute;', 'ó':'&oacute;', 'ú':'&uacute;',
    'Á':'&Aacute;', 'É':'&Eacute;', 'Í':'&Iacute;', 'Ó':'&Oacute;', 'Ú':'&Uacute;',
    'ñ':'&ntilde;', 'Ñ':'&Ntilde;', 'ü':'&uuml;', 'Ü':'&Uuml;', '¿':'&iquest;', '¡':'&iexcl;',
    'à':'&agrave;', 'â':'&acirc;', 'æ':'&aelig;', 'ç':'&ccedil;', 'è':'&egrave;',
    'ê':'&ecirc;', 'ë':'&euml;', 'î':'&icirc;', 'ï':'&iuml;', 'ô':'&ocirc;',
    'œ':'&oelig;', 'ù':'&ugrave;', 'û':'&ucirc;', 'ÿ':'&yuml;',
    'À':'&Agrave;', 'Â':'&Acirc;', 'Æ':'&AElig;', 'Ç':'&Ccedil;', 'È':'&Egrave;',
    'Ê':'&Ecirc;', 'Ë':'&Euml;', 'Î':'&Icirc;', 'Ï':'&Iuml;', 'Ô':'&Ocirc;',
    'Œ':'&OElig;', 'Ù':'&Ugrave;', 'Û':'&Ucirc;', 'Ÿ':'&Yuml;'
  };
  const ACCENT_RE = /[áéíóúÁÉÍÓÚñÑüÜ¿¡àâæçèêëîïôœùûÿÀÂÆÇÈÊËÎÏÔŒÙÛŸ]/g;
  
  const text = ta.value;
  if (!ACCENT_RE.test(text)) return;
  
  const fixedText = text.replace(ACCENT_RE, char => ACCENT_MAP[char]);
  cm.operation(() => { cm.setValue(fixedText); });
  showToast('✨ Accented characters converted to HTML entities.');
  setTimeout(() => runAudit(), 60);
};

// Tab switching
document.querySelectorAll('.tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
});

// Upload zone
DOM.uploadZone.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', e => handleFile(e));
DOM.clearFileBtn.addEventListener('click', () => clearFile());

// Save File - Initialize database connection for cross-session folder memory
window._lastSaveHandle = null;
try {
  const req = indexedDB.open('FileSaveDB', 1);
  req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
  req.onsuccess = e => {
    const db = e.target.result;
    if (db.objectStoreNames.contains('handles')) {
      const tx = db.transaction('handles', 'readonly');
      const getReq = tx.objectStore('handles').get('lastSaveHandle');
      getReq.onsuccess = () => { window._lastSaveHandle = getReq.result; };
    }
  };
} catch(e) {}

DOM.saveFileBtn.addEventListener('click', async () => {
  const text = cm.getValue();
  if (!text.trim()) { 
    alert('Nothing to save.'); 
    return; 
  }
  
  // Modern approach: Native "Save As" window (Chrome/Edge)
  if ('showSaveFilePicker' in window) {
    try {
      const options = {
        id: 'assessment-checker-save-dir',
        suggestedName: 'assessment.txt',
        types: [{
          description: 'Text Files',
          accept: {'text/plain': ['.txt', '.html', '.htm']},
        }],
      };
      
      // Explicitly force Chrome to open in the directory of the last saved file
      if (window._lastSaveHandle) {
        options.startIn = window._lastSaveHandle;
      }

      const handle = await window.showSaveFilePicker(options);
      
      // Keep the handle in memory for this session
      window._lastSaveHandle = handle;
      
      // Save the handle to the browser's database for future sessions
      try {
        const req = indexedDB.open('FileSaveDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tx = db.transaction('handles', 'readwrite');
          tx.objectStore('handles').put(handle, 'lastSaveHandle');
        };
      } catch(e) {}

      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return; // Success!
    } catch (err) {
      // Ignore AbortError (user clicked cancel)
      if (err.name !== 'AbortError') console.error('Save failed:', err);
      return;
    }
  }

  // Fallback approach: standard download prompt (Firefox/Safari)
  let filename = prompt('Enter a name for your file:', 'assessment.txt');
  if (!filename) return; 
  
  if (!filename.toLowerCase().endsWith('.txt') && !filename.toLowerCase().endsWith('.html') && !filename.toLowerCase().endsWith('.htm')) {
    filename += '.txt';
  }
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Q-mode toggle
DOM.qmodeBtn.addEventListener('click', () => toggleQMode());

// Results panel
DOM.collapseAllBtn.addEventListener('click', () => closeAllResults());

// Dashboard
DOM.dashboardBtn.addEventListener('click', () => openDashboard());
DOM.dashOverlay.addEventListener('click', () => closeDashboard());
DOM.dashCloseBtn.addEventListener('click', () => closeDashboard());
