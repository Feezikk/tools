// =============================================================================
// SEARCH.JS
// Content search feature: search/standards filter-dropdown rendering plus running a search (via the AST engine) and highlighting results.
// =============================================================================


function buildFilterCheckboxHTML(onchange, label, checked) {
    return `<label style="display:flex; align-items:flex-start; gap:8px; font-size:0.9rem;
                          cursor:pointer; color:var(--text); margin-bottom:4px; break-inside:avoid;">
                <input type="checkbox"
                       style="accent-color:var(--primary); width:16px; height:16px;
                              cursor:pointer; margin-top:2px;"
                       onchange="${onchange}" ${checked ? 'checked' : ''}>
                <span style="flex:1;">${label}</span>
            </label>`;
}

window.renderSearchFilters = function renderSearchFilters() {
    const modContainer = document.getElementById('search-module-dropdown-list');
    const modBtn       = document.getElementById('search-mod-btn');
    if (modContainer && modBtn) {
        modContainer.innerHTML =
            `<div style="column-count:2; column-gap:20px;">` +
            validModules.map(mod => {
                const modNum = padNum(mod.num);
                return buildFilterCheckboxHTML(
                    `toggleSearchModule('${modNum}')`,
                    `Module ${modNum}`,
                    activeSearchModules.has(modNum)
                );
            }).join('') +
            `</div>`;
        modBtn.innerHTML = activeSearchModules.size === 0
            ? `Modules <span id="svg-arrow-down-search-mod">${SVGS.arrowDown}</span>`
            : `${activeSearchModules.size} Selected <span id="svg-arrow-down-search-mod">${SVGS.arrowDown}</span>`;
        modBtn.classList.toggle('filtered', activeSearchModules.size > 0);
    }

    const typeContainer = document.getElementById('search-type-dropdown-list');
    const typeBtn       = document.getElementById('search-type-btn');
    if (typeContainer && typeBtn) {
        typeContainer.innerHTML =
            `<div>` +
            buildFilterCheckboxHTML("toggleSearchExcludePages()",        'Exclude Course Pages', activeSearchExcludePages) +
            buildFilterCheckboxHTML("toggleSearchExcludeInteractives()", 'Exclude Interactives', activeSearchExcludeInteractives) +
            `<div style="border-top:1px dashed var(--border); margin-top:8px; padding-top:8px;">` +
            buildFilterCheckboxHTML("toggleSearchExcludeHTML()",      'Exclude HTML Code', activeSearchExcludeHTML) +
            buildFilterCheckboxHTML("toggleSearchExcludeStandards()", 'Exclude Standards', activeSearchExcludeStandards) +
            buildFilterCheckboxHTML("toggleSearchExcludeML()",        'Exclude ML',        activeSearchExcludeML) +
            buildFilterCheckboxHTML("toggleSearchExcludeNotes()",     'Exclude Notes',     activeSearchExcludeNotes) +
            `</div></div>`;

        const isNonDefault =
            activeSearchExcludePages ||
            activeSearchExcludeInteractives ||
            !activeSearchExcludeHTML ||
            !activeSearchExcludeStandards ||
            !activeSearchExcludeML ||
            !activeSearchExcludeNotes;
            
        typeBtn.innerHTML = isNonDefault
            ? `Filtered <span id="svg-arrow-down-search-type">${SVGS.arrowDown}</span>`
            : `Exclude <span id="svg-arrow-down-search-type">${SVGS.arrowDown}</span>`;
        typeBtn.classList.toggle('filtered', isNonDefault);
    }
};

window.toggleSearchModule = function toggleSearchModule(modNum) {
    if (activeSearchModules.has(modNum)) activeSearchModules.delete(modNum);
    else                                 activeSearchModules.add(modNum);
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.toggleAllSearchModules = function toggleAllSearchModules(state) {
    if (state) validModules.forEach(mod => activeSearchModules.add(padNum(mod.num)));
    else       activeSearchModules.clear();
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.toggleAllSearchTypes = function toggleAllSearchTypes(state) {
    if (state) {
        // Reset to default
        activeSearchExcludePages          = false;
        activeSearchExcludeInteractives   = false;
        activeSearchExcludeHTML           = true;
        activeSearchExcludeStandards      = true;
        activeSearchExcludeML             = true;
        activeSearchExcludeNotes          = true;
    } else {
        // "Clear All" unchecks everything
        activeSearchExcludePages          = false;
        activeSearchExcludeInteractives   = false;
        activeSearchExcludeHTML           = false;
        activeSearchExcludeStandards      = false;
        activeSearchExcludeML             = false;
        activeSearchExcludeNotes          = false;
    }
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.toggleSearchExcludePages = function() {
    activeSearchExcludePages = !activeSearchExcludePages;
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.toggleSearchExcludeInteractives = function() {
    activeSearchExcludeInteractives = !activeSearchExcludeInteractives;
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.toggleSearchExcludeHTML = function() {
    activeSearchExcludeHTML = !activeSearchExcludeHTML;
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.toggleSearchExcludeStandards = function() {
    activeSearchExcludeStandards = !activeSearchExcludeStandards;
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};
window.toggleSearchExcludeML = function() {
    activeSearchExcludeML = !activeSearchExcludeML;
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};
window.toggleSearchExcludeNotes = function() {
    activeSearchExcludeNotes = !activeSearchExcludeNotes;
    renderSearchFilters();
    if (elements.searchInput.value.trim()) runSearch(elements.searchInput.value);
};

window.renderStdsFilters = function renderStdsFilters() {
    const modContainer = document.getElementById('stds-module-dropdown-list');
    const modBtn       = document.getElementById('stds-mod-btn');
    if (modContainer && modBtn) {
        modContainer.innerHTML =
            `<div style="column-count:2; column-gap:20px;">` +
            validModules.map(mod => {
                const modNum = padNum(mod.num);
                return buildFilterCheckboxHTML(
                    `toggleStdsModule('${modNum}')`,
                    `Module ${modNum}`,
                    activeStdsModules.has(modNum)
                );
            }).join('') +
            `</div>`;
        modBtn.innerHTML = activeStdsModules.size === 0
            ? `Modules <span id="svg-arrow-down-stds-mod">${SVGS.arrowDown}</span>`
            : `${activeStdsModules.size} Selected <span id="svg-arrow-down-stds-mod">${SVGS.arrowDown}</span>`;
        modBtn.classList.toggle('filtered', activeStdsModules.size > 0);
    }

    const stateContainer = document.getElementById('stds-state-dropdown-list');
    const stateBtn       = document.getElementById('stds-state-btn');
    if (stateContainer && stateBtn) {
        stateContainer.innerHTML =
            `<div style="column-count:2; column-gap:20px;">` +
            Array.from(courseStandardGroups).sort().map(g =>
                buildFilterCheckboxHTML(
                    `toggleStdsState('${escapeHtml(g).replace(/'/g, "\\'")}')`,
                    escapeHtml(g),
                    activeStdsStates.has(g)
                )
            ).join('') +
            `</div>`;
        stateBtn.innerHTML = activeStdsStates.size === 0
            ? `States <span id="svg-arrow-down-stds-state">${SVGS.arrowDown}</span>`
            : `${activeStdsStates.size} Selected <span id="svg-arrow-down-stds-state">${SVGS.arrowDown}</span>`;
        stateBtn.classList.toggle('filtered', activeStdsStates.size > 0);
    }
};

window.toggleStdsModule = function toggleStdsModule(modNum) {
    if (activeStdsModules.has(modNum)) activeStdsModules.delete(modNum);
    else                               activeStdsModules.add(modNum);
    renderStdsFilters();
    runStdsSearch();
};

window.toggleAllStdsModules = function toggleAllStdsModules(state) {
    if (state) validModules.forEach(mod => activeStdsModules.add(padNum(mod.num)));
    else       activeStdsModules.clear();
    renderStdsFilters();
    runStdsSearch();
};

window.toggleStdsState = function toggleStdsState(stateName) {
    if (activeStdsStates.has(stateName)) activeStdsStates.delete(stateName);
    else                                  activeStdsStates.add(stateName);
    renderStdsFilters();
    runStdsSearch();
};

window.toggleAllStdsStates = function toggleAllStdsStates(state) {
    activeStdsStates.clear();
    if (state) courseStandardGroups.forEach(g => activeStdsStates.add(g));
    renderStdsFilters();
    runStdsSearch();
};
    

window.runSearch = function runSearch(query) {
    const q = query.trim();
    elements.results.innerHTML = '';
    currentSearchResults       = [];
    currentSearchQuery         = q;
    currentSearchIsHtmlMode    = elements.htmlToggle.checked;
    searchRenderCount          = 0;

    if (!q.length) {
        elements.exportSearchBtn.style.display = 'none';
        elements.searchStats.style.display     = 'none';
        return;
    }

    const { ast, error } = compileQueryToAST(q);
    if (error) {
        elements.results.innerHTML = `<div style="color:#dc3545; padding: 20px; border: 1px solid #dc3545; border-radius: 8px; background: #fff;">Syntax Error in Advanced Search: ${error}</div>`;
        elements.exportSearchBtn.style.display = 'none'; 
        elements.searchStats.style.display = 'none';
        return;
    }
    
    const positiveTerms = extractPositiveTerms(ast);

    const options = {
        ast:             ast,
        positiveTerms:   positiveTerms,
        isHtmlMode:      elements.htmlToggle.checked,
        isWholeWord:     elements.wholeWordToggle.checked,
        isCaseSensitive: elements.caseSensitiveToggle.checked,
        excludePages:        activeSearchExcludePages,
        excludeInteractives: activeSearchExcludeInteractives,
        excludeHTML:         activeSearchExcludeHTML,
        excludeML:           activeSearchExcludeML,
        excludeStds:         activeSearchExcludeStandards,
        excludeNotes:        activeSearchExcludeNotes,
        activeModules:       Array.from(activeSearchModules)
    };

    elements.results.innerHTML =
        `<div style="text-align:center; padding:40px; color:var(--text-light);">
             <div class="spinner" style="display:inline-block;"></div>
         </div>`;

    _pendingSearchOptions = options;

    if (searchWorker) {
        searchWorker.postMessage({ type: 'SEARCH', query: q, options });
    } else {
        setTimeout(() => _runSearchSync(q, options), 0);
    }
};

function renderSearchBatch() {
    const frag  = document.createDocumentFragment();
    const start = searchRenderCount;
    const end   = Math.min(start + SEARCH_BATCH_SIZE, currentSearchResults.length);

    for (let i = start; i < end; i++) {
        frag.appendChild(
            createResultCard(currentSearchResults[i], currentSearchQuery, currentSearchIsHtmlMode, i)
        );
    }

    document.getElementById('load-more-search-btn')?.remove();
    elements.results.appendChild(frag);
    searchRenderCount = end;

    if (searchRenderCount < currentSearchResults.length) {
        const remaining = currentSearchResults.length - searchRenderCount;
        const btn = document.createElement('button');
        btn.id        = 'load-more-search-btn';
        btn.className = 'action-btn btn-base';
        btn.style.margin = '20px auto';
        btn.innerHTML =
            `Load Next ${Math.min(SEARCH_BATCH_SIZE, remaining)} Results ` +
            `(Showing ${searchRenderCount} of ${currentSearchResults.length})`;
        btn.onclick = renderSearchBatch;
        elements.results.appendChild(btn);
    }
}

function createResultCard(res, query, isHtmlMode, index) {
    const card = document.createElement('div');
    card.className     = 'result-card';
    card.dataset.index = index;

    const allDisplayMatches = [];
    res.normalMatches.forEach(idx => allDisplayMatches.push({ idx, type: 'normal', text: res.normalText }));
    res.mlMatches.forEach(idx     => allDisplayMatches.push({ idx, type: 'ml',     text: res.mlText     }));
    res.stdMatches.forEach(idx    => allDisplayMatches.push({ idx, type: 'std',    text: res.stdText    }));
    res.noteMatches.forEach(idx   => allDisplayMatches.push({ idx, type: 'note',   text: res.noteText   }));
    const totalMatches = allDisplayMatches.length;

    let snippetsHtml = '';
    if (res.isIdMatch && totalMatches === 0) {
        const fallback = res.normalText || res.mlText || res.stdText || res.noteText || '';
        snippetsHtml =
            `<div class="snippet-item ${isHtmlMode ? 'code-view' : ''}">` +
            getSnippet(fallback, 0, 0, query, isHtmlMode, 'normal') +
            `</div>`;
    } else {
        const maxDisplay = 10;
        const displayIndices = allDisplayMatches.slice(0, maxDisplay);
        const hiddenIndices = allDisplayMatches.slice(maxDisplay);

        displayIndices.forEach((m, i) => {
            snippetsHtml +=
                `<div class="snippet-item ${isHtmlMode ? 'code-view' : ''}" data-match-index="${i}">` +
                getSnippet(m.text, m.idx, query.length, query, isHtmlMode, m.type) +
                `</div>`;
            if (i < displayIndices.length - 1 || hiddenIndices.length > 0) {
                snippetsHtml += `<div class="separator"></div>`;
            }
        });
        
        if (hiddenIndices.length > 0) {
            let hiddenHtml = `<div class="hidden-matches" style="display:none; padding-top: 5px;">`;
            hiddenIndices.forEach((m, i) => {
                hiddenHtml += `<div class="snippet-item ${isHtmlMode ? 'code-view' : ''}" data-match-index="${maxDisplay + i}">${getSnippet(m.text, m.idx, query.length, query, isHtmlMode, m.type)}</div>`;
                if (i < hiddenIndices.length - 1) hiddenHtml += `<div class="separator"></div>`;
            });
            hiddenHtml += `</div>`;
            
            snippetsHtml += hiddenHtml;
            snippetsHtml += `<button class="expand-matches-btn" data-count="${hiddenIndices.length}" style="background: none; border: none; color: var(--primary-light); text-decoration: underline; font-size: 0.85rem; cursor: pointer; padding: 5px 10px 0 10px; margin-top: 5px; font-weight: 600; font-family: inherit;" onclick="toggleHiddenMatches(event, this)">...and ${hiddenIndices.length} more matches (Click to expand) ▼</button>`;
        }
    }

    const contextBadges = [
        res.mlMatches?.length
            ? `<span style="font-size:0.7rem; background:#8e44ad; color:white; padding:2px 6px;
                            border-radius:8px; margin-left:6px; font-weight:600;"
                   title="Match in ML/chatHistory">ML</span>` : '',
        res.stdMatches?.length
            ? `<span style="font-size:0.7rem; background:#0d6efd; color:white; padding:2px 6px;
                            border-radius:8px; margin-left:6px; font-weight:600;"
                   title="Match in Standards">STND</span>` : '',
        res.noteMatches?.length
            ? `<span style="font-size:0.7rem; background:#fd7e14; color:white; padding:2px 6px;
                            border-radius:8px; margin-left:6px; font-weight:600;"
                   title="Match in Notes">NOTE</span>` : ''
    ].join('');

    const matchText = totalMatches > 0
        ? (totalMatches >= 500 ? 'Found 500+' : `Found ${totalMatches}`)
        : 'ID Match';

    card.innerHTML = `
        <div class="flex-between flex-wrap gap-10"
             style="margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">
            <div>
                <div class="breadcrumb">${res.breadcrumb}${contextBadges}</div>
                <div class="flex-center gap-10"
                     style="font-size:0.8rem; margin-top:5px; justify-content:flex-start;">
                    <span class="id-number"># ${res.locationId}</span>
                    <span class="flex-center gap-10" style="color:var(--primary);">
                        ${SVGS.fileText} ${res.filename}
                    </span>
                </div>
            </div>
            <div style="font-size:0.75rem; background:var(--primary); color:white;
                        padding:4px 10px; border-radius:12px; height:fit-content;
                        font-weight:600;">${matchText}</div>
        </div>
        <div class="snippets-container">${snippetsHtml}</div>`;

    return card;
}

window.toggleHiddenMatches = function(event, btn) {
    event.stopPropagation();
    const container = btn.previousElementSibling;
    if (container && container.classList.contains('hidden-matches')) {
        if (container.style.display === 'none') {
            container.style.display = 'block';
            btn.innerHTML = 'Collapse matches ▲';
        } else {
            container.style.display = 'none';
            btn.innerHTML = `...and ${btn.dataset.count} more matches ▼`;
        }
    }
};

function getSnippet(fullText, index, length, query, isHtmlMode, matchType = 'normal') {
    if (!fullText) return '';

    const matchLength = isHtmlMode ? escapeHtml(query).length : query.length;
    const padding     = isHtmlMode ? 80 : 60;
    const start       = Math.max(0, index - padding);
    const end         = Math.min(fullText.length, index + matchLength + padding);
    let   textPart    = fullText.substring(start, end);

    if (isHtmlMode) textPart = escapeHtml(textPart);

    let highlightClass = 'highlight', contextBadge = '';
    if (matchType === 'ml') {
        highlightClass = 'highlight highlight-ml';
        contextBadge   = `<span style="font-size:0.7rem; background:#8e44ad; color:white; padding:2px 6px;
                                       border-radius:8px; margin-right:8px; cursor:help; vertical-align:middle;"
                                title="Found in ML/chatHistory node">ML</span>`;
    } else if (matchType === 'std') {
        highlightClass = 'highlight highlight-std';
        contextBadge   = `<span style="font-size:0.7rem; background:#0d6efd; color:white; padding:2px 6px;
                                       border-radius:8px; margin-right:8px; cursor:help; vertical-align:middle;"
                                title="Found in Standards node">STND</span>`;
    } else if (matchType === 'note') {
        highlightClass = 'highlight highlight-note';
        contextBadge   = `<span style="font-size:0.7rem; background:#fd7e14; color:white; padding:2px 6px;
                                       border-radius:8px; margin-right:8px; cursor:help; vertical-align:middle;"
                                title="Found in Notes node">NOTE</span>`;
    }

    if (matchLength > 0 && query && currentSearchHighlightRegex) {
        textPart = textPart.replace(
            currentSearchHighlightRegex,
            `<span class="${highlightClass}">$1</span>`
        );
    }

    return contextBadge +
           (start > 0 ? '…' : '') +
           textPart +
           (end < fullText.length ? '…' : '');
}

window.openPageModal = async function openPageModal(
    res, query, isHtmlMode, isWholeWord, isCaseSensitive, startingMatchIndex = 0
) {
    if (!res?.filename) return;

    let fullText   = "";
    let isCodeView = true;

    // Use currentSearchHighlightRegex from AST instead of raw string regex matching
    let rawRegex = currentSearchHighlightRegex;

    try {
        const file = fileMap.get(res.filename);
        if (file) {
            const rawText    = await file.text();
            const json       = JSON.parse(rawText);
            const prettyJson = JSON.stringify(json, null, 2);

            if (rawRegex) {
                const NORM_O = '___MATCHNORMOPEN___', NORM_C = '___MATCHNORMCLOSE___';
                const ML_O   = '___MATCHMLOPEN___',   ML_C   = '___MATCHMLCLOSE___';
                const STD_O  = '___MATCHSTDOPEN___',  STD_C  = '___MATCHSTDCLOSE___';
                const NOTE_O = '___MATCHNOTEOPEN___', NOTE_C = '___MATCHNOTECLOSE___';
                const skipKeys = new Set(['id','type','contentType','status','classes','version']);

                function injectTokens(o, ctx) {
                    if (o === null || o === undefined) return o;
                    if (Array.isArray(o)) return o.map(v => injectTokens(v, ctx));
                    if (typeof o === 'object') {
                        const result = {};
                        for (const key in o) {
                            if (activeSearchExcludeML        && (key === 'ml'        || key === 'chatHistory')) { result[key] = o[key]; continue; }
                            if (activeSearchExcludeStandards && (key === 'standards' || key === 'standard'))    { result[key] = o[key]; continue; }
                            if (activeSearchExcludeNotes     && (key === 'notes'     || key === 'note'))        { result[key] = o[key]; continue; }
                            if (skipKeys.has(key)) { result[key] = o[key]; continue; }
                            let nextCtx = ctx;
                            if      (key === 'ml'        || key === 'chatHistory') nextCtx = 'ml';
                            else if (key === 'standards' || key === 'standard')    nextCtx = 'std';
                            else if (key === 'notes'     || key === 'note')        nextCtx = 'note';
                            result[key] = injectTokens(o[key], nextCtx);
                        }
                        return result;
                    }
                    if (typeof o === 'string') {
                        rawRegex.lastIndex = 0;
                        const [open, close] = {
                            ml:   [ML_O,   ML_C],
                            std:  [STD_O,  STD_C],
                            note: [NOTE_O, NOTE_C]
                        }[ctx] || [NORM_O, NORM_C];
                        return o.replace(rawRegex, `${open}$1${close}`);
                    }
                    return o;
                }

                const tokenized = injectTokens(json, 'normal');
                let escaped = escapeHtml(JSON.stringify(tokenized, null, 2));
                escaped = escaped
                    .split(escapeHtml(NORM_O)).join('<span class="highlight search-match">')
                    .split(escapeHtml(NORM_C)).join('</span>')
                    .split(escapeHtml(ML_O)).join('<span class="highlight highlight-ml search-match">')
                    .split(escapeHtml(ML_C)).join('</span>')
                    .split(escapeHtml(STD_O)).join('<span class="highlight highlight-std search-match">')
                    .split(escapeHtml(STD_C)).join('</span>')
                    .split(escapeHtml(NOTE_O)).join('<span class="highlight highlight-note search-match">')
                    .split(escapeHtml(NOTE_C)).join('</span>');
                fullText = escaped;

            } else {
                fullText = escapeHtml(prettyJson);
            }

        } else {
            let text = isHtmlMode ? res.normalRaw : res.normalClean;
            fullText = escapeHtml(text || "");
            if (rawRegex) {
                // Not ideal, but fallback for no file
                let htmlPattern = escapeRegExp(escapeHtml(query));
                if (isWholeWord) htmlPattern = `(?<=^|\\W)${htmlPattern}(?=\\W|$)`;
                const htmlRegex = new RegExp(`(${htmlPattern})`, isCaseSensitive ? 'g' : 'gi');
                fullText = fullText.replace(htmlRegex, '<span class="highlight search-match">$1</span>');
            }
            isCodeView = false;
        }
    } catch (e) {
        fullText   = escapeHtml((isHtmlMode ? res.normalRaw : res.normalClean) || "");
        isCodeView = false;
    }

    document.getElementById('modal-header-content').innerHTML = `
        <h3 class="flex-center gap-10"
            style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary); justify-content:flex-start;">
            ${SVGS.fileText} ${res.filename}
        </h3>
        <div style="font-size:0.85rem; color:var(--text-light);">
            <span class="id-number"># ${res.locationId}</span>
            &nbsp;|&nbsp;
            <span>${res.breadcrumb}</span>
        </div>
        <div id="modal-match-controls"></div>`;

    document.getElementById('modal-body-content').innerHTML = isCodeView
        ? `<div style="margin-bottom:15px;">
               <strong style="color:var(--text-light);">🧑‍💻 Code View (Formatted JSON)</strong>
           </div>
           <pre id="modal-pre"
                style="font-family:var(--code-font); font-size:0.85rem; color:#24292e;
                       background:#f6f8fa; border-left:3px solid #0366d6; padding:15px;
                       border-radius:4px; overflow-x:auto; white-space:pre-wrap;
                       word-wrap:break-word; margin:0;">${fullText}</pre>`
        : `<div style="font-size:0.95rem; line-height:1.6; color:var(--text);
                       font-family:Georgia, serif; white-space:pre-wrap;
                       padding-left:10px; border-left:3px solid var(--border);">
               ${fullText}
           </div>`;

    document.getElementById('media-modal').classList.add('active');
    document.body.style.overflow = 'hidden';

    const modalBody = document.getElementById('modal-body-content');
    const matches   = Array.from(document.querySelectorAll('#modal-body-content .search-match'));

    function scrollModalToElement(el) {
        let offsetTop = 0, node = el;
        while (node && node !== modalBody) { offsetTop += node.offsetTop; node = node.offsetParent; }
        modalBody.scrollTop = Math.max(0, offsetTop - (modalBody.clientHeight / 2) + (el.offsetHeight / 2));
    }

    if (matches.length > 0) {
        let currentMatch = Math.min(Math.max(startingMatchIndex, 0), matches.length - 1);

        document.getElementById('modal-match-controls').innerHTML = `
            <div class="flex-center gap-10"
                 style="margin-top:10px; font-size:0.85rem; justify-content:flex-start;">
                <button id="prev-match-btn" class="nav-btn btn-base"
                        style="padding:4px 8px;" disabled>
                    ${SVGS.arrowUp} Prev
                </button>
                <span id="match-counter" style="font-weight:600;">
                    ${currentMatch + 1} of ${matches.length}
                </span>
                <button id="next-match-btn" class="nav-btn btn-base"
                        style="padding:4px 8px;" ${matches.length === 1 ? 'disabled' : ''}>
                    Next ${SVGS.arrowDown}
                </button>
            </div>`;

        const updateMatchNav = () => {
            matches.forEach(m => { m.style.outline = 'none'; m.style.boxShadow = 'none'; });
            const active = matches[currentMatch];
            let outlineColor = 'var(--primary)', shadowColor = 'rgba(28,53,94,0.4)';
            if      (active.classList.contains('highlight-ml'))   { outlineColor = '#8e44ad'; shadowColor = 'rgba(142,68,173,0.5)'; }
            else if (active.classList.contains('highlight-std'))  { outlineColor = '#0d6efd'; shadowColor = 'rgba(13,110,253,0.5)'; }
            else if (active.classList.contains('highlight-note')) { outlineColor = '#fd7e14'; shadowColor = 'rgba(253,126,20,0.5)'; }
            active.style.outline   = `2px solid ${outlineColor}`;
            active.style.boxShadow = `0 0 8px ${shadowColor}`;
            scrollModalToElement(active);
            document.getElementById('match-counter').innerText =
                `${currentMatch + 1} of ${matches.length}`;
            document.getElementById('prev-match-btn').disabled = (currentMatch === 0);
            document.getElementById('next-match-btn').disabled = (currentMatch === matches.length - 1);
        };

        document.getElementById('prev-match-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentMatch > 0) { currentMatch--; updateMatchNav(); }
        });
        document.getElementById('next-match-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentMatch < matches.length - 1) { currentMatch++; updateMatchNav(); }
        });

        setTimeout(() => updateMatchNav(), 250);
    } else {
        modalBody.scrollTop = 0;
    }
};

