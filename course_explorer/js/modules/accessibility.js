// =============================================================================
// ACCESSIBILITY.JS
// Two independent, automated checks run against documents discovered in the
// course (Downloads tab of the Media Dashboard), each with its own column:
//
//   1. STRUCTURE CHECK — a focused set of WCAG 2.1 Level A structural checks
//      (image alt text, heading hierarchy, table headers, link text). This is
//      NOT a full WCAG AA conformance audit — see STRUCTURE_CHECK_CRITERIA.
//
//   2. FLVS FOOTER CHECK — a separate, non-WCAG check that looks for the
//      required FLVS copyright/trademark footer text. This is a branding/
//      compliance check, not an accessibility criterion, which is why it's
//      reported in its own column rather than folded into Structure Check.
//
// Currently supports .docx, .pptx, and .xlsx via direct OOXML parsing (no
// server round-trip). Both checks share one JSZip read per file, so adding a
// document to the queue only unzips it once even though two checks run
// against it.
//
// -----------------------------------------------------------------------------
// EXTENSIBILITY
// -----------------------------------------------------------------------------
// Each check has its own registry, keyed by file extension:
//   registerAccessibilityValidator(fileType, fn)   — Structure Check
//   registerFooterCheckValidator(fileType, fn)     — FLVS Footer Check
// A validator is an (async) function: (zip: JSZip, doc: object) => result
//   Structure Check result:  { status: 'pass'|'fail', issues: [...] }
//   Footer Check result:     { status: 'pass'|'fail', footerText: string }
// To support a new format later (e.g. PDF), add validator function(s) and
// register them — nothing in the UI (media.js) needs to change; unsupported
// types simply show a neutral "—" status until a validator is registered.
// =============================================================================

const AccessibilityValidators = {};
const FooterCheckValidators   = {};

function registerAccessibilityValidator(fileType, validatorFn) {
    AccessibilityValidators[fileType.toLowerCase()] = validatorFn;
}
function getAccessibilityValidator(fileType) {
    if (!fileType) return null;
    return AccessibilityValidators[fileType.toLowerCase()] || null;
}

function registerFooterCheckValidator(fileType, validatorFn) {
    FooterCheckValidators[fileType.toLowerCase()] = validatorFn;
}
function getFooterCheckValidator(fileType) {
    if (!fileType) return null;
    return FooterCheckValidators[fileType.toLowerCase()] || null;
}

// Feed both checks' cached results into the Downloads "Flagged Items Only"
// filter (see registerDownloadsFlagPredicate in media.js). A document that
// hasn't finished checking yet, or isn't a supported format, has no cache
// entry and is simply not flagged by these predicates yet.
if (typeof registerDownloadsFlagPredicate === 'function') {
    registerDownloadsFlagPredicate(doc => {
        const result = accessibilityResultsCache.get(doc.path);
        return !!(result && (result.status === 'fail' || result.status === 'error'));
    });
    registerDownloadsFlagPredicate(doc => {
        const result = footerCheckResultsCache.get(doc.path);
        return !!(result && (result.status === 'fail' || result.status === 'error'));
    });
}


// ── Queue / async processing ────────────────────────────────────────────────
// Both checks run off the main render path: documents are enqueued once, then
// a small pool of workers processes them with a `setTimeout(…, 0)` yield
// between each file so the UI thread never gets tied up, keeping search/
// filtering/scrolling responsive while a course's documents are checked in
// the background. Each document is unzipped once and run through whichever
// checks (Structure / Footer) have a validator registered for its file type.

const ACCESSIBILITY_CONCURRENCY = 3;

// Adds any documents that still need Structure Check and/or Footer Check to
// the shared queue and (re)starts the background processor if it isn't
// already running. Safe to call repeatedly with overlapping lists — already
// fully-cached or already-queued paths are skipped.
function queueAccessibilityChecks(docs) {
    if (!Array.isArray(docs) || !docs.length) return;

    let addedAny = false;
    docs.forEach(doc => {
        if (!doc || !doc.path) return;

        const hasStructureValidator = !!getAccessibilityValidator(doc.fileType);
        const hasFooterValidator    = !!getFooterCheckValidator(doc.fileType);
        if (!hasStructureValidator && !hasFooterValidator) return; // no checks apply to this format (yet)

        const needsStructure = hasStructureValidator && !accessibilityResultsCache.has(doc.path);
        const needsFooter    = hasFooterValidator && !footerCheckResultsCache.has(doc.path);
        if (!needsStructure && !needsFooter) return;       // already validated this session

        if (accessibilityQueuedPaths.has(doc.path)) return; // already queued/in-flight

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

function analysisErrorIssue(err) {
    return {
        title: 'Could not analyze this document',
        description: `An unexpected error occurred while analyzing this file (${err && err.message ? err.message : 'unknown error'}).`,
        why: 'This could not be verified automatically for this document.',
        location: '',
        recommendation: 'Confirm the file opens correctly in its native application and is not corrupted, then try refreshing the course.'
    };
}

async function processAccessibilityDoc(doc) {
    const path = doc.path;
    const structureValidator = getAccessibilityValidator(doc.fileType);
    const footerValidator    = getFooterCheckValidator(doc.fileType);

    try {
        const file = fileMap.get(path);
        if (!file) {
            if (structureValidator) accessibilityResultsCache.set(path, { status: 'unavailable', issues: [] });
            if (footerValidator)    footerCheckResultsCache.set(path, { status: 'unavailable', footerText: '', issues: [] });
            return;
        }

        // Read the file once and share the unzipped archive across both checks.
        let zip = null;
        if (structureValidator || footerValidator) {
            try {
                const buffer = await file.arrayBuffer();
                zip = await JSZip.loadAsync(buffer);
            } catch (zipErr) {
                if (structureValidator) accessibilityResultsCache.set(path, { status: 'error', issues: [analysisErrorIssue(zipErr)] });
                if (footerValidator)    footerCheckResultsCache.set(path, { status: 'error', footerText: '', issues: [] });
                return;
            }
        }

        if (structureValidator) {
            try {
                const result = await structureValidator(zip, doc);
                accessibilityResultsCache.set(path, {
                    status: result.status === 'fail' ? 'fail' : 'pass',
                    issues: Array.isArray(result.issues) ? result.issues : [],
                    checkedAt: Date.now()
                });
            } catch (err) {
                accessibilityResultsCache.set(path, { status: 'error', issues: [analysisErrorIssue(err)] });
            }
        }

        if (footerValidator) {
            try {
                const result = await footerValidator(zip, doc);
                footerCheckResultsCache.set(path, {
                    status: result.status === 'pass' ? 'pass' : 'fail',
                    footerText: result.footerText || '',
                    issues: Array.isArray(result.issues) ? result.issues : [],
                    checkedAt: Date.now()
                });
            } catch (err) {
                footerCheckResultsCache.set(path, { status: 'error', footerText: '', issues: [] });
            }
        }
    } finally {
        accessibilityQueuedPaths.delete(path);
        accessibilityProgress.completed++;
        patchAccessibilityCellsForPath(path);
        patchFooterCheckCellsForPath(path);
        updateAccessibilityProgressUI();
        if (typeof refreshDownloadsFlaggedFilterIfActive === 'function') refreshDownloadsFlaggedFilterIfActive();
    }
}


// ── Progress indicator (shared by both checks — one pass per document) ─────

function updateAccessibilityProgressUI() {
    const el = document.getElementById('a11y-progress-indicator');
    if (!el) return;

    if (accessibilityInProgress || accessibilityQueue.length > 0) {
        el.style.display = 'flex';
        el.innerHTML = `<span class="spinner"></span> Running document checks: ${accessibilityProgress.completed} of ${accessibilityProgress.total} document${accessibilityProgress.total === 1 ? '' : 's'}…`;
    } else {
        el.style.display = 'none';
        el.innerHTML = '';
    }
}


// =============================================================================
// STRUCTURE CHECK — rendering, report modal, info modal
// =============================================================================

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
        return `<button type="button" class="a11y-badge a11y-pass" data-a11y-path="${safePath}" onclick="event.stopPropagation(); openAccessibilityReport(this.dataset.a11yPath)" title="No structure-check issues detected — click to view">${SVGS.check} Pass</button>`;
    }

    if (cached.status === 'fail') {
        const n = cached.issues.length;
        return `<button type="button" class="a11y-badge a11y-fail" data-a11y-path="${safePath}" onclick="event.stopPropagation(); openAccessibilityReport(this.dataset.a11yPath)" title="View structure check report — ${n} issue${n === 1 ? '' : 's'} found">${SVGS.x} Fail</button>`;
    }

    if (cached.status === 'unavailable') {
        return `<span class="a11y-badge a11y-na" data-a11y-path="${safePath}" title="File not found in the loaded folder">—</span>`;
    }

    return `<button type="button" class="a11y-badge a11y-error" data-a11y-path="${safePath}" onclick="event.stopPropagation(); openAccessibilityReport(this.dataset.a11yPath)" title="Structure check could not run — click for details">${SVGS.alert} Error</button>`;
}

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
const STRUCTURE_CHECK_CRITERIA = [
    { check: 'Image missing alternative text',   criterion: '1.1.1 Non-text Content',         level: 'A', appliesTo: '.docx, .pptx, .xlsx' },
    { check: 'Heading hierarchy skipped',         criterion: '1.3.1 Info and Relationships',   level: 'A', appliesTo: '.docx' },
    { check: 'Table missing header row',          criterion: '1.3.1 Info and Relationships',   level: 'A', appliesTo: '.docx' },
    { check: 'Non-descriptive link text',         criterion: '2.4.4 Link Purpose (In Context)', level: 'A', appliesTo: '.docx, .pptx' },
    { check: 'Slide missing a title placeholder', criterion: '2.4.2 Document Titled',           level: 'A', appliesTo: '.pptx' },
    { check: 'Worksheet tab uses a generic name', criterion: '2.4.2 Document Titled',           level: 'A', appliesTo: '.xlsx' }
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
            Structure Check scans each .docx, .pptx, and .xlsx file for a focused set of structural
            issues known to affect screen reader and assistive-technology users. It currently covers
            <strong>WCAG 2.1 Level A</strong> checks — it is not a full WCAG AA conformance audit
            (things like color contrast or reading order aren't checked yet). Images explicitly
            marked as decorative are correctly exempted from the alt-text check below.
        </p>
        <div style="overflow-x:auto;">
        <table class="image-list-table">
            <thead><tr><th>Check</th><th>WCAG Success Criterion</th><th>Level</th><th>Applies To</th></tr></thead>
            <tbody>
                ${STRUCTURE_CHECK_CRITERIA.map(c => `
                    <tr>
                        <td style="font-weight:500;">${escapeHtml(c.check)}</td>
                        <td style="color:var(--text-light);">${escapeHtml(c.criterion)}</td>
                        <td><span class="type-badge">${escapeHtml(c.level)}</span></td>
                        <td style="font-family:var(--code-font); font-size:0.8rem; color:var(--text-light);">${escapeHtml(c.appliesTo)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        </div>`;

    modal.classList.add('active');
};

window.closeStructureCheckInfoModal = function closeStructureCheckInfoModal(event) {
    if (event && event.target.id !== 'structure-check-info-modal') return;
    const modal = document.getElementById('structure-check-info-modal');
    if (modal) modal.classList.remove('active');
};


// =============================================================================
// FLVS FOOTER CHECK — a separate, non-WCAG branding/compliance check
// =============================================================================
// Two things are verified, each reported as its own issue when it fails:
//   1. The required FLVS copyright/trademark text appears somewhere in the
//      document's footer area.
//   2. An image in that same footer area has alt text that mentions either
//      "Brand Icon" or "Brand Logo" (case-insensitive, substring match —
//      Word/PowerPoint commonly append extra text like ", Picture" to
//      inserted icon alt text, so this deliberately isn't an exact match).

const REQUIRED_FOOTER_TEXT     = "Copyright © by Florida Virtual School. All rights reserved. Florida Virtual School, FLVS, and   are registered trademarks of Florida Virtual School, a public school district of the State of Florida.";
const ACCEPTED_ICON_ALT_PHRASES = ['brand icon', 'brand logo'];

// The actual FLVS brand icon (the pin/badge mark that sits between "and" and
// "are registered trademarks..." in the real footer). Embedded as a data URI
// so the app has no external asset dependency. Used only for *display*
// purposes below -- REQUIRED_FOOTER_TEXT above stays plain text (with a
// blank gap where the icon goes) because it's matched against real document
// content, and documents obviously don't contain this HTML.
const FOOTER_ICON_DATA_URI = 'data:image/png;base64,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';
const FOOTER_ICON_IMG_HTML = `<img src="${FOOTER_ICON_DATA_URI}" alt="Brand Icon" style="height:1em; width:auto; vertical-align:-0.15em; display:inline-block;">`;

// REQUIRED_FOOTER_TEXT with the brand icon inlined into the blank gap, for
// showing the user what the footer text/icon combination should look like.
// escapeHtml() runs first so the plain text is safe, then the (trusted,
// locally-built) icon <img> is dropped into the gap -- the gap is the only
// run of 2+ consecutive spaces in the string.
const REQUIRED_FOOTER_TEXT_DISPLAY_HTML = escapeHtml(REQUIRED_FOOTER_TEXT).replace(/\s{2,}/, ` ${FOOTER_ICON_IMG_HTML} `);

// `images` is an array of alt-text strings (descr/title) found in the footer
// area. `checkIcon: false` skips the icon requirement entirely for formats
// where we can't reliably locate footer images (currently: .xlsx — Excel
// page headers/footers use a legacy VML drawing mechanism for images that
// isn't handled here).
function evaluateFooterCheck(rawText, images, checkIcon, areaLabel) {
    const footerText = (rawText || '').trim();
    const clean         = footerText.replace(/\s+/g, ' ').trim().toLowerCase();
    const cleanRequired = REQUIRED_FOOTER_TEXT.replace(/\s+/g, ' ').trim().toLowerCase();

    const hasRequiredText = clean.includes(cleanRequired) || (
        clean.includes('copyright © by florida virtual school') &&
        clean.includes('flvs') &&
        clean.includes('registered trademarks of florida virtual school')
    );

    const issues = [];
    if (!hasRequiredText) {
        issues.push({
            title: 'Required FLVS copyright/trademark text not found',
            description: `${areaLabel} does not contain the required FLVS copyright and trademark notice.`,
            recommendation: `Add the required text in ${areaLabel.charAt(0).toLowerCase() + areaLabel.slice(1)}: "${REQUIRED_FOOTER_TEXT_DISPLAY_HTML}"`
        });
    }

    // Only check for the icon if the required copyright text was found. When
    // the copyright text is missing, the footer icon (which sits right next
    // to it) is almost always missing too — reporting both is redundant, so
    // we skip the icon check and let the missing-text issue stand alone.
    if (checkIcon && hasRequiredText) {
        const iconMatch = (images || []).some(alt => {
            const lower = alt.toLowerCase();
            return ACCEPTED_ICON_ALT_PHRASES.some(phrase => lower.includes(phrase));
        });
        if (!iconMatch) {
            const foundAlts = (images || []).map(a => a.trim()).filter(Boolean);
            issues.push({
                title: 'Footer icon missing "Brand Icon"/"Brand Logo" alt text',
                description: images && images.length
                    ? `An image was found, but its alt text (${foundAlts.length ? foundAlts.map(a => `"${a}"`).join(', ') : 'blank'}) does not mention "Brand Icon" or "Brand Logo".`
                    : `No image was found in ${areaLabel.charAt(0).toLowerCase() + areaLabel.slice(1)} to check.`,
                recommendation: 'Set the footer icon\'s alt text to include "Brand Icon" or "Brand Logo" (capitalization doesn\'t matter).'
            });
        }
    }

    return { status: issues.length ? 'fail' : 'pass', footerText, issues };
}

async function validateDocxFooterCheck(zip) {
    const parser = new DOMParser();
    const footerFiles = Object.keys(zip.files).filter(name => name.startsWith('word/footer') && name.endsWith('.xml'));

    let footerText = '';
    const images = [];
    for (const name of footerFiles) {
        const xml = await zip.files[name].async('string');
        const doc = parser.parseFromString(xml, 'application/xml');
        footerText += ' ' + Array.from(doc.getElementsByTagName('w:t')).map(t => t.textContent).join('');
        Array.from(doc.getElementsByTagName('wp:docPr')).forEach(docPr => {
            images.push(docPr.getAttribute('descr') || docPr.getAttribute('title') || '');
        });
    }
    return evaluateFooterCheck(footerText, images, true, 'The document footer');
}

async function validatePptxFooterCheck(zip) {
    const parser = new DOMParser();
    // Same broad scope as the text check above (slides + slide masters + notes) —
    // a footer icon on a master/layout is the most common real-world placement.
    const files = Object.keys(zip.files).filter(name =>
        (name.startsWith('ppt/slides/') || name.startsWith('ppt/slideMasters/') || name.startsWith('ppt/notesSlides/')) && name.endsWith('.xml')
    );

    let text = '';
    const images = [];
    for (const name of files) {
        const xml = await zip.files[name].async('string');
        const doc = parser.parseFromString(xml, 'application/xml');
        text += ' ' + Array.from(doc.getElementsByTagName('a:t')).map(t => t.textContent).join('');
        Array.from(doc.getElementsByTagName('p:cNvPr')).forEach(cNvPr => {
            images.push(cNvPr.getAttribute('descr') || cNvPr.getAttribute('title') || '');
        });
    }
    return evaluateFooterCheck(text, images, true, 'The presentation (slides, slide masters, or notes)');
}

async function validateXlsxFooterCheck(zip) {
    const parser = new DOMParser();
    let text = '';

    const sharedStrings = zip.file('xl/sharedStrings.xml');
    if (sharedStrings) {
        const xml = await sharedStrings.async('string');
        const doc = parser.parseFromString(xml, 'application/xml');
        text += ' ' + Array.from(doc.getElementsByTagName('t')).map(t => t.textContent).join(' ');
    }

    const sheetFiles = Object.keys(zip.files).filter(name => name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml'));
    for (const name of sheetFiles) {
        const xml = await zip.files[name].async('string');
        const doc = parser.parseFromString(xml, 'application/xml');
        const hf  = doc.getElementsByTagName('headerFooter')[0];
        if (hf) text += ' ' + (hf.textContent || '');
    }

    // Icon check intentionally skipped for .xlsx — see comment above evaluateFooterCheck.
    return evaluateFooterCheck(text, [], false, 'The workbook (any cell value, or the Excel print header/footer)');
}

registerFooterCheckValidator('docx', validateDocxFooterCheck);
registerFooterCheckValidator('pptx', validatePptxFooterCheck);
registerFooterCheckValidator('xlsx', validateXlsxFooterCheck);



// ── FLVS Footer Check — rendering, report modal, info modal ────────────────

function renderFooterCheckCell(doc) {
    if (!doc || !doc.path) return '';
    const safePath = escapeHtml(doc.path);

    if (!getFooterCheckValidator(doc.fileType)) {
        return `<span class="a11y-badge a11y-na" data-footer-path="${safePath}" title="Footer check isn't available yet for .${escapeHtml(doc.fileType || '')} files">—</span>`;
    }

    if (!footerCheckResultsCache.has(doc.path)) {
        return `<span class="a11y-badge a11y-pending" data-footer-path="${safePath}"><span class="spinner a11y-spinner"></span> Checking…</span>`;
    }

    return footerCheckBadgeMarkupFromCache(doc.path);
}

function footerCheckBadgeMarkupFromCache(path) {
    const safePath = escapeHtml(path);
    const cached   = footerCheckResultsCache.get(path);
    if (!cached) {
        return `<span class="a11y-badge a11y-pending" data-footer-path="${safePath}"><span class="spinner a11y-spinner"></span> Checking…</span>`;
    }

    if (cached.status === 'pass') {
        return `<button type="button" class="a11y-badge a11y-pass" data-footer-path="${safePath}" onclick="event.stopPropagation(); openFooterCheckReport(this.dataset.footerPath)" title="Required FLVS footer text and icon alt text found — click to view">${SVGS.check} Pass</button>`;
    }

    if (cached.status === 'fail') {
        const n = (cached.issues || []).length;
        return `<button type="button" class="a11y-badge a11y-fail" data-footer-path="${safePath}" onclick="event.stopPropagation(); openFooterCheckReport(this.dataset.footerPath)" title="Footer check failed — ${n} issue${n === 1 ? '' : 's'} found, click for details">${SVGS.x} Fail</button>`;
    }

    if (cached.status === 'unavailable') {
        return `<span class="a11y-badge a11y-na" data-footer-path="${safePath}" title="File not found in the loaded folder">—</span>`;
    }

    return `<button type="button" class="a11y-badge a11y-error" data-footer-path="${safePath}" onclick="event.stopPropagation(); openFooterCheckReport(this.dataset.footerPath)" title="Footer check could not run — click for details">${SVGS.alert} Error</button>`;
}

function patchFooterCheckCellsForPath(path) {
    if (typeof CSS === 'undefined' || !CSS.escape) return;
    const selector = `[data-footer-path="${CSS.escape(path)}"]`;
    document.querySelectorAll(selector).forEach(el => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = footerCheckBadgeMarkupFromCache(path);
        const newEl = wrapper.firstElementChild;
        if (newEl) el.replaceWith(newEl);
    });
}

function truncateForDisplay(text, maxLen) {
    if (!text) return '(no text found in the checked areas of this document)';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '(no text found in the checked areas of this document)';
    return trimmed.length > maxLen ? trimmed.slice(0, maxLen) + '…' : trimmed;
}

window.openFooterCheckReport = function openFooterCheckReport(path) {
    const cached = footerCheckResultsCache.get(path);
    if (!cached) return;

    const fileNameEl = document.getElementById('footer-check-report-filename');
    const body       = document.getElementById('footer-check-report-body');
    const modal      = document.getElementById('footer-check-report-modal');
    if (!body || !modal) return;

    if (fileNameEl) fileNameEl.textContent = path.split('/').pop();

    if (cached.status === 'error') {
        body.innerHTML = `
            <div class="a11y-issue-card">
                <div class="a11y-issue-title">${SVGS.alert} Footer check could not run</div>
                <p class="a11y-issue-desc">This document could not be scanned for the required footer text (it may be corrupted or in an unexpected format).</p>
            </div>`;
    } else if (cached.status === 'pass') {
        body.innerHTML = `
            <div class="a11y-report-pass" style="margin-bottom:15px;">
                ${SVGS.checkCircle} The required FLVS copyright/trademark text and footer icon alt text were both found.
            </div>
            <p style="font-size:0.85rem; color:var(--text-light); margin-bottom:6px;"><strong>Text found in checked areas:</strong></p>
            <div class="a11y-issue-recommendation" style="white-space:pre-wrap;">${escapeHtml(truncateForDisplay(cached.footerText, 800))}</div>`;
    } else {
        const issueCards = (cached.issues || []).map(issue => `
            <div class="a11y-issue-card">
                <div class="a11y-issue-title">${SVGS.x} ${escapeHtml(issue.title)}</div>
                <p class="a11y-issue-desc">${escapeHtml(issue.description)}</p>
                <div class="a11y-issue-recommendation"><strong>Recommendation:</strong> ${issue.recommendation}</div>
            </div>
        `).join('');

        body.innerHTML = `
            ${issueCards}
            <p style="font-size:0.85rem; color:var(--text-light); margin:15px 0 6px;"><strong>Text found in checked areas:</strong></p>
            <div class="a11y-issue-recommendation" style="white-space:pre-wrap;">${escapeHtml(truncateForDisplay(cached.footerText, 800))}</div>`;
    }

    modal.classList.add('active');
};

window.closeFooterCheckReportModal = function closeFooterCheckReportModal(event) {
    if (event && event.target.id !== 'footer-check-report-modal') return;
    const modal = document.getElementById('footer-check-report-modal');
    if (modal) modal.classList.remove('active');
};

function footerCheckInfoButton() {
    return `<button type="button" class="info-btn" onclick="event.stopPropagation(); openFooterCheckInfo()" title="What does the FLVS Footer Check look for?">${SVGS.info}</button>`;
}

window.openFooterCheckInfo = function openFooterCheckInfo() {
    const modal = document.getElementById('footer-check-info-modal');
    const body  = document.getElementById('footer-check-info-body');
    if (!modal || !body) return;

    body.innerHTML = `
        <p style="margin-top:0; color:var(--text-light); font-size:0.9rem;">
            This is a separate, non-WCAG check: it verifies two things in each .docx, .pptx, and
            .xlsx file. It's a district branding requirement, not an accessibility criterion —
            that's why it's reported in its own column rather than as part of Structure Check.
        </p>
        <p style="font-size:0.85rem; color:var(--text-light); margin-bottom:6px;"><strong>1. Required copyright/trademark text — checked for .docx, .pptx, and .xlsx:</strong></p>
        <div class="a11y-issue-recommendation">${REQUIRED_FOOTER_TEXT_DISPLAY_HTML}</div>
        <p style="font-size:0.85rem; color:var(--text-light); margin:12px 0 6px;"><strong>2. Footer icon alt text — checked for .docx and .pptx only:</strong></p>
        <div class="a11y-issue-recommendation">Any image found in the checked area must have alt text that mentions "Brand Icon" or "Brand Logo" (case-insensitive — e.g. "Brand Icon, Picture" passes). Images explicitly marked as decorative are exempt from needing alt text. This part is skipped for .xlsx, where footer images aren't reliably detectable — only check #1 (the required text) applies to Excel files.</div>
        <p style="font-size:0.8rem; color:var(--text-light); margin-top:12px;">
            Where each format is checked for the required text:<br>
            • <strong>.docx</strong> — the document's actual page footer(s).<br>
            • <strong>.pptx</strong> — slide content, slide masters, and speaker notes.<br>
            • <strong>.xlsx</strong> — any cell value anywhere in the workbook, <em>and</em> the actual Excel print header/footer (Page Layout → Header &amp; Footer). Either location counts — the text doesn't need to be in a printed footer specifically for Excel files.
        </p>`;

    modal.classList.add('active');
};

window.closeFooterCheckInfoModal = function closeFooterCheckInfoModal(event) {
    if (event && event.target.id !== 'footer-check-info-modal') return;
    const modal = document.getElementById('footer-check-info-modal');
    if (modal) modal.classList.remove('active');
};


// =============================================================================
// DOCX VALIDATOR (Structure Check)
// =============================================================================

// Word/PowerPoint/Excel all use the same DrawingML extension to mark an
// image as decorative (Alt Text pane → "Mark as decorative"): an
// <adec:decorative val="1"/> element nested inside the image's <a:extLst>.
// A decorative image is WCAG-compliant *without* alt text — screen readers
// should skip it entirely — so it must never be flagged as "missing alt text".
function isDecorativeImage(el) {
    return Array.from(el.getElementsByTagName('adec:decorative')).some(d => d.getAttribute('val') === '1' || d.getAttribute('val') === 'true');
}

const VAGUE_LINK_PHRASES = new Set([
    'click here', 'here', 'link', 'this link', 'read more', 'more', 'more info',
    'learn more', 'website', 'url', 'go to'
]);

// =============================================================================
// PERSONAL INFORMATION METADATA CHECK (shared across all Structure Check
// validators below)
// =============================================================================
//
// Office documents keep an author name and a last-modified-by name in their
// document properties (docProps/core.xml) — and sometimes a manager name
// (docProps/app.xml) — even after every visible piece of content has been
// scrubbed. This mirrors Word/PowerPoint/Excel's own "Inspect Document >
// Document Properties and Personal Information" feature, checking the same
// fields, and folds a single issue into whichever validator calls it if any
// of them are still populated.
//
// Per the requirement, the actual name(s) found are never surfaced in the
// UI — only which property fields were populated.
async function checkPersonalInfoMetadata(zip) {
    const parser = new DOMParser();
    const fieldsFound = [];

    const corePart = zip.file('docProps/core.xml');
    if (corePart) {
        const xml = await corePart.async('string');
        const coreDoc = parser.parseFromString(xml, 'application/xml');
        if (!coreDoc.getElementsByTagName('parsererror').length) {
            const creator         = coreDoc.getElementsByTagName('dc:creator')[0];
            const lastModifiedBy  = coreDoc.getElementsByTagName('cp:lastModifiedBy')[0];
            if (creator && creator.textContent.trim())        fieldsFound.push('Author');
            if (lastModifiedBy && lastModifiedBy.textContent.trim()) fieldsFound.push('Last Modified By');
        }
    }

    const appPart = zip.file('docProps/app.xml');
    if (appPart) {
        const xml = await appPart.async('string');
        const appDoc = parser.parseFromString(xml, 'application/xml');
        if (!appDoc.getElementsByTagName('parsererror').length) {
            const manager = appDoc.getElementsByTagName('Manager')[0];
            if (manager && manager.textContent.trim()) fieldsFound.push('Manager');
        }
    }

    if (!fieldsFound.length) return [];

    return [{
        title: 'Personal information detected in document metadata',
        description: 'Personal information was detected in the document metadata. Remove all personal information from the document before publishing.',
        why: 'Document properties such as the author, last-modified-by, or manager name travel with the file even after the visible content has been reviewed, and can expose who created or edited it.',
        location: `Document properties (${fieldsFound.join(', ')})`,
        recommendation: 'In the source application, go to File → Info → Check for Issues → Inspect Document, select "Document Properties and Personal Information," click Inspect, then Remove All — then re-save and re-upload the file.'
    }];
}

async function validateDocxAccessibility(zip) {
    const issues = [];
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

    Array.from(body.children).forEach(node => {
        const tag = node.tagName;

        if (tag === 'w:p') {
            paraCounter++;
            const text = getText(node).trim();

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

            Array.from(node.getElementsByTagName('wp:docPr')).forEach(docPr => {
                if (isDecorativeImage(docPr)) return; // marked decorative — no alt text needed
                const descr = (docPr.getAttribute('descr') || '').trim();
                const title = (docPr.getAttribute('title') || '').trim();
                const name  = (docPr.getAttribute('name')  || '').trim();
                if (!descr && !title) {
                    issues.push({
                        title: 'Image missing alternative text',
                        description: `An image${name ? ` ("${name}")` : ''} does not have alternative text set.`,
                        why: 'Screen reader users rely on alt text to understand what an image shows and why it is there. Without it, the image is announced generically or skipped entirely.',
                        location: lastHeadingText ? `Near heading: "${lastHeadingText}"` : `Paragraph ${paraCounter}`,
                        recommendation: 'Right-click the image → Edit Alt Text, and add a concise description of the image\'s content and purpose.'
                    });
                }
            });

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

    issues.push(...await checkPersonalInfoMetadata(zip));

    return { status: issues.length ? 'fail' : 'pass', issues };
}

registerAccessibilityValidator('docx', validateDocxAccessibility);


// =============================================================================
// PPTX VALIDATOR (Structure Check)
// =============================================================================

async function validatePptxAccessibility(zip) {
    const issues = [];
    const parser = new DOMParser();

    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)\.xml$/)[1], 10);
            const nb = parseInt(b.match(/slide(\d+)\.xml$/)[1], 10);
            return na - nb;
        });

    if (!slideFiles.length) {
        return {
            status: 'fail',
            issues: [{
                title: 'Unable to read presentation contents',
                description: 'This .pptx file does not contain any readable slide parts.',
                why: 'Accessibility of the content cannot be verified if the presentation structure cannot be parsed.',
                location: '',
                recommendation: 'Re-save the file from PowerPoint (or another compliant editor) and try again.'
            }]
        };
    }

    for (const slidePath of slideFiles) {
        const slideNum = slidePath.match(/slide(\d+)\.xml$/)[1];
        const xml = await zip.files[slidePath].async('string');
        const slideDoc = parser.parseFromString(xml, 'application/xml');

        if (slideDoc.getElementsByTagName('parsererror').length) {
            issues.push({
                title: 'Could not parse this slide',
                description: `Slide ${slideNum}'s XML could not be parsed, so it could not be checked for alt text, a title, or link text.`,
                why: 'Accessibility of the content cannot be verified if the slide structure cannot be parsed.',
                location: `Slide ${slideNum}`,
                recommendation: 'Re-save the presentation from PowerPoint (or another compliant editor) and try again.'
            });
            continue;
        }

        Array.from(slideDoc.getElementsByTagName('p:pic')).forEach((pic, i) => {
            const cNvPr = pic.getElementsByTagName('p:cNvPr')[0];
            if (cNvPr && isDecorativeImage(cNvPr)) return; // marked decorative — no alt text needed
            const descr = cNvPr ? (cNvPr.getAttribute('descr') || '').trim() : '';
            const title = cNvPr ? (cNvPr.getAttribute('title') || '').trim() : '';
            const name  = cNvPr ? (cNvPr.getAttribute('name') || `Picture ${i + 1}`) : `Picture ${i + 1}`;

            if (!descr && !title) {
                issues.push({
                    title: 'Image missing alternative text',
                    description: `An image ("${name}") on slide ${slideNum} does not have alternative text set.`,
                    why: 'Screen reader users rely on alt text to understand what an image shows. Without it, the image is announced generically or skipped entirely.',
                    location: `Slide ${slideNum}`,
                    recommendation: 'Right-click the image → Edit Alt Text, and add a concise description of the image\'s content and purpose.'
                });
            }
        });

        let hasTitle = slideDoc.getElementsByTagName('p:title').length > 0;
        if (!hasTitle) {
            Array.from(slideDoc.getElementsByTagName('p:sp')).some(sp => {
                const ph = sp.getElementsByTagName('p:ph')[0];
                const type = ph ? ph.getAttribute('type') : null;
                if (type === 'title' || type === 'ctrTitle') { hasTitle = true; return true; }
                return false;
            });
        }
        if (!hasTitle) {
            issues.push({
                title: 'Slide missing a title placeholder',
                description: `Slide ${slideNum} does not have a title placeholder defined.`,
                why: 'Screen reader users rely on slide titles to navigate between slides and to identify where they are in a presentation, similar to headings in a document.',
                location: `Slide ${slideNum}`,
                recommendation: 'Use a slide layout that includes a Title placeholder, or add one via Insert → Header & Footer, then give it descriptive text (it can be sent behind other content if the design calls for it).'
            });
        }

        Array.from(slideDoc.getElementsByTagName('a:hlinkClick')).forEach(hlink => {
            const parentRun = hlink.parentNode;
            const tNode = parentRun && parentRun.getElementsByTagName
                ? parentRun.getElementsByTagName('a:t')[0]
                : null;
            const linkText = tNode ? (tNode.textContent || '').trim() : '';
            if (linkText && VAGUE_LINK_PHRASES.has(linkText.toLowerCase())) {
                issues.push({
                    title: 'Non-descriptive link text',
                    description: `A hyperlink on slide ${slideNum} uses the text "${linkText}", which does not describe where it leads.`,
                    why: 'Screen reader users often scan a list of links out of the surrounding context. Generic text like "click here" gives no indication of the link\'s destination.',
                    location: `Slide ${slideNum}`,
                    recommendation: 'Rewrite the link text to describe its destination, e.g. "Course syllabus" instead of "click here".'
                });
            }
        });
    }

    issues.push(...await checkPersonalInfoMetadata(zip));

    return { status: issues.length ? 'fail' : 'pass', issues };
}

registerAccessibilityValidator('pptx', validatePptxAccessibility);


// =============================================================================
// XLSX VALIDATOR (Structure Check)
// =============================================================================

async function validateXlsxAccessibility(zip) {
    const issues = [];
    const parser = new DOMParser();

    const workbookPart = zip.file('xl/workbook.xml');
    if (!workbookPart) {
        return {
            status: 'fail',
            issues: [{
                title: 'Unable to read workbook contents',
                description: 'This .xlsx file does not contain a readable xl/workbook.xml part.',
                why: 'Accessibility of the content cannot be verified if the workbook structure cannot be parsed.',
                location: '',
                recommendation: 'Re-save the file from Excel (or another compliant editor) and try again.'
            }]
        };
    }

    const workbookXml = await workbookPart.async('string');
    const workbookDoc = parser.parseFromString(workbookXml, 'application/xml');
    if (workbookDoc.getElementsByTagName('parsererror').length) {
        throw new Error('xl/workbook.xml could not be parsed as XML');
    }
    Array.from(workbookDoc.getElementsByTagName('sheet')).forEach(sheetEl => {
        const sheetName = (sheetEl.getAttribute('name') || '').trim();
        if (/^Sheet\d+$/i.test(sheetName)) {
            issues.push({
                title: 'Worksheet tab uses a generic name',
                description: `The worksheet tab "${sheetName}" still uses Excel's default name instead of a descriptive one.`,
                why: 'Screen reader users navigate between worksheets by tab name. A generic name like "Sheet1" gives no indication of what the tab contains.',
                location: `Worksheet tab: "${sheetName}"`,
                recommendation: 'Double-click the worksheet tab and rename it to describe its contents, e.g. "Grading Rubric" instead of "Sheet1".'
            });
        }
    });

    const drawingFiles = Object.keys(zip.files).filter(name => name.startsWith('xl/drawings/drawing') && name.endsWith('.xml'));
    for (const drawingPath of drawingFiles) {
        const xml = await zip.files[drawingPath].async('string');
        const drawingDoc = parser.parseFromString(xml, 'application/xml');
        if (drawingDoc.getElementsByTagName('parsererror').length) {
            issues.push({
                title: 'Could not parse a drawing/chart part',
                description: `${drawingPath.split('/').pop()} could not be parsed, so any images or charts it contains could not be checked for alt text.`,
                why: 'Accessibility of the content cannot be verified if the drawing structure cannot be parsed.',
                location: drawingPath.split('/').pop(),
                recommendation: 'Re-save the workbook from Excel (or another compliant editor) and try again.'
            });
            continue;
        }

        Array.from(drawingDoc.getElementsByTagName('xdr:pic')).forEach((pic, i) => {
            const cNvPr = pic.getElementsByTagName('xdr:cNvPr')[0];
            if (cNvPr && isDecorativeImage(cNvPr)) return; // marked decorative — no alt text needed
            const descr = cNvPr ? (cNvPr.getAttribute('descr') || '').trim() : '';
            const title = cNvPr ? (cNvPr.getAttribute('title') || '').trim() : '';
            const name  = cNvPr ? (cNvPr.getAttribute('name') || `Image ${i + 1}`) : `Image ${i + 1}`;

            if (!descr && !title) {
                issues.push({
                    title: 'Image missing alternative text',
                    description: `An embedded image/graphic ("${name}") does not have alternative text set.`,
                    why: 'Screen reader users rely on alt text to understand what an image or chart shows. Without it, the graphic is announced generically or skipped entirely.',
                    location: `${drawingPath.split('/').pop()}`,
                    recommendation: 'Right-click the image or chart → Edit Alt Text, and add a concise description of what it shows.'
                });
            }
        });
    }

    issues.push(...await checkPersonalInfoMetadata(zip));

    return { status: issues.length ? 'fail' : 'pass', issues };
}

registerAccessibilityValidator('xlsx', validateXlsxAccessibility);


// =============================================================================
// TITLE/TYPE CHECK — verifies that a document's title ends with the correct
// file extension in parentheses, e.g. "Guided Notes (.docx)" for a linked
// guided_notes.docx file. Unlike Structure Check / Footer Check, this needs
// no zip read or background queue — title and fileType are already known
// once a document is indexed — so it's evaluated synchronously at render
// time rather than cached in a results map. Only applies to linked
// documents (title comes from the authored link text); unlinked documents
// discovered by folder scan have no title to check.
// =============================================================================

// Matches a trailing "(.ext)" — optional whitespace before it, case-insensitive
// extension letters/digits only.
const TITLE_TYPE_EXTENSION_PATTERN = /\(\.([A-Za-z0-9]+)\)\s*$/;

// -----------------------------------------------------------------------------
// MALFORMED EXTENSION FORMAT DETECTION
//
// The strict pattern above only recognizes a fully correct "(.ext)" suffix.
// Anything else previously fell through to a generic "missing" result, even
// when the author clearly tried to add the extension marker but got the
// punctuation wrong (e.g. "Report .pdf)" or "Report (pdf)"). This section
// distinguishes those near-miss attempts from a genuinely absent extension,
// and reports exactly which piece of punctuation is wrong.
//
// Detection is anchored on the document's ACTUAL, known file extension (not
// a generic "any short alnum token" guess) for two reasons: it avoids false
// positives on ordinary titles that happen to end in a short word, and it
// means the suggested fix is always unambiguous. Only titles where at least
// one of '(', ')', or '.' appears alongside the extension text (or an empty
// parenthetical like "()"/"(.)" at the very end) are treated as a malformed
// attempt; anything else is left as the original "missing" result.
// -----------------------------------------------------------------------------

// Matches an empty parenthetical extension marker at the end: "()" or "(.)" ,
// with optional internal/surrounding whitespace.
const EMPTY_EXTENSION_PATTERN = /\(\s*\.?\s*\)\s*$/;

function detectMalformedExtensionFormat(title, fileType) {
    const trimmedTitle = (title || '').trim();
    if (!fileType) return null;

    const emptyMatch = trimmedTitle.match(EMPTY_EXTENSION_PATTERN);
    if (emptyMatch) {
        return { formatIssues: ['empty-extension'], rawMatch: emptyMatch[0].trim() };
    }

    // Anchor on the real extension text itself, allowing optional '(', a
    // leading '.', optional whitespace, optional trailing '.', and optional
    // ')' around it -- in any combination -- right at the end of the title.
    const ext = fileType.toLowerCase();
    const anchorPattern = new RegExp(
        `(\\()?\\s*(\\.)?\\s*${escapeRegExp(ext)}\\s*(\\.)?\\s*(\\))?\\s*$`, 'i'
    );
    const match = trimmedTitle.match(anchorPattern);
    if (!match) return null; // extension text isn't present near the end at all -> genuinely missing

    const [, openParen, leadingDot, trailingDot, closeParen] = match;
    const rawMatch = match[0].trim();
    const hasInternalWhitespace = /\s/.test(rawMatch);

    // A well-formed "(.ext)" (no trailing dot, no stray internal whitespace)
    // isn't a malformed case at all -- TITLE_TYPE_EXTENSION_PATTERN would
    // already have matched it as a pass.
    if (openParen && leadingDot && closeParen && !trailingDot && !hasInternalWhitespace) return null;

    // Require at least one punctuation mark or whitespace irregularity to be
    // present; a bare extension word with nothing else going on is too easily
    // an ordinary word in the title (e.g. "PDF Guide") rather than a genuine
    // formatting attempt.
    if (!openParen && !leadingDot && !trailingDot && !closeParen && !hasInternalWhitespace) return null;

    const formatIssues = [];
    if (!openParen)  formatIssues.push('missing-open-paren');
    if (trailingDot) formatIssues.push('period-wrong-position');
    else if (!leadingDot) formatIssues.push('missing-leading-period');
    if (!closeParen) formatIssues.push('missing-close-paren');
    if (hasInternalWhitespace) formatIssues.push('extra-whitespace');

    return { formatIssues, rawMatch: match[0].trim() };
}

// Composes a human-readable explanation from the detected format issues,
// e.g. "Missing opening parenthesis. Expected (.pdf)."
function describeMalformedExtension(formatIssues, fileType) {
    const expected = `(.${fileType})`;

    if (formatIssues.includes('empty-extension')) {
        return `The extension is missing or empty. Expected ${expected}.`;
    }

    const missingParts = [];
    if (formatIssues.includes('missing-open-paren'))     missingParts.push('opening parenthesis');
    if (formatIssues.includes('missing-leading-period'))  missingParts.push('leading period before the extension');
    if (formatIssues.includes('missing-close-paren'))    missingParts.push('closing parenthesis');

    const sentences = [];
    if (missingParts.length === 2 && !formatIssues.includes('missing-leading-period')) {
        // The common "no parentheses at all" case gets its own tidy phrasing.
        sentences.push(`Missing opening and closing parentheses.`);
    } else if (missingParts.length === 1) {
        sentences.push(`Missing ${missingParts[0]}.`);
    } else if (missingParts.length > 1) {
        sentences.push(`Missing ${missingParts.slice(0, -1).join(', ')} and ${missingParts[missingParts.length - 1]}.`);
    }

    if (formatIssues.includes('period-wrong-position')) {
        sentences.push(`Period is in the wrong position.`);
    }

    if (formatIssues.includes('extra-whitespace')) {
        sentences.push(`Remove the extra spacing within the extension marker.`);
    }

    sentences.push(`Expected ${expected}.`);
    return sentences.join(' ');
}

function evaluateTitleTypeCheck(doc) {
    const fileType = (doc && doc.fileType ? doc.fileType : '').toLowerCase();
    const title    = (doc && doc.title ? doc.title : '');
    const match    = title.match(TITLE_TYPE_EXTENSION_PATTERN);

    if (!match) {
        const malformed = detectMalformedExtensionFormat(title, fileType);
        if (malformed) {
            return {
                status: 'fail',
                reason: 'malformed',
                fileType,
                foundExt: null,
                formatIssues: malformed.formatIssues,
                rawMatch: malformed.rawMatch,
                message: describeMalformedExtension(malformed.formatIssues, fileType),
            };
        }
        return { status: 'fail', reason: 'missing', fileType, foundExt: null };
    }

    const foundExt = match[1].toLowerCase();
    if (foundExt !== fileType) {
        return { status: 'fail', reason: 'mismatch', fileType, foundExt };
    }

    return { status: 'pass', reason: 'match', fileType, foundExt };
}

// Builds the corrected title Claude suggests when the check fails: strips
// any existing extension suffix (well-formed, malformed, or mismatched) and
// appends the correct one.
function buildSuggestedTitle(doc, result) {
    const rawTitle = (doc && doc.title ? doc.title : '').trim();
    let withoutExt = rawTitle.replace(TITLE_TYPE_EXTENSION_PATTERN, '').trim();

    // For the malformed case, TITLE_TYPE_EXTENSION_PATTERN won't have matched
    // anything (that's exactly why it was flagged as malformed), so strip the
    // specific malformed tail that was detected instead.
    if (result && result.reason === 'malformed' && result.rawMatch && withoutExt === rawTitle) {
        const tailPattern = new RegExp(escapeRegExp(result.rawMatch) + '\\s*$');
        withoutExt = rawTitle.replace(tailPattern, '').trim();
    }

    return `${withoutExt} (.${result.fileType})`;
}

function renderTitleTypeBadge(doc) {
    if (!doc) return '';
    if (!doc.fileType) return `<span class="a11y-badge a11y-na">—</span>`;

    const result   = evaluateTitleTypeCheck(doc);
    const safePath = escapeHtml(doc.path || '');
    const label    = escapeHtml(doc.fileType.toUpperCase());

    if (result.status === 'pass') {
        return `<button type="button" class="a11y-badge a11y-pass" data-title-type-path="${safePath}" onclick="event.stopPropagation(); openTitleTypeCheckReport(this.dataset.titleTypePath)" title="Title correctly identifies the file type — click to view">${SVGS.check} ${label}</button>`;
    }

    if (result.reason === 'malformed') {
        return `<button type="button" class="a11y-badge a11y-error" data-title-type-path="${safePath}" onclick="event.stopPropagation(); openTitleTypeCheckReport(this.dataset.titleTypePath)" title="Title has a malformed file type extension — click for details">${SVGS.alert} ${label}</button>`;
    }

    return `<button type="button" class="a11y-badge a11y-fail" data-title-type-path="${safePath}" onclick="event.stopPropagation(); openTitleTypeCheckReport(this.dataset.titleTypePath)" title="Title does not correctly identify the file type — click for details">${SVGS.x} ${label}</button>`;
}

window.openTitleTypeCheckReport = function openTitleTypeCheckReport(path) {
    const doc = (courseDocuments || []).find(d => d.path === path);
    if (!doc) return;

    const result     = evaluateTitleTypeCheck(doc);
    const fileNameEl = document.getElementById('title-type-check-report-filename');
    const body       = document.getElementById('title-type-check-report-body');
    const modal      = document.getElementById('title-type-check-report-modal');
    if (!body || !modal) return;

    if (fileNameEl) fileNameEl.textContent = doc.fileName || doc.title || '';

    if (result.status === 'pass') {
        body.innerHTML = `
            <div class="a11y-report-pass">
                ${SVGS.checkCircle} The document title correctly identifies the linked file type (.${escapeHtml(result.fileType)}).
            </div>`;
    } else if (result.reason === 'malformed') {
        const suggested = buildSuggestedTitle(doc, result);
        body.innerHTML = `
            <div class="a11y-issue-card">
                <div class="a11y-issue-title">${SVGS.alert} Malformed file type extension</div>
                <p class="a11y-issue-desc">${escapeHtml(result.message)}</p>
                <p class="a11y-issue-location"><strong>Current title:</strong> ${escapeHtml(doc.title)}</p>
                <p class="a11y-issue-location"><strong>Detected:</strong> <code>${escapeHtml(result.rawMatch)}</code></p>
                <div class="a11y-issue-recommendation"><strong>Suggested title:</strong> ${escapeHtml(suggested)}</div>
            </div>`;
    } else if (result.reason === 'missing') {
        const suggested = buildSuggestedTitle(doc, result);
        body.innerHTML = `
            <div class="a11y-issue-card">
                <div class="a11y-issue-title">${SVGS.x} Missing file type extension</div>
                <p class="a11y-issue-desc">The document title should end with (.${escapeHtml(result.fileType)}) to identify the linked document type.</p>
                <p class="a11y-issue-location"><strong>Current title:</strong> ${escapeHtml(doc.title)}</p>
                <div class="a11y-issue-recommendation"><strong>Suggested title:</strong> ${escapeHtml(suggested)}</div>
            </div>`;
    } else {
        const suggested = buildSuggestedTitle(doc, result);
        body.innerHTML = `
            <div class="a11y-issue-card">
                <div class="a11y-issue-title">${SVGS.x} Title extension does not match the linked file</div>
                <p class="a11y-issue-desc">The title ends with (.${escapeHtml(result.foundExt)}), but the linked document is a .${escapeHtml(result.fileType)} file. Update the title so the extension matches the linked document.</p>
                <p class="a11y-issue-location"><strong>Current title:</strong> ${escapeHtml(doc.title)}</p>
                <div class="a11y-issue-recommendation"><strong>Suggested title:</strong> ${escapeHtml(suggested)}</div>
            </div>`;
    }

    modal.classList.add('active');
};

window.closeTitleTypeCheckReportModal = function closeTitleTypeCheckReportModal(event) {
    if (event && event.target.id !== 'title-type-check-report-modal') return;
    const modal = document.getElementById('title-type-check-report-modal');
    if (modal) modal.classList.remove('active');
};

function titleTypeCheckInfoButton() {
    return `<button type="button" class="info-btn" onclick="event.stopPropagation(); openTitleTypeCheckInfo()" title="What does the Type column check?">${SVGS.info}</button>`;
}

window.openTitleTypeCheckInfo = function openTitleTypeCheckInfo() {
    const modal = document.getElementById('title-type-check-info-modal');
    const body  = document.getElementById('title-type-check-info-body');
    if (!modal || !body) return;

    body.innerHTML = `
        <p style="margin-top:0; color:var(--text-light); font-size:0.9rem;">
            This validation ensures that each document title accurately identifies the linked file
            type. Titles should end with the document extension enclosed in parentheses (for
            example, <strong>(.docx)</strong> or <strong>(.pdf)</strong>). This helps students
            understand what type of file will open before selecting the link and promotes
            consistency throughout the course.
        </p>
        <p style="color:var(--text-light); font-size:0.9rem;">
            An amber warning badge (${SVGS.alert}) means the extension is present but the
            punctuation is off — e.g. a missing parenthesis or a misplaced period — and the
            report will show exactly what to fix. A red badge (${SVGS.x}) means the extension
            is missing entirely or doesn't match the linked file.
        </p>`;

    modal.classList.add('active');
};

window.closeTitleTypeCheckInfoModal = function closeTitleTypeCheckInfoModal(event) {
    if (event && event.target.id !== 'title-type-check-info-modal') return;
    const modal = document.getElementById('title-type-check-info-modal');
    if (modal) modal.classList.remove('active');
};

// Title/Type Check only applies to linked documents — unlinked files have
// no `title` field to check an extension marker against.
if (typeof registerDownloadsFlagPredicate === 'function') {
    registerDownloadsFlagPredicate(doc => doc.title ? evaluateTitleTypeCheck(doc).status === 'fail' : false);
}
