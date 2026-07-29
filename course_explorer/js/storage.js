// =============================================================================
// STORAGE.JS
// Persisting and restoring full application state (selected course, scan results, config) to/from localStorage.
// =============================================================================


function saveAppState() {
    const openLessonIds = [];
    if (elements.auditDetailArea.style.display === 'block') {
        elements.auditDetailContent
            .querySelectorAll('details.audit-lesson')
            .forEach(l => { if (l.open) openLessonIds.push(l.id); });
    }

    let currentView = 'search';
    if      (elements.mediaArea.style.display   === 'block') currentView = 'media';
    else if (elements.stdsSearchArea.style.display === 'block') currentView = 'stds';
    else if (
        elements.dashboardGrid.style.display    === 'grid' ||
        elements.auditDetailArea.style.display  === 'block'
    ) currentView = 'audit';

    localStorage.setItem(STATE_KEY, JSON.stringify({
        view:       currentView,
        auditMode:  elements.dashboardGrid.style.display === 'grid' ? 'grid' : 'detail',
        moduleIndex: currentModuleIndex,
        filters: {
            type:      document.querySelector('input[name="audit-filter"]:checked')?.value || 'all',
            gap:       elements.gapToggle?.checked || false,
            stdGroups: Array.from(activeStandardGroups)
        },
        openLessons:       openLessonIds,
        hasRunAuditConfig: hasRunAuditConfig
    }));
}

function restoreAppState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        hasRunAuditConfig = state.hasRunAuditConfig || false;

        if (state.view === 'audit') {
            switchView('audit');

            if (state.filters) {
                const radio = document.querySelector(
                    `input[name="audit-filter"][value="${state.filters.type}"]`
                );
                if (radio) {
                    radio.checked = true;
                    elements.auditDetailArea.classList.remove('show-objs-only', 'show-stds-only');
                    if      (state.filters.type === 'obj') elements.auditDetailArea.classList.add('show-objs-only');
                    else if (state.filters.type === 'std') elements.auditDetailArea.classList.add('show-stds-only');
                }
                if (elements.gapToggle) {
                    elements.gapToggle.checked = !!state.filters.gap;
                    elements.auditDetailArea.classList.toggle('gap-mode', !!state.filters.gap);
                }
                if (state.filters.stdGroups?.length) {
                    activeStandardGroups = new Set(state.filters.stdGroups);
                    const wrapper = document.getElementById('std-filter-wrapper');
                    if (wrapper?.style.display !== 'none') window.renderStdFilterDropdown();
                }
            }

            if (
                state.auditMode === 'detail' &&
                state.moduleIndex > -1 &&
                state.moduleIndex < validModules.length
            ) {
                currentModuleIndex = state.moduleIndex;
                elements.dashboardGrid.style.display   = 'none';
                elements.auditTopBar.style.display     = 'none';
                elements.auditDetailArea.style.display = 'block';
                renderModuleDetail(false);

                if (state.openLessons?.length) {
                    state.openLessons.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.open = true;
                    });
                    const all  = elements.auditDetailContent.querySelectorAll('details.audit-lesson');
                    const open = elements.auditDetailContent.querySelectorAll('details.audit-lesson[open]');
                    if (all.length > 0 && open.length === all.length) {
                        isAllExpanded = true;
                        updateToggleButton();
                    }
                }
            } else if (hasRunAuditConfig) {
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
					
