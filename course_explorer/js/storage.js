// =============================================================================
// STORAGE.JS
// Persisting and restoring full application state (selected course, scan results, config) to/from localStorage.
// =============================================================================


function saveAppState() {
    const openLessonIds = [];
    if (elements.mapDetailArea.style.display === 'block') {
        elements.mapDetailContent
            .querySelectorAll('details.map-lesson')
            .forEach(l => { if (l.open) openLessonIds.push(l.id); });
    }

    let currentView = 'search';
    if      (elements.mediaArea.style.display   === 'block') currentView = 'media';
    else if (elements.stdsSearchArea.style.display === 'block') currentView = 'stds';
    else if (
        elements.dashboardGrid.style.display    === 'grid' ||
        elements.mapDetailArea.style.display  === 'block'
    ) currentView = 'map';

    localStorage.setItem(STATE_KEY, JSON.stringify({
        view:       currentView,
        mapMode:  elements.dashboardGrid.style.display === 'grid' ? 'grid' : 'detail',
        moduleIndex: currentModuleIndex,
        filters: {
            type:      document.querySelector('input[name="map-filter"]:checked')?.value || 'all',
            gap:       elements.gapToggle?.checked || false,
            stdGroups: Array.from(StandardsState.activeGroups)
        },
        openLessons:       openLessonIds,
        hasRunMapConfig: hasRunMapConfig
    }));
}

function restoreAppState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        hasRunMapConfig = state.hasRunMapConfig || false;

        if (state.view === 'map') {
            switchView('map');

            if (state.filters) {
                const radio = document.querySelector(
                    `input[name="map-filter"][value="${state.filters.type}"]`
                );
                if (radio) {
                    radio.checked = true;
                    elements.mapDetailArea.classList.remove('show-objs-only', 'show-stds-only');
                    if      (state.filters.type === 'obj') elements.mapDetailArea.classList.add('show-objs-only');
                    else if (state.filters.type === 'std') elements.mapDetailArea.classList.add('show-stds-only');
                }
                if (elements.gapToggle) {
                    elements.gapToggle.checked = !!state.filters.gap;
                    elements.mapDetailArea.classList.toggle('gap-mode', !!state.filters.gap);
                }
                if (state.filters.stdGroups?.length) {
                    // Cleared and refilled in place (not reassigned to a new Set) so that
                    // toggleStdGroup/toggleAllStdGroups -- which captured this exact Set
                    // object as a factory argument in standards.js -- stay in sync with it.
                    // A prior version of this line reassigned the variable outright, which
                    // silently broke the group-filter checkboxes after restoring saved state.
                    StandardsState.activeGroups.clear();
                    state.filters.stdGroups.forEach(g => StandardsState.activeGroups.add(g));
                    const wrapper = document.getElementById('std-filter-wrapper');
                    if (wrapper?.style.display !== 'none') window.renderStdFilterDropdown();
                }
            }

            if (
                state.mapMode === 'detail' &&
                state.moduleIndex > -1 &&
                state.moduleIndex < validModules.length
            ) {
                currentModuleIndex = state.moduleIndex;
                elements.dashboardGrid.style.display   = 'none';
                elements.mapTopBar.style.display     = 'none';
                elements.mapDetailArea.style.display = 'block';
                renderModuleDetail(false);

                if (state.openLessons?.length) {
                    state.openLessons.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.open = true;
                    });
                    const all  = elements.mapDetailContent.querySelectorAll('details.map-lesson');
                    const open = elements.mapDetailContent.querySelectorAll('details.map-lesson[open]');
                    if (all.length > 0 && open.length === all.length) {
                        isAllExpanded = true;
                        updateToggleButton();
                    }
                }
            } else if (hasRunMapConfig) {
                backToDashboard();
            }

        } else if (state.view === 'media') {
            switchView('media');
        } else if (state.view === 'stds') {
            switchView('stds');
        } else {
            switchView('search');
        }

    } catch (e) {
        console.warn("Failed to restore state:", e);
    }
}

