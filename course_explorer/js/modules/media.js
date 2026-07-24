// =============================================================================
// MEDIA.JS
// Media Dashboard (images/video/audio/interactives): filter toggle handlers, the shared filter helper, the main grid renderer, and the media preview modal (open/navigate/close).
// =============================================================================


window.setMediaTab = function setMediaTab(tab) {
    currentMediaTab = tab;
    activeMediaFilterTypes.clear();
    activeMediaFilterMissingId = false;
    activeMediaFilterHasAlt = false;
    activeMediaFilterHasCaption = false;
    activeMediaFilterHasCaptionHeader = false;
    activeMediaFilterHasTextVer = false;
    activeMediaFilterCheckCopyright = false;
    activeMediaFilterCheckTextVer = false;
    downloadsSearchQuery = '';
    renderMediaDashboard();
};

window.setMediaLayout = function setMediaLayout(layout) {
    currentMediaLayout = layout;
    localStorage.setItem('courseSearch_mediaLayout', layout);
    renderMediaDashboard();
};

window.toggleMissingIdFilter = function toggleMissingIdFilter(checked) {
    activeMediaFilterMissingId = checked;
    renderMediaDashboard();
};

window.toggleGlobalImageBg = function(checked) {
    isGlobalDarkImageBg = checked;
    if (checked) document.body.classList.add('global-dark-bg');
    else         document.body.classList.remove('global-dark-bg');
};

window.toggleMediaFilterHasAlt = function(checked) { activeMediaFilterHasAlt = checked; renderMediaDashboard(); };
window.toggleMediaFilterHasCaption = function(checked) { activeMediaFilterHasCaption = checked; renderMediaDashboard(); };
window.toggleMediaFilterHasCaptionHeader = function(checked) { activeMediaFilterHasCaptionHeader = checked; renderMediaDashboard(); };
window.toggleMediaFilterHasTextVer = function(checked) { activeMediaFilterHasTextVer = checked; renderMediaDashboard(); };

window.toggleMediaFilterCheckCopyright = function(checked) { activeMediaFilterCheckCopyright = checked; renderMediaDashboard(); };
window.toggleMediaFilterCheckTextVer = function(checked) { activeMediaFilterCheckTextVer = checked; renderMediaDashboard(); };

window.toggleMediaTypeFilter = function toggleMediaTypeFilter(type) {
    if (activeMediaFilterTypes.has(type)) activeMediaFilterTypes.delete(type);
    else                                   activeMediaFilterTypes.add(type);
    renderMediaDashboard();
};

window.toggleMediaModule = function toggleMediaModule(modNum) {
    if (activeMediaModules.has(modNum)) activeMediaModules.delete(modNum);
    else                                 activeMediaModules.add(modNum);
    renderMediaDashboard();
};

window.toggleAllMediaModules = function toggleAllMediaModules(state) {
    activeMediaModules.clear();
    if (state) validModules.forEach(mod => activeMediaModules.add(padNum(mod.num)));
    renderMediaDashboard();
};

window.toggleMediaFilterDropdown = function toggleMediaFilterDropdown(event) {
    toggleFilterDropdown('media-filter-dropdown', event);
};

window.setDownloadsView = function setDownloadsView(view) {
    currentDownloadsView = view;
    downloadsSearchQuery = '';
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


function passesModuleFilter(item) {
    if (!item.locationId) return false;
    if (activeMediaModules.size === 0) return true;
    return activeMediaModules.has(item.locationId.split('.')[0]);
}
	
window.clearAllMediaFilters = function clearAllMediaFilters() {
    activeMediaModules.clear();
    activeMediaFilterTypes.clear();
    activeMediaFilterMissingId = false;
    activeMediaFilterHasAlt = false;
    activeMediaFilterHasCaption = false;
    activeMediaFilterHasCaptionHeader = false;
    activeMediaFilterHasTextVer = false;
    activeMediaFilterCheckCopyright = false;
    activeMediaFilterCheckTextVer = false;
    renderMediaDashboard();
};


// Scans the folder that holds the linked documents (inferred from the linked
// paths themselves) and returns every file in that folder that is NOT
// referenced by a [[ link | ... | dLoad ]] tag anywhere in the course.
// Cached on `cachedUnlinkedDocuments` and invalidated whenever a new course
// is indexed (see indexing.js).
function getUnlinkedDocuments() {
    if (cachedUnlinkedDocuments) return cachedUnlinkedDocuments;
    if (!courseDocuments.length) { cachedUnlinkedDocuments = []; return cachedUnlinkedDocuments; }

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
    cachedUnlinkedDocuments = unlinked;
    return unlinked;
}

// Shared filtering logic for both the full dashboard render and the
// keystroke-driven search (renderDownloadsList), so the two stay in sync.
function getFilteredDownloads(query) {
    const q = (query || '').trim().toLowerCase();
    const matchesDocSearch = (d) => {
        if (!q) return true;
        const haystack = [d.title, d.fileName, d.fileType, d.breadcrumb, d.locationId, d.folder]
            .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
    };

    if (currentDownloadsView === 'unlinked') {
        return getUnlinkedDocuments().filter(d =>
            (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(d.fileType)) &&
            matchesDocSearch(d)
        );
    }
    return courseDocuments.filter(d =>
        passesModuleFilter(d) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(d.fileType)) &&
        matchesDocSearch(d)
    );
}

// Renders the downloads grid/table directly into #media-grid, honoring the
// current grid/list layout toggle exactly like every other media tab.
window.renderDownloadsList = function renderDownloadsList(query = '') {
    downloadsSearchQuery = query;
    const grid = document.getElementById('media-grid');
    if (!grid) return;

    currentDisplayedMedia = [];
    const filtered   = getFilteredDownloads(query);
    const isUnlinked = currentDownloadsView === 'unlinked';

    if (!filtered.length) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">${
            isUnlinked
                ? 'No unlinked downloads found — every file in the downloads folder is referenced somewhere in the course.'
                : 'No downloads found for the selected filters.'
        }</div>`;
        return;
    }

    if (currentMediaLayout === 'list') {
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
                        <td style="font-weight:500;"><span class="flex-center gap-10" style="justify-content:flex-start;">${SVGS.fileText} ${escapeHtml(doc.fileName)}</span></td>
                        <td style="font-family:var(--code-font); color:var(--text-light); font-size:0.8rem;">${escapeHtml(doc.fileType)}</td>
                        <td style="color:#888; font-size:0.85rem;">${escapeHtml(doc.folder)}</td>
                        <td><span class="type-badge" style="background:var(--badge-missing); color:var(--badge-missing-text);">${escapeHtml(doc.status)}</span></td>
                    </tr>`;
            });
            wrapper.innerHTML = `
                <table class="image-list-table">
                    <thead><tr><th>Filename</th><th>Type</th><th>Folder</th><th>Status</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>`;
        } else {
            filtered.forEach(doc => {
                currentDisplayedMedia.push({ item: doc, type: 'document' });
                const idx = currentDisplayedMedia.length - 1;
                tableRows += `
                    <tr data-index="${idx}">
                        <td style="font-family:var(--code-font); color:var(--id-color); font-size:0.8rem;">${doc.locationId}</td>
                        <td style="font-weight:500; white-space:normal; min-width:200px;">${escapeHtml(doc.title)}</td>
                        <td>${escapeHtml(doc.fileName)}</td>
                        <td style="font-family:var(--code-font); color:var(--text-light); font-size:0.8rem;">${escapeHtml(doc.fileType)}</td>
                    </tr>`;
            });
            wrapper.innerHTML = `
                <table class="image-list-table">
                    <thead><tr><th>Location</th><th>Title</th><th>Filename</th><th>Type</th></tr></thead>
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
                const card = document.createElement('div');
                card.className     = 'media-card';
                card.dataset.index = currentDisplayedMedia.length - 1;
                card.innerHTML = `
                    <div class="media-top-row">
                        <div class="media-icon">${SVGS.fileText}</div>
                        <div class="media-location"><span class="type-badge" style="background:var(--badge-missing); color:var(--badge-missing-text); margin:0;">Not Linked</span></div>
                    </div>
                    <h3 class="media-title" title="${escapeHtml(doc.fileName)}">${escapeHtml(doc.fileName)}</h3>
                    <div class="media-card-footer">
                        <span class="flex-center gap-10" style="color:#888; font-size:0.85rem; font-weight:500;" title="Folder">${SVGS.folder} ${escapeHtml(doc.folder)}</span>
                        <span class="type-badge">Type: ${escapeHtml(doc.fileType)}</span>
                    </div>`;
                frag.appendChild(card);
            });
        } else {
            filtered.forEach(doc => {
                currentDisplayedMedia.push({ item: doc, type: 'document' });
                const card = document.createElement('div');
                card.className     = 'media-card';
                card.dataset.index = currentDisplayedMedia.length - 1;
                card.innerHTML = `
                    <div class="media-top-row">
                        <div class="media-icon">${SVGS.fileText}</div>
                        <div class="media-location"><span class="id-number" title="Location"># ${doc.locationId}</span></div>
                    </div>
                    <h3 class="media-title" title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</h3>
                    <div class="media-card-footer">
                        <span style="color:#888; font-size:0.85rem;" title="Filename">${escapeHtml(doc.fileName)}</span>
                        <span class="type-badge">Type: ${escapeHtml(doc.fileType)}</span>
                    </div>`;
                frag.appendChild(card);
            });
        }

        grid.appendChild(frag);
    }
};

// Opens a linked or unlinked document directly (PDFs render inline in most
// browsers via the blob URL; Word/Excel files fall back to the browser's
// native "open or download" handling for that file type).
window.openDocumentFile = function openDocumentFile(path) {
    const cleanPath = (path || '').replace(/^\/+/, '');
    if (!fileMap.has(cleanPath)) {
        alert(`File not found in the loaded folder: ${cleanPath}`);
        return;
    }
    const file = fileMap.get(cleanPath);
    const url  = URL.createObjectURL(file);
    const win  = window.open(url, '_blank');
    if (!win) {
        // Popup blocked — fall back to a direct download.
        const a = document.createElement('a');
        a.href = url;
        a.download = cleanPath.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
};


window.renderMediaDashboard = function renderMediaDashboard() {
    const container = elements.mediaArea;
    
    container.innerHTML  = '';
    currentDisplayedMedia = [];
    currentMediaRenderCount = 0; 

    const filteredVideos = courseVideos.filter(m =>
        passesModuleFilter(m) &&
        (!activeMediaFilterMissingId || isMissingId(m.entryId)) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(m.kalturaType))
    );
    const filteredAudio = courseAudio.filter(m =>
        passesModuleFilter(m) &&
        (!activeMediaFilterMissingId || isMissingId(m.entryId)) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(m.kalturaType))
    );
    const filteredInteractives = courseInteractives.filter(m =>
        passesModuleFilter(m) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(m.interactiveType))
    );
    
    const filteredImages = courseImages.filter(img => {
        if (!passesModuleFilter(img)) return false;
        if (activeMediaFilterTypes.size > 0 && !activeMediaFilterTypes.has(img.fileType)) return false;
        if (activeMediaFilterHasAlt && !img.altText.trim()) return false;
        if (activeMediaFilterHasCaption && !img.caption.trim()) return false;
        if (activeMediaFilterHasCaptionHeader && !img.captionHeader.trim()) return false;
        if (activeMediaFilterHasTextVer && !img.textVersion.trim()) return false;
        
        if (activeMediaFilterCheckCopyright) {
            if (img.copyright.trim() !== '') return false;
            const nameWithoutExt = img.fileName.substring(0, img.fileName.lastIndexOf('.')) || img.fileName;
            const approvedSuffixes = ['_gi', '_ts', '_flvs', '_flvs_ai', '_ai_flvs'];
            const hasApprovedSuffix = approvedSuffixes.some(suffix => nameWithoutExt.toLowerCase().endsWith(suffix));
            if (hasApprovedSuffix) return false;
        }
        
        if (activeMediaFilterCheckTextVer) {
            const hasTextVer = !!img.textVersion.trim();
            const hasAlt = !!img.altText.trim();
            const altContainsTextVer = img.altText.toLowerCase().includes('text version');
            
            const failsCondition1 = hasTextVer && !hasAlt;
            const failsCondition2 = altContainsTextVer && !hasTextVer;
            
            if (!failsCondition1 && !failsCondition2) return false;
        }
        
        return true;
    });
	
	const uniqueImagesCount = new Set(filteredImages.map(img => img.src)).size;

    const filteredDownloads = getFilteredDownloads(downloadsSearchQuery);

    const filteredGlossary = courseGlossary.filter(g =>
        activeMediaModules.size === 0 ||
        g.locations.some(loc => activeMediaModules.has(loc.split('.')[0]))
    );

    const currentUniqueTypes = new Set();
    if      (currentMediaTab === 'videos')       filteredVideos.forEach(m => { if (m.kalturaType)    currentUniqueTypes.add(m.kalturaType); });
    else if (currentMediaTab === 'audio')        filteredAudio.forEach(m  => { if (m.kalturaType)    currentUniqueTypes.add(m.kalturaType); });
    else if (currentMediaTab === 'interactives') filteredInteractives.forEach(m => { if (m.interactiveType) currentUniqueTypes.add(m.interactiveType); });
    else if (currentMediaTab === 'images')       filteredImages.forEach(img => { if (img.fileType) currentUniqueTypes.add(img.fileType); });
    else if (currentMediaTab === 'downloads')    filteredDownloads.forEach(d => { if (d.fileType) currentUniqueTypes.add(d.fileType); });

    const isFiltered = activeMediaModules.size > 0 || activeMediaFilterTypes.size > 0 || 
                       activeMediaFilterMissingId || activeMediaFilterHasAlt || 
                       activeMediaFilterHasCaption || activeMediaFilterHasCaptionHeader || 
                       activeMediaFilterHasTextVer || activeMediaFilterCheckCopyright || 
                       activeMediaFilterCheckTextVer;
    
    const isGlossary  = currentMediaTab === 'glossary';
    const isDownloads = currentMediaTab === 'downloads';

    const modCheckboxes = validModules.map(mod => {
        const modNum = padNum(mod.num);
        return buildFilterCheckboxHTML(
            `toggleMediaModule('${modNum}')`,
            `Module ${modNum}`,
            activeMediaModules.has(modNum)
        );
    }).join('');

    const typeCheckboxes = Array.from(currentUniqueTypes).sort().map(t =>
        buildFilterCheckboxHTML(`toggleMediaTypeFilter('${t}')`, t, activeMediaFilterTypes.has(t))
    ).join('');

	let specificFiltersHtml = '';
    if (currentMediaTab === 'videos' || currentMediaTab === 'audio') {
        specificFiltersHtml = `
            <div style="font-weight:700; font-size:0.75rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Status</div>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem; cursor:pointer; color:#dc3545; font-weight:600;">
               <input type="checkbox" style="accent-color:#dc3545; width:16px; height:16px; cursor:pointer;" onchange="toggleMissingIdFilter(this.checked)" ${activeMediaFilterMissingId ? 'checked' : ''}>
               Missing Kaltura ID
            </label>`;
    } else if (currentMediaTab === 'images') {
        specificFiltersHtml = `
            <div style="display:flex; gap:20px; flex-wrap:wrap;">
                <div style="flex:1; min-width:140px;">
                    <div style="font-weight:700; font-size:0.75rem; color:var(--text-light); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Must Contain</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasAlt(this.checked)', 'Alt Text', activeMediaFilterHasAlt)}
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasCaption(this.checked)', 'Caption', activeMediaFilterHasCaption)}
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasCaptionHeader(this.checked)', 'Caption Header', activeMediaFilterHasCaptionHeader)}
                        ${buildFilterCheckboxHTML('toggleMediaFilterHasTextVer(this.checked)', 'Text Version', activeMediaFilterHasTextVer)}
                    </div>
                </div>
               <div style="flex:1; min-width:140px;">
                    <div style="font-weight:700; font-size:0.75rem; color:#dc3545; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Audit Checks</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${buildFilterCheckboxHTML(
                            'toggleMediaFilterCheckCopyright(this.checked)', 
                            `Check Copyrights <span title="Flags images with an empty copyright, unless the filename ends in an approved suffix." style="cursor:help; opacity:0.6; margin-left:4px; display:inline-flex; align-items:center; vertical-align:text-bottom; width:1.1em; height:1.1em;">${SVGS.info}</span>`, 
                            activeMediaFilterCheckCopyright
                        )}
                        ${buildFilterCheckboxHTML(
                            'toggleMediaFilterCheckTextVer(this.checked)', 
                            `Check Text Versions <span title="Flags images that have a Text Version but no Alt Text, OR say text version in the Alt Text but are missing the actual text." style="cursor:help; opacity:0.6; margin-left:4px; display:inline-flex; align-items:center; vertical-align:text-bottom; width:1.1em; height:1.1em;">${SVGS.info}</span>`, 
                            activeMediaFilterCheckTextVer
                        )}
                    </div>
                </div>
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

    let activeFilterCount = activeMediaModules.size + activeMediaFilterTypes.size;
    if (activeMediaFilterMissingId) activeFilterCount++;
    if (activeMediaFilterHasAlt) activeFilterCount++;
    if (activeMediaFilterHasCaption) activeFilterCount++;
    if (activeMediaFilterHasCaptionHeader) activeFilterCount++;
    if (activeMediaFilterHasTextVer) activeFilterCount++;
    if (activeMediaFilterCheckCopyright) activeFilterCount++;
    if (activeMediaFilterCheckTextVer) activeFilterCount++;

    const isFilteredUI = activeFilterCount > 0;
    const filterBtnHtml = isFilteredUI 
        ? `Filters <span class="filter-badge">${activeFilterCount}</span> ${SVGS.arrowDown}`
        : `Filters ${SVGS.arrowDown}`;

    const clearFiltersHtml = isFilteredUI
        ? `<button class="clear-filters-btn" onclick="clearAllMediaFilters()">Clear</button>`
        : '';

    const darkBgToggleHtml = currentMediaTab === 'images'
        ? `<label class="darken-toggle-label" title="Globally darken image backgrounds" style="margin-left: 5px; height: 32px;">
               <input type="checkbox" onchange="toggleGlobalImageBg(this.checked)" ${isGlobalDarkImageBg ? 'checked' : ''} style="accent-color:var(--primary); cursor:pointer;">
               Dark BG
           </label>`
        : '';

    container.innerHTML = `
        <div class="sticky-top-wrapper">
            <div class="white-card-header" style="padding-bottom:0;">
                <div class="media-header-container">
                    <div class="media-tab-group">
                        <button class="media-tab-btn ${currentMediaTab === 'images'       ? 'active' : ''}" onclick="setMediaTab('images')">
                            ${SVGS.image} Images
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredImages.length} total, ${uniqueImagesCount} unique)</span>
                        </button>
                        <button class="media-tab-btn ${currentMediaTab === 'videos'       ? 'active' : ''}" onclick="setMediaTab('videos')">
                            ${SVGS.video} Videos
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredVideos.length})</span>
                        </button>
                        <button class="media-tab-btn ${currentMediaTab === 'audio'        ? 'active' : ''}" onclick="setMediaTab('audio')">
                            ${SVGS.audio} Audio
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredAudio.length})</span>
                        </button>
                        <button class="media-tab-btn ${currentMediaTab === 'interactives' ? 'active' : ''}" onclick="setMediaTab('interactives')">
                            ${SVGS.interactive} Interactives
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredInteractives.length})</span>
                        </button>
                        <button class="media-tab-btn ${currentMediaTab === 'downloads'    ? 'active' : ''}" onclick="setMediaTab('downloads')">
                            ${SVGS.download} Downloads
                            <span style="font-size:0.8em; opacity:0.7;">(${filteredDownloads.length})</span>
                        </button>
                        <button class="media-tab-btn ${currentMediaTab === 'glossary'     ? 'active' : ''}" onclick="setMediaTab('glossary')">
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
                                <div id="media-filter-dropdown" class="filter-dropdown-content ${isMediaFilterOpen ? 'show' : ''}" style="width:400px;" onclick="event.stopPropagation()">
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
                                    <label><input type="radio" name="downloads-view" value="linked" onchange="setDownloadsView('linked')" ${currentDownloadsView === 'linked' ? 'checked' : ''}><span style="padding:4px 12px;">Linked</span></label>
                                    <label><input type="radio" name="downloads-view" value="unlinked" onchange="setDownloadsView('unlinked')" ${currentDownloadsView === 'unlinked' ? 'checked' : ''}><span style="padding:4px 12px;">Unlinked</span></label>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="media-global-actions">
                            <div class="layout-toggle" style="${isGlossary ? 'display:none;' : ''}">
                                <button class="layout-btn ${currentMediaLayout === 'grid' ? 'active' : ''}" onclick="setMediaLayout('grid')">▦ Grid</button>
                                <button class="layout-btn ${currentMediaLayout === 'list' ? 'active' : ''}" onclick="setMediaLayout('list')">☰ List</button>
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
                    <div class="glossary-search-wrapper">
                        <input type="text" id="downloads-search" class="glossary-search" placeholder="Search by title, filename, type, or location…" autocomplete="off" value="${escapeHtml(downloadsSearchQuery)}" oninput="filterDownloadsList(this.value); toggleDownloadsClearBtn(this.value)">
                        <button id="downloads-search-clear" class="glossary-search-clear" onclick="clearDownloadsSearch()" title="Clear search" style="display:${downloadsSearchQuery ? 'block' : 'none'};">&times;</button>
                    </div>
                ` : ''}
            </div>
        </div>
        <div id="media-grid" class="${currentMediaLayout === 'list' && !isGlossary ? 'list-view' : ''} ${isGlossary ? 'glossary-view-mode' : ''} ${currentMediaTab === 'images' && currentMediaLayout === 'grid' ? 'image-grid-view' : ''}"></div>`;
    

    const grid = document.getElementById('media-grid');
    const frag = document.createDocumentFragment();

    if (isGlossary) {
        grid.innerHTML = `<div class="glossary-columns" id="glossary-list-container"></div>`;
        renderGlossaryList('');
    } else if (currentMediaTab === 'images') {
        if (!filteredImages.length) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No images found for the selected filters.</div>';
            return;
        }
        
        currentDisplayedMedia = filteredImages.map(img => ({ item: img, type: 'image' }));
        
        if (currentMediaLayout === 'list') {
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
                            <th>File Name</th>
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
        }
        
        window.renderImageBatch = function() {
            const batchContainer = currentMediaLayout === 'list' ? document.getElementById('image-list-tbody') : grid;
            const start = currentMediaRenderCount;
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

                if (currentMediaLayout === 'grid') {
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
                            <div class="image-card-text"><strong> ${img.fileName || '<span class="empty-dash">—</span>'}</strong></div>
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
                        <td style="font-weight:500;">${img.fileName}</td>
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
            currentMediaRenderCount = end;

            if (currentMediaRenderCount < currentDisplayedMedia.length) {
                const remaining = currentDisplayedMedia.length - currentMediaRenderCount;
                const btnWrapper = document.createElement('div');
                btnWrapper.id = 'load-more-media-btn';
                btnWrapper.style = currentMediaLayout === 'list' ? 'padding: 20px; text-align: center;' : 'grid-column: 1/-1; text-align: center;';
                
                const btn = document.createElement('button');
                btn.className = 'action-btn btn-base';
                btn.style.margin = '0 auto';
                btn.innerHTML = `Load Next ${Math.min(MEDIA_BATCH_SIZE, remaining)} Images (Showing ${currentMediaRenderCount} of ${currentDisplayedMedia.length})`;
                btn.onclick = window.renderImageBatch;
                
                btnWrapper.appendChild(btn);
                grid.appendChild(btnWrapper);
            }
        };
        
        window.renderImageBatch();

    } else if (currentMediaTab === 'videos') {
        if (!filteredVideos.length) { grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No videos found for the selected filters.</div>'; return; }
        
        if (currentMediaLayout === 'list') {
            grid.className = ''; 
            grid.style.display = 'block'; 
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

    } else if (currentMediaTab === 'audio') {
        if (!filteredAudio.length) { grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No audio found for the selected filters.</div>'; return; }
        
        if (currentMediaLayout === 'list') {
            grid.className = ''; 
            grid.style.display = 'block'; 
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

    } else if (currentMediaTab === 'interactives') {
        if (!filteredInteractives.length) { grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#999;">No interactives found for the selected modules.</div>'; return; }
        
        if (currentMediaLayout === 'list') {
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
    } else if (currentMediaTab === 'downloads') {
        renderDownloadsList(downloadsSearchQuery);
    }
};


window.openMediaModalFromObj = function openMediaModalFromObj(mediaObj, type, index = -1) {
    if (type === 'document') {
        openDocumentFile(mediaObj.path);
        return;
    }

    const modalHeader = document.getElementById('modal-header-content');
    const modalBody   = document.getElementById('modal-body-content');

    if (type === 'image') {
        let currentIndex = index !== -1 ? index : currentDisplayedMedia.findIndex(e => e.item === mediaObj);
        let hasNav = currentIndex !== -1 && currentDisplayedMedia.length > 1;
        
        let navHtml = '';
        if (hasNav) {
            navHtml = `
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
            currentAudioBlobUrl = srcUrl; 
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
        
        if (!window.imageModalKeyHandler) {
            window.imageModalKeyHandler = function(e) {
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
            document.addEventListener('keydown', window.imageModalKeyHandler);
        }
    } else if (type === 'video') {
        modalHeader.innerHTML = `
            <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                ${mediaObj.title}
            </h3>
            <div style="font-size:0.85rem; color:var(--text-light);">
                <span class="id-number"># ${mediaObj.locationId}</span>
                &nbsp;|&nbsp;
                <span style="font-family:var(--code-font);">Kaltura ID: <strong>${mediaObj.entryId}</strong></span>
                &nbsp;|&nbsp;
                <span>Type: ${mediaObj.kalturaType}</span>
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
        const displayId = (mediaObj.kalturaType === 'mp3') ? 'None' : mediaObj.entryId;
        modalHeader.innerHTML = `
            <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                ${mediaObj.title}
            </h3>
            <div style="font-size:0.85rem; color:var(--text-light);">
                <span class="id-number"># ${mediaObj.locationId}</span>
                &nbsp;|&nbsp;
                <span style="font-family:var(--code-font);">Kaltura ID: <strong>${displayId}</strong></span>
                &nbsp;|&nbsp;
                <span>Type: ${mediaObj.kalturaType}</span>
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
                currentAudioBlobUrl = URL.createObjectURL(fileMap.get(cleanPath));
                playerHtml = `
                    <div class="flex-center"
                         style="background:#f8f9fa; margin:-25px -25px 20px -25px;
                                padding:20px; flex-direction:column;
                                border-bottom:1px solid var(--border);">
                        <audio controls src="${currentAudioBlobUrl}"
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
                currentAudioBlobUrl = URL.createObjectURL(fileMap.get(cleanPath));
                audioPlayerHtml = `
                    <div style="margin-bottom: 20px; padding: 10px 15px; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; gap: 15px;">
                        <span style="font-size: 0.85rem; font-weight: bold; color: var(--primary);">Audio:</span>
                        <audio controls src="${currentAudioBlobUrl}" style="height: 35px; flex-grow: 1; outline: none;"></audio>
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
        if (currentAudioBlobUrl) {
            URL.revokeObjectURL(currentAudioBlobUrl);
            currentAudioBlobUrl = null;
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
    
    if (window.imageModalKeyHandler) {
        document.removeEventListener('keydown', window.imageModalKeyHandler);
        window.imageModalKeyHandler = null;
    }
    
    if (currentAudioBlobUrl) {
        URL.revokeObjectURL(currentAudioBlobUrl);
        currentAudioBlobUrl = null;
    }
    previousModalState = null;
    setTimeout(() => {
        document.getElementById('modal-body-content').innerHTML   = '';
        document.getElementById('modal-header-content').innerHTML = '';
    }, 200);
};

