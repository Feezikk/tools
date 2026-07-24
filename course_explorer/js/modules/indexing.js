// =============================================================================
// INDEXING.JS
// Turns raw scanned files into the course index: the main indexing entry point, recursive content extraction, and per-page processing.
// =============================================================================


async function runIndexingAndShowUI(wasRefreshed) {
    try {
        elements.status.style.display = 'block';
        elements.status.innerHTML     =
            `<div class="spinner"></div> Indexing content &amp; parsing settings…`;

        courseIndex         = [];
        courseTree          = {};
        validModules        = [];
		readabilityHierarchy = null;
        courseVideos        = [];
        courseAudio         = [];
        courseInteractives  = [];
        courseImages        = [];
        courseDocuments     = [];
        currentDownloadsView = 'linked';
        downloadsSearchQuery = '';
        cachedUnlinkedDocuments = null;
        courseGlossary      = [];
        foundGlossaryIds    = {};
        courseStandardsList = [];
        currentModuleIndex  = -1;

        courseStandardGroups.clear();
        activeStandardGroups.clear();
        activeStdsModules.clear();
        activeStdsStates.clear();
        activeSearchModules.clear();
        activeSearchExcludePages          = false;
        activeSearchExcludeInteractives   = false;
        activeSearchExcludeHTML           = true;
        activeSearchExcludeStandards      = true;
        activeSearchExcludeML             = true;
        activeSearchExcludeNotes          = true;

        currentSearchResults     = [];
        currentStdsSearchResults = [];
        activeGlossaryLetters.clear();
        showOnlyDuplicates = false;
        showOnlyUnused = false;
        glossaryAudioFilter = 'all';
        extractedCourseTitle = "";
        fileNameIndex.clear();
        folderIndex.clear();

        elements.searchInput.value            = '';
        elements.searchClearBtn.style.display = 'none';
        elements.results.innerHTML            = '';
        currentSearchQuery                    = "";
        currentSearchHighlightRegex           = null;

        elements.stdsSearchInput.value         = '';
        elements.stdsSearchClear.style.display = 'none';
        const stdsGrid = document.getElementById('stds-results-grid');
        if (stdsGrid) stdsGrid.innerHTML = '';

        currentStdsQuery        = "";
        currentStdsExactPattern = null;
        currentStdsFuzzyPattern = null;
        currentGroupedStds      = [];
        stdsRenderCount         = 0;

        currentStdsView = 'lesson';
        const resetStdsRadio = document.querySelector('input[name="stds-view"][value="lesson"]');
        if (resetStdsRadio) resetStdsRadio.checked = true;
        elements.fullscreenStdsBtn.style.display = 'none';

        const glossarySearch = document.getElementById('glossary-search');
        if (glossarySearch) glossarySearch.value = '';

        const settingsFile =
            fileMap.get('settings.json') ||
            fileMap.get('global/data/settings.json') ||
            fileMap.get('data/settings.json');

        if (settingsFile) {
            try {
                const settingsJson = JSON.parse(await settingsFile.text());
                function findCourseTitle(obj) {
                    if (!obj || typeof obj !== 'object') return null;
                    if (typeof obj.course_title === 'string' && obj.course_title.trim()) {
                        return obj.course_title.trim();
                    }
                    for (const key in obj) {
                        const found = findCourseTitle(obj[key]);
                        if (found) return found;
                    }
                    return null;
                }
                extractedCourseTitle = findCourseTitle(settingsJson) || "";
            } catch (e) {
                console.warn("Could not parse settings.json");
            }
        }

        if (!wasRefreshed) localStorage.removeItem(NAME_KEY);
        const savedName    = localStorage.getItem(NAME_KEY) || "";
        const displayTitle = extractedCourseTitle || selectedCourseName || savedName || "Course";

        if (displayTitle) {
            customCourseName = displayTitle;
            localStorage.setItem(NAME_KEY, customCourseName);
            elements.mainTitle.textContent = customCourseName;
            document.title = customCourseName;
        }

        const sitemapFile =
            fileMap.get('sitemap.json') ||
            fileMap.get('global/sitemap.json');
        if (!sitemapFile) {
            throw new Error("Could not locate sitemap.json within the selected course structure.");
        }
        courseTree = JSON.parse(await sitemapFile.text());
        await buildIndexAndHydrate(courseTree);

        let rawGlossaryMap = {};
        const glossaryFile = fileMap.get('global/data/glossary.json');
        if (glossaryFile) {
            try {
                const glossaryData = JSON.parse(await glossaryFile.text());
                const items = Array.isArray(glossaryData)
                    ? glossaryData
                    : (glossaryData.items || glossaryData.terms || []);
                if (Array.isArray(items)) {
                    items.forEach(item => {
                        if (item.id) rawGlossaryMap[item.id.toString()] = item;
                    });
                }
            } catch (e) { /* glossary is optional */ }
        }

        try {
            courseIndex.sort((a, b) =>
                (a.locationId || "").localeCompare(b.locationId || "") ||
                (a.breadcrumb || "").localeCompare(b.breadcrumb || "", undefined, { numeric: true })
            );
        } catch (e) {}

       // 1. Add terms that were found in the content
        for (const [id, locMap] of Object.entries(foundGlossaryIds)) {
            const data = rawGlossaryMap[id.toString()];
            
            let fallbackName = `Glossary Term ${id}`;
            let termAudioPath = null;
            const locationsArray = [];
            
            const sortedLocs = Array.from(locMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            
            for (const [lId, locData] of sortedLocs) {
                // Grab the first audio path we find for this term
                if (!termAudioPath && locData.audioPath) termAudioPath = locData.audioPath;
                if (fallbackName === `Glossary Term ${id}` && locData.termName) fallbackName = locData.termName;
                locationsArray.push(locData.audioPath ? `${lId} 🔊` : lId);
            }

            courseGlossary.push({
                id,
                title:      data ? (data.term || data.title)  : fallbackName,
                definition: data ? data.definition             : "<em>Definition not found in course glossary data.</em>",
                locations:  locationsArray,
                audioPath:  termAudioPath
            });
        }

        // 2. Add unused terms (in JSON, not in content, and not hidden)
        for (const [id, data] of Object.entries(rawGlossaryMap)) {
            if (!foundGlossaryIds[id] && data.hide !== true && data.hide !== "true") {
                courseGlossary.push({
                    id,
                    title:      data.term || data.title || `Glossary Term ${id}`,
                    definition: data.definition || "<em>No definition provided.</em>",
                    locations:  [] // Empty array means it's orphaned/unused
                });
            }
        }

        courseGlossary.sort((a, b) => a.title.localeCompare(b.title));

        const mediaSort = (a, b) =>
            (a.locationId || "").localeCompare(b.locationId || "") ||
            (a.title || a.fileName || "").localeCompare(b.title || b.fileName || "");
        try {
            courseVideos.sort(mediaSort);
            courseAudio.sort(mediaSort);
            courseInteractives.sort(mediaSort);
            courseImages.sort(mediaSort);
        } catch (e) {}

        buildValidModuleList();
		buildReadabilityHierarchy();

        activeSearchModules.clear();
        activeSearchExcludePages          = false;
        activeSearchExcludeInteractives   = false;
        activeSearchExcludeHTML           = true;
        activeSearchExcludeStandards      = true;
        activeSearchExcludeML             = true;
        activeSearchExcludeNotes          = true;
        renderSearchFilters();

        activeStdsModules.clear();
        activeStdsStates.clear();
        renderStdsFilters();

        applyDefaultOrSavedConfig();

        const stdWrapper = document.getElementById('std-filter-wrapper');
        const stdDivider = document.getElementById('std-filter-divider');
        if (stdWrapper && stdDivider) {
            const hasMultiple = courseStandardGroups.size > 1;
            stdWrapper.style.display = hasMultiple ? 'inline-block' : 'none';
            stdDivider.style.display = hasMultiple ? 'block'        : 'none';
            activeStandardGroups.clear();
            if (hasMultiple) window.renderStdFilterDropdown();
        }

        elements.viewSwitcher.style.display    = 'inline-flex';
        elements.selectCourseBtn.style.display = 'inline-flex';
        elements.refreshBtn.style.display      = 'inline-flex';
        elements.status.style.display          = 'none';

        if (searchWorker) {
            searchWorker.postMessage({ type: 'INIT', index: courseIndex });
        }

        showToast(`Loaded ${courseIndex.length} pages/interactives.`);

        if (!wasRefreshed) hasRunAuditConfig = false;
        isRefreshMode = false;

        if (wasRefreshed && localStorage.getItem(STATE_KEY)) restoreAppState();
        else switchView('search');

        if (elements.searchInput.value.trim().length > 0) {
            runSearch(elements.searchInput.value);
        }

    } catch (error) {
        elements.status.innerHTML =
            `<span style="color:#dc3545; font-weight:bold;">
                ${SVGS.x} Error during indexing: ${error.message}
             </span>`;
        elements.setupArea.style.display = 'block';
    }
}

async function buildIndexAndHydrate(sitemap) {
    _processedInteractives = new Set();
    if (!sitemap.modules) return;

    fileNameIndex.clear();
    folderIndex.clear();
    for (const key of fileMap.keys()) {
        const parts = key.split('/');
        const name  = parts[parts.length - 1];
        if (!fileNameIndex.has(name)) fileNameIndex.set(name, []);
        fileNameIndex.get(name).push(key);

        if (parts.length > 1) {
            const folder = parts[parts.length - 2];
            if (!folderIndex.has(folder)) folderIndex.set(folder, []);
            folderIndex.get(folder).push(key);
        }
    }

    const tasks = [];
        sitemap.modules.forEach(module => {
            const title = String(module.title || "").toLowerCase();
            const id    = String(module.mID   || "").toLowerCase();
            if (IGNORE_TITLES.some(k => title.includes(k)) || IGNORE_IDS.includes(id)) {
                return; 
            }

            if (!module.lessons) return;
            module.lessons.forEach(lesson => {
            lesson._topic            = lesson.topic || null;
            lesson._parsedObjectives =
                (lesson.objectives?.items?.length > 0)
                    ? lesson.objectives.items
                    : null;

            if (!lesson.pages) return;
            lesson.pages.forEach(page => {
                const breadcrumb = `${module.title} > ${lesson.title} > ${page.title}`;
                const locationId = `${padNum(module.num)}.${padNum(lesson.num)}.${padNum(Number(page.num) + 1)}`;
                if (page.src && fileMap.has(page.src)) {
                    tasks.push(() => processPage(page.src, breadcrumb, locationId, page));
                } else {
                    page._parsedStandards = null;
                }
            });
        });
    });

    const CHUNK_SIZE = 10;
    for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
        await Promise.all(tasks.slice(i, i + CHUNK_SIZE).map(fn => fn()));
    }

    try {
        courseStandardsList.sort((a, b) =>
            (a.locationId || "").localeCompare(b.locationId || "", undefined, { numeric: true })
        );
    } catch (e) {}
}


function extractContentRecursive(obj) {
    const streams = {
        normal: { clean: [], raw: [] },
        ml:     { clean: [], raw: [] },
        std:    { clean: [], raw: [] },
        note:   { clean: [], raw: [] },
        media:  { clean: [], raw: [] }
    };

    // LAYER 1: Aggressively stripped blocklist
    const ignoreKeys = new Set([
        // Structural / layout keys
        'id', 'type', 'contenttype', 'status', 'classes', 'version',
        'grid', 'combotype', 'print', 'reveal', 'revealtitle',
        'imgclasses', 'lightbox', 'animation', 'animbutton', 'animduration', 'unlock',
        'layout', 'align', 'alignment', 'position', 'role', 'ariahidden', 'tabindex', 'src',
        // Page metadata — block entire info subtree
        'title', 'recoveredcontent', 'complexity', 'designedfor', 'duration', 'grades',
        'badstandardmatches', 'info',
        // Quiz / interactive feedback keys — not prose, skews readability scores
            'correct', 'incorrect', 'failed', 'quiz', 'answer', 'directions',
            // Machine Learning / Chat History
            'chathistory', 'ml'
        ]);

    const mediaKeys = new Set(['alttext', 'caption', 'captionheader', 'textversion', 'copyright']);
    const hasTags    = /<[^>]+>/;

    function traverse(o, ctx) {
        if (!o) return;
        if (Array.isArray(o)) { for (const item of o) traverse(item, ctx); return; }
        if (typeof o === 'object') {
            for (const key in o) {
                // STRIP ALL SPACES AND SYMBOLS from the key name to catch authoring tool quirks
                const safeKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();

                if (ignoreKeys.has(safeKey)) continue;

                let nextCtx = ctx;
                if      (safeKey === 'ml'        || safeKey === 'chathistory') nextCtx = 'ml';
                else if (safeKey === 'standards' || safeKey === 'standard')    nextCtx = 'std';
                else if (safeKey === 'notes'     || safeKey === 'note')        nextCtx = 'note';
                else if (mediaKeys.has(safeKey))                               nextCtx = 'media';

                const val = o[key];
                if (typeof val === 'string' && val.trim() !== '') {
                    // LAYER 2: Value Sniper — exact-match structural noise
                    const cleanVal = val.trim();
                    if (/^(col-(md|sm|xs|lg)-\d+\s*)+$/.test(cleanVal)) continue;
                    if (/^(left|right|center|top|bottom|title|subtitle|visible|hidden)$/i.test(cleanVal)) continue;

                    // LAYER 3: Contains-match for structural artifacts that slipped through
                    if (/col-(md|sm|xs|lg)-\d+/.test(cleanVal)) continue;
                    if (/"contentType"\s*:/.test(cleanVal)) continue;
                    if (/"fieldValues"\s*:/.test(cleanVal)) continue;

                    streams[nextCtx].raw.push(val);
                    streams[nextCtx].clean.push(hasTags.test(val) ? stripHtml(val) : val);
                } else {
                    traverse(val, nextCtx);
                }
            }
        }
    }

    traverse(obj, 'normal');

    // Helper to ensure every extracted text block acts like a proper sentence
    function formatStream(arr) {
        return arr.map(s => {
            let str = s.trim();
            // If the string doesn't end with punctuation, force a period so the math treats it as a separate sentence
            if (str && !/[.!?]$/.test(str)) str += ".";
            return str;
        }).join(" ");
    }

    return {
        normalClean: formatStream(streams.normal.clean),
        normalRaw:   formatStream(streams.normal.raw),
        mlClean:     formatStream(streams.ml.clean),
        mlRaw:       formatStream(streams.ml.raw),
        stdClean:    formatStream(streams.std.clean),
        stdRaw:      formatStream(streams.std.raw),
        noteClean:   formatStream(streams.note.clean),
        noteRaw:     formatStream(streams.note.raw),
        mediaClean:  formatStream(streams.media.clean),
        mediaRaw:    formatStream(streams.media.raw),
    };
}

function determineInteractiveType(rawJsonString) {
    const srcMatch = rawJsonString.match(/"src"\s*:\s*"([^"]+)"/i);
    if (srcMatch?.[1]) {
        const val = srcMatch[1].toLowerCase();
        if (val !== "quizmo" && val !== "quizmo2") return srcMatch[1];
    }
    const typeMatches = [...rawJsonString.matchAll(/"type"\s*:\s*"([^"]+)"/gi)].map(m => m[1]);
    if (!typeMatches.length) return "undetermined";
    return (typeMatches[0].toLowerCase() === "config")
        ? (typeMatches[1] || "undetermined")
        : typeMatches[0];
}

function extractGlossaryIds(text, locId) {
    if (!text) return;
    
    // Helper to check for nearby audio and extract the path
    const checkAudio = (index) => {
        const windowSize = 200;
        const start = Math.max(0, index - windowSize);
        const end = Math.min(text.length, index + windowSize);
        const context = text.substring(start, end);
        
        let m = /<element[^>]+data-type=\\?["']audio\\?["'][^>]*?(?:data-src|src|data-cbdisplay)=\\?["']([^"']+\.mp3)\\?["']/i.exec(context);
        if (m) return m[1];
        
        m = /\[\[\s*audio\b[^\]]*?([^|\s\]"']+\.mp3)[^\]]*?\]\]/i.exec(context);
        if (m) return m[1];
        
        return null;
    };

    const addGlossaryHit = (id, index, termName) => {
        if (!foundGlossaryIds[id]) foundGlossaryIds[id] = new Map();
        const audioPath = checkAudio(index);
        
        const current = foundGlossaryIds[id].get(locId) || { audioPath: null, termName: termName };
        foundGlossaryIds[id].set(locId, { 
            audioPath: current.audioPath || audioPath, 
            termName: termName ? termName.trim() : current.termName 
        });
    };

    const elementRegex = /<element\b([^>]*)>(?:(.*?)<\/element>)?/gi;
    let match;
    while ((match = elementRegex.exec(text)) !== null) {
        const attrs = match[1];
        const innerText = match[2] ? match[2].replace(/<[^>]+>/g, '') : "";
        if (!/data-type=\\?["']glossary\\?["']/i.test(attrs)) continue;
        const idMatch = attrs.match(/data-id=\\?["'](\d+)\\?["']/i);
        if (idMatch?.[1]) addGlossaryHit(idMatch[1], match.index, innerText);
    }

    const bracketRegex = /\[\[\s*glossary\s*\|\s*(\d+)\s*\|\s*([^\]]+?)\s*\]\]/gi;
    while ((match = bracketRegex.exec(text)) !== null) {
        addGlossaryHit(match[1], match.index, match[2]);
    }
}

function extractMp3Files(text, locationId, breadcrumb) {
    const found = [];
    if (!text) return found;
    const mp3Regex = /(?:data-src|src|data-cbdisplay)=\\?["']([^"']+\.mp3)\\?["']|\[\[\s*audio[^\]]*?([^|\s\]"']+\.mp3)[^\]]*?\]\]/gi;
        const seen     = new Set();
        let match;
        while ((match = mp3Regex.exec(text)) !== null) {
            const fullPath = match[1] || match[2];
        if (seen.has(fullPath)) continue;
        seen.add(fullPath);
        const filename = fullPath.split('/').pop().replace(/\.mp3$/i, '');
        found.push({
            locationId, breadcrumb, entryId: "Unknown",
            kalturaType: "mp3", title: filename, textVersion: "", mp3Path: fullPath
        });
    }
    return found;
}

function extractDocuments(text, locationId, breadcrumb) {
    // Detects downloadable-document links. The authoring tool renders these
    // as a plain HTML anchor tag, e.g.:
    //   <a href="content/documents/guided_notes_01_gearing_up.docx" class="dLoad"
    //      data-cbdisplay="Guided Notes (.docx)">Guided Notes (.docx)</a>
    // A document is only counted when the anchor's class list includes "dLoad".
    //
    // NOTE: this runs against the RAW (unparsed) page JSON text, so quotes
    // inside the embedded HTML show up escaped as \" — every quote in the
    // regexes below therefore optionally matches a leading backslash.
    const found = [];
    if (!text) return found;

    const q = '\\\\?["\']'; // a real quote, optionally preceded by a JSON-escaping backslash

    const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(text)) !== null) {
        const attrs     = match[1];
        const innerHtml = match[2];

        const classMatch = attrs.match(new RegExp('class\\s*=\\s*' + q + '([^"\'\\\\]*)' + q, 'i'));
        const classes = classMatch ? classMatch[1].split(/\s+/) : [];
        if (!classes.some(c => c.toLowerCase() === 'dload')) continue;

        const hrefMatch = attrs.match(new RegExp('href\\s*=\\s*' + q + '([^"\'\\\\]*)' + q, 'i'));
        if (!hrefMatch) continue;
        const path = hrefMatch[1].trim();
        if (!path) continue;

        const displayMatch = attrs.match(new RegExp('data-cbdisplay\\s*=\\s*' + q + '([^"\'\\\\]*)' + q, 'i'));
        const title = displayMatch ? displayMatch[1].trim() : innerHtml.replace(/<[^>]*>/g, '').trim();

        const cleanPath = path.replace(/^\/+/, '');
        const fileName  = cleanPath.split('/').pop() || cleanPath;
        const fileType  = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase();

        found.push({ locationId, breadcrumb, title: title || fileName, path: cleanPath, fileName, fileType });
    }

    // Fallback: some course versions may instead use a bracket-tag authoring
    // shorthand, e.g. [[ link | Title | path | dLoad ]]. Kept as a safety net.
    const bracketRegex = /\[\[\s*link\b([^\]]*)\]\]/gi;
    while ((match = bracketRegex.exec(text)) !== null) {
        const parts = match[1].split('|').map(p => p.trim()).filter(p => p !== '');
        if (parts.length < 2) continue;

        const marker = parts[parts.length - 1];
        if (marker.toLowerCase() !== 'dload') continue;

        const title = parts[0];
        const middleParts = parts.slice(1, -1);
        const path = middleParts.find(p => /\.[a-z0-9]{2,5}$/i.test(p)) || middleParts[middleParts.length - 1] || '';
        if (!path) continue;

        const cleanPath = path.replace(/^\/+/, '');
        const fileName  = cleanPath.split('/').pop() || cleanPath;
        const fileType  = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase();

        found.push({ locationId, breadcrumb, title, path: cleanPath, fileName, fileType });
    }

    return found;
}

function extractMediaTitle(htmlString, mediaType = 'unknown') {
    if (!htmlString) return "Untitled Media";
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlString;
    const heading = tmp.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading?.textContent.trim()) return heading.textContent.trim();
    if (mediaType === 'audio' || mediaType === 'video') {
        const text = tmp.querySelector('p')?.textContent.trim() || tmp.textContent.trim();
        if (text) return text.length > 60 ? text.substring(0, 60) + '…' : text;
    }
    return "Untitled Media";
}

function findMedia(obj, locationId, breadcrumb, mediaType, found = []) {
    if (!obj) return found;
    if (Array.isArray(obj)) {
        obj.forEach(item => findMedia(item, locationId, breadcrumb, mediaType, found));
    } else if (typeof obj === 'object') {
        const validTypes = mediaType === 'video'
            ? ['video', 'videoNoCC', 'videoplaylist']
            : ['audio', 'audiobtn'];
        if (
            obj.contentType === 'media' &&
            obj.fieldValues &&
            validTypes.includes(obj.fieldValues.kalturaType)
        ) {
            const textVer = obj.fieldValues.textVersion || "";
            found.push({
                locationId, breadcrumb,
                entryId:     obj.fieldValues.kalturaEntryId || "Unknown",
                kalturaType: obj.fieldValues.kalturaType,
                title:       extractMediaTitle(textVer, mediaType),
                textVersion: textVer
            });
        }
        for (const key in obj) findMedia(obj[key], locationId, breadcrumb, mediaType, found);
    }
    return found;
}

function extractImages(obj, locationId, breadcrumb, found = []) {
    if (!obj) return found;
    if (Array.isArray(obj)) {
        obj.forEach(item => extractImages(item, locationId, breadcrumb, found));
    } else if (typeof obj === 'object') {
        if (obj.contentType === 'image' && obj.fieldValues) {
            const fv = obj.fieldValues;
            const src = fv.src || "";
            const fileName = src.split('/').pop() || "Unknown";
            const fileType = fileName.split('.').pop().toLowerCase() || "unknown";

            found.push({
                locationId, breadcrumb,
                src: src,
                fileName: fileName,
                fileType: fileType,
                altText: fv.altText || "",
                caption: fv.caption || "",
                captionHeader: fv.captionHeader || "",
                copyright: fv.copyright || "",
                textVersion: fv.textVersion || "",
                rawJson: JSON.stringify(obj, null, 2)
            });
        }
        for (const key in obj) {
            extractImages(obj[key], locationId, breadcrumb, found);
        }
    }
    return found;
}

function findInteractivesPaths(obj, found = []) {
    if (!obj) return found;
    if (Array.isArray(obj)) {
        obj.forEach(item => findInteractivesPaths(item, found));
    } else if (typeof obj === 'object') {
        if (obj.contentType === 'interactive' && obj.fieldValues?.value) {
            // Push an object containing the path, type, and textVersion
            found.push({
                path: obj.fieldValues.value,
                type: obj.fieldValues.type || 'unknown',
                textVersion: obj.fieldValues.textVersion || ''
            });
        }
        for (const key in obj) findInteractivesPaths(obj[key], found);
    }
    return found;
}

function extractInteractiveMeta(obj) {
    let meta = { title: "Untitled Interactive" }, titlePriority = 0;
    function scan(o) {
        if (!o || typeof o !== 'object' || titlePriority === 2) return;
        if (typeof o.interactiveTitle === 'string' && o.interactiveTitle.trim()) {
            meta.title = stripHtml(o.interactiveTitle); titlePriority = 2; return;
        }
        if (titlePriority < 1 && typeof o.title === 'string' && o.title.trim()) {
            meta.title = stripHtml(o.title); titlePriority = 1;
        }
        if (Array.isArray(o)) { for (const item of o) { scan(item); if (titlePriority === 2) return; } }
        else { for (const key in o) { scan(o[key]); if (titlePriority === 2) return; } }
    }
    scan(obj);
    return meta;
}


async function processPage(filename, breadcrumb, locationId, pageRef) {
    try {
        const contentText = await fileMap.get(filename).text();
        const json        = JSON.parse(contentText);
        const extracted   = extractContentRecursive(json);

        const hasContent =
            extracted.normalClean.trim() || extracted.normalRaw.trim() ||
            extracted.mlClean.trim()     || extracted.noteClean.trim() ||
            extracted.stdClean.trim();

        if (hasContent) {
            courseIndex.push({
                breadcrumb, locationId, filename,
                normalClean: extracted.normalClean, normalRaw:  extracted.normalRaw,
                mlClean:     extracted.mlClean,     mlRaw:      extracted.mlRaw,
                stdClean:    extracted.stdClean,    stdRaw:     extracted.stdRaw,
                noteClean:   extracted.noteClean,   noteRaw:    extracted.noteRaw,
                mediaClean:  extracted.mediaClean,  mediaRaw:   extracted.mediaRaw,
                isInteractive: false,
                hasML:   !!extracted.mlClean.trim(),
                hasNote: !!extracted.noteClean.trim()
            });
        }

        // Isolate the actual page content (rows) to ignore the hidden 'info' and 'standards' metadata
            const glossarySearchText = json.rows ? JSON.stringify(json.rows) : contentText;
            extractGlossaryIds(glossarySearchText, locationId);
        courseVideos.push(...findMedia(json, locationId, breadcrumb, 'video'));
        courseAudio.push(...findMedia(json, locationId, breadcrumb, 'audio'));
        courseAudio.push(...extractMp3Files(contentText, locationId, breadcrumb));
        courseImages.push(...extractImages(json, locationId, breadcrumb));
        courseDocuments.push(...extractDocuments(contentText, locationId, breadcrumb));

        if (json.info?.standards?.length > 0) {
            pageRef._parsedStandards = json.info.standards.map(s => {
                const groupName = (s.folder && s.folder !== "N/A") ? s.folder : "Uncategorized";
                courseStandardGroups.add(groupName);
                const entry = {
                    locationId, breadcrumb, group: groupName,
                    grade:     s.gradeID          || "N/A",
                    code:      s.humanCodingScheme || "N/A",
                    statement: s.fullStatement     || "No definition"
                };
                courseStandardsList.push(entry);
                return { group: entry.group, grade: entry.grade, code: entry.code, statement: entry.statement };
            });
        } else {
            pageRef._parsedStandards = [];
        }

      const interactiveDefs = findInteractivesPaths(json);
        let intCounter = 1;

        for (const intDef of interactiveDefs) {
            let targetFiles = [];
            const cleanPath      = intDef.path.replace(/^\/+/, '');
            const pathParts      = cleanPath.split('/');
            const targetFileName = pathParts[pathParts.length - 1];

            for (const key of (fileNameIndex.get(targetFileName) || [])) {
                if (key === cleanPath || key.endsWith('/' + cleanPath)) targetFiles.push(key);
            }

            if (!targetFiles.length) {
                const isJson     = cleanPath.toLowerCase().endsWith('.json');
                const folderName = pathParts.length > 1
                    ? pathParts[pathParts.length - (isJson ? 2 : 1)]
                    : cleanPath;
                for (const key of (folderIndex.get(folderName) || [])) {
                    if (key.toLowerCase().endsWith('.json')) targetFiles.push(key);
                }
            }

            targetFiles = [...new Set(targetFiles)];

            for (const fileKey of targetFiles) {
                try {
                    const intLocationId = `${locationId}.INT-${intCounter++}`;
                    const intBreadcrumb = (() => {
                        const parts      = fileKey.split('/');
                        const folderName = parts.length > 1 ? parts[parts.length - 2] : "Interactive";
                        return `${breadcrumb} > Interactive (${folderName})`;
                    })();

                    const intText = await fileMap.get(fileKey).text();

                    // NEW: Handle HTML custom interactives gracefully
                    if (fileKey.toLowerCase().endsWith('.htm') || fileKey.toLowerCase().endsWith('.html')) {
                        const titleMatch = intText.match(/<title[^>]*>([^<]+)<\/title>/i);
                        const extractedTitle = titleMatch && titleMatch[1].trim() ? titleMatch[1].trim() : "Custom Interactive";
                        const parts   = fileKey.split('/');
                        const folder  = parts.length > 1 ? parts[parts.length - 2] : "Interactive";

                        // Check the folder index for any Geogebra (.ggb) files
                        let finalType = intDef.type === 'custom' ? 'custom' : 'html-interactive';
                        const filesInFolder = folderIndex.get(folder) || [];
                        const hasGgb = filesInFolder.some(f => f.toLowerCase().endsWith('.ggb'));
                        
                        let iframeCode = "";

                        if (hasGgb) {
                            finalType = 'Geogebra';
                            // Extract the iframe block from the HTML string
                            const iframeMatch = intText.match(/<iframe[^>]*>[\s\S]*?<\/iframe>/i);
                            if (iframeMatch) {
                                iframeCode = iframeMatch[0];
                            }
                        }

                        courseInteractives.push({
                            locationId:      intLocationId,
                            folder,
                            filename:        fileKey,
                            title:           extractedTitle,
                            rawJson:         "", 
                            interactiveType: finalType,
                            textVersion:     intDef.textVersion || "",
                            iframeCode:      iframeCode
                        });

                        // Optionally index the textVersion so it's searchable in the main search bar
                        if (intDef.textVersion) {
                             courseIndex.push({
                                breadcrumb:  intBreadcrumb,
                                locationId:  intLocationId,
                                filename:    fileKey,
                                normalClean: stripHtml(intDef.textVersion),
                                normalRaw:   intDef.textVersion,
                                mlClean: '', mlRaw: '', stdClean: '', stdRaw: '', noteClean: '', noteRaw: '', mediaClean: '', mediaRaw: '',
                                isInteractive: true, hasML: false, hasNote: false
                            });
                        }
                        
                        _processedInteractives.add(fileKey);
                        continue; // Skip the JSON processing below!
                    }

                    const intJson = JSON.parse(intText);

                    courseVideos.push(...findMedia(intJson, intLocationId, intBreadcrumb, 'video'));
                    courseAudio.push(...findMedia(intJson, intLocationId, intBreadcrumb, 'audio'));
                    courseAudio.push(...extractMp3Files(intText, intLocationId, intBreadcrumb));
                    courseImages.push(...extractImages(intJson, intLocationId, intBreadcrumb));
                    courseDocuments.push(...extractDocuments(intText, intLocationId, intBreadcrumb));

                    if (_processedInteractives.has(fileKey)) continue;
                    _processedInteractives.add(fileKey);

                    const extractedInt = extractContentRecursive(intJson);
                    const intHasContent =
                        extractedInt.normalClean.trim() || extractedInt.normalRaw.trim() ||
                        extractedInt.mlClean.trim()     || extractedInt.noteClean.trim() ||
                        extractedInt.stdClean.trim();

                    if (intHasContent) {
                        courseIndex.push({
                            breadcrumb:  intBreadcrumb,
                            locationId:  intLocationId,
                            filename:    fileKey,
                            normalClean: extractedInt.normalClean, normalRaw:  extractedInt.normalRaw,
                            mlClean:     extractedInt.mlClean,     mlRaw:      extractedInt.mlRaw,
                            stdClean:    extractedInt.stdClean,    stdRaw:     extractedInt.stdRaw,
                            noteClean:   extractedInt.noteClean,   noteRaw:    extractedInt.noteRaw,
                            mediaClean:  extractedInt.mediaClean,  mediaRaw:   extractedInt.mediaRaw,
                            isInteractive: true,
                            hasML:   !!extractedInt.mlClean.trim(),
                            hasNote: !!extractedInt.noteClean.trim()
                        });
                    }

                    const meta    = extractInteractiveMeta(intJson);
                    const intType = determineInteractiveType(intText);
                    const parts   = fileKey.split('/');
                    const folder  = parts.length > 1 ? parts[parts.length - 2] : "Interactive";

                    courseInteractives.push({
                        locationId:      intLocationId,
                        folder,
                        filename:        fileKey,
                        title:           meta.title,
                        rawJson:         JSON.stringify(intJson, null, 2),
                        interactiveType: intDef.type === 'custom' ? 'custom' : intType,
                        textVersion:     intDef.textVersion || ""
                    });

                } catch (e) {
                    // Silently ignore parsing errors
                }
            }
        }  

    } catch (e) {
        pageRef._parsedStandards = null;
    }
}
	
