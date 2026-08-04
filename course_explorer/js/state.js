// =============================================================================
// STATE.JS
// Remaining global application state: course data caches, file/folder
// indexes, currently-selected-course bookkeeping, and the accessibility/
// footer-check caches. Most per-feature UI/filter state has been moved into
// namespaced objects owned by their respective modules (see the relocation
// comments below) — GlossaryState, ReadabilityState, MediaState, SearchState,
// and StandardsState.
// =============================================================================


let fileMap                  = new Map();
let courseIndex              = [];
let courseTree               = {};
let validModules             = [];
let courseVideos             = [];
let courseAudio              = [];
let courseInteractives       = [];
let courseImages             = [];
let courseDocuments          = [];
let courseGlossary           = [];
let foundGlossaryIds         = {};
let courseStandardsList      = [];
let courseStandardGroups     = new Set();
let fileNameIndex            = new Map();
let folderIndex              = new Map();

let availableCoursesFromScan = new Map();
let selectedCourseName       = "";
let extractedCourseTitle     = "";
let customCourseName         = "";

let currentModuleIndex       = -1;
let isAllExpanded            = false;
let hasRunMapConfig        = false;
let isRefreshMode            = false;
let debounceTimer;
let _processedInteractives   = new Set();

let searchWorker             = null;

// Content-search state (filters, active results, render pagination) moved to
// js/modules/search.js -> SearchState.

// Standards feature state (Standards-Search filters/results/rendering AND
// the Curriculum-Map group filter) moved to js/modules/search.js -> StandardsState.
// (See the comment there for why it's declared in search.js rather than
// standards.js, despite standards.js owning most of the actual logic.)

let currentDisplayedMedia             = []; // shared across media.js, glossary.js, app.js — see media.js top-of-file note

// Media Dashboard state (filters, layout, tab, downloads view, audio blob
// URL, etc.) moved to js/modules/media.js -> MediaState.


// Accessibility validation state (see js/modules/accessibility.js).
// Results are cached for the current session, keyed by course-relative file path,
// so a document already validated is never re-processed unless a new course is indexed.
let accessibilityResultsCache         = new Map();  // path -> { status: 'pass'|'fail'|'error'|'unavailable', issues: [...] }
let accessibilityQueue                = [];         // documents waiting to be validated
let accessibilityQueuedPaths          = new Set();  // paths currently queued/in-flight (de-dupe guard)
let accessibilityInProgress           = false;
let accessibilityProgress             = { completed: 0, total: 0 };

// FLVS Footer Check — a separate, non-WCAG check (required copyright/trademark
// footer text) that piggybacks on the same document pass/queue as Structure
// Check above (one zip read per file, run through whichever checks apply).
let footerCheckResultsCache           = new Map();  // path -> { status: 'pass'|'fail'|'error'|'unavailable', footerText }

// Glossary-tab filter state moved to js/modules/glossary.js -> GlossaryState
// (activeLetters, showOnlyDuplicates, showOnlyUnused, audioFilter).

// activeStandardGroups moved to js/modules/search.js -> StandardsState.activeGroups

let previousModalState       = null;
// currentAudioBlobUrl moved to js/modules/media.js -> MediaState.audioBlobUrl

// Readability Dashboard state moved to js/modules/readability.js -> ReadabilityState
// (hierarchy, allExpanded). The old currentTargetGrade global was dead code
// (never read or written anywhere) and was dropped rather than carried forward.

