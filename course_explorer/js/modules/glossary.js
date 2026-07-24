// =============================================================================
// GLOSSARY.JS
// Glossary tab: rendering terms, duplicate/unused detection, and glossary-specific filters.
// =============================================================================


window.toggleGlossaryLetter = function toggleGlossaryLetter(letter) {
    if (letter === 'All') {
        activeGlossaryLetters.clear();
        showOnlyDuplicates = false;
        showOnlyUnused     = false;
        renderGlossaryList(document.getElementById('glossary-search')?.value || '');
    } else {
        if (activeGlossaryLetters.has(letter)) activeGlossaryLetters.delete(letter);
        else                                    activeGlossaryLetters.add(letter);
        applyGlossaryFilters();
    }
};

window.toggleDuplicateFilter = function toggleDuplicateFilter() {
    showOnlyDuplicates = !showOnlyDuplicates;
    if (showOnlyDuplicates) showOnlyUnused = false; // Mutually exclusive
    renderGlossaryList(document.getElementById('glossary-search')?.value || '');
};

window.toggleUnusedFilter = function toggleUnusedFilter() {
    showOnlyUnused = !showOnlyUnused;
    if (showOnlyUnused) showOnlyDuplicates = false; // Mutually exclusive
    renderGlossaryList(document.getElementById('glossary-search')?.value || '');
};

window.setGlossaryAudioFilter = function setGlossaryAudioFilter(val) {
    glossaryAudioFilter = val;
    renderGlossaryList(document.getElementById('glossary-search')?.value || '');
};

window.applyGlossaryFilters = function applyGlossaryFilters() {
    const allBtn = document.getElementById('btn-az-All');
    if (allBtn) {
        allBtn.classList.toggle('active', activeGlossaryLetters.size === 0 && !showOnlyDuplicates);
    }
    document.querySelectorAll('.az-btn-letter').forEach(btn => {
        btn.classList.toggle('active', activeGlossaryLetters.has(btn.dataset.letter));
    });
    document.querySelectorAll('.glossary-group').forEach(group => {
        group.style.display = (activeGlossaryLetters.size === 0 ||
                               activeGlossaryLetters.has(group.dataset.letter))
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

    if (query.trim()) activeGlossaryLetters.clear();

    const filteredGlossary = courseGlossary.filter(g => {
        if (showOnlyUnused && g.locations.length > 0) return false;
        if (showOnlyDuplicates && g.locations.length <= 1) return false;
        
        if (glossaryAudioFilter === 'with' && !g.audioPath) return false;
        if (glossaryAudioFilter === 'without' && g.audioPath) return false;
        
        // If module filters are active, bypass them ONLY IF we are specifically looking for unused terms
        if (activeMediaModules.size > 0 && !showOnlyUnused &&
            !g.locations.some(loc => activeMediaModules.has(loc.split('.')[0]))) return false;
            
        if (query) {
            const q = query.toLowerCase();
            return g.title.toLowerCase().includes(q) ||
                   g.definition.toLowerCase().includes(q);
        }
        return true;
    });

    const hasDuplicates = courseGlossary.some(g =>
        (activeMediaModules.size === 0 ||
         g.locations.some(loc => activeMediaModules.has(loc.split('.')[0]))) &&
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
                 class="az-btn ${activeGlossaryLetters.size === 0 && !showOnlyDuplicates && !showOnlyUnused ? 'active' : ''}"
                 onclick="toggleGlossaryLetter('All')">All</button>
         <div class="divider" style="margin:0 4px; height:auto;"></div>`;
                 
    let specialFiltersHtml = '';
    
    const hasAnyAudio = courseGlossary.some(g => g.audioPath);
    if (hasAnyAudio) {
        specialFiltersHtml += `
            <div class="segmented-control" style="margin-right: 10px; align-items: center;">
                <label><input type="radio" name="gloss-audio-filter" value="all" onchange="setGlossaryAudioFilter('all')" ${glossaryAudioFilter === 'all' ? 'checked' : ''}><span style="padding: 4px 12px;">All</span></label>
                <label><input type="radio" name="gloss-audio-filter" value="with" onchange="setGlossaryAudioFilter('with')" ${glossaryAudioFilter === 'with' ? 'checked' : ''}><span style="padding: 4px 12px;">With Audio</span></label>
                <label><input type="radio" name="gloss-audio-filter" value="without" onchange="setGlossaryAudioFilter('without')" ${glossaryAudioFilter === 'without' ? 'checked' : ''}><span style="padding: 4px 12px;">Without Audio</span></label>
            </div>
        `;
    }
    
    if (hasDuplicates || showOnlyDuplicates) {
        specialFiltersHtml += `<button class="az-btn duplicate-btn ${showOnlyDuplicates ? 'active' : ''}"
                                       onclick="toggleDuplicateFilter()">Duplicates</button>`;
    }

    if (hasUnused || showOnlyUnused) {
        specialFiltersHtml += `<button class="az-btn ${showOnlyUnused ? 'active' : ''}"
                                       style="${showOnlyUnused ? 'background:#6c757d; color:#fff; border-color:#6c757d;' : 'color:#6c757d; border-color:#6c757d;'}"
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
            `<button class="az-btn az-btn-letter ${activeGlossaryLetters.has(letter) ? 'active' : ''}"
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

