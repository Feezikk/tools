// =============================================================================
// GLOSSARY.JS
// Glossary tab: rendering terms, duplicate/unused detection, and glossary-specific filters.
// =============================================================================

// Glossary-tab filter state. Previously four separate globals declared in
// state.js (activeGlossaryLetters/showOnlyDuplicates/showOnlyUnused/
// glossaryAudioFilter); consolidated here since glossary.js is the only module
// that owns this feature. indexing.js resets it on each new course index, and
// import-export.js reads it when exporting the visible glossary list — both
// go through window.GlossaryState, same as any other reference here.
const GlossaryState = {
    activeLetters:      new Set(),
    showOnlyDuplicates: false,
    showOnlyUnused:     false,
    audioFilter:        'all', // 'all' | 'with' | 'without'
};
window.GlossaryState = GlossaryState;

window.toggleGlossaryLetter = function toggleGlossaryLetter(letter) {
    if (letter === 'All') {
        GlossaryState.activeLetters.clear();
        GlossaryState.showOnlyDuplicates = false;
        GlossaryState.showOnlyUnused     = false;
        renderGlossaryList(document.getElementById('glossary-search')?.value || '');
    } else {
        if (GlossaryState.activeLetters.has(letter)) GlossaryState.activeLetters.delete(letter);
        else                                    GlossaryState.activeLetters.add(letter);
        applyGlossaryFilters();
    }
};

window.toggleDuplicateFilter = function toggleDuplicateFilter() {
    GlossaryState.showOnlyDuplicates = !GlossaryState.showOnlyDuplicates;
    if (GlossaryState.showOnlyDuplicates) GlossaryState.showOnlyUnused = false; // Mutually exclusive
    renderGlossaryList(document.getElementById('glossary-search')?.value || '');
};

window.toggleUnusedFilter = function toggleUnusedFilter() {
    GlossaryState.showOnlyUnused = !GlossaryState.showOnlyUnused;
    if (GlossaryState.showOnlyUnused) GlossaryState.showOnlyDuplicates = false; // Mutually exclusive
    renderGlossaryList(document.getElementById('glossary-search')?.value || '');
};

window.setGlossaryAudioFilter = function setGlossaryAudioFilter(val) {
    GlossaryState.audioFilter = val;
    renderGlossaryList(document.getElementById('glossary-search')?.value || '');
};

window.applyGlossaryFilters = function applyGlossaryFilters() {
    const allBtn = document.getElementById('btn-az-All');
    if (allBtn) {
        allBtn.classList.toggle('active', GlossaryState.activeLetters.size === 0 && !GlossaryState.showOnlyDuplicates);
    }
    document.querySelectorAll('.az-btn-letter').forEach(btn => {
        btn.classList.toggle('active', GlossaryState.activeLetters.has(btn.dataset.letter));
    });
    document.querySelectorAll('.glossary-group').forEach(group => {
        group.style.display = (GlossaryState.activeLetters.size === 0 ||
                               GlossaryState.activeLetters.has(group.dataset.letter))
            ? 'block' : 'none';
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.toggleGlossaryClearBtn = function toggleGlossaryClearBtn(val) {
    const btn = document.getElementById('glossary-search-clear');
    if (btn) btn.style.display = val.length > 0 ? 'block' : 'none';
};

window.clearGlossarySearch = function clearGlossarySearch() {
    const input = document.getElementById('glossary-search');
    if (input) { input.value = ''; toggleGlossaryClearBtn(''); filterGlossaryList(''); }
};

window.filterGlossaryList = function filterGlossaryList(val) {
    renderGlossaryList(val);
};

window.renderGlossaryList = function renderGlossaryList(query = '') {
    const container = document.getElementById('glossary-list-container');
    const azBar     = document.getElementById('glossary-az-bar');
    if (!container || !azBar) return;

    currentDisplayedMedia = [];

    if (query.trim()) GlossaryState.activeLetters.clear();

    const filteredGlossary = courseGlossary.filter(g => {
        if (GlossaryState.showOnlyUnused && g.locations.length > 0) return false;
        if (GlossaryState.showOnlyDuplicates && g.locations.length <= 1) return false;

        if (GlossaryState.audioFilter === 'with' && !g.audioPath) return false;
        if (GlossaryState.audioFilter === 'without' && g.audioPath) return false;

        // If module filters are active, bypass them ONLY IF we are specifically looking for unused terms
        if (MediaState.activeModules.size > 0 && !GlossaryState.showOnlyUnused &&
            !g.locations.some(loc => MediaState.activeModules.has(loc.split('.')[0]))) return false;

        if (query) {
            const q = query.toLowerCase();
            return g.title.toLowerCase().includes(q) ||
                   g.definition.toLowerCase().includes(q);
        }
        return true;
    });

    const hasDuplicates = courseGlossary.some(g =>
        (MediaState.activeModules.size === 0 ||
         g.locations.some(loc => MediaState.activeModules.has(loc.split('.')[0]))) &&
        g.locations.length > 1
    );
    const hasUnused = courseGlossary.some(g => g.locations.length === 0);

    // Update the tab count dynamically based on the current active filters
    const tabCountEl = document.getElementById('glossary-tab-count');
    if (tabCountEl) {
        tabCountEl.innerText = `(${filteredGlossary.length})`;
    }

    let azHtml =
        `<button id="btn-az-All"
                 class="az-btn ${GlossaryState.activeLetters.size === 0 && !GlossaryState.showOnlyDuplicates && !GlossaryState.showOnlyUnused ? 'active' : ''}"
                 onclick="toggleGlossaryLetter('All')">All</button>
         <div class="divider" style="margin:0 4px; height:auto;"></div>`;

    let specialFiltersHtml = '';

    const hasAnyAudio = courseGlossary.some(g => g.audioPath);
    if (hasAnyAudio) {
        specialFiltersHtml += `
            <div class="segmented-control" style="margin-right: 10px; align-items: center;">
                <label><input type="radio" name="gloss-audio-filter" value="all" onchange="setGlossaryAudioFilter('all')" ${GlossaryState.audioFilter === 'all' ? 'checked' : ''}><span style="padding: 4px 12px;">All</span></label>
                <label><input type="radio" name="gloss-audio-filter" value="with" onchange="setGlossaryAudioFilter('with')" ${GlossaryState.audioFilter === 'with' ? 'checked' : ''}><span style="padding: 4px 12px;">With Audio</span></label>
                <label><input type="radio" name="gloss-audio-filter" value="without" onchange="setGlossaryAudioFilter('without')" ${GlossaryState.audioFilter === 'without' ? 'checked' : ''}><span style="padding: 4px 12px;">Without Audio</span></label>
            </div>
        `;
    }

    if (hasDuplicates || GlossaryState.showOnlyDuplicates) {
        specialFiltersHtml += `<button class="az-btn duplicate-btn ${GlossaryState.showOnlyDuplicates ? 'active' : ''}"
                                       onclick="toggleDuplicateFilter()">Duplicates</button>`;
    }

    if (hasUnused || GlossaryState.showOnlyUnused) {
        specialFiltersHtml += `<button class="az-btn ${GlossaryState.showOnlyUnused ? 'active' : ''}"
                                       style="${GlossaryState.showOnlyUnused ? 'background:#6c757d; color:#fff; border-color:#6c757d;' : 'color:#6c757d; border-color:#6c757d;'}"
                                       onclick="toggleUnusedFilter()">Glossary Only</button>`;
    }

    const specialContainer = document.getElementById('glossary-special-filters');
    if (specialContainer) specialContainer.innerHTML = specialFiltersHtml;

    if (!filteredGlossary.length) {
        container.innerHTML =
            `<div style="column-span:all; text-align:center; padding:40px; color:#999;">
                 No matching glossary terms found.
             </div>`;
        azBar.innerHTML = azHtml;
        return;
    }

    const groups = {};
    filteredGlossary.forEach(g => {
        let letter = g.title.charAt(0).toUpperCase();
        if (!/[A-Z]/.test(letter)) letter = '#';
        if (!groups[letter]) groups[letter] = [];
        groups[letter].push(g);
    });

    const sortedLetters = Object.keys(groups).sort((a, b) =>
        a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)
    );

    sortedLetters.forEach(letter => {
        azHtml +=
            `<button class="az-btn az-btn-letter ${GlossaryState.activeLetters.has(letter) ? 'active' : ''}"
                     data-letter="${letter}"
                     onclick="toggleGlossaryLetter('${letter}')">${letter}</button>`;
    });
    azBar.innerHTML = azHtml;

    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    sortedLetters.forEach(letter => {
        const groupDiv = document.createElement('div');
        groupDiv.className      = 'glossary-group';
        groupDiv.id             = `letter-${letter}`;
        groupDiv.dataset.letter = letter;

        const letterDiv = document.createElement('div');
        letterDiv.className   = 'glossary-letter';
        letterDiv.textContent = letter;
        groupDiv.appendChild(letterDiv);

        const gridDiv = document.createElement('div');
        gridDiv.className = 'glossary-items-grid';

        groups[letter].forEach(g => {
            const isDup   = g.locations.length > 1;
            const itemDiv = document.createElement('div');
            itemDiv.className    = `glossary-item ${isDup ? 'duplicate-term' : ''}`;
            currentDisplayedMedia.push({ item: g, type: 'glossary' });
            itemDiv.dataset.index = currentDisplayedMedia.length - 1;
            const speakerSvg = `<svg viewBox="0 0 24 24" style="width:1.1em; height:1.1em; vertical-align:text-bottom; color:var(--primary); margin-left:4px;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

            itemDiv.innerHTML = `
                <div class="glossary-term">${escapeHtml(g.title)}</div>
                <div class="glossary-locs">
                    ${g.locations.length > 0
                        ? g.locations.map(loc => {
                            const hasAudio = loc.includes('🔊');
                            const cleanLoc = loc.replace('🔊', '').trim();
                            return `<span class="glossary-loc-badge" title="Location">${cleanLoc}${hasAudio ? speakerSvg : ''}</span>`;
                        }).join('')
                        : `<span class="glossary-loc-badge" style="background:#ffe3e6; color:#842029;">Glossary Only</span>`
                    }
                </div>`;

            gridDiv.appendChild(itemDiv);
        });

        groupDiv.appendChild(gridDiv);
        frag.appendChild(groupDiv);
    });

    container.appendChild(frag);
    applyGlossaryFilters();
};

