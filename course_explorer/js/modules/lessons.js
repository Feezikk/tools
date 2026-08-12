// =============================================================================
// LESSONS.JS
// Switching between top-level views (dashboard/search/standards/media/etc.) and expanding/collapsing lesson rows.
// =============================================================================


window.switchView = function switchView(viewName) {
    // If the Media Dashboard is currently on screen and we're navigating
    // away from it, remember where the active tab was scrolled to so
    // coming back to Media (not just switching its internal tabs) resumes
    // instead of restarting at the top.
    if (elements.mediaArea && elements.mediaArea.style.display === 'block' && typeof captureMediaScrollPosition === 'function') {
        captureMediaScrollPosition(MediaState.tab);
    }

    elements.viewBtns.forEach(b => b.classList.remove('active'));

    [
        elements.searchWrapper, elements.results,
        elements.stdsSearchArea, elements.mediaArea,
        elements.dashboardGrid,  elements.mapTopBar,
        elements.mapDetailArea, elements.configScreen,
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
        renderMediaDashboard({ resumeImages: true });
        if (typeof restoreMediaScrollPosition === 'function') restoreMediaScrollPosition(MediaState.tab);
    } else if (viewName === 'readability') {
        document.getElementById('btn-view-read').classList.add('active');
        document.getElementById('readability-area').style.display = 'block';
        renderReadabilityDashboard();
    } else if (viewName === 'map') {
        document.getElementById('btn-view-map').classList.add('active');
        if (!hasRunMapConfig) {
            elements.configScreen.style.display = 'block';
            showConfigScreen();
        } else {
            elements.mapTopBar.style.display = 'flex';
            backToDashboard();
        }
    }

    setTimeout(updateStickyHeaderOffset, 50);
    saveAppState();
};

window.backToDashboard = function backToDashboard() {
    elements.dashboardGrid.style.display   = 'grid';
    elements.mapDetailArea.style.display = 'none';
    elements.mapTopBar.style.display     = 'flex';
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
    elements.mapDetailContent
        .querySelectorAll('details.map-lesson')
        .forEach(l => {
            if (shouldExpand) l.setAttribute('open', 'true');
            else              l.removeAttribute('open');
        });
}

