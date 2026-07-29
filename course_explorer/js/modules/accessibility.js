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
            recommendation: `Add the required text in ${areaLabel.charAt(0).toLowerCase() + areaLabel.slice(1)}: "${REQUIRED_FOOTER_TEXT}"`
        });
    }

    if (checkIcon) {
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
                <div class="a11y-issue-recommendation"><strong>Recommendation:</strong> ${escapeHtml(issue.recommendation)}</div>
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
        <div class="a11y-issue-recommendation">${escapeHtml(REQUIRED_FOOTER_TEXT)}</div>
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

    return { status: issues.length ? 'fail' : 'pass', issues };
}

registerAccessibilityValidator('xlsx', validateXlsxAccessibility);
