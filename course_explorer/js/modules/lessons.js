// =============================================================================
// LESSONS.JS
// Switching between top-level views (dashboard/search/standards/media/etc.) and expanding/collapsing lesson rows.
// =============================================================================


window.switchView = function switchView(viewName) {
    elements.viewBtns.forEach(b => b.classList.remove('active'));

    [
        elements.searchWrapper, elements.results,
        elements.stdsSearchArea, elements.mediaArea,
        elements.dashboardGrid,  elements.auditTopBar,
        elements.auditDetailArea, elements.configScreen,
        document.getElementById('readability-area')
    ].forEach(el => { if (el) el.style.display = 'none'; });

    if (viewName === 'search') {
        document.getElementById('btn-view-search').classList.add('active');
        elements.searchWrapper.style.display = 'block';
        elements.results.style.display       = 'flex';
    } else if (viewName === 'stds') {
        document.getElementById('btn-view-stds').classList.add('active');
        elements.stdsSearchArea.style.display = 'block';
        runStdsSearch();
    } else if (viewName === 'media') {
        document.getElementById('btn-view-media').classList.add('active');
        elements.mediaArea.style.display = 'block';
        renderMediaDashboard();
	} else if (viewName === 'readability') {
        document.getElementById('btn-view-read').classList.add('active');
        document.getElementById('readability-area').style.display = 'block';
        renderReadabilityDashboard();
    } else if (viewName === 'audit') {
        document.getElementById('btn-view-audit').classList.add('active');
        if (!hasRunAuditConfig) {
            elements.configScreen.style.display = 'block';
            showConfigScreen();
        } else {
            elements.auditTopBar.style.display = 'flex';
            backToDashboard();
        }
    }

    setTimeout(updateStickyHeaderOffset, 50);
    saveAppState();
};

window.backToDashboard = function backToDashboard() {
    elements.dashboardGrid.style.display   = 'grid';
    elements.auditDetailArea.style.display = 'none';
    elements.auditTopBar.style.display     = 'flex';
    renderDashboardGrid();
    saveAppState();
};


window.toggleAllLessonsState = function toggleAllLessonsState() {
    isAllExpanded = !isAllExpanded;
    updateToggleButton();
    applyExpansionState(isAllExpanded);
    saveAppState();
};

function updateToggleButton() {
    if (elements.toggleAllBtn) {
        elements.toggleAllBtn.innerHTML = isAllExpanded
            ? `${SVGS.arrowUp}   Collapse Lessons`
            : `${SVGS.arrowDown} Expand Lessons`;
    }
}

function applyExpansionState(shouldExpand) {
    elements.auditDetailContent
        .querySelectorAll('details.audit-lesson')
        .forEach(l => {
            if (shouldExpand) l.setAttribute('open', 'true');
            else              l.removeAttribute('open');
        });
}

