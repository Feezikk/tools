'use strict';

// state.js
// Centralised mutable runtime state (AppState) and a single cached
// lookup table of DOM elements (DOM), used by every other module.
// Depends on: nothing (must load first, after config.js).

// ─────────────────────────────────────────────────────────────────
// APP STATE — centralised mutable state (replaces scattered window._ globals)
// ─────────────────────────────────────────────────────────────────
const AppState = {
  lineMap:          {},
  activeFilter:     'all',   // current filter mode: 'all' | 'err' | 'warn'
  dashData:         null, // built by buildDashboardData after each audit
  dashMeta:         null, // { questions, groups }
  courseType:       'R',  // 'R' | 'H' | 'M' set by header dropdown
  mathCourse:       false, // set by the header "Math Course" checkbox; changes data-associatedlessons validation
  imgCourseFolder:  '',   // set by the header input
  imgBasePath:      '',   // derived from imgCourseFolder
  hasRunOnce:       false,
  openCategories:   new Set(),
  qMode:            false,   // question-number gutter mode
  qLineMap:         {},      // lineNum (1-based) → { qNum, group } built after audit
};

// ─────────────────────────────────────────────────────────────────
// DOM CACHE — one lookup per element, used everywhere below
// ─────────────────────────────────────────────────────────────────
const DOM = (() => {
  const $ = id => document.getElementById(id);
  return {
    // Header
    imgBasePath:    $('img-base-path'),
    cdnAutoBadge:   $('cdn-auto-badge'),
    courseTypeSelect: $('course-type-select'),
    mathCourseCheckbox: $('math-course-checkbox'),
    dashboardBtn:   $('dashboard-btn'),
    // Left panel
    cmEditor:       $('cm-editor'),
    uploadZone:     $('upload-zone'),
    filePill:       $('file-pill'),
    fileInput:      $('file-input'),
    // Action bar
    runAuditBtn:    $('run-audit-btn'),
    copyBtn:        $('copy-btn'),
    clearAllBtn:    $('clear-all-btn'),
   
    autoFixAllBtn:  $('autofix-all-btn'),
    // Right panel
    resultsBody:    $('results-body'),
    summaryChips:   $('summary-chips'),
    collapseAllBtn: $('collapse-all-btn'),
    chipError:      $('chip-error'),
    chipWarn:       $('chip-warn'),
    chipPass:       $('chip-pass'),
    qStrip:         $('q-strip'),
    statusBar:      $('status-bar'),
    statusText:     $('status-text'),
    // Divider
    divider:        $('divider'),
    // Dashboard modal
    dashOverlay:    $('dashboard-overlay'),
    dashModal:      $('dashboard-modal'),
    dashMeta:       $('dash-meta'),
    dashTbody:      $('dash-tbody'),
    // Tab buttons
    clearFileBtn:   $('clear-file-btn'),
    dashCloseBtn:   $('dash-close-btn'),
    filterBar:      $('filter-bar'),
    filterAll:      $('filter-all'),
    filterErr:      $('filter-err'),
    filterWarn:     $('filter-warn'),
    qmodeBtn:       $('qmode-btn'),
    saveFileBtn:    $('save-file-btn'),
    // Find & Replace
    frToggleBtn:    $('fr-toggle-btn'),
    frPanel:        $('fr-panel'),
    frHeader:       $('fr-header'),
    frClose:        $('fr-close'),
    frFindInput:    $('fr-find-input'),
    frReplaceInput: $('fr-replace-input'),
    frOptCase:      $('fr-opt-case'),
    frOptWord:      $('fr-opt-word'),
    frOptBold:      $('fr-opt-bold'),
    frOptItalic:    $('fr-opt-italic'),
    frNavText:      $('fr-nav-text'),
    frPrevBtn:      $('fr-prev-btn'),
    frNextBtn:      $('fr-next-btn'),
    frReplaceBtn:   $('fr-replace-btn'),
    frReplaceAllBtn:$('fr-replace-all-btn'),
  };
})();

