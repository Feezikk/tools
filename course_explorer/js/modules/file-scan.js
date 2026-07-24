// =============================================================================
// FILE-SCAN.JS
// Recent-folder history UI, kicking off a batch folder scan from the file picker, and the course-selection modal shown when multiple courses are detected.
// =============================================================================


function renderHistory() {
    const lastFolder = localStorage.getItem(HISTORY_KEY);
    if (!lastFolder) { elements.historyArea.style.display = 'none'; return; }
    elements.historyArea.style.display = 'block';
    elements.historyList.innerHTML =
        `<div class="history-chip" onclick="document.getElementById('folder-input').click()">
            <span style="color:var(--primary);">${SVGS.folder}</span> ${lastFolder}
         </div>`;
}

elements.input.addEventListener('change', (e) => handleBatchScan(e.target.files));

elements.selectCourseBtn.addEventListener('click', () => {
    if (availableCoursesFromScan.size > 1) { isRefreshMode = false; showCourseSelectionModal(); }
    else { localStorage.removeItem(STATE_KEY); location.reload(); }
});

elements.refreshBtn.addEventListener('click', () => {
    isRefreshMode = true;
    elements.input.value = '';
    elements.input.click();
});

async function handleBatchScan(files) {
    if (!files.length) return;

    [
        elements.searchWrapper, elements.results, elements.stdsSearchArea,
        elements.mediaArea, elements.dashboardGrid, elements.auditTopBar,
        elements.auditDetailArea, elements.viewSwitcher, elements.setupArea,
        elements.exportSearchBtn, elements.exportStdsBtn, elements.fullscreenStdsBtn,
        elements.configScreen, elements.selectCourseBtn, elements.refreshBtn,
        elements.searchStats, elements.stdsStats
    ].forEach(el => { if (el) el.style.display = 'none'; });

    elements.status.style.display = 'block';
    elements.status.innerHTML     = `<div class="spinner"></div> Scanning for latest course versions…`;

    let detectedFolderName = "Course Folder";
    if (files[0]?.webkitRelativePath) {
        detectedFolderName = files[0].webkitRelativePath.split('/')[0];
    }
    localStorage.setItem(HISTORY_KEY, detectedFolderName);

    availableCoursesFromScan.clear();
    const courseVersionsTracker = new Map();
    const rootFallbackMap       = new Map();
    const versionFolderRegex    = /(_v(\d+)|_?cbimport)$/i;

    for (const file of files) {
        const originalPath = file.webkitRelativePath || file.name;
        const pathParts    = originalPath.split('/');
        let versionFolderIndex = -1, isCbImport = false, versionWeight = -1, displayVersion = "";

        for (let j = 0; j < pathParts.length; j++) {
            const m = pathParts[j].match(versionFolderRegex);
            if (m) {
                versionFolderIndex = j;
                if (m[0].toLowerCase().includes('cbimport')) { isCbImport = true; displayVersion = "cbimport"; }
                else { versionWeight = parseInt(m[2], 10); displayVersion = `v${versionWeight}`; }
                break;
            }
        }

        if (versionFolderIndex !== -1) {
            const folderName = pathParts[versionFolderIndex];
            const courseName = folderName.replace(versionFolderRegex, '');

            if (!courseVersionsTracker.has(courseName)) {
                courseVersionsTracker.set(courseName, { bestNumeric: null, cbImport: null });
            }
            const tracker = courseVersionsTracker.get(courseName);
            let activeTarget = null;

            if (isCbImport) {
                if (!tracker.cbImport) tracker.cbImport = { display: displayVersion, fileMap: new Map() };
                activeTarget = tracker.cbImport;
            } else {
                if (!tracker.bestNumeric || versionWeight > tracker.bestNumeric.weight) {
                    tracker.bestNumeric = { weight: versionWeight, display: displayVersion, fileMap: new Map() };
                }
                if (versionWeight === tracker.bestNumeric.weight) activeTarget = tracker.bestNumeric;
                else continue;
            }

            const relPath = pathParts.slice(versionFolderIndex + 1).join('/');
            if (
                relPath.includes('global/') || relPath.includes('content/') ||
                relPath.includes('data/')   || relPath === 'sitemap.json'   ||
                file.name === 'settings.json'
            ) {
                activeTarget.fileMap.set(relPath, file);
                if (!relPath.includes('interactives/')) activeTarget.fileMap.set(file.name, file);
            }
        } else {
            if (file.name === 'settings.json') rootFallbackMap.set('settings.json', file);
            if (
                originalPath.includes('/global/') || originalPath.includes('/content/') ||
                originalPath.includes('/data/')   || file.name === 'sitemap.json'
            ) {
                let cleanPath = originalPath;
                if (pathParts.length > 1) { const s = [...pathParts]; s.shift(); cleanPath = s.join('/'); }
                rootFallbackMap.set(cleanPath, file);
                if (!originalPath.includes('/interactives/')) rootFallbackMap.set(file.name, file);
            }
        }
    }

    // Helper function to extract the title from settings.json before rendering the modal
    const extractTitle = async (fMap, fallbackName) => {
        const settingsFile = fMap.get('settings.json') || fMap.get('global/data/settings.json') || fMap.get('data/settings.json');
        if (settingsFile) {
            try {
                const settingsJson = JSON.parse(await settingsFile.text());
                function findCourseTitle(obj) {
                    if (!obj || typeof obj !== 'object') return null;
                    if (typeof obj.course_title === 'string' && obj.course_title.trim()) return obj.course_title.trim();
                    for (const key in obj) {
                        const found = findCourseTitle(obj[key]);
                        if (found) return found;
                    }
                    return null;
                }
                const title = findCourseTitle(settingsJson);
                if (title) return title;
            } catch (e) {}
        }
        return fallbackName;
    };

    // Use a for...of loop so we can await the title extraction for each detected course
    for (const [courseName, data] of courseVersionsTracker.entries()) {
        if (data.bestNumeric?.fileMap.has('sitemap.json') ||
            data.bestNumeric?.fileMap.has('global/sitemap.json')) {
            const title = await extractTitle(data.bestNumeric.fileMap, courseName);
            availableCoursesFromScan.set(`${title} (${data.bestNumeric.display})`, data.bestNumeric.fileMap);
        }
        if (data.cbImport?.fileMap.has('sitemap.json') ||
            data.cbImport?.fileMap.has('global/sitemap.json')) {
            const title = await extractTitle(data.cbImport.fileMap, courseName);
            availableCoursesFromScan.set(`${title} (${data.cbImport.display})`, data.cbImport.fileMap);
        }
    }

    if (
        availableCoursesFromScan.size === 0 &&
        (rootFallbackMap.has('sitemap.json') || rootFallbackMap.has('global/sitemap.json'))
    ) {
        const title = await extractTitle(rootFallbackMap, "Selected Root Course");
        availableCoursesFromScan.set(title, rootFallbackMap);
    }

    if (availableCoursesFromScan.size === 0) {
        elements.status.innerHTML =
            `<span style="color:var(--badge-missing-text)">
                ${SVGS.x} Error: No valid course structure or 'sitemap.json' found.
             </span>`;
        elements.setupArea.style.display = 'block';
        return;
    }

    if (availableCoursesFromScan.size === 1 && !isRefreshMode) {
        selectedCourseName = Array.from(availableCoursesFromScan.keys())[0];
        fileMap = availableCoursesFromScan.get(selectedCourseName);
        runIndexingAndShowUI(false);
        return;
    }

    if (isRefreshMode && selectedCourseName &&
        availableCoursesFromScan.has(selectedCourseName)) {
        fileMap = availableCoursesFromScan.get(selectedCourseName);
        runIndexingAndShowUI(true);
        return;
    }

    elements.status.style.display = 'none';
    showCourseSelectionModal();
}

function showCourseSelectionModal() {
    const container     = document.getElementById('course-list-container');
    const sortedCourses = Array.from(availableCoursesFromScan.keys()).sort();

    let html = '<div style="column-count:2; column-gap:20px;">';
    sortedCourses.forEach((name, idx) => {
        const isChecked = (selectedCourseName === name ||
                          (selectedCourseName === "" && idx === 0)) ? 'checked' : '';
        html +=
            `<label class="course-list-item" style="align-items: flex-start; padding-top: 6px; padding-bottom: 6px;">
                <input type="radio" name="course-radio" class="course-radio"
                       value="${escapeHtml(name)}" ${isChecked} style="flex-shrink:0; margin: 2px 0 0 0;">
                <span style="flex:1; white-space:normal; line-height:1.3; margin-left:8px;"
                      title="${escapeHtml(name)}">${escapeHtml(name)}</span>
             </label>`;
    });
    html += '</div>';
    container.innerHTML = html;
    document.getElementById('course-selection-modal').classList.add('active');
}

window.cancelCourseSelection = function cancelCourseSelection() {
    document.getElementById('course-selection-modal').classList.remove('active');
    if (courseIndex.length === 0) {
        elements.setupArea.style.display = 'block';
        elements.input.value = '';
    }
};

window.confirmCourseSelection = function confirmCourseSelection() {
    const selectedRadio = document.querySelector('.course-radio:checked');
    if (!selectedRadio) { alert("Please select a course to explore."); return; }
    selectedCourseName = selectedRadio.value;
    document.getElementById('course-selection-modal').classList.remove('active');
    elements.status.style.display = 'block';
    fileMap = availableCoursesFromScan.get(selectedCourseName);
    runIndexingAndShowUI(false);
};

