// =============================================================================
// MEDIA.JS
// Media Dashboard (images/video/audio/interactives): filter toggle handlers, the shared filter helper, the main grid renderer, and the media preview modal (open/navigate/close).
// =============================================================================

// Media Dashboard state. Previously ~18 separate globals in state.js;
// consolidated here since media.js is the only module that owns this
// feature. A few outside references still go through window.MediaState:
// checklist.js resets `activeModules` when rebuilding the valid module list,
// glossary.js reads `activeModules` to cross-filter glossary terms by the
// same module selection, import-export.js reads the filter flags when
// exporting, indexing.js resets several fields on each new course index, and
// app.js/utilities.js touch `isFilterOpen` from generic dropdown-closing code.
//
// (`currentDisplayedMedia` and `previousModalState` were deliberately NOT
// moved here even though they sit near media state in state.js — both are
// genuinely shared across multiple unrelated features, not owned by media:
// currentDisplayedMedia backs the same "click a rendered card" pattern used
// by the Glossary tab and app.js's event delegation, and previousModalState
// is reused by standards.js for its own, unrelated modal restore flow.)
const MediaState = {
    renderCount:            0,
    layout:                 localStorage.getItem('courseSearch_mediaLayout') || 'grid',
    tab:                    'images',
    activeModules:          new Set(),
    filterTypes:            new Set(),
    filterMissingId:        false,
    filterHasAlt:           false,
    filterHasCaption:       false,
    filterHasCaptionHeader: false,
    filterHasTextVer:       false,
    filterCheckCopyright:   false,
    filterCheckTextVer:     false,
    filterCheckFileName:    false,
    filterFlaggedOnly:      false,
    isFilterOpen:           false,
    downloadsView:          'linked', // 'linked' | 'unlinked'
    downloadsSearchQuery:   '',
    searchQuery:            '',       // shared search box for Images / Videos / Audio tabs
    cachedUnlinkedDocuments: null,    // computed lazily, invalidated on each new index run
    isGlobalDarkImageBg:    false,
    audioBlobUrl:           null,
};
window.MediaState = MediaState;

window.setMediaTab = function setMediaTab(tab) {
    MediaState.tab = tab;
    MediaState.filterTypes.clear();
    MediaState.filterMissingId = false;
    MediaState.filterHasAlt = false;
    MediaState.filterHasCaption = false;
    MediaState.filterHasCaptionHeader = false;
    MediaState.filterHasTextVer = false;
    MediaState.filterCheckCopyright = false;
    MediaState.filterCheckTextVer = false;
    MediaState.filterCheckFileName = false;
    MediaState.filterFlaggedOnly = false;
    MediaState.downloadsSearchQuery = '';
    MediaState.searchQuery = '';
    renderMediaDashboard();
};

window.setMediaLayout = function setMediaLayout(layout) {
    MediaState.layout = layout;
    localStorage.setItem('courseSearch_mediaLayout', layout);
    renderMediaDashboard();
};

window.toggleMissingIdFilter = makeCheckedFlagToggle(v => MediaState.filterMissingId = v, () => renderMediaDashboard());

window.toggleGlobalImageBg = function(checked) {
    MediaState.isGlobalDarkImageBg = checked;
    if (checked) document.body.classList.add('global-dark-bg');
    else         document.body.classList.remove('global-dark-bg');
};

window.toggleMediaFilterHasAlt          = makeCheckedFlagToggle(v => MediaState.filterHasAlt = v,          () => renderMediaDashboard());
window.toggleMediaFilterHasCaption      = makeCheckedFlagToggle(v => MediaState.filterHasCaption = v,      () => renderMediaDashboard());
window.toggleMediaFilterHasCaptionHeader = makeCheckedFlagToggle(v => MediaState.filterHasCaptionHeader = v, () => renderMediaDashboard());
window.toggleMediaFilterHasTextVer      = makeCheckedFlagToggle(v => MediaState.filterHasTextVer = v,      () => renderMediaDashboard());

window.toggleMediaFilterCheckCopyright = makeCheckedFlagToggle(v => MediaState.filterCheckCopyright = v, () => renderMediaDashboard());
window.toggleMediaFilterCheckTextVer   = makeCheckedFlagToggle(v => MediaState.filterCheckTextVer = v,   () => renderMediaDashboard());
window.toggleMediaFilterCheckFileName  = makeCheckedFlagToggle(v => MediaState.filterCheckFileName = v,  () => renderMediaDashboard());
window.toggleDownloadsFlaggedOnly      = makeCheckedFlagToggle(v => MediaState.filterFlaggedOnly = v,    () => renderMediaDashboard());

window.toggleMediaTypeFilter = makeSetToggle(MediaState.filterTypes, () => renderMediaDashboard());

window.toggleMediaModule = makeSetToggle(MediaState.activeModules, () => renderMediaDashboard());

window.toggleAllMediaModules = makeSetAllToggle(
    MediaState.activeModules,
    () => validModules.map(mod => padNum(mod.num)),
    () => renderMediaDashboard()
);

window.toggleMediaFilterDropdown = function toggleMediaFilterDropdown(event) {
    toggleFilterDropdown('media-filter-dropdown', event);
};

window.setDownloadsView = function setDownloadsView(view) {
    MediaState.downloadsView = view;
    MediaState.downloadsSearchQuery = '';
    renderMediaDashboard();
};

window.filterDownloadsList = function filterDownloadsList(val) {
    renderDownloadsList(val);
};

window.toggleDownloadsClearBtn = function toggleDownloadsClearBtn(val) {
    const btn = document.getElementById('downloads-search-clear');
    if (btn) btn.style.display = val.length > 0 ? 'block' : 'none';
};

window.clearDownloadsSearch = function clearDownloadsSearch() {
    const input = document.getElementById('downloads-search');
    if (input) input.value = '';
    toggleDownloadsClearBtn('');
    renderDownloadsList('');
};

// Shared substring search used by the Images / Videos / Audio search bar.
// `fields` is an array of raw (possibly undefined) strings pulled from the item.
function matchesMediaSearch(query, fields) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return true;
    return fields.filter(Boolean).join(' ').toLowerCase().includes(q);
}

// Shared filtering logic for videos/audio/images, used by both the full
// dashboard render (for tab counts / type-checkbox lists) and the
// keystroke-driven search re-renders (renderVideosList/renderAudioList/renderImagesList),
// so the two always stay in sync — same approach as getFilteredDownloads.
function getFilteredVideos(query, opts = {}) {
    const { skipTypeFilter = false } = opts;
    return courseVideos.filter(m =>
        passesModuleFilter(m) &&
        (!MediaState.filterMissingId || isMissingId(m.entryId)) &&
        (skipTypeFilter || MediaState.filterTypes.size === 0 || MediaState.filterTypes.has(m.kalturaType)) &&
        matchesMediaSearch(query, [m.title, m.entryId, m.locationId])
    );
}

function getFilteredAudio(query, opts = {}) {
    const { skipTypeFilter = false } = opts;
    return courseAudio.filter(m =>
        passesModuleFilter(m) &&
        (!MediaState.filterMissingId || isMissingId(m.entryId)) &&
        (skipTypeFilter || MediaState.filterTypes.size === 0 || MediaState.filterTypes.has(m.kalturaType)) &&
        matchesMediaSearch(query, [m.title, m.entryId, m.locationId])
    );
}

function getFilteredImages(query, opts = {}) {
    const { skipTypeFilter = false } = opts;
    return courseImages.filter(img => {
        if (!passesModuleFilter(img)) return false;
        if (MediaState.filterHasAlt && !img.altText.trim()) return false;
        if (MediaState.filterHasCaption && !img.caption.trim()) return false;
        if (MediaState.filterHasCaptionHeader && !img.captionHeader.trim()) return false;
        if (MediaState.filterHasTextVer && !img.textVersion.trim()) return false;

        if (MediaState.filterCheckCopyright) {
            if (img.copyright.trim() !== '') return false;
            const nameWithoutExt = img.fileName.substring(0, img.fileName.lastIndexOf('.')) || img.fileName;
            const approvedSuffixes = ['_gi', '_ts', '_flvs', '_flvs_ai', '_ai_flvs'];
            const hasApprovedSuffix = approvedSuffixes.some(suffix => nameWithoutExt.toLowerCase().endsWith(suffix));
            if (hasApprovedSuffix) return false;
        }

        if (MediaState.filterCheckTextVer) {
            const hasTextVer = !!img.textVersion.trim();
            const hasAlt = !!img.altText.trim();
            const altContainsTextVer = img.altText.toLowerCase().includes('text version');

            const failsCondition1 = hasTextVer && !hasAlt;
            const failsCondition2 = altContainsTextVer && !hasTextVer;

            if (!failsCondition1 && !failsCondition2) return false;
        }

        if (MediaState.filterCheckFileName && evaluateFileNameCheck(img.fileName).status !== 'fail') return false;

        if (!skipTypeFilter && MediaState.filterTypes.size > 0 && !MediaState.filterTypes.has(img.fileType)) return false;
        if (!matchesMediaSearch(query, [img.fileName, img.altText, img.caption, img.locationId])) return false;

        return true;
    });
}

// Routes a keystroke in the media search box to whichever tab is currently
// active, re-rendering only #media-grid (not the whole dashboard/header) so
// the input never loses focus while typing — same approach as Downloads.
window.filterMediaGridSearch = function filterMediaGridSearch(val) {
    if      (MediaState.tab === 'images') renderImagesList(val);
    else if (MediaState.tab === 'videos') renderVideosList(val);
    else if (MediaState.tab === 'audio')  renderAudioList(val);
};

window.toggleMediaSearchClearBtn = function toggleMediaSearchClearBtn(val) {
    const btn = document.getElementById('media-search-clear');
    if (btn) btn.style.display = val.length > 0 ? 'block' : 'none';
};

window.clearMediaGridSearch = function clearMediaGridSearch() {
    const input = document.getElementById('media-search');
    if (input) input.value = '';
    toggleMediaSearchClearBtn('');
    filterMediaGridSearch('');
};


function passesModuleFilter(item) {
    if (!item.locationId) return false;
    if (MediaState.activeModules.size === 0) return true;
    return MediaState.activeModules.has(item.locationId.split('.')[0]);
}

window.clearAllMediaFilters = function clearAllMediaFilters() {
    MediaState.activeModules.clear();
    MediaState.filterTypes.clear();
    MediaState.filterMissingId = false;
    MediaState.filterHasAlt = false;
    MediaState.filterHasCaption = false;
    MediaState.filterHasCaptionHeader = false;
    MediaState.filterHasTextVer = false;
    MediaState.filterCheckCopyright = false;
    MediaState.filterCheckTextVer = false;
    MediaState.filterCheckFileName = false;
    MediaState.filterFlaggedOnly = false;
    renderMediaDashboard();
};


// Scans the folder that holds the linked documents (inferred from the linked
// paths themselves) and returns every file in that folder that is NOT
// referenced by a [[ link | ... | dLoad ]] tag anywhere in the course.
// Cached on `MediaState.cachedUnlinkedDocuments` and invalidated whenever a new course
// is indexed (see indexing.js).
function getUnlinkedDocuments() {
    if (MediaState.cachedUnlinkedDocuments) return MediaState.cachedUnlinkedDocuments;
    if (!courseDocuments.length) { MediaState.cachedUnlinkedDocuments = []; return MediaState.cachedUnlinkedDocuments; }

    // Infer the documents folder as the most common parent folder among linked paths.
    const folderCounts = new Map();
    courseDocuments.forEach(d => {
        const idx    = d.path.lastIndexOf('/');
        const folder = idx !== -1 ? d.path.substring(0, idx + 1) : '';
        folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
    });
    let docsFolder = '', maxCount = -1;
    for (const [folder, count] of folderCounts) {
        if (count > maxCount) { maxCount = count; docsFolder = folder; }
    }

    const linkedPaths = new Set(courseDocuments.map(d => d.path));
    const unlinked = [];

    for (const key of fileMap.keys()) {
        if (!docsFolder || !key.startsWith(docsFolder)) continue;
        if (linkedPaths.has(key)) continue;
        const rest = key.slice(docsFolder.length);
        if (!rest || rest.includes('/')) continue;     // only direct files, skip nested sub-folders
        if (!rest.includes('.')) continue;              // skip extension-less entries
        const fileType = rest.split('.').pop().toLowerCase();
        unlinked.push({ fileName: rest, fileType, folder: docsFolder, path: key, status: 'Not Linked' });
    }

    unlinked.sort((a, b) => a.fileName.localeCompare(b.fileName));
    MediaState.cachedUnlinkedDocuments = unlinked;
    queueAccessibilityChecks(unlinked);
    return unlinked;
}

// Registry of "is this document flagged for review" predicates. Each
// Downloads validation feature (Structure Check, FLVS Footer Check, File
// Name Check, Title/Type Check, and any future Downloads validation)
// registers its own predicate here via registerDownloadsFlagPredicate(),
// so the "Flagged Items Only" filter below automatically covers whatever
// checks currently exist without media.js needing to know their specifics.
const DownloadsFlagPredicates = [];
function registerDownloadsFlagPredicate(predicateFn) {
    DownloadsFlagPredicates.push(predicateFn);
}
function isDownloadFlagged(doc) {
    return DownloadsFlagPredicates.some(fn => {
        try { return !!fn(doc); } catch (e) { return false; } // a broken predicate shouldn't hide every document
    });
}

// Called whenever a background Structure/Footer check finishes. Those
// checks only patch their own badge cell in place (see
// patchAccessibilityCellsForPath / patchFooterCheckCellsForPath in
// accessibility.js) — they don't add or remove rows. If the "Flagged Items
// Only" filter is active, a document that just failed a check wouldn't
// appear until the list re-renders, so re-run the filter now.
function refreshDownloadsFlaggedFilterIfActive() {
    if (MediaState.tab === 'downloads' && MediaState.filterFlaggedOnly && typeof renderDownloadsList === 'function') {
        renderDownloadsList(MediaState.downloadsSearchQuery);
    }
}

// Shared filtering logic for both the full dashboard render and the
// keystroke-driven search (renderDownloadsList), so the two stay in sync.
function getFilteredDownloads(query, opts = {}) {
    const { skipTypeFilter = false } = opts;
    const q = (query || '').trim().toLowerCase();
    const matchesDocSearch = (d) => {
        if (!q) return true;
        const haystack = [d.title, d.fileName, d.fileType, d.breadcrumb, d.locationId, d.folder]
            .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
    };
    const matchesType = (d) => skipTypeFilter || MediaState.filterTypes.size === 0 || MediaState.filterTypes.has(d.fileType);
    const matchesFlagFilter = (d) => !MediaState.filterFlaggedOnly || isDownloadFlagged(d);

    if (MediaState.downloadsView === 'unlinked') {
        return getUnlinkedDocuments().filter(d => matchesType(d) && matchesDocSearch(d) && matchesFlagFilter(d));
    }
    return courseDocuments.filter(d =>
        passesModuleFilter(d) &&
        matchesType(d) &&
        matchesDocSearch(d) &&
        matchesFlagFilter(d)
    );
}

// Renders the downloads grid/table directly into #media-grid, honoring the
// current grid/list layout toggle exactly like every other media tab.
window.renderDownloadsList = function renderDownloadsList(query = '') {
    MediaState.downloadsSearchQuery = query;
    const grid = document.getElementById('media-grid');
    if (!grid) return;

    currentDisplayedMedia = [];
    const filtered   = getFilteredDownloads(query);
    const isUnlinked = MediaState.downloadsView === 'unlinked';

    if (!filtered.length) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">${
            isUnlinked
                ? 'No unlinked downloads found — every file in the downloads folder is referenced somewhere in the course.'
                : 'No downloads found for the selected filters.'
        }</div>`;
        return;
    }

    if (MediaState.layout === 'list') {
        grid.className     = '';
        grid.style.display = 'block';
        const wrapper = document.createElement('div');
        wrapper.className = 'image-list-wrapper';
        let tableRows = '';

        if (isUnlinked) {
            filtered.forEach(doc => {
                currentDisplayedMedia.push({ item: doc, type: 'document' });
                const idx = currentDisplayedMedia.length - 1;
                tableRows += `
                    <tr data-index="${idx}">
                        <td style="text-align:center;"><button class="download-icon-btn" data-index="${idx}" title="Download a copy of the file.">${SVGS.download}</button></td>
                        <td><span class="downloads-filename-only">${escapeHtml(doc.fileName)}</span></td>
                        <td style="font-family:var(--code-font); color:var(--text-light); font-size:0.8rem;">${escapeHtml(doc.fileType)}</td>
                        <td>${renderFileNameBadge(doc, 'document')}</td>
                        <td><span class="type-badge" style="background:var(--badge-missing); color:var(--badge-missing-text);">${escapeHtml(doc.status)}</span></td>
                        <td>${renderAccessibilityCell(doc)}</td>
                        <td>${renderFooterCheckCell(doc)}</td>
                    </tr>`;
            });
            wrapper.innerHTML = `
                <table class="image-list-table downloads-table downloads-table-unlinked">
                    <colgroup>
                        <col class="col-download"><col class="col-filename"><col class="col-type"><col class="col-filecheck"><col class="col-status"><col class="col-structure"><col class="col-footer">
                    </colgroup>
                    <thead><tr><th></th><th>File Name</th><th>Type</th><th>File Name Check ${fileNameCheckInfoButton()}</th><th>Status</th><th>Structure Check ${structureCheckInfoButton()}</th><th>FLVS Footer ${footerCheckInfoButton()}</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>`;
        } else {
            filtered.forEach(doc => {
                currentDisplayedMedia.push({ item: doc, type: 'document' });
                const idx = currentDisplayedMedia.length - 1;
                tableRows += `
                    <tr data-index="${idx}">
                        <td style="text-align:center;"><button class="download-icon-btn" data-index="${idx}" title="Download a copy of the file.">${SVGS.download}</button></td>
                        <td style="font-family:var(--code-font); color:var(--id-color); font-size:0.8rem;">${doc.locationId}</td>
                        <td class="downloads-title-cell">
                            <div class="downloads-title-text">${escapeHtml(doc.title)}</div>
                            <div class="downloads-filename-text">${escapeHtml(doc.fileName)}</div>
                        </td>
                        <td>${renderTitleTypeBadge(doc)}</td>
                        <td>${renderFileNameBadge(doc, 'document')}</td>
                        <td>${renderAccessibilityCell(doc)}</td>
                        <td>${renderFooterCheckCell(doc)}</td>
                    </tr>`;
            });
            wrapper.innerHTML = `
                <table class="image-list-table downloads-table downloads-table-linked">
                    <colgroup>
                        <col class="col-download"><col class="col-location"><col class="col-title"><col class="col-type"><col class="col-filecheck"><col class="col-structure"><col class="col-footer">
                    </colgroup>
                    <thead><tr><th></th><th>Location</th><th>Title/Filename</th><th>Type ${titleTypeCheckInfoButton()}</th><th>File Name ${fileNameCheckInfoButton()}</th><th>Structure Check ${structureCheckInfoButton()}</th><th>FLVS Footer ${footerCheckInfoButton()}</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>`;
        }

        grid.innerHTML = '';
        grid.appendChild(wrapper);
    } else {
        grid.className     = '';
        grid.style.display = 'grid';
        grid.innerHTML     = '';
        const frag = document.createDocumentFragment();

        if (isUnlinked) {
            filtered.forEach(doc => {
                currentDisplayedMedia.push({ item: doc, type: 'document' });
                const idx = currentDisplayedMedia.length - 1;
                const card = document.createElement('div');
                card.className     = 'media-card';
                card.dataset.index = idx;
                card.innerHTML = `
                    <div class="media-top-row">
                        <button class="media-icon download-icon-btn" data-index="${idx}" title="Download a copy of the file.">${SVGS.download}</button>
                        <div class="media-location"><span class="type-badge" style="background:var(--badge-missing); color:var(--badge-missing-text); margin:0;">Not Linked</span></div>
                    </div>
                    <h3 class="media-title" title="${escapeHtml(doc.fileName)}">${escapeHtml(doc.fileName)}</h3>
                    <div class="media-card-footer">
                        <span class="type-badge">Type: ${escapeHtml(doc.fileType)}</span>
                        ${renderFileNameBadge(doc, 'document')}
                        ${renderAccessibilityCell(doc)}
                        ${renderFooterCheckCell(doc)}
                    </div>`;
                frag.appendChild(card);
            });
        } else {
            filtered.forEach(doc => {
                currentDisplayedMedia.push({ item: doc, type: 'document' });
                const idx = currentDisplayedMedia.length - 1;
                const card = document.createElement('div');
                card.className     = 'media-card';
                card.dataset.index = idx;
                card.innerHTML = `
                    <div class="media-top-row">
                        <button class="media-icon download-icon-btn" data-index="${idx}" title="Download a copy of the file.">${SVGS.download}</button>
                        <div class="media-location"><span class="id-number" title="Location"># ${doc.locationId}</span></div>
                    </div>
                    <h3 class="media-title" title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</h3>
                    <div class="media-card-footer">
                        <span style="color:#888; font-size:0.85rem;" title="Filename">${escapeHtml(doc.fileName)}</span>
                        ${renderTitleTypeBadge(doc)}
                        ${renderFileNameBadge(doc, 'document')}
                        ${renderAccessibilityCell(doc)}
                        ${renderFooterCheckCell(doc)}
                    </div>`;
                frag.appendChild(card);
            });
        }

        grid.appendChild(frag);
    }

    updateAccessibilityProgressUI();
};

// Opens a linked or unlinked document directly (PDFs render inline in most
// browsers via the blob URL; everything else downloads with its original
// filename preserved rather than the browser's random blob-URL id).
window.openDocumentFile = function openDocumentFile(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (!fileMap.has(cleanPath)) {
        alert(`File not found in the loaded folder: ${cleanPath}`);
        return;
    }
    const file     = fileMap.get(cleanPath);
    const fileName = cleanPath.split('/').pop();
    const url      = URL.createObjectURL(file);

    // Only a handful of formats render usefully inline in a new browser tab.
    // For everything else (Word, Excel, PowerPoint, zip, etc.), window.open()
    // on a blob URL still just downloads the file — but names it after the
    // random blob id instead of the real filename. Downloading directly via
    // an anchor's `download` attribute preserves the original filename.
    const INLINE_VIEWABLE_EXTENSIONS = new Set(['pdf', 'txt', 'htm', 'html']);
    const ext = (fileName.split('.').pop() || '').toLowerCase();

    if (INLINE_VIEWABLE_EXTENSIONS.has(ext)) {
        const win = window.open(url, '_blank');
        if (win) {
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return;
        }
        // Popup blocked — fall through to a direct download below.
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
};


// Renders the Images grid/table directly into #media-grid, honoring the
// current grid/list layout toggle and search box, exactly like Downloads.
window.renderImagesList = function renderImagesList(query = '') {
    MediaState.searchQuery = query;
    const grid = document.getElementById('media-grid');
    if (!grid) return;

    currentDisplayedMedia = [];
    MediaState.renderCount = 0;

    const filteredImages = getFilteredImages(query);

    if (!filteredImages.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No images found for the selected filters.</div>';
        return;
    }

    currentDisplayedMedia = filteredImages.map(img => ({ item: img, type: 'image' }));

    if (MediaState.layout === 'list') {
        grid.className = '';
        grid.style.display = 'block';
        const wrapper = document.createElement('div');
        wrapper.className = 'image-list-wrapper';
        wrapper.innerHTML = `
            <table class="image-list-table">
                <thead>
                    <tr>
                        <th style="width: 60px;">Thumbnail</th>
                        <th>Location</th>
                        <th>File Name ${fileNameCheckInfoButton()}</th>
                        <th>Type</th>
                        <th style="text-align:center;">Alt Text</th>
                        <th style="text-align:center;">Text Version</th>
                        <th style="text-align:center;">Caption</th>
                        <th style="text-align:center;">Caption Header</th>
                        <th style="text-align:center;">Copyright</th>
                    </tr>
                </thead>
                <tbody id="image-list-tbody"></tbody>
            </table>
        `;
        grid.appendChild(wrapper);
    } else {
        grid.className = 'image-grid-view';
        grid.style.display = '';
        grid.innerHTML = '';
    }

    window.renderImageBatch = function() {
        const batchContainer = MediaState.layout === 'list' ? document.getElementById('image-list-tbody') : grid;
        const start = MediaState.renderCount;
        const end = Math.min(start + MEDIA_BATCH_SIZE, currentDisplayedMedia.length);
        const batchFrag = document.createDocumentFragment();

        const checkIcon = `<span class="status-icon-check">${SVGS.checkCircle}</span>`;
        const dashIcon = `<span class="status-icon-dash">${SVGS.minus}</span>`;

        for (let i = start; i < end; i++) {
            const entry = currentDisplayedMedia[i];
            const img = entry.item;

            let srcUrl = '';
            const cleanPath = img.src.replace(/^\/+/, '');
            if (fileMap.has(cleanPath)) {
                srcUrl = URL.createObjectURL(fileMap.get(cleanPath));
            }

            if (MediaState.layout === 'grid') {
                const card = document.createElement('div');
                card.className = 'image-card';
                card.dataset.index = i;

                const tvClass = img.textVersion.trim() ? '' : 'missing';
                const tvIcon = img.textVersion.trim() ? SVGS.checkCircle : SVGS.minus;

                card.innerHTML = `
                    <div class="image-card-header">
                        <span class="id-number"># ${img.locationId}</span>
                        <span class="type-badge">Type: ${img.fileType}</span>
                    </div>
                    <div class="image-card-img-wrapper">
                        ${srcUrl ? `<img src="${srcUrl}" alt="Preview" loading="lazy">` : `<span style="color:#adb5bd; font-size:0.8rem;">Image not found</span>`}
                    </div>
                   <div class="image-card-body" style="font-size: 0.75rem; gap: 4px; line-height: 1.3;">
                        <div class="image-card-text"><strong> ${img.fileName || '<span class="empty-dash">—</span>'}</strong> ${renderFileNameBadge(img, 'image')}</div>
                        <div class="image-card-text"><strong>Alt:</strong> ${img.altText || '<span class="empty-dash">—</span>'}</div>
                        <div class="image-card-text"><strong>Caption:</strong> ${img.caption || '<span class="empty-dash">—</span>'}</div>
                        <div class="image-card-text"><strong>Copyright:</strong> ${img.copyright || '<span class="empty-dash">—</span>'}</div>
                    </div>
                    <div class="image-card-footer">
                        <span class="text-version-pill ${tvClass}">${tvIcon} Text Version</span>
                    </div>
                `;
                batchFrag.appendChild(card);
            } else {
                const tr = document.createElement('tr');
                tr.dataset.index = i;

                tr.innerHTML = `
                    <td>${srcUrl ? `<img src="${srcUrl}" class="img-thumb-sm" loading="lazy">` : `<div class="img-thumb-sm flex-center">${SVGS.image}</div>`}</td>
                    <td style="font-family:var(--code-font); color:var(--id-color); font-size:0.8rem;">${img.locationId}</td>
                    <td style="font-weight:500;">
                        <div>${escapeHtml(img.fileName)}</div>
                        <div style="margin-top:4px;">${renderFileNameBadge(img, 'image')}</div>
                    </td>
                    <td style="font-family:var(--code-font); color:var(--text-light); font-size:0.8rem;">${img.fileType}</td>
                    <td style="text-align:center;">${img.altText.trim() ? checkIcon : dashIcon}</td>
                    <td style="text-align:center;">${img.textVersion.trim() ? checkIcon : dashIcon}</td>
                    <td style="text-align:center;">${img.caption.trim() ? checkIcon : dashIcon}</td>
                    <td style="text-align:center;">${img.captionHeader.trim() ? checkIcon : dashIcon}</td>
                    <td style="text-align:center;">${img.copyright.trim() ? checkIcon : dashIcon}</td>
                `;
                batchFrag.appendChild(tr);
            }
        }

        document.getElementById('load-more-media-btn')?.remove();
        batchContainer.appendChild(batchFrag);
        MediaState.renderCount = end;

        if (MediaState.renderCount < currentDisplayedMedia.length) {
            const remaining = currentDisplayedMedia.length - MediaState.renderCount;
            const btnWrapper = document.createElement('div');
            btnWrapper.id = 'load-more-media-btn';
            btnWrapper.style = MediaState.layout === 'list' ? 'padding: 20px; text-align: center;' : 'grid-column: 1/-1; text-align: center;';

            const btn = document.createElement('button');
            btn.className = 'action-btn btn-base';
            btn.style.margin = '0 auto';
            btn.innerHTML = `Load Next ${Math.min(MEDIA_BATCH_SIZE, remaining)} Images (Showing ${MediaState.renderCount} of ${currentDisplayedMedia.length})`;
            btn.onclick = window.renderImageBatch;

            btnWrapper.appendChild(btn);
            grid.appendChild(btnWrapper);
        }
    };

    window.renderImageBatch();
};

// Renders the Videos grid/table directly into #media-grid, honoring the
// current grid/list layout toggle and search box, exactly like Downloads.
window.renderVideosList = function renderVideosList(query = '') {
    MediaState.searchQuery = query;
    const grid = document.getElementById('media-grid');
    if (!grid) return;

    currentDisplayedMedia = [];
    const filteredVideos = getFilteredVideos(query);

    if (!filteredVideos.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No videos found for the selected filters.</div>';
        return;
    }

    if (MediaState.layout === 'list') {
        grid.className = '';
        grid.style.display = 'block';
        grid.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'image-list-wrapper';

        let tableRows = '';
        filteredVideos.forEach(vid => {
            const hasTranscript = vid.textVersion?.replace(/<[^>]*>?/gm, '').trim();
            currentDisplayedMedia.push({ item: vid, type: 'video' });
            const idx = currentDisplayedMedia.length - 1;

            const isMissing = isMissingId(vid.entryId);
            const displayId = isMissing ? '<span style="color:#dc3545; font-weight:bold;">Blank</span>' : vid.entryId;
            const copyBtn = isMissing ? '' : `<button class="copy-btn flex-center" data-id="${vid.entryId}" title="Copy ID">${SVGS.clipboard}</button>`;

            tableRows += `
                <tr data-index="${idx}">
                    <td style="font-family:var(--code-font); color:var(--id-color); font-size:0.8rem;">${vid.locationId}</td>
                    <td style="font-weight:500; white-space:normal; min-width:200px;">${escapeHtml(vid.title)}</td>
                    <td style="font-family:var(--code-font); font-size:0.8rem;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${displayId}
                            ${copyBtn}
                        </div>
                    </td>
                    <td><span class="type-badge" style="margin:0;">${vid.kalturaType}</span></td>
                    <td style="text-align:center;">${hasTranscript ? `<span class="status-icon-check">${SVGS.checkCircle}</span>` : `<span class="status-icon-dash">${SVGS.minus}</span>`}</td>
                </tr>`;
        });

        wrapper.innerHTML = `
            <table class="image-list-table">
                <thead>
                    <tr>
                        <th>Location</th>
                        <th>Title</th>
                        <th>Kaltura ID</th>
                        <th>Type</th>
                        <th style="text-align:center;">Text Version</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>`;
        grid.appendChild(wrapper);
    } else {
        grid.className = '';
        grid.style.display = '';
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        filteredVideos.forEach(vid => {
            const hasTranscript = vid.textVersion?.replace(/<[^>]*>?/gm, '').trim();
            currentDisplayedMedia.push({ item: vid, type: 'video' });
            const isMissing = isMissingId(vid.entryId);
            const displayId = isMissing ? '<span style="color:#dc3545; font-weight:bold;">Blank</span>' : vid.entryId;
            const copyBtn = isMissing ? '' : ` <button class="copy-btn flex-center" data-id="${vid.entryId}" title="Copy ID">${SVGS.clipboard}</button>`;

            const card = document.createElement('div');
            card.className     = 'media-card';
            card.dataset.index = currentDisplayedMedia.length - 1;
            card.innerHTML = `
                <div class="media-top-row">
                    <div class="media-icon">${SVGS.video}</div>
                    <div class="media-location"><span class="id-number" title="Location"># ${vid.locationId}</span></div>
                </div>
                <h3 class="media-title flex-center gap-10" title="${escapeHtml(vid.title)}" style="justify-content:flex-start;">
                    ${escapeHtml(vid.title)} ${hasTranscript ? `<span title="Transcript Available" style="color:var(--primary); cursor:help;">${SVGS.fileText}</span>` : ''}
                </h3>
                <div class="media-card-footer">
                    <span class="kaltura-badge">ID: ${displayId}${copyBtn}</span>
                    <span class="type-badge">Type: ${vid.kalturaType}</span>
                </div>`;
            frag.appendChild(card);
        });
        grid.appendChild(frag);
    }
};

// Renders the Audio grid/table directly into #media-grid, honoring the
// current grid/list layout toggle and search box, exactly like Downloads.
window.renderAudioList = function renderAudioList(query = '') {
    MediaState.searchQuery = query;
    const grid = document.getElementById('media-grid');
    if (!grid) return;

    currentDisplayedMedia = [];
    const filteredAudio = getFilteredAudio(query);

    if (!filteredAudio.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No audio found for the selected filters.</div>';
        return;
    }

    if (MediaState.layout === 'list') {
        grid.className = '';
        grid.style.display = 'block';
        grid.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'image-list-wrapper';

        let tableRows = '';
        filteredAudio.forEach(aud => {
            const hasTranscript = aud.textVersion?.replace(/<[^>]*>?/gm, '').trim();
            currentDisplayedMedia.push({ item: aud, type: 'audio' });
            const idx = currentDisplayedMedia.length - 1;

            let displayLoc  = aud.locationId;
            const isMissing = isMissingId(aud.entryId);
            let idOrSource = isMissing ? '<span style="color:#dc3545; font-weight:bold;">Blank</span>' : aud.entryId;
            let copyBtnHtml = isMissing ? '' : `<button class="copy-btn flex-center" data-id="${aud.entryId}" title="Copy ID">${SVGS.clipboard}</button>`;

            if (aud.kalturaType === 'mp3') {
                displayLoc  = displayLoc.replace(/\.INT-\d+/i, '');
                idOrSource = 'In Course';
                copyBtnHtml = '';
            }

            tableRows += `
                <tr data-index="${idx}">
                    <td style="font-family:var(--code-font); color:var(--id-color); font-size:0.8rem;">${displayLoc}</td>
                    <td style="font-weight:500; white-space:normal; min-width:200px;">${escapeHtml(aud.title)}</td>
                    <td style="font-family:var(--code-font); font-size:0.8rem;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${idOrSource}
                            ${copyBtnHtml}
                        </div>
                    </td>
                    <td><span class="type-badge" style="margin:0;">${aud.kalturaType}</span></td>
                    <td style="text-align:center;">${hasTranscript ? `<span class="status-icon-check">${SVGS.checkCircle}</span>` : `<span class="status-icon-dash">${SVGS.minus}</span>`}</td>
                </tr>`;
        });

        wrapper.innerHTML = `
            <table class="image-list-table">
                <thead>
                    <tr>
                        <th>Location</th>
                        <th>Title</th>
                        <th>Kaltura ID / Source</th>
                        <th>Type</th>
                        <th style="text-align:center;">Text Version</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>`;
        grid.appendChild(wrapper);
    } else {
        grid.className = '';
        grid.style.display = '';
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        filteredAudio.forEach(aud => {
            const hasTranscript = aud.textVersion?.replace(/<[^>]*>?/gm, '').trim();
            currentDisplayedMedia.push({ item: aud, type: 'audio' });
            let displayLoc  = aud.locationId;
            let idBadgeHtml = '';
            if (aud.kalturaType === 'mp3') {
                displayLoc  = displayLoc.replace(/\.INT-\d+/i, '');
                idBadgeHtml = `<span class="kaltura-badge" style="background:var(--badge-neutral); color:var(--text); cursor:default;">Source: In Course</span>`;
            } else {
                const isMissing = isMissingId(aud.entryId);
                const displayId = isMissing ? '<span style="color:#dc3545; font-weight:bold;">Blank</span>' : aud.entryId;
                const copyBtn = isMissing ? '' : ` <button class="copy-btn flex-center" data-id="${aud.entryId}" title="Copy ID">${SVGS.clipboard}</button>`;
                idBadgeHtml = `<span class="kaltura-badge">ID: ${displayId}${copyBtn}</span>`;
            }
            const card = document.createElement('div');
            card.className     = 'media-card';
            card.dataset.index = currentDisplayedMedia.length - 1;
            card.innerHTML = `
                <div class="media-top-row">
                    <div class="media-icon">${SVGS.audio}</div>
                    <div class="media-location"><span class="id-number" title="Location"># ${displayLoc}</span></div>
                </div>
                <h3 class="media-title flex-center gap-10" title="${escapeHtml(aud.title)}" style="justify-content:flex-start;">
                    ${escapeHtml(aud.title)} ${hasTranscript ? `<span title="Transcript Available" style="color:var(--primary); cursor:help;">${SVGS.fileText}</span>` : ''}
                </h3>
                <div class="media-card-footer">
                    ${idBadgeHtml} <span class="type-badge">Type: ${aud.kalturaType}</span>
                </div>`;
            frag.appendChild(card);
        });
        grid.appendChild(frag);
    }
};


window.renderMediaDashboard = function renderMediaDashboard() {
    const container = elements.mediaArea;

    container.innerHTML  = '';
    currentDisplayedMedia = [];
    MediaState.renderCount = 0;

    // Each of these applies every active filter *except* the type filter first
    // ("TypeAgnostic"), then the type filter is applied on top to get the final
    // displayed list. The type-agnostic version is also what the Types checkbox
    // list is built from — using the final (type-filtered) list there would mean
    // selecting one type removes every other type from view, since by definition
    // nothing else would match anymore.
    const typeAgnosticVideos = getFilteredVideos(MediaState.searchQuery, { skipTypeFilter: true });
    const filteredVideos     = getFilteredVideos(MediaState.searchQuery);

    const typeAgnosticAudio = getFilteredAudio(MediaState.searchQuery, { skipTypeFilter: true });
    const filteredAudio     = getFilteredAudio(MediaState.searchQuery);

    const typeAgnosticInteractives = courseInteractives.filter(m => passesModuleFilter(m));
    const filteredInteractives = typeAgnosticInteractives.filter(m =>
        MediaState.filterTypes.size === 0 || MediaState.filterTypes.has(m.interactiveType)
    );

    const typeAgnosticImages = getFilteredImages(MediaState.searchQuery, { skipTypeFilter: true });
    const filteredImages     = getFilteredImages(MediaState.searchQuery);

    const uniqueImagesCount = new Set(filteredImages.map(img => img.src)).size;

    const filteredDownloads       = getFilteredDownloads(MediaState.downloadsSearchQuery);
    const typeAgnosticDownloads   = getFilteredDownloads(MediaState.downloadsSearchQuery, { skipTypeFilter: true });

    const filteredGlossary = courseGlossary.filter(g =>
        MediaState.activeModules.size === 0 ||
        g.locations.some(loc => MediaState.activeModules.has(loc.split('.')[0]))
    );

    const currentUniqueTypes = new Set();
    if      (MediaState.tab === 'videos')       typeAgnosticVideos.forEach(m => { if (m.kalturaType)    currentUniqueTypes.add(m.kalturaType); });
    else if (MediaState.tab === 'audio')        typeAgnosticAudio.forEach(m  => { if (m.kalturaType)    currentUniqueTypes.add(m.kalturaType); });
    else if (MediaState.tab === 'interactives') typeAgnosticInteractives.forEach(m => { if (m.interactiveType) currentUniqueTypes.add(m.interactiveType); });
    else if (MediaState.tab === 'images')       typeAgnosticImages.forEach(img => { if (img.fileType) currentUniqueTypes.add(img.fileType); });
    else if (MediaState.tab === 'downloads')    typeAgnosticDownloads.forEach(d => { if (d.fileType) currentUniqueTypes.add(d.fileType); });

    const isFiltered = MediaState.activeModules.size > 0 || MediaState.filterTypes.size > 0 ||
                       MediaState.filterMissingId || MediaState.filterHasAlt ||
                       MediaState.filterHasCaption || MediaState.filterHasCaptionHeader ||
                       MediaState.filterHasTextVer || MediaState.filterCheckCopyright ||
                       MediaState.filterCheckTextVer || MediaState.filterCheckFileName ||
                       MediaState.filterFlaggedOnly;

    const isGlossary  = MediaState.tab === 'glossary';
    const isDownloads = MediaState.tab === 'downloads';
    const isSearchableMediaTab = MediaState.tab === 'images' || MediaState.tab === 'videos' || MediaState.tab === 'audio';
    const mediaSearchPlaceholder = MediaState.tab === 'images'
        ? 'Search by filename, alt text, caption, or location…'
        : 'Search by title, Kaltura ID, or location…';

    const modCheckboxes = validModules.map(mod => {
        const modNum = padNum(mod.num);
        return buildFilterCheckboxHTML(
            `toggleMediaModule('${modNum}')`,
            `Module ${modNum}`,
            MediaState.activeModules.has(modNum)
        );
    }).join('');

    const typeCheckboxes = Array.from(currentUniqueTypes).sort().map(t =>
        buildFilterCheckboxHTML(`toggleMediaTypeFilter('${t}')`, t, MediaState.filterTypes.has(t))
    ).join('');

    let specificFiltersHtml = '';
    if (MediaState.tab === 'videos' || MediaState.tab === 'audio') {
        specificFiltersHtml = `
            <div style="font-weight:700; font-size:0.75rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Status</div>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem; cursor:pointer; color:#dc3545; font-weight:600;">
               <input type="checkbox" style="accent-color:#dc3545; width:16px; height:16px; cursor:pointer;" onchange="toggleMissingIdFilter(this.checked)" ${MediaState.filterMissingId ? 'checked' : ''}>
               Missing Kaltura ID
            </label>`;
    } else if (MediaState.tab === 'images') {
        specificFiltersHtml = `
            <div style="display:flex; gap:20px; flex-wrap:wrap;">
                <div style="flex:1; min-width:140px;">
                    <div style="font-weight:700; font-size:0.75rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Must Contain</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasAlt(this.checked)', 'Alt Text', MediaState.filterHasAlt)}
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasCaption(this.checked)', 'Caption', MediaState.filterHasCaption)}
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasCaptionHeader(this.checked)', 'Caption Header', MediaState.filterHasCaptionHeader)}
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasTextVer(this.checked)', 'Text Version', MediaState.filterHasTextVer)}
                    </div>
                </div>
               <div style="flex:1; min-width:140px;">
                    <div style="font-weight:700; font-size:0.75rem; color:#dc3545; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Audit Checks</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${buildFilterCheckboxHTML(
                            'toggleMediaFilterCheckCopyright(this.checked)',
                            `Check Copyrights <span title="Flags images with an empty copyright, unless the filename ends in an approved suffix." style="cursor:help; opacity:0.6; margin-left:4px; display:inline-flex; align-items:center; vertical-align:text-bottom; width:1.1em; height:1.1em;">${SVGS.info}</span>`,
                            MediaState.filterCheckCopyright
                        )}
                        ${buildFilterCheckboxHTML(
                            'toggleMediaFilterCheckTextVer(this.checked)',
                            `Check Text Versions <span title="Flags images that have a Text Version but no Alt Text, OR say text version in the Alt Text but are missing the actual text." style="cursor:help; opacity:0.6; margin-left:4px; display:inline-flex; align-items:center; vertical-align:text-bottom; width:1.1em; height:1.1em;">${SVGS.info}</span>`,
                            MediaState.filterCheckTextVer
                        )}
                        ${buildFilterCheckboxHTML(
                            'toggleMediaFilterCheckFileName(this.checked)',
                            `File Name Errors <span title="Flags images whose file name does not follow the required naming conventions (capitals, spaces, hyphens, or extra/missing periods)." style="cursor:help; opacity:0.6; margin-left:4px; display:inline-flex; align-items:center; vertical-align:text-bottom; width:1.1em; height:1.1em;">${SVGS.info}</span>`,
                            MediaState.filterCheckFileName
                        )}
                    </div>
                </div>
            </div>`;
    } else if (MediaState.tab === 'downloads') {
        specificFiltersHtml = `
            <div style="font-weight:700; font-size:0.75rem; color:#dc3545; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Audit Checks</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
                ${buildFilterCheckboxHTML(
                    'toggleDownloadsFlaggedOnly(this.checked)',
                    `Flagged Items Only <span title="Shows only downloads with at least one validation issue: File Name Check, Title/Type Check, Structure Check, or FLVS Footer Check." style="cursor:help; opacity:0.6; margin-left:4px; display:inline-flex; align-items:center; vertical-align:text-bottom; width:1.1em; height:1.1em;">${SVGS.info}</span>`,
                    MediaState.filterFlaggedOnly
                )}
            </div>`;
    }

    const typesSection = !isGlossary
        ? `<div style="border-top:1px dashed var(--border); padding-top:15px;">
               <div style="font-weight:700; font-size:0.75rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Types</div>
               <div style="max-height:150px; overflow-y:auto; overflow-x:hidden; padding-right:5px; margin-bottom:${specificFiltersHtml ? '15px' : '0'};">
                   <div style="column-count:2; column-gap:20px;">${typeCheckboxes}</div>
               </div>
               ${specificFiltersHtml}
           </div>`
        : '';

    let activeFilterCount = MediaState.activeModules.size + MediaState.filterTypes.size;
    if (MediaState.filterMissingId) activeFilterCount++;
    if (MediaState.filterHasAlt) activeFilterCount++;
    if (MediaState.filterHasCaption) activeFilterCount++;
    if (MediaState.filterHasCaptionHeader) activeFilterCount++;
    if (MediaState.filterHasTextVer) activeFilterCount++;
    if (MediaState.filterCheckCopyright) activeFilterCount++;
    if (MediaState.filterCheckTextVer) activeFilterCount++;
    if (MediaState.filterCheckFileName) activeFilterCount++;
    if (MediaState.filterFlaggedOnly) activeFilterCount++;

    const isFilteredUI = activeFilterCount > 0;
    const filterBtnHtml = isFilteredUI
        ? `Filters <span class="filter-badge">${activeFilterCount}</span> ${SVGS.arrowDown}`
        : `Filters ${SVGS.arrowDown}`;

    const clearFiltersHtml = isFilteredUI
        ? `<button class="clear-filters-btn" onclick="clearAllMediaFilters()">Clear</button>`
        : '';

    const darkBgToggleHtml = MediaState.tab === 'images'
        ? `<label class="darken-toggle-label" title="Globally darken image backgrounds" style="margin-left: 5px; height: 32px;">
               <input type="checkbox" onchange="toggleGlobalImageBg(this.checked)" ${MediaState.isGlobalDarkImageBg ? 'checked' : ''} style="accent-color:var(--primary); cursor:pointer;">
               Dark BG
           </label>`
        : '';

    container.innerHTML = `
        <div class="sticky-top-wrapper">
            <div class="white-card-header" style="padding-bottom:0;">
                <div class="media-header-container">
                    <div class="media-tab-group">
                        <button class="media-tab-btn ${MediaState.tab === 'images'       ? 'active' : ''}" onclick="setMediaTab('images')">
                            ${SVGS.image} Images
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredImages.length} total, ${uniqueImagesCount} unique)</span>
                        </button>
                        <button class="media-tab-btn ${MediaState.tab === 'videos'       ? 'active' : ''}" onclick="setMediaTab('videos')">
                            ${SVGS.video} Videos
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredVideos.length})</span>
                        </button>
                        <button class="media-tab-btn ${MediaState.tab === 'audio'        ? 'active' : ''}" onclick="setMediaTab('audio')">
                            ${SVGS.audio} Audio
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredAudio.length})</span>
                        </button>
                        <button class="media-tab-btn ${MediaState.tab === 'interactives' ? 'active' : ''}" onclick="setMediaTab('interactives')">
                            ${SVGS.interactive} Interactives
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredInteractives.length})</span>
                        </button>
                        <button class="media-tab-btn ${MediaState.tab === 'downloads'    ? 'active' : ''}" onclick="setMediaTab('downloads')">
                            ${SVGS.download} Downloads
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredDownloads.length})</span>
                        </button>
                        <button class="media-tab-btn ${MediaState.tab === 'glossary'     ? 'active' : ''}" onclick="setMediaTab('glossary')">
                            ${SVGS.glossary} Glossary
                            <span id="glossary-tab-count" style="font-size:0.8em; opacity:0.7;">(${filteredGlossary.length})</span>
                        </button>
                    </div>

                    <div class="media-action-bar">
                        <div class="media-filters-group">
                            <div class="filter-dropdown-wrapper">
                                <button class="filter-btn btn-base ${isFilteredUI ? 'filtered' : ''}" onclick="toggleMediaFilterDropdown(event)">
                                    ${filterBtnHtml}
                                </button>
                                <div id="media-filter-dropdown" class="filter-dropdown-content ${MediaState.isFilterOpen ? 'show' : ''}" style="width:400px;" onclick="event.stopPropagation()">
                                    <div style="font-weight:700; font-size:0.75rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Modules</div>
                                    <div class="filter-actions" style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--border);">
                                        <button class="filter-action-btn" onclick="clearAllMediaFilters()">Clear All</button>
                                    </div>
                                    <div style="max-height:200px; overflow-y:auto; overflow-x:hidden; padding-right:5px; margin-bottom:${!isGlossary ? '15px' : '0'};">
                                        <div style="column-count:2; column-gap:20px;">${modCheckboxes}</div>
                                    </div>
                                    ${typesSection}
                                </div>
                            </div>
                           ${clearFiltersHtml}
                            ${darkBgToggleHtml}
                            ${isGlossary ? `<div id="glossary-special-filters" style="display:flex; gap:6px; flex-wrap:wrap; margin-left:8px;"></div>` : ''}
                            ${isDownloads ? `
                                <div class="segmented-control" style="margin-left:8px; align-items:center;">
                                    <label><input type="radio" name="downloads-view" value="linked" onchange="setDownloadsView('linked')" ${MediaState.downloadsView === 'linked' ? 'checked' : ''}><span style="padding:4px 12px;">Linked</span></label>
                                    <label><input type="radio" name="downloads-view" value="unlinked" onchange="setDownloadsView('unlinked')" ${MediaState.downloadsView === 'unlinked' ? 'checked' : ''}><span style="padding:4px 12px;">Unlinked</span></label>
                                </div>
                            ` : ''}
                        </div>

                        <div class="media-global-actions">
                            <div class="layout-toggle" style="${isGlossary ? 'display:none;' : ''}">
                                <button class="layout-btn ${MediaState.layout === 'grid' ? 'active' : ''}" onclick="setMediaLayout('grid')">▦ Grid</button>
                                <button class="layout-btn ${MediaState.layout === 'list' ? 'active' : ''}" onclick="setMediaLayout('list')">☰ List</button>
                            </div>
                            <button class="action-btn btn-base" style="background:var(--primary); color:#fff; border:none; box-shadow: 0 2px 4px rgba(28,53,94,0.15);" onclick="exportMediaReport()">
                                ${SVGS.export} Export Report
                            </button>
                        </div>
                    </div>
                </div>
               ${isGlossary ? `
                    <div class="glossary-search-wrapper">
                        <input type="text" id="glossary-search" class="glossary-search" placeholder="Search glossary terms…" autocomplete="off" oninput="filterGlossaryList(this.value); toggleGlossaryClearBtn(this.value)">
                        <button id="glossary-search-clear" class="glossary-search-clear" onclick="clearGlossarySearch()" title="Clear search">&times;</button>
                    </div>
                    <div class="glossary-az-bar" id="glossary-az-bar"></div>
                ` : ''}
               ${isDownloads ? `
                    <div class="glossary-search-wrapper downloads-search-wrapper">
                        <input type="text" id="downloads-search" class="glossary-search" placeholder="Search by title, filename, type, or location…" autocomplete="off" value="${escapeHtml(MediaState.downloadsSearchQuery)}" oninput="filterDownloadsList(this.value); toggleDownloadsClearBtn(this.value)">
                        <button id="downloads-search-clear" class="glossary-search-clear" onclick="clearDownloadsSearch()" title="Clear search" style="display:${MediaState.downloadsSearchQuery ? 'block' : 'none'};">&times;</button>
                    </div>
                    <div id="a11y-progress-indicator" class="a11y-progress-indicator" style="display:none;"></div>
                ` : ''}
               ${isSearchableMediaTab ? `
                    <div class="glossary-search-wrapper downloads-search-wrapper">
                        <input type="text" id="media-search" class="glossary-search" placeholder="${mediaSearchPlaceholder}" autocomplete="off" value="${escapeHtml(MediaState.searchQuery)}" oninput="filterMediaGridSearch(this.value); toggleMediaSearchClearBtn(this.value)">
                        <button id="media-search-clear" class="glossary-search-clear" onclick="clearMediaGridSearch()" title="Clear search" style="display:${MediaState.searchQuery ? 'block' : 'none'};">&times;</button>
                    </div>
                ` : ''}
            </div>
        </div>
        <div id="media-grid" class="${MediaState.layout === 'list' && !isGlossary ? 'list-view' : ''} ${isGlossary ? 'glossary-view-mode' : ''} ${MediaState.tab === 'images' && MediaState.layout === 'grid' ? 'image-grid-view' : ''}"></div>`;


    const grid = document.getElementById('media-grid');
    const frag = document.createDocumentFragment();

    if (isGlossary) {
        grid.innerHTML = `<div class="glossary-columns" id="glossary-list-container"></div>`;
        renderGlossaryList('');
    } else if (MediaState.tab === 'images') {
        renderImagesList(MediaState.searchQuery);
    } else if (MediaState.tab === 'videos') {
        renderVideosList(MediaState.searchQuery);
    } else if (MediaState.tab === 'audio') {
        renderAudioList(MediaState.searchQuery);
    } else if (MediaState.tab === 'interactives') {
        if (!filteredInteractives.length) { grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No interactives found for the selected modules.</div>'; return; }

        if (MediaState.layout === 'list') {
            grid.className = '';
            grid.style.display = 'block';
            const wrapper = document.createElement('div');
            wrapper.className = 'image-list-wrapper';

            let tableRows = '';
            filteredInteractives.forEach(intItem => {
                currentDisplayedMedia.push({ item: intItem, type: 'interactive' });
                const idx = currentDisplayedMedia.length - 1;
                const displayLoc = intItem.locationId ? intItem.locationId.replace(/\.INT-\d+/i, '') : "";

                tableRows += `
                    <tr data-index="${idx}">
                        <td style="font-family:var(--code-font); color:var(--id-color); font-size:0.8rem;">${displayLoc}</td>
                        <td style="font-weight:500; white-space:normal; min-width:200px;">${escapeHtml(intItem.title)}</td>
                        <td><span class="flex-center gap-10" style="color:#888; font-size:0.85rem; font-weight:500; justify-content:flex-start;" title="Folder Name">${SVGS.folder} ${escapeHtml(intItem.folder)}</span></td>
                        <td><span class="type-badge" style="margin:0;">${escapeHtml(intItem.interactiveType || 'Unknown')}</span></td>
                    </tr>`;
            });

            wrapper.innerHTML = `
                <table class="image-list-table">
                    <thead>
                        <tr>
                            <th>Location</th>
                            <th>Title</th>
                            <th>Folder Name</th>
                            <th>Type</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>`;
            grid.appendChild(wrapper);
        } else {
            filteredInteractives.forEach(intItem => {
                currentDisplayedMedia.push({ item: intItem, type: 'interactive' });
                const displayLoc = intItem.locationId ? intItem.locationId.replace(/\.INT-\d+/i, '') : "";
                const card = document.createElement('div');
                card.className     = 'media-card';
                card.dataset.index = currentDisplayedMedia.length - 1;
                card.innerHTML = `
                    <div class="media-top-row">
                        <div class="media-icon">${SVGS.interactive}</div>
                        <div class="media-location"><span class="id-number" title="Location"># ${displayLoc}</span></div>
                    </div>
                    <h3 class="media-title" title="${escapeHtml(intItem.title)}">${escapeHtml(intItem.title)}</h3>
                    <div class="media-card-footer" style="justify-content:flex-start; gap:8px;">
                        <span class="flex-center gap-10" style="color:#888; font-size:0.85rem; font-weight:500;" title="Folder Name">${SVGS.folder} ${escapeHtml(intItem.folder)}</span>
                        <span class="type-badge">Type: ${escapeHtml(intItem.interactiveType || 'Unknown')}</span>
                    </div>`;
                frag.appendChild(card);
            });
            grid.appendChild(frag);
        }
    } else if (MediaState.tab === 'downloads') {
        renderDownloadsList(MediaState.downloadsSearchQuery);
    }
};


// Shared Prev/Next nav bar used by the media modal (image/video/audio),
// driven by the item's position in currentDisplayedMedia.
function buildModalNavHtml(currentIndex) {
    const hasNav = currentIndex !== -1 && currentDisplayedMedia.length > 1;
    if (!hasNav) return '';
    return `
        <div class="flex-center gap-10" style="margin-right: 5px;">
            <button class="modal-nav-btn" onclick="navigateMediaModal(-1, ${currentIndex})" ${currentIndex === 0 ? 'disabled' : ''}>
                ${SVGS.back} Prev
            </button>
            <span style="font-size:0.8rem; color:var(--text-light); font-weight:600; min-width: 45px; text-align: center;">
                ${currentIndex + 1} / ${currentDisplayedMedia.length}
            </span>
            <button class="modal-nav-btn" onclick="navigateMediaModal(1, ${currentIndex})" ${currentIndex === currentDisplayedMedia.length - 1 ? 'disabled' : ''}>
                Next ${SVGS.forward}
            </button>
        </div>
    `;
}

window.openMediaModalFromObj = function openMediaModalFromObj(mediaObj, type, index = -1) {
    if (type === 'document') {
        openDocumentFile(mediaObj.path);
        return;
    }

    const modalHeader = document.getElementById('modal-header-content');
    const modalBody   = document.getElementById('modal-body-content');

    // Registered once, reused for every type that has Prev/Next nav buttons
    // (image/video/audio) — it just clicks whichever nav button is present.
    if (!window.mediaModalKeyHandler) {
        window.mediaModalKeyHandler = function(e) {
            if (document.getElementById('media-modal').classList.contains('active')) {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    const prevBtn = document.querySelector('.modal-nav-btn:first-of-type');
                    if (prevBtn && !prevBtn.disabled) prevBtn.click();
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    const nextBtn = document.querySelector('.modal-nav-btn:last-of-type');
                    if (nextBtn && !nextBtn.disabled) nextBtn.click();
                }
            }
        };
        document.addEventListener('keydown', window.mediaModalKeyHandler);
    }

    if (type === 'image') {
        let currentIndex = index !== -1 ? index : currentDisplayedMedia.findIndex(e => e.item === mediaObj);
        const navHtml = buildModalNavHtml(currentIndex);

        modalHeader.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex: 1; min-width: 0;">
                <div style="flex: 1; min-width: 0; padding-right: 15px;">
                    <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary); display:flex; align-items:flex-start; gap:10px; overflow-wrap: anywhere;">
                        <span style="flex-shrink:0;">${SVGS.image}</span>
                        <span>${escapeHtml(mediaObj.fileName)}</span>
                    </h3>
                    <div style="font-size:0.85rem; color:var(--text-light); margin-top:4px;">
                        <span class="id-number"># ${mediaObj.locationId}</span>
                        &nbsp;|&nbsp;
                        <span>Type: ${mediaObj.fileType}</span>
                    </div>
                </div>
               <div style="display:flex; align-items:center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
                    ${navHtml}
                </div>
            </div>`;

        let srcUrl = '';
        const cleanPath = mediaObj.src.replace(/^\/+/, '');
        if (fileMap.has(cleanPath)) {
            srcUrl = URL.createObjectURL(fileMap.get(cleanPath));
            MediaState.audioBlobUrl = srcUrl;
        }

        const imgPreviewHtml = srcUrl
            ? `<div id="modal-img-wrapper" style="text-align:center; background:#e9ecef; padding:20px; border-radius:8px; margin-bottom:20px; border:1px solid var(--border); transition: background 0.3s;">
                   <img src="${srcUrl}" style="max-width:100%; max-height:400px; border-radius:4px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" alt="Full Image Preview">
               </div>`
            : `<div style="padding:15px; background:#fff3cd; color:#856404; border:1px solid #ffeeba; border-radius:6px; margin-bottom:20px; font-size:0.9rem;">
                   ${SVGS.alert} Image file (<strong>${mediaObj.src}</strong>) not found in the loaded folder.
               </div>`;

        const renderField = (label, val) => `
            <div style="margin-bottom: 12px; border-bottom: 1px solid #f1f3f5; padding-bottom: 12px;">
                <div style="font-size:0.75rem; font-weight:700; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                    ${label}
                </div>
                <div style="font-size:0.95rem; color:var(--text);">
                    ${val.trim() ? val : '<span class="empty-dash">—</span>'}
                </div>
            </div>`;

        modalBody.innerHTML = `
            ${imgPreviewHtml}
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div>
                    ${renderField('Alt Text', escapeHtml(mediaObj.altText))}
                    ${renderField('Caption Header', escapeHtml(mediaObj.captionHeader))}
                    ${renderField('Copyright', escapeHtml(mediaObj.copyright))}
                </div>
                <div>
                    ${renderField('Caption', escapeHtml(mediaObj.caption))}
                </div>
            </div>
            <div>
                <div style="font-size:0.75rem; font-weight:700; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                    Text Version
                </div>
                <div style="font-size:0.95rem; color:var(--text); background: #f8f9fa; padding: 15px; border-radius: 6px; border: 1px solid var(--border); overflow-x: auto;">
                    ${mediaObj.textVersion.trim()
                        ? mediaObj.textVersion.replace(/<table[^>]*class=['"]table['"][^>]*>/gi, '<table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%; background: #fff;">')
                        : '<span class="empty-dash">—</span>'}
                </div>
            </div>
        `;

    } else if (type === 'video') {
        let currentIndex = index !== -1 ? index : currentDisplayedMedia.findIndex(e => e.item === mediaObj);
        const navHtml = buildModalNavHtml(currentIndex);

        modalHeader.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex: 1; min-width: 0;">
                <div style="flex: 1; min-width: 0; padding-right: 15px;">
                    <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                        ${mediaObj.title}
                    </h3>
                    <div style="font-size:0.85rem; color:var(--text-light);">
                        <span class="id-number"># ${mediaObj.locationId}</span>
                        &nbsp;|&nbsp;
                        <span style="font-family:var(--code-font);">Kaltura ID: <strong>${mediaObj.entryId}</strong></span>
                        &nbsp;|&nbsp;
                        <span>Type: ${mediaObj.kalturaType}</span>
                    </div>
                </div>
               <div style="display:flex; align-items:center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
                    ${navHtml}
                </div>
            </div>`;

        let playerHtml = '';
        const hasValidId = mediaObj.entryId && mediaObj.entryId !== "Unknown" && mediaObj.entryId.trim();
        if (hasValidId) {
            const uiConfMap = {
                video:         '54575302',
                videoNoCC:     '54575422',
                videoplaylist: '54575812'
            };
            const uiConf = uiConfMap[mediaObj.kalturaType];
            if (uiConf) {
                playerHtml = `
                    <div class="flex-center"
                         style="background:#000; margin:-25px -25px 20px -25px;
                                padding:0; border-bottom:2px solid var(--primary);">
                        <iframe src="https://cdnapisec.kaltura.com/p/2061901/embedPlaykitJs/uiconf_id/${uiConf}?iframeembed=true&entry_id=${mediaObj.entryId}"
                                style="width:640px; height:360px; max-width:100%; aspect-ratio:16/9;"
                                allowfullscreen frameborder="0" loading="lazy"></iframe>
                    </div>
                    <div style="margin-bottom:10px; border-bottom:1px dashed var(--border); padding-bottom:5px;">
                        <strong style="color:var(--text-light); text-transform:uppercase;
                                       font-size:0.75rem; letter-spacing:0.5px;">
                            Transcript / Text Version
                        </strong>
                    </div>`;
            }
        } else {
            playerHtml = `<div style="padding:15px; background:#fff3cd; color:#856404;
                                      border:1px solid #ffeeba; border-radius:6px;
                                      margin-bottom:20px; font-size:0.9rem;">
                              ${SVGS.alert} A valid Kaltura ID was not found.
                          </div>`;
        }
        modalBody.innerHTML = playerHtml + (mediaObj.textVersion || '<em>No text version provided for this media.</em>');

    } else if (type === 'audio') {
        let currentIndex = index !== -1 ? index : currentDisplayedMedia.findIndex(e => e.item === mediaObj);
        const navHtml = buildModalNavHtml(currentIndex);

        const displayId = (mediaObj.kalturaType === 'mp3') ? 'None' : mediaObj.entryId;
        modalHeader.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex: 1; min-width: 0;">
                <div style="flex: 1; min-width: 0; padding-right: 15px;">
                    <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                        ${mediaObj.title}
                    </h3>
                    <div style="font-size:0.85rem; color:var(--text-light);">
                        <span class="id-number"># ${mediaObj.locationId}</span>
                        &nbsp;|&nbsp;
                        <span style="font-family:var(--code-font);">Kaltura ID: <strong>${displayId}</strong></span>
                        &nbsp;|&nbsp;
                        <span>Type: ${mediaObj.kalturaType}</span>
                    </div>
                </div>
               <div style="display:flex; align-items:center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
                    ${navHtml}
                </div>
            </div>`;

        let playerHtml = '';
        const hasValidId = mediaObj.entryId && mediaObj.entryId !== "Unknown" && mediaObj.entryId.trim();

        if (hasValidId) {
            const audioUiConfMap = {
                audio:    { uid: '54576672', style: 'width:300px; height:80px; max-width:100%;' },
                audiobtn: { uid: '54811142', style: 'width:40px;  height:40px; max-width:100%;' }
            };
            const conf = audioUiConfMap[mediaObj.kalturaType];
            if (conf) {
                playerHtml = `
                    <div class="flex-center"
                         style="background:#f8f9fa; margin:-25px -25px 20px -25px;
                                padding:20px; border-bottom:1px solid var(--border);">
                        <iframe src="https://cdnapisec.kaltura.com/p/2061901/embedPlaykitJs/uiconf_id/${conf.uid}?iframeembed=true&entry_id=${mediaObj.entryId}"
                                style="${conf.style}" allowfullscreen frameborder="0" loading="lazy"></iframe>
                    </div>
                    <div style="margin-bottom:10px; border-bottom:1px dashed var(--border); padding-bottom:5px;">
                        <strong style="color:var(--text-light); text-transform:uppercase;
                                       font-size:0.75rem; letter-spacing:0.5px;">
                            Transcript / Text Version
                        </strong>
                    </div>`;
            }
        } else if (mediaObj.kalturaType === 'mp3') {
            const cleanPath = mediaObj.mp3Path.replace(/^\/+/, '');
            if (fileMap.has(cleanPath)) {
                MediaState.audioBlobUrl = URL.createObjectURL(fileMap.get(cleanPath));
                playerHtml = `
                    <div class="flex-center"
                         style="background:#f8f9fa; margin:-25px -25px 20px -25px;
                                padding:20px; flex-direction:column;
                                border-bottom:1px solid var(--border);">
                        <audio controls src="${MediaState.audioBlobUrl}"
                               style="width:300px; max-width:100%;"></audio>
                        <div style="margin-top:10px; font-size:0.8rem; color:var(--text-light);
                                    word-break:break-all;">
                            File Path: ${mediaObj.mp3Path}
                        </div>
                    </div>
                    <div style="margin-bottom:10px; border-bottom:1px dashed var(--border); padding-bottom:5px;">
                        <strong style="color:var(--text-light); text-transform:uppercase;
                                       font-size:0.75rem; letter-spacing:0.5px;">
                            No Transcript Provided
                        </strong>
                    </div>`;
            } else {
                playerHtml = `<div style="padding:15px; background:#fff3cd; color:#856404;
                                          border:1px solid #ffeeba; border-radius:6px;
                                          margin-bottom:20px; font-size:0.9rem;">
                                  ${SVGS.alert} MP3 file (<strong>${mediaObj.mp3Path}</strong>)
                                  not found in the loaded folder.
                              </div>`;
            }
        } else {
            playerHtml = `<div style="padding:15px; background:#fff3cd; color:#856404;
                                      border:1px solid #ffeeba; border-radius:6px;
                                      margin-bottom:20px; font-size:0.9rem;">
                              ${SVGS.alert} A valid Kaltura ID was not found.
                          </div>`;
        }

        const transcriptFallback = mediaObj.kalturaType === 'mp3'
            ? '<em>Audio is natively linked.</em>'
            : '<em>No text version provided for this media.</em>';
        modalBody.innerHTML = playerHtml + (mediaObj.textVersion || transcriptFallback);

    } else if (type === 'interactive') {
                modalHeader.innerHTML = `
                    <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                        ${escapeHtml(mediaObj.title)}
                    </h3>
                    <div class="flex-center gap-10"
                         style="font-size:0.85rem; color:var(--text-light); justify-content:flex-start;">
                        <span class="id-number"># ${mediaObj.locationId}</span>
                        &nbsp;|&nbsp;
                        <span class="flex-center gap-10">${SVGS.folder} ${mediaObj.folder}</span>
                        &nbsp;|&nbsp;
                        <span>Type: ${mediaObj.interactiveType || 'Unknown'}</span>
                    </div>`;

                let bodyHtml = '';

                // Show the Geogebra iframe if we extracted one
                if (mediaObj.iframeCode) {
                    bodyHtml += `
                        <div style="margin-bottom:20px; text-align:center; background:#f8f9fa; padding:15px; border-radius:6px; border:1px solid var(--border); overflow:hidden;">
                            ${mediaObj.iframeCode.replace(/<iframe/i, '<iframe style="max-width:100%; max-height: 60vh; border:none;"')}
                        </div>`;
                }

                // Show text version if it was pulled from the page configuration
                if (mediaObj.textVersion) {
            bodyHtml += `
                <div style="margin-bottom:10px; border-bottom:1px dashed var(--border); padding-bottom:5px;">
                    <strong style="color:var(--text-light); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.5px;">
                        Text Version
                    </strong>
                </div>
                <div style="margin-bottom: 20px; font-size:0.95rem; line-height:1.6; color:var(--text); background: #f8f9fa; padding: 15px; border-radius: 6px; border: 1px solid var(--border); overflow-x: auto;">
                    ${mediaObj.textVersion}
                </div>`;
        }

        if (mediaObj.rawJson) {
             bodyHtml += `
            <div style="margin-bottom:15px;">
                <strong style="color:var(--text-light);">🧑‍💻 Code View (JSON Content)</strong>
            </div>
            <pre style="font-family:var(--code-font); font-size:0.85rem; color:#24292e;
                        background:#f6f8fa; border-left:3px solid #0366d6; padding:15px;
                        border-radius:4px; overflow-x:auto; white-space:pre-wrap;
                        word-wrap:break-word; margin:0;">
${escapeHtml(mediaObj.rawJson)}</pre>`;
       } else {
             bodyHtml += `
                <div style="padding:15px; background:#e8f4fd; color:#0d47a1; border:1px solid #b8daff; border-radius:6px; font-size:0.9rem;">
                    ${SVGS.info} This is a Custom HTML Interactive. There is no JSON configuration file to display.
                </div>`;
        }
        modalBody.innerHTML = bodyHtml;

    } else if (type === 'glossary') {
        const speakerSvg = `<svg viewBox="0 0 24 24" style="width:1.1em; height:1.1em; vertical-align:text-bottom; color:var(--primary); margin-left:4px;" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

        modalHeader.innerHTML = `
            <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                ${escapeHtml(mediaObj.title)}
            </h3>
            <div style="font-size:0.85rem; color:var(--text-light); display:flex; align-items:center; gap:6px;">
                Located at:
                ${mediaObj.locations && mediaObj.locations.length > 0
                    ? mediaObj.locations.map(l => {
                        const hasAudio = l.includes('🔊');
                        const cleanLoc = l.replace('🔊', '').trim();
                        return `<span class="id-number"># ${cleanLoc}${hasAudio ? speakerSvg : ''}</span>`;
                    }).join('')
                    : `<span class="id-number" style="color:#842029; ">Present In Glossary: Tooltip Not Applied</span>`
                }
            </div>`;

        let audioPlayerHtml = '';
        if (mediaObj.audioPath) {
            const cleanPath = mediaObj.audioPath.replace(/^\/+/, '');
            if (fileMap.has(cleanPath)) {
                // Reuse the global audio blob URL so it gets cleared safely on modal close
                MediaState.audioBlobUrl = URL.createObjectURL(fileMap.get(cleanPath));
                audioPlayerHtml = `
                    <div style="margin-bottom: 20px; padding: 10px 15px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; gap: 15px;">
                        <span style="font-size: 0.85rem; font-weight: bold; color: var(--primary);">Audio:</span>
                        <audio controls src="${MediaState.audioBlobUrl}" style="height: 35px; flex-grow: 1; outline: none;"></audio>
                    </div>`;
            } else {
                audioPlayerHtml = `
                    <div style="padding:15px; background:#fff3cd; color:#856404; border:1px solid #ffeeba; border-radius:6px; margin-bottom:20px; font-size:0.9rem;">
                        ${SVGS.alert} Audio file (<strong>${mediaObj.audioPath}</strong>) not found in the loaded folder.
                    </div>`;
            }
        }

        modalBody.innerHTML = `
            ${audioPlayerHtml}
            <div style="font-size:1.05rem; line-height:1.6; color:var(--text);">
                 ${mediaObj.definition}
             </div>`;
    }

    document.getElementById('media-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
    modalBody.scrollTop = 0;
};

window.navigateMediaModal = function(dir, currentIndex) {
    let newIndex = currentIndex + dir;
    if (newIndex >= 0 && newIndex < currentDisplayedMedia.length) {
        if (MediaState.audioBlobUrl) {
            URL.revokeObjectURL(MediaState.audioBlobUrl);
            MediaState.audioBlobUrl = null;
        }

        const nextEntry = currentDisplayedMedia[newIndex];
        openMediaModalFromObj(nextEntry.item, nextEntry.type, newIndex);
    }
};

window.closeMediaModal = function closeMediaModal(e) {
    if (e && e.target !== e.currentTarget) return;
    const overlay = document.getElementById('media-modal');
    overlay.classList.remove('active', 'fullscreen-modal');
    document.body.style.overflow = '';

    if (window.mediaModalKeyHandler) {
        document.removeEventListener('keydown', window.mediaModalKeyHandler);
        window.mediaModalKeyHandler = null;
    }

    if (MediaState.audioBlobUrl) {
        URL.revokeObjectURL(MediaState.audioBlobUrl);
        MediaState.audioBlobUrl = null;
    }
    previousModalState = null;
    setTimeout(() => {
        document.getElementById('modal-body-content').innerHTML   = '';
        document.getElementById('modal-header-content').innerHTML = '';
    }, 200);
};

