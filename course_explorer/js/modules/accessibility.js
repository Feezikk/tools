// =============================================================================
// ACCESSIBILITY.JS
// Automated WCAG accessibility validation for documents discovered in the course
// (Downloads tab of the Media Dashboard). Currently supports .docx via a direct
// OOXML parse (no server round-trip); designed so additional formats (PDF, PPTX,
// XLSX, …) can be plugged in later without touching the UI code in media.js.
//
// -----------------------------------------------------------------------------
// EXTENSIBILITY
// -----------------------------------------------------------------------------
// Validators are registered by file extension in `AccessibilityValidators`.
// A validator is an (async) function: (file: File, doc: object) => { status, issues }
//   - status: 'pass' | 'fail'
//   - issues: array of { title, description, why, location, recommendation }
// To support a new format later, add a validator function elsewhere and register it:
//
//   registerAccessibilityValidator('pdf',  validatePdfAccessibility);
//   registerAccessibilityValidator('pptx', validatePptxAccessibility);
//
// Nothing in the UI (media.js) needs to change — unsupported types simply show
// a neutral "—" status until a validator is registered for them.
// =============================================================================

const AccessibilityValidators = {};

function registerAccessibilityValidator(fileType, validatorFn) {
    AccessibilityValidators[fileType.toLowerCase()] = validatorFn;
}

function getAccessibilityValidator(fileType) {
    if (!fileType) return null;
    return AccessibilityValidators[fileType.toLowerCase()] || null;
}


// ── Queue / async processing ────────────────────────────────────────────────
// Validation runs off the main render path: documents are enqueued, then a
// small pool of workers processes them with a `setTimeout(…, 0)` yield between
// each file so the UI thread never gets tied up, keeping search/filtering/
// scrolling responsive while a course's documents are checked in the background.

const ACCESSIBILITY_CONCURRENCY = 3;

// Adds any not-yet-checked, supported documents to the validation queue and
// (re)starts the background processor if it isn't already running. Safe to
// call repeatedly with overlapping lists — already-cached or already-queued
// paths are skipped.
function queueAccessibilityChecks(docs) {
    if (!Array.isArray(docs) || !docs.length) return;

    let addedAny = false;
    docs.forEach(doc => {
        if (!doc || !doc.path) return;
        if (!getAccessibilityValidator(doc.fileType)) return;          // no validator for this format (yet)
        if (accessibilityResultsCache.has(doc.path)) return;           // already validated this session
        if (accessibilityQueuedPaths.has(doc.path)) return;            // already queued/in-flight

        accessibilityQueuedPaths.add(doc.path);
        accessibilityQueue.push(doc);
        accessibilityProgress.total++;
        addedAny = true;
    });

    if (addedAny) {
        updateAccessibilityProgressUI();
        startAccessibilityProcessing();
    }
}

async function startAccessibilityProcessing() {
    if (accessibilityInProgress) return; // a pool is already draining the shared queue
    accessibilityInProgress = true;
    updateAccessibilityProgressUI();

    const workerCount = Math.min(ACCESSIBILITY_CONCURRENCY, accessibilityQueue.length) || 1;
    const workers = [];
    for (let i = 0; i < workerCount; i++) workers.push(accessibilityWorkerLoop());
    await Promise.all(workers);

    accessibilityInProgress = false;
    updateAccessibilityProgressUI();
}

async function accessibilityWorkerLoop() {
    while (accessibilityQueue.length) {
        const doc = accessibilityQueue.shift();
        await processAccessibilityDoc(doc);
        // Yield back to the event loop between documents so scrolling/typing/
        // filtering never stalls behind a long validation run.
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

async function processAccessibilityDoc(doc) {
    const path = doc.path;
    try {
        const file = fileMap.get(path);
        if (!file) {
            accessibilityResultsCache.set(path, { status: 'unavailable', issues: [] });
        } else {
            const validator = getAccessibilityValidator(doc.fileType);
            const result     = await validator(file, doc);
            accessibilityResultsCache.set(path, {
                status: result.status === 'fail' ? 'fail' : 'pass',
                issues: Array.isArray(result.issues) ? result.issues : [],
                checkedAt: Date.now()
            });
        }
    } catch (err) {
        accessibilityResultsCache.set(path, {
            status: 'error',
            issues: [{
                title: 'Could not analyze this document',
                description: `An unexpected error occurred while analyzing this file (${err && err.message ? err.message : 'unknown error'}).`,
                why: 'Accessibility could not be verified automatically for this document.',
                location: '',
                recommendation: 'Confirm the file opens correctly in Microsoft Word and is not corrupted, then try refreshing the course.'
            }]
        });
    } finally {
        accessibilityQueuedPaths.delete(path);
        accessibilityProgress.completed++;
        patchAccessibilityCellsForPath(path);
        updateAccessibilityProgressUI();
    }
}


// ── Rendering: status cell / badge (used in both table rows and cards) ─────

// Builds the markup for one document's accessibility status. Supported types
// with a cached result render a Pass/Fail badge (Fail is clickable and opens
// the detailed report); supported types not yet processed show a small
// "Checking…" spinner; unsupported types render a neutral placeholder.
function renderAccessibilityCell(doc) {
    if (!doc || !doc.path) return '';
    const safePath = escapeHtml(doc.path);

    if (!getAccessibilityValidator(doc.fileType)) {
        return `<span class="a11y-badge a11y-na" data-a11y-path="${safePath}" title="Structure check isn't available yet for .${escapeHtml(doc.fileType || '')} files">—</span>`;
    }

    if (!accessibilityResultsCache.has(doc.path)) {
        return `<span class="a11y-badge a11y-pending" data-a11y-path="${safePath}"><span class="spinner a11y-spinner"></span> Checking…</span>`;
    }

    return accessibilityBadgeMarkupFromCache(doc.path);
}

function accessibilityBadgeMarkupFromCache(path) {
    const safePath = escapeHtml(path);
    const cached   = accessibilityResultsCache.get(path);
    if (!cached) {
        return `<span class="a11y-badge a11y-pending" data-a11y-path="${safePath}"><span class="spinner a11y-spinner"></span> Checking…</span>`;
    }

    if (cached.status === 'pass') {
        return `<span class="a11y-badge a11y-pass" data-a11y-path="${safePath}" title="No structure-check issues detected">${SVGS.check} Pass</span>`;
    }

    if (cached.status === 'fail') {
        const n = cached.issues.length;
        return `<button type="button" class="a11y-badge a11y-fail" data-a11y-path="${safePath}" onclick="event.stopPropagation(); openAccessibilityReport(this.dataset.a11yPath)" title="View structure check report — ${n} issue${n === 1 ? '' : 's'} found">${SVGS.x} Fail</button>`;
    }

    if (cached.status === 'unavailable') {
        return `<span class="a11y-badge a11y-na" data-a11y-path="${safePath}" title="File not found in the loaded folder">—</span>`;
    }

    // 'error' — the check itself couldn't run; still surface details via the report modal.
    return `<button type="button" class="a11y-badge a11y-error" data-a11y-path="${safePath}" onclick="event.stopPropagation(); openAccessibilityReport(this.dataset.a11yPath)" title="Structure check could not run — click for details">${SVGS.alert} Error</button>`;
}

// Live-patches every rendered badge for a given path once its result lands,
// instead of re-rendering the whole Downloads list (which would reset scroll
// position and any in-progress search typing).
function patchAccessibilityCellsForPath(path) {
    if (typeof CSS === 'undefined' || !CSS.escape) return;
    const selector = `[data-a11y-path="${CSS.escape(path)}"]`;
    document.querySelectorAll(selector).forEach(el => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = accessibilityBadgeMarkupFromCache(path);
        const newEl = wrapper.firstElementChild;
        if (newEl) el.replaceWith(newEl);
    });
}


// ── Progress indicator ──────────────────────────────────────────────────────

function updateAccessibilityProgressUI() {
    const el = document.getElementById('a11y-progress-indicator');
    if (!el) return;

    if (accessibilityInProgress || accessibilityQueue.length > 0) {
        el.style.display = 'flex';
        el.innerHTML = `<span class="spinner"></span> Running structure check: ${accessibilityProgress.completed} of ${accessibilityProgress.total} document${accessibilityProgress.total === 1 ? '' : 's'}…`;
    } else {
        el.style.display = 'none';
        el.innerHTML = '';
    }
}


// ── Report modal ─────────────────────────────────────────────────────────────

window.openAccessibilityReport = function openAccessibilityReport(path) {
    const cached = accessibilityResultsCache.get(path);
    if (!cached) return;

    const fileNameEl = document.getElementById('accessibility-report-filename');
    const body       = document.getElementById('accessibility-report-body');
    const modal      = document.getElementById('accessibility-report-modal');
    if (!body || !modal) return;

    if (fileNameEl) fileNameEl.textContent = path.split('/').pop();

    if (!cached.issues.length) {
        body.innerHTML = `
            <div class="a11y-report-pass">
                ${SVGS.checkCircle} No structure-check issues were found in this document.
            </div>`;
    } else {
        body.innerHTML = cached.issues.map(issue => `
            <div class="a11y-issue-card">
                <div class="a11y-issue-title">${SVGS.x} ${escapeHtml(issue.title)}</div>
                <p class="a11y-issue-desc">${escapeHtml(issue.description)}</p>
                ${issue.why ? `<p class="a11y-issue-why"><strong>Why it matters:</strong> ${escapeHtml(issue.why)}</p>` : ''}
                ${issue.location ? `<p class="a11y-issue-location"><strong>Location:</strong> ${escapeHtml(issue.location)}</p>` : ''}
                <div class="a11y-issue-recommendation"><strong>Recommendation:</strong> ${escapeHtml(issue.recommendation)}</div>
            </div>
        `).join('');
    }

    modal.classList.add('active');
};

window.closeAccessibilityReportModal = function closeAccessibilityReportModal(event) {
    if (event && event.target.id !== 'accessibility-report-modal') return;
    const modal = document.getElementById('accessibility-report-modal');
    if (modal) modal.classList.remove('active');
};


// ── "What does this check?" info button/modal ──────────────────────────────
// A small, transparent reference for what Structure Check actually covers —
// a focused set of Level A structural checks, not a full WCAG AA audit.
// Add a row here whenever a new check (or validator) is introduced so the
// list in the UI never drifts out of sync with what the code actually does.
const STRUCTURE_CHECK_CRITERIA = [
    { check: 'Image missing alternative text',   criterion: '1.1.1 Non-text Content',         level: 'A' },
    { check: 'Heading hierarchy skipped',         criterion: '1.3.1 Info and Relationships',   level: 'A' },
    { check: 'Table missing header row',          criterion: '1.3.1 Info and Relationships',   level: 'A' },
    { check: 'Non-descriptive link text',         criterion: '2.4.4 Link Purpose (In Context)', level: 'A' }
];

function structureCheckInfoButton() {
    return `<button type="button" class="info-btn" onclick="event.stopPropagation(); openStructureCheckInfo()" title="What does Structure Check look for?">${SVGS.info}</button>`;
}

window.openStructureCheckInfo = function openStructureCheckInfo() {
    const modal = document.getElementById('structure-check-info-modal');
    const body  = document.getElementById('structure-check-info-body');
    if (!modal || !body) return;

    body.innerHTML = `
        <p style="margin-top:0; color:var(--text-light); font-size:0.9rem;">
            Structure Check scans each .docx file for a focused set of structural issues known to
            affect screen reader and assistive-technology users. It currently covers four
            <strong>WCAG 2.1 Level A</strong> checks — it is not a full WCAG AA conformance audit
            (things like color contrast or reading order aren't checked yet).
        </p>
        <table class="image-list-table">
            <thead><tr><th>Check</th><th>WCAG Success Criterion</th><th>Level</th></tr></thead>
            <tbody>
                ${STRUCTURE_CHECK_CRITERIA.map(c => `
                    <tr>
                        <td style="font-weight:500;">${escapeHtml(c.check)}</td>
                        <td style="color:var(--text-light);">${escapeHtml(c.criterion)}</td>
                        <td><span class="type-badge">${escapeHtml(c.level)}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;

    modal.classList.add('active');
};

window.closeStructureCheckInfoModal = function closeStructureCheckInfoModal(event) {
    if (event && event.target.id !== 'structure-check-info-modal') return;
    const modal = document.getElementById('structure-check-info-modal');
    if (modal) modal.classList.remove('active');
};


// =============================================================================
// DOCX VALIDATOR
// =============================================================================
// Reads the .docx (a zip of OOXML parts) directly in the browser via JSZip and
// walks word/document.xml looking for WCAG-relevant structural problems:
//   1. Images without alternative text
//   2. Skipped heading levels (e.g. Heading 1 straight to Heading 3)
//   3. Tables without a designated header row
//   4. Hyperlinks whose visible text doesn't describe their destination
//
// Note on "location": .docx has no fixed page numbers (pagination is a
// rendering-time concern), so locations are reported relative to the nearest
// preceding heading and/or a running paragraph/table index — the most useful
// anchor a reader can act on inside Word itself.

async function validateDocxAccessibility(file) {
    const issues = [];

    const buffer  = await file.arrayBuffer();
    const zip     = await JSZip.loadAsync(buffer);
    const docPart = zip.file('word/document.xml');

    if (!docPart) {
        return {
            status: 'fail',
            issues: [{
                title: 'Unable to read document contents',
                description: 'This .docx file does not contain a readable word/document.xml part.',
                why: 'Accessibility of the content cannot be verified if the document structure cannot be parsed.',
                location: '',
                recommendation: 'Re-save the file from Microsoft Word (or another compliant editor) and try again.'
            }]
        };
    }

    const xmlText = await docPart.async('string');
    const xmlDoc  = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length) {
        throw new Error('document.xml could not be parsed as XML');
    }

    const body = xmlDoc.getElementsByTagName('w:body')[0] || xmlDoc.documentElement;
    const getText = el => Array.from(el.getElementsByTagName('w:t')).map(t => t.textContent).join('');

    let lastHeadingLevel = 0;
    let lastHeadingText  = '';
    let paraCounter      = 0;
    let tableCounter     = 0;

    const VAGUE_LINK_PHRASES = new Set([
        'click here', 'here', 'link', 'this link', 'read more', 'more', 'more info', 'learn more'
    ]);

    Array.from(body.children).forEach(node => {
        const tag = node.tagName;

        if (tag === 'w:p') {
            paraCounter++;
            const text = getText(node).trim();

            // --- Heading hierarchy -------------------------------------------------
            const pStyle   = node.getElementsByTagName('w:pStyle')[0];
            const styleVal = pStyle ? pStyle.getAttribute('w:val') : null;
            const headingMatch = styleVal && /^Heading([1-9])$/.exec(styleVal);

            if (headingMatch) {
                const level = parseInt(headingMatch[1], 10);
                if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
                    issues.push({
                        title: 'Heading hierarchy skipped',
                        description: `The heading level jumps from Heading ${lastHeadingLevel} ("${lastHeadingText || 'untitled'}") straight to Heading ${level} ("${text || 'untitled'}") without a Heading ${lastHeadingLevel + 1} in between.`,
                        why: 'Screen reader users navigate documents by heading level to build a mental outline. Skipping levels breaks that structure and can hide content from quick navigation.',
                        location: text ? `Heading: "${text}"` : `Paragraph ${paraCounter}`,
                        recommendation: `Do not jump from Heading ${lastHeadingLevel} directly to Heading ${level}. Insert a Heading ${lastHeadingLevel + 1} first, or adjust the outline so levels increase by one at a time.`
                    });
                }
                lastHeadingLevel = level;
                lastHeadingText  = text;
            }

            // --- Images / drawings missing alt text --------------------------------
            Array.from(node.getElementsByTagName('wp:docPr')).forEach(docPr => {
                const descr = (docPr.getAttribute('descr') || '').trim();
                const name  = (docPr.getAttribute('name')  || '').trim();
                if (!descr) {
                    issues.push({
                        title: 'Image missing alternative text',
                        description: `An image${name ? ` ("${name}")` : ''} does not have alternative text set.`,
                        why: 'Screen reader users rely on alt text to understand what an image shows and why it is there. Without it, the image is announced generically or skipped entirely.',
                        location: lastHeadingText ? `Near heading: "${lastHeadingText}"` : `Paragraph ${paraCounter}`,
                        recommendation: 'Right-click the image → Edit Alt Text, and add a concise description of the image\'s content and purpose.'
                    });
                }
            });

            // --- Non-descriptive link text ------------------------------------------
            Array.from(node.getElementsByTagName('w:hyperlink')).forEach(link => {
                const linkText = getText(link).trim();
                if (linkText && VAGUE_LINK_PHRASES.has(linkText.toLowerCase())) {
                    issues.push({
                        title: 'Non-descriptive link text',
                        description: `A hyperlink uses the text "${linkText}", which does not describe where it leads.`,
                        why: 'Screen reader users often scan a list of links out of the surrounding context. Generic text like "click here" gives no indication of the link\'s destination.',
                        location: lastHeadingText ? `Near heading: "${lastHeadingText}"` : `Paragraph ${paraCounter}`,
                        recommendation: 'Rewrite the link text to describe its destination, e.g. "Download the syllabus" instead of "click here".'
                    });
                }
            });

        } else if (tag === 'w:tbl') {
            tableCounter++;

            // A table's first row can be marked as a header two different ways in
            // Word, and either one is a valid accessibility signal:
            //   1. Table Design → "Header Row" checkbox — sets w:tblLook/@w:firstRow="1"
            //      on the table's properties (this is what most authors use).
            //   2. Layout → "Repeat Header Rows" — sets <w:tblHeader/> inside the
            //      first row's <w:trPr> (repeats the row across printed pages).
            const tblPr    = node.getElementsByTagName('w:tblPr')[0];
            const tblLook  = tblPr ? tblPr.getElementsByTagName('w:tblLook')[0] : null;
            const firstRowStyleFlag = tblLook ? tblLook.getAttribute('w:firstRow') : null;
            const hasHeaderRowStyle = firstRowStyleFlag === '1' || firstRowStyleFlag === 'true';

            const rows     = node.getElementsByTagName('w:tr');
            const firstRow = rows[0];
            const trPr     = firstRow ? firstRow.getElementsByTagName('w:trPr')[0] : null;
            const hasRepeatingHeaderRow = !!(trPr && trPr.getElementsByTagName('w:tblHeader').length);

            const hasHeaderRow = hasHeaderRowStyle || hasRepeatingHeaderRow;

            if (!hasHeaderRow) {
                issues.push({
                    title: 'Table missing header row',
                    description: `Table ${tableCounter}${lastHeadingText ? ` (near heading "${lastHeadingText}")` : ''} does not have its first row marked as a header row.`,
                    why: 'Screen readers use header-row markup to announce column headers as a user moves through a table, so cell values keep their context.',
                    location: `Table ${tableCounter}` + (lastHeadingText ? `, near heading: "${lastHeadingText}"` : ''),
                    recommendation: 'Select the table, open the Table Design tab, and check "Header Row" (or select the first row, open Table Properties → Row, and enable "Repeat as header row at the top of each page").'
                });
            }
        }
    });

    return { status: issues.length ? 'fail' : 'pass', issues };
}

registerAccessibilityValidator('docx', validateDocxAccessibility);
