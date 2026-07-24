// =============================================================================
// CHECKLIST.JS
// Audit configuration ('checklist') screen: choosing which modules/lessons to include in an audit and syncing checkbox state.
// =============================================================================


function showConfigScreen() {
    const tbody = document.getElementById('config-table-body');
    elements.configScreen.style.display = 'block';
    elements.status.innerHTML           = '';
    tbody.innerHTML                      = '';

    const displayName    = extractedCourseTitle || localStorage.getItem(NAME_KEY) || selectedCourseName || "";
    const safeDisplayName = displayName.replace(/"/g, '&quot;');

    document.getElementById('config-header').innerHTML = `
        <h2 class="flex-center gap-10" style="color:var(--primary);">
            ${SVGS.config} Audit Configuration
        </h2>
        <div style="margin-bottom:15px;">
            <input type="text" id="course-name-input"
                   value="${safeDisplayName}"
                   placeholder="Enter Course Name (Optional)"
                   style="padding:10px; width:300px; border:2px solid var(--border);
                          border-radius:6px; font-size:1rem; outline:none;"
                   autocomplete="off">
        </div>
        <p style="color:var(--text-light); margin-bottom:15px;">
            Uncheck any lessons that do not require objectives and/or standards.
        </p>`;

    if (!courseTree.modules) return;

    let savedConfig = {};
    try { savedConfig = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch (e) {}

    const frag = document.createDocumentFragment();

    courseTree.modules.forEach(mod => {
        if (!mod.lessons) return;
        if (IGNORE_TITLES.some(k => String(mod.title || "").toLowerCase().includes(k))) return;
        if (IGNORE_IDS.includes(String(mod.mID || "").toLowerCase())) return;

        const modRow = document.createElement('tr');
        modRow.style.background = "#e9ecef";
        modRow.innerHTML = `
            <td style="padding:10px 15px; font-weight:bold; color:var(--primary); border-top:2px solid #fff;">
                Module ${padNum(mod.num)}: ${mod.title}
            </td>
            <td colspan="2" style="border-top:2px solid #fff;"></td>`;
        frag.appendChild(modRow);

        mod.lessons.forEach(lesson => {
            const storeKey = `${mod.mID}_${lesson.lID}`;
            const rowID    = `row-${mod.mID}-${lesson.lID}`;
            const saved    = savedConfig[storeKey];

            const defaultContent = saved ? saved.reqContent : true;
            const defaultStd     = saved ? saved.reqStd     : true;
            const isMasterChecked = defaultContent || defaultStd;
            const fullID = `${padNum(mod.num)}.${padNum(lesson.num)}`;

            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid #eee";
            tr.innerHTML = `
                <td style="padding:10px 15px; display:flex; align-items:center; gap:10px;">
                    <input type="checkbox" title="Toggle Row" id="${rowID}-master" onchange="toggleLessonRow(this, '${rowID}')" ${isMasterChecked ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--primary); cursor:pointer;">
                    <div><span class="id-number">${fullID}</span> ${lesson.title}</div>
                </td>
                <td style="text-align:center;">
                    <input type="checkbox" id="${rowID}-content" class="cfg-content" data-mid="${mod.mID}" data-lid="${lesson.lID}" ${defaultContent ? 'checked' : ''} onchange="syncChecks(this, '${rowID}', 'content')">
                </td>
                <td style="text-align:center;">
                    <input type="checkbox" id="${rowID}-std" class="cfg-std" data-lid="${lesson.lID}" ${defaultStd ? 'checked' : ''} onchange="syncChecks(this, '${rowID}', 'std')">
                </td>`;
            frag.appendChild(tr);
        });
    });

    tbody.appendChild(frag);
}

window.toggleLessonRow = function toggleLessonRow(masterCb, rowID) {
    const contentCb = document.getElementById(`${rowID}-content`);
    const stdCb     = document.getElementById(`${rowID}-std`);
    if (contentCb) contentCb.checked = masterCb.checked;
    if (stdCb)     stdCb.checked     = masterCb.checked;
};

window.syncChecks = function syncChecks(sourceCb, rowID, type) {
    const contentCb = document.getElementById(`${rowID}-content`);
    const stdCb     = document.getElementById(`${rowID}-std`);
    const masterCb  = document.getElementById(`${rowID}-master`);
    if (type === 'content' && !sourceCb.checked && stdCb) stdCb.checked = false;
    if (masterCb && contentCb && stdCb) {
        masterCb.checked = contentCb.checked || stdCb.checked;
    }
};

window.applyAuditConfig = function applyAuditConfig() {
    const nameInput = document.getElementById('course-name-input');
    if (nameInput) {
        customCourseName = nameInput.value.trim();
        localStorage.setItem(NAME_KEY, customCourseName);
    }
    if (customCourseName) {
        elements.mainTitle.textContent = customCourseName;
        document.title = customCourseName;
    } else {
        elements.mainTitle.textContent = "Course Explorer";
        document.title = "Course Explorer";
    }

    const configMap  = new Map();
    const saveToStore = {};

    document.querySelectorAll('.cfg-content').forEach(inp => {
        const mID       = inp.dataset.mid;
        const lID       = inp.dataset.lid;
        const reqContent = inp.checked;
        const stdCb     = document.getElementById(`row-${mID}-${lID}-std`);
        const reqStd    = stdCb ? stdCb.checked : false;
        configMap.set(`${mID}_${lID}`, { reqContent, reqStd });
        saveToStore[`${mID}_${lID}`] = { reqContent, reqStd };
    });

    localStorage.setItem(CONFIG_KEY, JSON.stringify(saveToStore));

    courseTree.modules?.forEach(mod => {
        (mod.lessons || []).forEach(les => {
            const conf = configMap.get(`${mod.mID}_${les.lID}`);
            les._reqContent = conf ? conf.reqContent : true;
            les._reqStd     = conf ? conf.reqStd     : true;
        });
    });

    hasRunAuditConfig = true;
    switchView('audit');
};

window.reconfigureAudit = function reconfigureAudit() {
    hasRunAuditConfig = false;
    switchView('audit');
};

function applyDefaultOrSavedConfig() {
    let savedConfig = {};
    try { savedConfig = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch (e) {}

    courseTree.modules?.forEach(mod => {
        (mod.lessons || []).forEach(les => {
            const saved = savedConfig[`${mod.mID}_${les.lID}`];
            les._reqContent = saved ? saved.reqContent : true;
            les._reqStd     = saved ? saved.reqStd     : true;
        });
    });
}

function buildValidModuleList() {
    validModules = [];
    activeMediaModules.clear();
    if (!courseTree.modules) return;
    courseTree.modules.forEach(mod => {
        const title = String(mod.title || "").toLowerCase();
        const id    = String(mod.mID   || "").toLowerCase();
        if (!IGNORE_TITLES.some(k => title.includes(k)) && !IGNORE_IDS.includes(id)) {
            validModules.push(mod);
        }
    });
}

