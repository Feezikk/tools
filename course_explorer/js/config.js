// =============================================================================
// CONFIG.JS
// Application-wide constants: SVG icons, color palettes, Excel export styles, cached DOM element references, localStorage keys, and tunable batch/threshold settings.
// =============================================================================


// ── SVG Icon Library ──────────────────────────────────────────────────────────
const SVGS = {
    folder:     `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    video:      `<svg class="svg-icon" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`,
    audio:      `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`,
    interactive:`<svg class="svg-icon" viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="M13 13l6 6"></path></svg>`,
    glossary:   `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`,
    image:      `<svg class="svg-icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
    fileText:   `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    clipboard:  `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`,
    check:      `<svg class="svg-icon" viewBox="0 0 24 24" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    checkCircle:`<svg class="svg-icon" viewBox="0 0 24 24" stroke="currentColor"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    x:          `<svg class="svg-icon" viewBox="0 0 24 24" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    minus:      `<svg class="svg-icon" viewBox="0 0 24 24" stroke="currentColor"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
    alert:      `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    arrowUp:    `<svg class="svg-icon" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
    arrowDown:  `<svg class="svg-icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,
    logo:       `<svg class="svg-icon" style="width:28px;height:28px;" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`,
    search:     `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    code:       `<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
   wholeWord:  `<svg class="svg-icon" viewBox="0 0 24 24"><path style="fill: currentColor; stroke: none;" d="M7 6h3v7l-2 4H5l2-4V6zm9 0h3v7l-2 4h-3l2-4V6z"/></svg>`,
    matchCase:  `<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="4 20 9 5 14 20"></polyline><line x1="6" y1="15" x2="12" y2="15"></line><circle cx="18" cy="15" r="3"></circle><line x1="21" y1="20" x2="21" y2="12"></line></svg>`,
    layers:     `<svg class="svg-icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
    media:      `<svg class="svg-icon" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`,
    map:        `<svg class="svg-icon" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
    export:     `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`,
    download:   `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    config:     `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    back:       `<svg class="svg-icon" viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`,
    forward:    `<svg class="svg-icon" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
    refresh:    `<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
    maximize:   `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`,
    info:       `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
};

// ── Shared Standards Colour Palette ───────────────────────────────────────────
const SHARED_COLORS = [
    { bg: "#f8d7da", border: "#f5c6cb", text: "#721c24" },
    { bg: "#d4edda", border: "#c3e6cb", text: "#155724" },
    { bg: "#cce5ff", border: "#b8daff", text: "#004085" },
    { bg: "#fff3cd", border: "#ffeeba", text: "#856404" },
    { bg: "#d1ecf1", border: "#bee5eb", text: "#0c5460" },
    { bg: "#e2e3e5", border: "#d6d8db", text: "#383d41" },
    { bg: "#e0cffc", border: "#cbb1fa", text: "#42207a" },
    { bg: "#fde1ed", border: "#facce2", text: "#721a46" },
    { bg: "#ffe8cc", border: "#ffd8a8", text: "#d97706" },
    { bg: "#d8f5d1", border: "#c2ebba", text: "#2e6820" }
];

// ── Global Excel Styles ───────────────────────────────────────────────────────
const ExcelStyles = (() => {
    const b = {
        top:    { style: "thin", color: { rgb: "BFBFBF" } },
        bottom: { style: "thin", color: { rgb: "BFBFBF" } },
        left:   { style: "thin", color: { rgb: "BFBFBF" } },
        right:  { style: "thin", color: { rgb: "BFBFBF" } }
    };
    return {
        borderStyle:    b,
        sHeader:        { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, fill: { fgColor: { rgb: "1C355E" } }, alignment: { horizontal: "center", vertical: "center" }, border: b },
        sHeaderLeft:    { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 }, fill: { fgColor: { rgb: "1C355E" } }, alignment: { horizontal: "left",   vertical: "center" }, border: b },
        sTitle:         { font: { bold: true, color: { rgb: "1C355E" }, sz: 14 }, alignment: { horizontal: "left", vertical: "center" } },
        sText:          { alignment: { wrapText: true, vertical: "top"    }, border: b },
        sTextBold:      { font: { bold: true }, alignment: { wrapText: true, vertical: "top" } },
        sNumber:        { alignment: { horizontal: "center", vertical: "top" }, border: b },
        sLocation:      { alignment: { horizontal: "center", vertical: "top" }, border: b },
        sLocationWrap:  { alignment: { horizontal: "center", vertical: "top", wrapText: true }, border: b },
        sLessonDivider: { font: { bold: true, color: { rgb: "1C355E" }, sz: 12 }, fill: { fgColor: { rgb: "E7E6E6" } }, alignment: { horizontal: "left", vertical: "center" }, border: b },
        sCode:          { font: { name: "Consolas", sz: 10 }, alignment: { wrapText: true, vertical: "top" }, border: b },
        sHighlightLoc:  { fill: { fgColor: { rgb: "FFFF99" } }, alignment: { horizontal: "center", vertical: "top", wrapText: true }, border: b },
        sHighlightText: { fill: { fgColor: { rgb: "FFFF99" } }, alignment: { wrapText: true, vertical: "top" }, border: b },
        sModRow:        { font: { bold: true, color: { rgb: "1C355E" }, sz: 12 }, fill: { fgColor: { rgb: "F6BF41" } } },
        sLesBar:        { font: { bold: true }, fill: { fgColor: { rgb: "E7E6E6" } }, border: { top: { style: "thin" }, bottom: { style: "thin" } }, alignment: { vertical: "center" } },
        sGap:           { font: { color: { rgb: "9C0006" } }, fill: { fgColor: { rgb: "FFC7CE" } }, alignment: { horizontal: "center", vertical: "center" } },
        sGood:          { font: { color: { rgb: "006100" } }, fill: { fgColor: { rgb: "C6EFCE" } }, alignment: { horizontal: "center", vertical: "center" } },
        sNeutral:       { font: { color: { rgb: "44546A" } }, fill: { fgColor: { rgb: "E7E6E6" } }, alignment: { horizontal: "center", vertical: "center" } }
    };
})();

// ── DOM Cache ─────────────────────────────────────────────────────────────────
const elements = {
    dropZone:            document.getElementById('drop-zone'),
    setupArea:           document.getElementById('setup-area'),
    input:               document.getElementById('folder-input'),
    status:              document.getElementById('status-area'),
    historyArea:         document.getElementById('history-area'),
    historyList:         document.getElementById('history-list'),
    selectCourseBtn:     document.getElementById('select-course-btn'),
    refreshBtn:          document.getElementById('refresh-btn'),
    viewSwitcher:        document.getElementById('view-switcher'),
    viewBtns:            document.querySelectorAll('.view-btn'),
    mainTitle:           document.getElementById('main-title'),
    searchWrapper:       document.getElementById('search-wrapper'),
    searchInput:         document.getElementById('search-input'),
    searchClearBtn:      document.getElementById('search-clear-btn'),
    htmlToggle:          document.getElementById('html-toggle'),
    wholeWordToggle:     document.getElementById('whole-word-toggle'),
    caseSensitiveToggle: document.getElementById('case-sensitive-toggle'),
    exportSearchBtn:     document.getElementById('export-search-btn'),
    searchStats:         document.getElementById('search-stats'),
    results:             document.getElementById('results-area'),
    stdsSearchArea:      document.getElementById('stds-search-area'),
    stdsSearchInput:     document.getElementById('stds-search-input'),
    stdsSearchClear:     document.getElementById('stds-search-clear'),
    exportStdsBtn:       document.getElementById('export-stds-btn'),
    fullscreenStdsBtn:   document.getElementById('fullscreen-stds-btn'),
    stdsStats:           document.getElementById('stds-stats'),
    mediaArea:           document.getElementById('media-area'),
    auditTopBar:         document.getElementById('audit-top-bar'),
    dashboardGrid:       document.getElementById('dashboard-grid'),
    auditDetailArea:     document.getElementById('audit-detail-area'),
    auditDetailContent:  document.getElementById('module-detail-content'),
    auditFilterRadios:   document.querySelectorAll('input[name="audit-filter"]'),
    toggleAllBtn:        document.getElementById('toggle-all-btn'),
    gapToggle:           document.getElementById('gap-toggle'),
    configScreen:        document.getElementById('config-screen'),
};

// ── Persistence Keys ──────────────────────────────────────────────────────────
const HISTORY_KEY = 'courseSearch_recentFolder';
const STATE_KEY   = 'courseSearch_appState';
const CONFIG_KEY  = 'courseSearch_auditConfig';
const NAME_KEY    = 'courseSearch_courseName';

// ── Constants ─────────────────────────────────────────────────────────────────
const IGNORE_TITLES     = ["style guide", "styleguide"];
const IGNORE_IDS        = ["wf", "gs"];
const SEARCH_BATCH_SIZE = 25;
const STDS_BATCH_SIZE   = 25;
const MEDIA_BATCH_SIZE  = 25;
	
// ── Readability Constants ─────────────────────────────────────────────────────
const GRADE_LEVEL_THRESHOLDS = {
    early_elem: { name: "Early Elem (K-2)", wpm: 80,  maxWords: 12, targetMin: 0,  targetMax: 2.9 },
    upper_elem: { name: "Upper Elem (3-5)", wpm: 130, maxWords: 15, targetMin: 3,  targetMax: 5.9 },
    middle:     { name: "Middle (6-8)",     wpm: 170, maxWords: 20, targetMin: 6,  targetMax: 8.9 },
    high:       { name: "High (9-12)",      wpm: 220, maxWords: 25, targetMin: 9,  targetMax: 12.9 }
};

