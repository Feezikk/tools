// =============================================================================
// STANDARDS.JS
// Standards-alignment search: executing standards searches and rendering grouped/compact results views.
// =============================================================================


window.setStdsView = function setStdsView(mode) {
    currentStdsView = mode;
    elements.fullscreenStdsBtn.style.display = (mode === 'table') ? 'inline-flex' : 'none';
    runStdsSearch();
};

window.runStdsSearch = function runStdsSearch() {
    const query     = elements.stdsSearchInput.value.trim().toLowerCase();
    const grid      = document.getElementById('stds-results-grid');
    const isGrouped = document.getElementById('stds-group-toggle')?.checked;

    const updateToggleState = (resultsArr) => {
        const groupToggleCb  = document.getElementById('stds-group-toggle');
        const groupToggleLbl = document.getElementById('lbl-stds-group-toggle');
        if (!groupToggleCb || !groupToggleLbl) return;

        const codeStateMap = new Map();
        let canBeGrouped   = false;
        for (const std of resultsArr) {
            if (!codeStateMap.has(std.code)) codeStateMap.set(std.code, new Set());
            codeStateMap.get(std.code).add(std.group);
            if (codeStateMap.get(std.code).size > 1) canBeGrouped = true;
        }

        if (!canBeGrouped) {
            groupToggleCb.disabled           = true;
            groupToggleCb.checked            = false;
            groupToggleLbl.style.opacity     = '0.4';
            groupToggleLbl.style.cursor      = 'not-allowed';
        } else {
            groupToggleCb.disabled           = false;
            groupToggleLbl.style.opacity     = '1';
            groupToggleLbl.style.cursor      = 'pointer';
        }

        sharedStandardColors.clear();
        colorIndexTracker = 0;
        if (isGrouped && canBeGrouped) {
            codeStateMap.forEach((states, code) => {
                if (states.size > 1) {
                    sharedStandardColors.set(code, SHARED_COLORS[colorIndexTracker++ % SHARED_COLORS.length]);
                }
            });
        }
    };

    if (!query && activeStdsModules.size === 0 && activeStdsStates.size === 0) {
        grid.innerHTML                       = '';
        elements.exportStdsBtn.style.display = 'none';
        elements.stdsStats.style.display     = 'none';
        currentStdsSearchResults             = [];
        updateToggleState([]);
        return;
    }

    const queryParts   = query.split(/[\W_]+/).filter(Boolean);
    const fuzzyPattern = queryParts.length > 0
        ? new RegExp(queryParts.map(escapeRegExp).join('[\\W_]+'), 'gi')
        : null;

    let results = courseStandardsList.filter(std => {
        if (activeStdsModules.size > 0 && !activeStdsModules.has(std.locationId.split('.')[0])) return false;
        if (activeStdsStates.size  > 0 && !activeStdsStates.has(std.group))  return false;
        if (query) {
            const codeMatch = std.code.toLowerCase().includes(query);
            const descMatch = std.statement.toLowerCase().includes(query) ||
                              (fuzzyPattern && (fuzzyPattern.lastIndex = 0, fuzzyPattern.test(std.statement)));
            if (!codeMatch && !descMatch) return false;
        }
        return true;
    });

    if (currentStdsView === 'lesson' || currentStdsView === 'table') {
        const lessonMap = new Map();
        results.forEach(std => {
            const parts           = std.locationId.split('.');
            const lessonId        = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : std.locationId;
            const breadcrumbParts = std.breadcrumb.split(' > ');
            const lessonBreadcrumb = breadcrumbParts.length >= 2
                ? `${breadcrumbParts[0]} > ${breadcrumbParts[1]}`
                : std.breadcrumb;
            const uniqueKey = `${lessonId}_${std.group}_${std.code}`;
            if (!lessonMap.has(uniqueKey)) {
                lessonMap.set(uniqueKey, { ...std, locationId: lessonId, breadcrumb: lessonBreadcrumb });
            }
        });
        results = Array.from(lessonMap.values());
    }

    results.sort((a, b) =>
        (a.locationId || "").localeCompare(b.locationId || "", undefined, { numeric: true }) ||
        (a.group      || "").localeCompare(b.group      || "") ||
        (a.code       || "").localeCompare(b.code       || "", undefined, { numeric: true })
    );

    currentStdsSearchResults = results;
    grid.innerHTML           = '';

    if (!results.length) {
        grid.innerHTML =
            `<div style="text-align:center; padding:40px; color:#999;">
                <div class="flex-center" style="margin-bottom:10px; opacity:0.3;">${SVGS.search}</div>
                <p>No standards found matching your criteria.</p>
             </div>`;
        elements.exportStdsBtn.style.display = 'none';
        elements.stdsStats.style.display     = 'none';
        updateToggleState([]);
        return;
    }

    elements.exportStdsBtn.style.display = 'inline-flex';
    updateToggleState(results);

    const uniqueLocs = new Set(results.map(r => r.locationId)).size;
    elements.stdsStats.innerHTML =
        `Found ${results.length} standard${results.length !== 1 ? 's' : ''} ` +
        `across ${uniqueLocs} location${uniqueLocs !== 1 ? 's' : ''}`;
    elements.stdsStats.style.display = 'inline-block';

    currentStdsExactPattern = query ? new RegExp(`(${escapeRegExp(query)})`, 'gi') : null;
    currentStdsFuzzyPattern = fuzzyPattern;
    currentStdsQuery        = query;

    const groupedResults = new Map();
    results.forEach(std => {
        if (!groupedResults.has(std.locationId)) {
            groupedResults.set(std.locationId, {
                locationId: std.locationId,
                breadcrumb: std.breadcrumb,
                standards:  []
            });
        }
        groupedResults.get(std.locationId).standards.push(std);
    });

    currentGroupedStds = Array.from(groupedResults.values());
    stdsRenderCount    = 0;

    if (currentStdsView === 'table') renderStdsTable();
    else                             renderStdsBatch();
};

window.renderStdsBatch = function renderStdsBatch() {
    const grid      = document.getElementById('stds-results-grid');
    const frag      = document.createDocumentFragment();
    const isGrouped = document.getElementById('stds-group-toggle')?.checked;
    const start     = stdsRenderCount;                                    
    const end       = Math.min(start + STDS_BATCH_SIZE, currentGroupedStds.length); 

    for (let i = start; i < end; i++) {
        const group = currentGroupedStds[i];   
        const card  = document.createElement('div');
        card.className = 'std-result-card';

        let standardsHtml = '';

        if (isGrouped) {
            const stdMap = new Map();
            group.standards.forEach(std => {
                if (!stdMap.has(std.code)) {
                    stdMap.set(std.code, { code: std.code, statement: std.statement, states: new Set() });
                }
                stdMap.get(std.code).states.add(std.group);
            });

            const comboMap = new Map();
            stdMap.forEach(val => {
                const key = Array.from(val.states).sort().join(', ');
                if (!comboMap.has(key)) comboMap.set(key, []);
                comboMap.get(key).push(val);
            });

            Array.from(comboMap.keys()).sort().forEach(combo => {
                const isMulti = combo.includes(',');
                standardsHtml +=
                    `<div class="${isMulti ? 'stds-state-header grouped-state' : 'stds-state-header'}">` +
                    `${isMulti ? '🗂️' : '📁'} ${escapeHtml(combo)}</div>`;

                const comboStds = comboMap.get(combo)
                    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
                comboStds.forEach((cStd, idx) => {
                    const { displayCode, displayState } = getHighlightedStd(cStd.code, cStd.statement);
                    const borderStyle = idx < comboStds.length - 1
                        ? 'border-bottom:1px dashed #e0e6ed;' : '';
                    standardsHtml += buildStdRowHTML(displayCode, displayState, borderStyle);
                });
            });

        } else {
            let currentState = null;
            group.standards.forEach((std, idx) => {
                const { displayCode, displayState } = getHighlightedStd(std.code, std.statement);
                if (std.group !== currentState) {
                    currentState   = std.group;
                    standardsHtml += `<div class="stds-state-header">📁 ${escapeHtml(currentState)}</div>`;
                }
                const nextIsSameState = group.standards[idx + 1]?.group === currentState;
                const borderStyle     = (idx < group.standards.length - 1 && nextIsSameState)
                    ? 'border-bottom:1px dashed #e0e6ed;' : '';
                standardsHtml += buildStdRowHTML(displayCode, displayState, borderStyle);
            });
        }

        card.innerHTML = `
            <div class="stds-loc-header">
                <span class="id-number"
                      title="Location"
                      style="flex-shrink:0; font-size:0.9rem; font-weight:700;
                             color:var(--primary); background:var(--tag-bg);
                             border-color:var(--primary-light); padding:4px 10px;">
                    # ${group.locationId}
                </span>
                <span style="font-size:0.95rem; color:var(--text-light); margin-left:12px;
                             font-weight:600; overflow:hidden; text-overflow:ellipsis;">
                    ${group.breadcrumb}
                </span>
            </div>
            <div style="display:flex; flex-direction:column;">${standardsHtml}</div>`;

        frag.appendChild(card);
    }

    document.getElementById('load-more-stds-btn')?.remove();
    grid.appendChild(frag);
    stdsRenderCount = end;   

    if (stdsRenderCount < currentGroupedStds.length) {   
        const remaining = currentGroupedStds.length - stdsRenderCount;
        const btn = document.createElement('button');
        btn.id        = 'load-more-stds-btn';
        btn.className = 'action-btn btn-base';
        btn.style.margin = '20px auto';
        btn.innerHTML =
            `Load Next ${Math.min(STDS_BATCH_SIZE, remaining)} Locations ` +
            `(Showing ${stdsRenderCount} of ${currentGroupedStds.length})`;
        btn.onclick = window.renderStdsBatch;
        grid.appendChild(btn);
    }

    setTimeout(updateStickyHeaderOffset, 50);
};

function buildStdRowHTML(displayCode, displayState, borderStyle = '') {
    return `<div style="display:flex; align-items:flex-start; gap:15px;
                        padding:10px 0; ${borderStyle}">
                <div style="flex-shrink:0; width:150px;">
                    <span class="std-code"
                          style="font-size:0.85rem; white-space:normal;
                                 text-align:center; display:block;">
                        ${displayCode}
                    </span>
                </div>
                <span style="font-size:0.95rem; line-height:1.5;
                             color:var(--text); flex:1;">
                    ${displayState}
                </span>
            </div>`;
}

window.renderStdsTable = function renderStdsTable() {
    const grid = document.getElementById('stds-results-grid');
    grid.innerHTML = '';
    if (!currentGroupedStds.length) return;  

    const sortedStates = Array.from(
        new Set(currentStdsSearchResults.map(s => s.group))
    ).sort();

    let html = '<div class="table-responsive-wrapper">' +
               '<table class="compact-stds-table"><thead><tr>' +
               '<th class="compact-loc-col">Section</th>';
    sortedStates.forEach(s => { html += `<th>${escapeHtml(s)}</th>`; });
    html += '</tr></thead><tbody>';

    currentGroupedStds.forEach(group => {   
        html += `<tr><td class="compact-loc-col"
                         title="${escapeHtml(group.breadcrumb)}">
                     ${escapeHtml(group.locationId)}
                 </td>`;

        const stdsByState = {};
        group.standards.forEach(std => {
            if (!stdsByState[std.group]) stdsByState[std.group] = [];
            stdsByState[std.group].push(std);
        });

        sortedStates.forEach(state => {
            html += '<td>';
            if (stdsByState[state]) {
                stdsByState[state].sort((a, b) =>
                    a.code.localeCompare(b.code, undefined, { numeric: true })
                );
                const cellData    = stdsByState[state].map(s => ({ code: s.code, statement: s.statement }));
                const encCellData = encodeURIComponent(JSON.stringify(cellData)).replace(/'/g, "%27");
                const encGroup    = encodeURIComponent(state).replace(/'/g, "%27");
                const encLoc      = encodeURIComponent(group.locationId).replace(/'/g, "%27");

                stdsByState[state].forEach(std => {
                    let inlineStyle = '';
                    if (sharedStandardColors.has(std.code)) {
                        const c = sharedStandardColors.get(std.code);
                        inlineStyle = `style="background-color:${c.bg}; color:${c.text}; border-color:${c.border};"`;
                    }
                    html +=
                        `<span class="clickable-std" ${inlineStyle}
                               onclick="openStdCellModal('${encCellData}','${encGroup}','${encLoc}')">
                             ${escapeHtml(std.code)}
                         </span>`;
                });
            } else {
                html += `<span style="color:#adb5bd; padding-left:6px;">—</span>`;
            }
            html += '</td>';
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    grid.innerHTML = html;
    setTimeout(updateStickyHeaderOffset, 50);
};

window.openFullscreenTable = function openFullscreenTable() {
    const tableHtml = document.getElementById('stds-results-grid').innerHTML;

    document.getElementById('modal-header-content').innerHTML =
        `<h3 class="flex-center gap-10"
              style="margin:0; font-size:1.25rem; color:var(--primary); justify-content:flex-start;">
             ${SVGS.maximize} Fullscreen Standards Map
         </h3>`;

    document.getElementById('modal-body-content').innerHTML =
        `<div class="fullscreen-table-wrapper">${tableHtml}</div>`;

    const overlay = document.getElementById('media-modal');
    overlay.classList.add('active', 'fullscreen-modal');
    document.body.style.overflow = 'hidden';
};

window.openStdCellModal = function openStdCellModal(encCellData, encGroup, encLocationId) {
    const cellData   = JSON.parse(decodeURIComponent(encCellData));
    const group      = decodeURIComponent(encGroup);
    const locationId = decodeURIComponent(encLocationId);

    const modalHeader  = document.getElementById('modal-header-content');
    const modalBody    = document.getElementById('modal-body-content');
    const isFullscreen = document.getElementById('media-modal').classList.contains('fullscreen-modal');

    if (isFullscreen) {
        previousModalState = { header: modalHeader.innerHTML, body: modalBody.innerHTML };
    }

    const backBtnHtml = isFullscreen
        ? `<button class="action-btn btn-base"
                   style="margin-right:15px; border-color:var(--primary); color:var(--primary);"
                   onclick="returnToFullscreenTable(event)">
               ${SVGS.back} Back to Table
           </button>`
        : '';

    modalHeader.innerHTML = `
        <div style="display:flex; align-items:center; width:100%;">
            ${backBtnHtml}
            <div>
                <h3 class="flex-center gap-10"
                    style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);
                           justify-content:flex-start;">
                    📁 ${escapeHtml(group)}
                </h3>
                <div style="font-size:0.85rem; color:var(--text-light); font-weight:600;
                            text-transform:uppercase; letter-spacing:0.5px;">
                    Standards for Section # ${escapeHtml(locationId)}
                </div>
            </div>
        </div>`;

    const containerStyle = isFullscreen
        ? 'padding:25px; overflow-y:auto; flex:1;'
        : 'padding:0 5px; margin-top:-15px;';

    let bodyHtml = `<div style="${containerStyle}">`;
    cellData.forEach((std, index) => {
        const borderStyle = index < cellData.length - 1
            ? 'border-bottom:1px dashed var(--border); margin-bottom:10px; padding-bottom:10px;'
            : '';

        let displayCode  = escapeHtml(std.code);
        let displayState = std.statement;

        if (currentStdsQuery) {
            if (currentStdsExactPattern) {
                currentStdsExactPattern.lastIndex = 0;
                displayCode = displayCode.replace(
                    currentStdsExactPattern,
                    '<span class="highlight">$1</span>'
                );
            }
            let activePattern = null;
            if (currentStdsFuzzyPattern) {
                currentStdsFuzzyPattern.lastIndex = 0;
                if (currentStdsFuzzyPattern.test(std.statement)) {
                    activePattern = currentStdsFuzzyPattern;
                }
            }
            if (!activePattern && currentStdsExactPattern) {
                activePattern = currentStdsExactPattern;
            }
            if (activePattern) {
                activePattern.lastIndex = 0;
                displayState = displayState
                    .split(/(<[^>]+>)/g)
                    .map((part, i) => i % 2 === 0
                        ? part.replace(activePattern, '<span class="highlight">$&</span>')
                        : part
                    )
                    .join('');
            }
        }

        bodyHtml += `
            <div style="${borderStyle}">
                <div style="font-family:var(--code-font); font-weight:bold; color:var(--primary);
                            margin-bottom:8px; font-size:0.9rem;">
                    ${displayCode}
                </div>
                <div style="font-size:0.85rem; line-height:1.3; color:var(--text);">
                    ${displayState}
                </div>
            </div>`;
    });
    bodyHtml += '</div>';

    modalBody.innerHTML = bodyHtml;

    if (!isFullscreen) {
        document.getElementById('media-modal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    modalBody.scrollTop = 0;
};

window.returnToFullscreenTable = function returnToFullscreenTable(e) {
    if (e) e.stopPropagation();
    if (previousModalState) {
        document.getElementById('modal-header-content').innerHTML = previousModalState.header;
        document.getElementById('modal-body-content').innerHTML   = previousModalState.body;
        previousModalState = null;
    }
};

function getHighlightedStd(code, statement) {
    let displayCode  = escapeHtml(code);
    let displayState = escapeHtml(statement);

    if (currentStdsQuery) {   
        if (currentStdsExactPattern) {   
            currentStdsExactPattern.lastIndex = 0;
            displayCode = displayCode.replace(
                currentStdsExactPattern,
                '<span class="highlight">$1</span>'
            );
        }
        if (currentStdsFuzzyPattern) {   
            currentStdsFuzzyPattern.lastIndex = 0;
            if (currentStdsFuzzyPattern.test(statement)) {
                currentStdsFuzzyPattern.lastIndex = 0;
                displayState = displayState.replace(
                    currentStdsFuzzyPattern,
                    '<span class="highlight">$&</span>'
                );
                return { displayCode, displayState };
            }
        }
        if (currentStdsExactPattern) {   
            currentStdsExactPattern.lastIndex = 0;
            displayState = displayState.replace(
                currentStdsExactPattern,
                '<span class="highlight">$1</span>'
            );
        }
    }
    return { displayCode, displayState };
}

// AUDIT VIEW — STATE / GROUP FILTER DROPDOWN
window.toggleStdFilterDropdown = function toggleStdFilterDropdown(event) {
    toggleFilterDropdown('std-filter-dropdown', event);
};

window.renderStdFilterDropdown = function renderStdFilterDropdown() {
    const dropdown = document.getElementById('std-filter-dropdown');
    if (!dropdown) return;

    const groupsHtml = Array.from(courseStandardGroups).sort().map(g =>
        buildFilterCheckboxHTML(
            `toggleStdGroup('${escapeHtml(g).replace(/'/g, "\\'")}', this.checked)`,
            escapeHtml(g),
            activeStandardGroups.has(g)
        )
    ).join('');

    dropdown.innerHTML = `
        <div class="filter-actions"
             style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--border);">
            <button class="filter-action-btn" onclick="toggleAllStdGroups(false)">Clear All</button>
        </div>
        <div style="max-height:250px; overflow-y:auto; overflow-x:hidden; padding-right:5px;">
            <div style="column-count:2; column-gap:20px;">${groupsHtml}</div>
        </div>`;

    updateStdFilterBtnText();
};

window.toggleStdGroup = function toggleStdGroup(group, isChecked) {
    if (isChecked) activeStandardGroups.add(group);
    else           activeStandardGroups.delete(group);
    updateStdFilterBtnText();
    renderModuleDetail(false);
    saveAppState();
};

window.toggleAllStdGroups = function toggleAllStdGroups(state) {
    activeStandardGroups.clear();
    if (state) courseStandardGroups.forEach(g => activeStandardGroups.add(g));
    renderStdFilterDropdown();
    renderModuleDetail(false);
    saveAppState();
};

window.updateStdFilterBtnText = function updateStdFilterBtnText() {
    const btn = document.getElementById('std-filter-btn');
    if (!btn) return;
    if (activeStandardGroups.size === 0) {
        btn.innerHTML = `States <span id="svg-arrow-down-audit-state">${SVGS.arrowDown}</span>`;
        btn.classList.remove('filtered');
    } else {
        btn.innerHTML = `${activeStandardGroups.size} States <span id="svg-arrow-down-audit-state">${SVGS.arrowDown}</span>`;
        btn.classList.add('filtered');
    }
};

window.toggleFolderDetails = function toggleFolderDetails(event, btn) {
    event.stopPropagation();
    const container = btn.closest('.audit-lesson') ||
                      btn.closest('.standards-box') ||
                      btn.closest('.audit-page');
    if (!container) return;
    const details     = container.querySelectorAll('details.std-group-details');
    const isExpanding = btn.textContent.includes('Expand');
    details.forEach(d => { d.open = isExpanding; });
    btn.innerHTML = isExpanding ? 'Collapse States' : 'Expand States';
};
					
