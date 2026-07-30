// =============================================================================
// DASHBOARD.JS
// Renders the main module/lesson audit dashboard grid and module detail view.
// =============================================================================


function renderDashboardGrid() {
    elements.dashboardGrid.innerHTML = '';
    const statsEl = document.getElementById('audit-stats');
    
    if (!validModules.length) {
        elements.dashboardGrid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#999; padding:40px;">No modules found.</div>';
        if (statsEl) statsEl.innerHTML = '';
        return;
    }

    let totalMods = validModules.length;
    let totalLess = 0;
    let totalPgs = 0;

    const frag = document.createDocumentFragment();

    validModules.forEach((mod, index) => {
        const modNum      = padNum(mod.num);
        let lessonCount   = mod.lessons?.length || 0;
        let pageCount     = 0;
        let moduleHasIssues = false;
        
        totalLess += lessonCount;

        (mod.lessons || []).forEach(lesson => {
            if (lesson.pages) {
                pageCount += lesson.pages.length;
                totalPgs += lesson.pages.length;
            }
            if (lesson._reqContent !== false && (!lesson._topic || !lesson._parsedObjectives?.length)) {
                moduleHasIssues = true;
            }
            if (lesson._reqStd !== false && lesson.pages) {
                lesson.pages.forEach(p => {
                    if (!p._parsedStandards?.length) moduleHasIssues = true;
                });
            }
        });

        const statusColor  = moduleHasIssues ? "#dc3545" : "#28a745";
        const statusBg     = moduleHasIssues ? "#fff5f5"  : "#e6f9e9";
        const statusBorder = moduleHasIssues ? "#ffaeb5"  : "#c3e6cb";
        const statusIcon   = moduleHasIssues ? `${SVGS.alert} Needs Attention` : `${SVGS.check} All Good`;

        const card = document.createElement('div');
        card.className = 'module-card';
        card.onclick   = () => openModuleDetail(index);
        card.style.borderLeftColor = statusColor;
        card.innerHTML = `
            <div class="flex-between" style="align-items:flex-start;">
                <div>
                    <div class="mc-header">Module ${modNum}</div>
                    <div class="mc-title">${mod.title}</div>
                </div>
                <div class="flex-center gap-10" style="font-size:0.75rem; font-weight:bold; color:${statusColor}; background:${statusBg}; border:1px solid ${statusBorder}; padding:4px 8px; border-radius:12px; white-space:nowrap;">
                    ${statusIcon}
                </div>
            </div>
            <div class="mc-stats">
                <div class="flex-center gap-10" style="justify-content:flex-start;"><span style="color:var(--primary);">${SVGS.folder}</span> ${lessonCount} Lessons</div>
                <div class="flex-center gap-10" style="justify-content:flex-start;"><span style="color:var(--primary);">${SVGS.fileText}</span> ${pageCount} Pages</div>
            </div>`;
        frag.appendChild(card);
    });

    if (statsEl) {
        statsEl.innerHTML = `Total Modules: ${totalMods} &nbsp;|&nbsp; Total Lessons: ${totalLess} &nbsp;|&nbsp; Total Pages: ${totalPgs}`;
    }
    
    elements.dashboardGrid.appendChild(frag);
}

window.openModuleDetail = function openModuleDetail(index) {
    currentModuleIndex = index;
    elements.dashboardGrid.style.display   = 'none';
    elements.auditTopBar.style.display     = 'none';
    elements.auditDetailArea.style.display = 'block';
    renderModuleDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(updateStickyHeaderOffset, 50);
    saveAppState();
};

window.navModule = function navModule(direction) {
    if (!validModules.length) return;
    let newIndex = currentModuleIndex + direction;
    if      (newIndex < 0)                    newIndex = validModules.length - 1;
    else if (newIndex >= validModules.length) newIndex = 0;
    currentModuleIndex = newIndex;
    renderModuleDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(updateStickyHeaderOffset, 50);
    saveAppState();
};

function getModNavText(mod) {
    const val = String(mod.num || "").trim();
    return /^\d+$/.test(val) ? `Module ${padNum(val)}` : val;
}

function renderModuleDetail(autoExpand = true) {
    const container = elements.auditDetailContent;
    const openLessonIds = Array.from(container.querySelectorAll('details.audit-lesson[open]')).map(d => d.id);

    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    if (autoExpand) {
        isAllExpanded = false;
        if (elements.gapToggle?.checked) isAllExpanded = true;
    }
    updateToggleButton();

    const mod    = validModules[currentModuleIndex];
    const modNum = padNum(mod.num);

    if (validModules.length > 0) {
        const prevIndex = currentModuleIndex === 0 ? validModules.length - 1 : currentModuleIndex - 1;
        const nextIndex = currentModuleIndex === validModules.length - 1 ? 0 : currentModuleIndex + 1;
        const btnPrev  = document.getElementById('btn-prev-mod');
        const btnNext  = document.getElementById('btn-next-mod');
        const lblCurr  = document.getElementById('current-mod-label');
        const prevText = getModNavText(validModules[prevIndex]);
        const nextText = getModNavText(validModules[nextIndex]);
        const currText = getModNavText(mod);

        if (btnPrev) { btnPrev.innerHTML = `${SVGS.back} <span class="nav-btn-truncate">${escapeHtml(prevText)}</span>`; btnPrev.title = prevText; }
        if (btnNext) { btnNext.innerHTML = `<span class="nav-btn-truncate">${escapeHtml(nextText)}</span> ${SVGS.forward}`; btnNext.title = nextText; }
        if (lblCurr) lblCurr.innerHTML = escapeHtml(currText);
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'module-detail-title';
    titleDiv.textContent = `Module ${modNum}: ${mod.title}`;
    frag.appendChild(titleDiv);

    (mod.lessons || []).forEach(lesson => frag.appendChild(renderLessonBlock(lesson, modNum)));
    container.appendChild(frag);

    if (autoExpand) {
        applyExpansionState(isAllExpanded);
    } else {
        openLessonIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.open = true;
        });
    }
    setTimeout(updateStickyHeaderOffset, 50);
}

function renderLessonBlock(lesson, modNum) {
    const details  = document.createElement('details');
    const hasTopic = !!lesson._topic;
    const hasObj   = !!lesson._parsedObjectives?.length;
    const contentPass = !lesson._reqContent || (hasTopic && hasObj);

    let standardsPass = true;
    if (lesson._reqStd) {
        if (lesson.pages?.length > 0) {
            lesson.pages.forEach(p => { if (!p._parsedStandards?.length) standardsPass = false; });
        } else { standardsPass = false; }
    }

    details.className = (contentPass && standardsPass) ? 'audit-lesson lesson-complete' : 'audit-lesson lesson-has-gaps';
    const fullLesID = `${modNum}.${padNum(lesson.num)}`;
    details.id      = `lesson-${fullLesID}`;
    details.addEventListener('toggle', () => saveAppState());

    const hasAnyStandards = lesson.pages?.some(p => p._parsedStandards?.length > 0);
    let healthBadges = `<div class="flex-center gap-10" style="margin-left:auto;">`;

    if (!lesson._reqContent && !lesson._reqStd) {
        healthBadges += `<span class="status-badge neutral" style="margin-left:0;">NOT REQUIRED</span>`;
    } else {
        if (lesson._reqContent) {
            healthBadges += hasTopic ? `<span class="status-badge present" style="margin-left:0;">TOPIC</span>` : `<span class="status-badge missing" style="margin-left:0;">NO TOPIC</span>`;
            healthBadges += hasObj   ? `<span class="status-badge present" style="margin-left:0;">OBJS</span>`  : `<span class="status-badge missing" style="margin-left:0;">NO OBJS</span>`;
        }
        if (lesson._reqStd) {
            healthBadges += standardsPass ? `<span class="status-badge present" style="margin-left:0;">STNDS</span>` : `<span class="status-badge missing" style="margin-left:0;">NO STNDS</span>`;
        }
    }
    healthBadges += `</div>`;

    const summary = document.createElement('summary');
    summary.className = 'lesson-summary';
    summary.innerHTML = `<span class="id-number">${fullLesID}</span> <span>${lesson.title}</span> ${healthBadges}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'audit-lesson-content';

    const topicBox = document.createElement('div');
    if (lesson._topic) {
        topicBox.className = 'topic-box present status-good';
        topicBox.innerHTML = `<div class="topic-title">Lesson Topic</div><div class="topic-content">${lesson._topic}</div>`;
    } else if (!lesson._reqContent) {
        topicBox.className = 'topic-box neutral status-neutral';
        topicBox.innerHTML = `<div class="topic-title">Lesson Topic</div><div class="topic-content topic-neutral">Not required for this lesson.</div>`;
    } else {
        topicBox.className = 'topic-box missing';
        topicBox.innerHTML = `<div class="topic-title">Lesson Topic</div><div class="topic-content topic-missing">No topic listed.</div>`;
    }
    contentDiv.appendChild(topicBox);

    if (hasObj) {
        const objBox = document.createElement('div');
        objBox.className = 'objectives-box status-good';
        objBox.innerHTML = `<div class="obj-title">Learning Objectives</div><ul class="obj-list">${lesson._parsedObjectives.map(o => `<li>${o}</li>`).join('')}</ul>`;
        contentDiv.appendChild(objBox);
    } else if (lesson._reqContent) {
        const emptyBox = document.createElement('div');
        emptyBox.className = 'objectives-box';
        emptyBox.style.color = "#dc3545";
        emptyBox.innerHTML = "<em>No objectives listed in sitemap</em>";
        contentDiv.appendChild(emptyBox);
    }

    if (checkIdenticalStandards(lesson.pages)) {
            const stdBox      = document.createElement('div');
            stdBox.className  = 'standards-box status-good';
            const firstStds   = lesson.pages?.[0]?._parsedStandards;
            let stdHTML       = '';

            if (firstStds?.length > 0) {
                const tableHtml = renderStandardsTableHTML(firstStds);
                const expandBtnHtml = (courseStandardGroups.size > 1) 
                    ? `<button class="nav-btn btn-base" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleFolderDetails(event, this)">Collapse States</button>` 
                    : '';
                    
                stdHTML = `
                    <div class="flex-between" style="align-items:center; margin-bottom:6px;">
                        <div class="std-title" style="margin-bottom:0;">Standards applied to all pages of this lesson</div>
                        ${expandBtnHtml}
                    </div>
                    ${tableHtml || `<div style="color:#666; font-style:italic;">No standards match the current state filter.</div>`}
                `;
            } else if (!lesson._reqStd) {
            stdHTML = `<div class="std-title">Standards applied to all pages of this lesson</div><div style="color:#666; font-style:italic;">Standards not required for this lesson.</div>`;
        } else {
            stdHTML = `<div class="std-title">Standards applied to all pages of this lesson</div><div style="color:#dc3545; font-weight:bold;">No standards found on any page.</div>`;
        }
        stdBox.innerHTML = stdHTML;
        contentDiv.appendChild(stdBox);
    } else {
        (lesson.pages || []).forEach(page => contentDiv.appendChild(renderPageBlock(page, fullLesID, lesson._reqStd)));
    }

    details.appendChild(summary);
    details.appendChild(contentDiv);
    return details;
}

function renderPageBlock(page, parentID, reqStd) {
    const div          = document.createElement('div');
    const rawStandards = page._parsedStandards;
    const hasStandards = !!rawStandards?.length;

    div.className = (hasStandards || !reqStd) ? 'audit-page page-complete' : 'audit-page page-incomplete';
    const fullPgID = `${parentID}.${padNum(Number(page.num) + 1)}`;

    let stdBadge = '';
    if (!reqStd)          stdBadge = `<span class="status-badge neutral">Not Required</span>`;
    else if (hasStandards) stdBadge = `<span class="status-badge present">${rawStandards.length} Standards</span>`;
    else                   stdBadge = `<span class="status-badge missing">No Standards</span>`;

    if (hasStandards) {
        const tableHtml = renderStandardsTableHTML(rawStandards);
        const expandBtnHtml = (courseStandardGroups.size > 1) 
            ? `<button class="nav-btn btn-base" style="padding:2px 8px; font-size:0.75rem;" onclick="toggleFolderDetails(event, this)">Collapse States</button>` 
            : '';
            
        div.innerHTML = `
            <div class="page-header flex-wrap gap-10" style="justify-content:space-between;">
                 <div class="flex-center gap-10"><span class="id-number">${fullPgID}</span> ${page.title} ${stdBadge}</div>
                 ${expandBtnHtml}
             </div>` + (tableHtml || `<div style="color:#666; font-style:italic; margin-bottom:10px; font-size:0.85rem;">No standards match the current state filter.</div>`);
    } else {
        div.innerHTML = `<div class="page-header flex-center gap-10" style="justify-content:flex-start;"><span class="id-number">${fullPgID}</span> ${page.title} ${stdBadge}</div>`;
    }
    return div;
}

function getGroupedAndSortedStandards(standards) {
    if (!standards?.length) return [];
    const filtered = activeStandardGroups.size > 0 ? standards.filter(s => activeStandardGroups.has(s.group)) : standards;
    const groups = {};
    filtered.forEach(s => {
        if (!groups[s.group]) groups[s.group] = [];
        groups[s.group].push(s);
    });
    return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(g => {
        groups[g] = sortStdsByCode(groups[g]);
        return { group: g, standards: groups[g] };
    });
}

function renderStandardsTableHTML(rawStandards) {
    const grouped = getGroupedAndSortedStandards(rawStandards);
    if (!grouped.length) return '';
    return grouped.map(g => `
        <details class="std-group-details" open>
            <summary class="std-group-summary">📁 ${escapeHtml(g.group)}</summary>
            <table class="standards-table status-good">
                ${g.standards.map(s => `<tr><td class="std-code-cell"><span class="std-code">${escapeHtml(s.code)}</span></td><td class="std-desc">${escapeHtml(s.statement)}</td><td class="std-grade" style="width:85px;">${escapeHtml(s.grade)}</td></tr>`).join('')}
            </table>
        </details>`).join('');
}

function checkIdenticalStandards(pages) {
    if (!pages?.length) return false;
    const getCodes = (p) => {
        if (!p._parsedStandards?.length) return "NONE";
        return p._parsedStandards.map(s => s.code).sort().join('|');
    };
    const firstCodes = getCodes(pages[0]);
    if (firstCodes === "NONE") return false;
    for (let i = 1; i < pages.length; i++) {
        if (getCodes(pages[i]) !== firstCodes) return false;
    }
    return true;
}
