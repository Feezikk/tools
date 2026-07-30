// =============================================================================
// APP.JS
// Main application bootstrap: wires up SVG icon injection, global event listeners, and kicks off the initial UI once the DOM is ready. Loaded last, after every other module.
// =============================================================================


document.addEventListener("DOMContentLoaded", () => {
    const svgInjections = {
        'svg-header-logo':            SVGS.logo,
        'svg-drop-zone':              `<svg class="svg-icon" style="width:48px;height:48px;" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
        'svg-content-search-icon':    SVGS.search,
        'svg-stds-search-icon':       SVGS.search,
        'svg-icon-code':              SVGS.code,
        'svg-icon-wholeword':         SVGS.wholeWord,
        'svg-icon-case':              SVGS.matchCase,
        'svg-icon-layers':            SVGS.layers,
        'svg-icon-alert':             SVGS.alert,
        'svg-arrow-down-search-mod':  SVGS.arrowDown,
        'svg-arrow-down-search-type': SVGS.arrowDown,
        'svg-arrow-down-stds-mod':    SVGS.arrowDown,
        'svg-arrow-down-stds-state':  SVGS.arrowDown,
        'svg-arrow-down-audit-state': SVGS.arrowDown,
        'back-to-top':                SVGS.arrowUp,
    };
    Object.entries(svgInjections).forEach(([id, html]) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });

    elements.selectCourseBtn.innerHTML   = `${SVGS.folder}  Select New Course`;
    elements.refreshBtn.innerHTML        = `${SVGS.refresh} Refresh`;
    elements.exportSearchBtn.innerHTML   = `${SVGS.export}  Export`;
    elements.exportStdsBtn.innerHTML     = `${SVGS.export}  Export`;
    elements.fullscreenStdsBtn.innerHTML = `${SVGS.maximize} Fullscreen`;

    document.getElementById('btn-view-search').innerHTML = `${SVGS.search}    Content Search`;
    document.getElementById('btn-view-media').innerHTML  = `${SVGS.media}     Media Dashboard`;
    document.getElementById('btn-view-audit').innerHTML  = `${SVGS.map}       Curriculum Map`;
    document.getElementById('btn-view-stds').innerHTML   = `${SVGS.clipboard} Standards Search`;
	document.getElementById('btn-view-read').innerHTML   = `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg> Readability`;
    document.getElementById('reconfig-btn').innerHTML    = `${SVGS.config}    Configure Audit`;
    document.getElementById('download-btn').innerHTML    = `${SVGS.download}  Download Report`;
    document.getElementById('btn-nav-dash').innerHTML    = `${SVGS.back}      Dashboard`;

    const defaultStdsRadio = document.querySelector('input[name="stds-view"][value="lesson"]');
    if (defaultStdsRadio) defaultStdsRadio.checked = true;

    elements.gapToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            elements.auditDetailArea.classList.add('gap-mode');
            isAllExpanded = true;
            updateToggleButton();
            applyExpansionState(true);
        } else {
            elements.auditDetailArea.classList.remove('gap-mode');
        }
        saveAppState();
    });

    elements.auditFilterRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            elements.auditDetailArea.classList.remove('show-objs-only', 'show-stds-only');
            if      (e.target.value === 'obj') elements.auditDetailArea.classList.add('show-objs-only');
            else if (e.target.value === 'std') elements.auditDetailArea.classList.add('show-stds-only');
            saveAppState();
            setTimeout(updateStickyHeaderOffset, 50);
        });
    });

    // Wire up the new Power User Input to update the Preview dynamically
    const powerInput = document.getElementById('power-user-input');
    if (powerInput) powerInput.addEventListener('input', updatePreview);

    elements.searchInput.addEventListener('input', (e) => {
        elements.searchClearBtn.style.display = e.target.value.length > 0 ? 'block' : 'none';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runSearch(e.target.value), 300);
    });
    elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.target.value = '';
            elements.searchClearBtn.style.display = 'none';
            runSearch('');
        }
    });
    elements.searchClearBtn.addEventListener('click', () => {
        elements.searchInput.value = '';
        elements.searchClearBtn.style.display = 'none';
        elements.searchInput.focus();
        runSearch('');
    });

    elements.htmlToggle.addEventListener('change',          () => runSearch(elements.searchInput.value));
    elements.wholeWordToggle.addEventListener('change',     () => runSearch(elements.searchInput.value));
    elements.caseSensitiveToggle.addEventListener('change', () => runSearch(elements.searchInput.value));

    elements.stdsSearchInput.addEventListener('input', (e) => {
        elements.stdsSearchClear.style.display = e.target.value.length > 0 ? 'block' : 'none';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runStdsSearch, 400);
    });
    elements.stdsSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.target.value = '';
            elements.stdsSearchClear.style.display = 'none';
            runStdsSearch();
        }
    });
    elements.stdsSearchClear.addEventListener('click', () => {
        elements.stdsSearchInput.value = '';
        elements.stdsSearchClear.style.display = 'none';
        elements.stdsSearchInput.focus();
        runStdsSearch();
    });

    elements.results.addEventListener('click', (e) => {
        if (e.target.closest('.expand-matches-btn')) return;

        const card = e.target.closest('.result-card');
        if (!card) return;
        const res = currentSearchResults[card.dataset.index];
        if (!res) return;
        let startingMatchIndex = 0;
        const snippet = e.target.closest('.snippet-item');
        if (snippet?.dataset.matchIndex != null) {
            startingMatchIndex = parseInt(snippet.dataset.matchIndex, 10);
        }
        openPageModal(
            res, currentSearchQuery, currentSearchIsHtmlMode,
            elements.wholeWordToggle.checked, elements.caseSensitiveToggle.checked,
            startingMatchIndex
        );
    });

    elements.mediaArea.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) { copyTextToClipboard(copyBtn.dataset.id, copyBtn); return; }
        if (e.target.closest('.kaltura-badge') || e.target.closest('.type-badge')) return;
        
        const imgCard = e.target.closest('.image-card') || e.target.closest('.image-list-table tr');
        if (imgCard && imgCard.dataset.index) {
            const entry = currentDisplayedMedia[imgCard.dataset.index];
            if (entry) openMediaModalFromObj(entry.item, entry.type);
            return;
        }

        const card = e.target.closest('.media-card');
        if (card) {
            const entry = currentDisplayedMedia[card.dataset.index];
            if (entry) openMediaModalFromObj(entry.item, entry.type);
            return;
        }
        const glossaryItem = e.target.closest('.glossary-item');
        if (glossaryItem) {
            const entry = currentDisplayedMedia[glossaryItem.dataset.index];
            if (entry) openMediaModalFromObj(entry.item, 'glossary');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-dropdown-wrapper')) {
            document.querySelectorAll('.filter-dropdown-content.show')
                    .forEach(d => d.classList.remove('show'));
            isMediaFilterOpen = false;
        }
    });

    window.addEventListener('scroll', () => {
        const btt = document.getElementById('back-to-top');
        if (!btt) return;
        const inSearchOrStds =
            elements.searchWrapper?.style.display  === 'block' ||
            elements.stdsSearchArea?.style.display === 'block';
        btt.classList.toggle('show', inSearchOrStds && window.scrollY > 400);
    }, { passive: true });

    window.addEventListener('resize', updateStickyHeaderOffset);

    // Advanced search modal close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const advModal = document.getElementById('advanced-search-modal');
            if (advModal && advModal.classList.contains('active')) {
                closeAdvSearchModal();
            }
        }
    });

    renderHistory();
});

