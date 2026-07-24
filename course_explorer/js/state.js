// =============================================================================
// STATE.JS
// All mutable global application state (course data caches, active filters, UI toggles, search/standards/media state).
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
let hasRunAuditConfig        = false;
let isRefreshMode            = false;
let debounceTimer;
let _processedInteractives   = new Set();

let searchWorker             = null;

let activeSearchModules               = new Set();
let activeSearchExcludePages          = false;
let activeSearchExcludeInteractives   = false;
let activeSearchExcludeStandards      = true;
let activeSearchExcludeML             = true;
let activeSearchExcludeNotes          = true;
let activeSearchExcludeHTML           = true;
let currentSearchResults         = [];
let currentSearchQuery           = "";
let currentSearchIsHtmlMode      = false;
let currentSearchHighlightRegex  = null;
let searchRenderCount            = 0;

let currentStdsSearchResults = [];
let activeStdsModules        = new Set();
let activeStdsStates         = new Set();
let currentStdsView          = 'lesson';
let currentGroupedStds       = [];
let stdsRenderCount          = 0;
let currentStdsQuery         = "";
let currentStdsExactPattern  = null;
let currentStdsFuzzyPattern  = null;

let sharedStandardColors     = new Map();
let colorIndexTracker        = 0;

let currentDisplayedMedia             = [];
let currentMediaRenderCount           = 0;
let currentMediaLayout                = localStorage.getItem('courseSearch_mediaLayout') || 'grid';
let currentMediaTab                   = 'images';
let activeMediaModules                = new Set();
let activeMediaFilterTypes            = new Set();
let activeMediaFilterMissingId        = false;
let activeMediaFilterHasAlt           = false;
let activeMediaFilterHasCaption       = false;
let activeMediaFilterHasCaptionHeader = false;
let activeMediaFilterHasTextVer       = false;
let activeMediaFilterCheckCopyright   = false;
let activeMediaFilterCheckTextVer     = false;
let isMediaFilterOpen                 = false;

let currentDownloadsView              = 'linked'; // 'linked' | 'unlinked'
let downloadsSearchQuery              = '';
let cachedUnlinkedDocuments           = null;     // computed lazily, invalidated on each new index run
let isGlobalDarkImageBg               = false;

let activeGlossaryLetters    = new Set();
let showOnlyDuplicates       = false;
let showOnlyUnused           = false;
let glossaryAudioFilter      = 'all'; // 'all', 'with', 'without'

let activeStandardGroups     = new Set();

let previousModalState       = null;
let currentAudioBlobUrl      = null;
// Readability Dashboard State
let readabilityHierarchy = [];
let currentTargetGrade   = 'high';

