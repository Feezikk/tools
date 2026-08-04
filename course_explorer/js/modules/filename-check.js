// =============================================================================
// File Name Check
//
// Validates a referenced file name (an image's src, or a download's path)
// against the required FLVS naming conventions:
//   1. No capital letters
//   2. No blank spaces
//   3. Words separated with underscores only (no hyphens or other separators)
//   4. Only one period, immediately before the file extension
//
// Used by both the Downloads and Images sections in media.js.
// =============================================================================

// Common file extensions used in course content. Used only to tell the
// difference between "words joined with periods" (e.g. lesson.image.01.png)
// and an accidental double extension (e.g. guided_notes.docx.pdf) so the
// feedback message and suggested file name are both accurate.
const KNOWN_FILE_EXTENSIONS = new Set([
    'doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'rtf',
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tif', 'tiff',
    'mp4', 'mov', 'avi', 'wmv', 'mp3', 'wav', 'm4a',
    'htm', 'html', 'zip'
]);

function evaluateFileNameCheck(fileName) {
    const name = (fileName || '').trim();
    if (!name) return { status: 'na', issues: [] };

    const issues = [];

    if (/[A-Z]/.test(name)) {
        issues.push({
            key: 'capitals',
            message: 'Contains capital letters. File names (including the extension) should use only lowercase letters.'
        });
    }

    if (/\s/.test(name)) {
        issues.push({
            key: 'spaces',
            message: 'Contains blank spaces. Separate words with an underscore ( _ ) instead.'
        });
    }

    if (/-/.test(name)) {
        issues.push({
            key: 'hyphens',
            message: 'Uses hyphens to separate words. Separate words with an underscore ( _ ) instead.'
        });
    }

    const segments    = name.split('.');
    const periodCount = segments.length - 1;

    if (periodCount > 1) {
        const precedingSegment = segments[segments.length - 2].toLowerCase();
        if (KNOWN_FILE_EXTENSIONS.has(precedingSegment)) {
            issues.push({
                key: 'multi-extension',
                message: 'Multiple file extensions detected. Only the true file extension should remain, with a single period immediately before it.'
            });
        } else {
            issues.push({
                key: 'multi-period',
                message: 'Multiple periods detected. Only one period is permitted, immediately before the file extension.'
            });
        }
    } else if (periodCount === 0) {
        issues.push({
            key: 'no-extension',
            message: 'No file extension found. Expected a single period followed by the file extension.'
        });
    }

    return { status: issues.length ? 'fail' : 'pass', issues };
}

// Cleans up a base-name segment (or list of segments that should be joined
// with underscores): lowercases, converts spaces/hyphens to underscores,
// and collapses/trims stray underscores.
function cleanFileNameSegments(segments) {
    return segments
        .map(seg => seg
            .replace(/[\s-]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase())
        .filter(Boolean)
        .join('_');
}

// Builds the corrected file name Claude suggests when the check fails.
// Walks backward from the last period, dropping any stray "extra extension"
// segments (e.g. the "docx" in "file.docx.pdf") while leaving genuine
// period-separated words (e.g. "lesson.image.01.png") intact.
function buildSuggestedFileName(fileName) {
    const name = (fileName || '').trim();
    if (!name) return '';

    const segments = name.split('.');
    if (segments.length === 1) {
        return cleanFileNameSegments(segments) || 'file';
    }

    const realExt = segments[segments.length - 1].toLowerCase();
    let baseEnd    = segments.length - 1;

    while (baseEnd >= 2 && KNOWN_FILE_EXTENSIONS.has(segments[baseEnd - 1].toLowerCase())) {
        baseEnd -= 1;
    }

    const base = cleanFileNameSegments(segments.slice(0, baseEnd)) || 'file';
    return realExt ? `${base}.${realExt}` : base;
}

// Renders the Pass/Fail badge shown in the Downloads and Images tables/cards.
// `kind` is 'image' or 'document' and is used to look the item back up when
// the badge is clicked (images are keyed by `src`, documents by `path`).
function renderFileNameBadge(item, kind) {
    if (!item) return '';

    const fileName = item.fileName || '';
    const result    = evaluateFileNameCheck(fileName);
    const idValue   = kind === 'image' ? item.src : item.path;
    const safeId    = escapeHtml(idValue || '');
    const safeKind  = kind === 'image' ? 'image' : 'document';

    if (result.status === 'na') {
        return `<span class="a11y-badge a11y-na">—</span>`;
    }

    if (result.status === 'pass') {
        return `<button type="button" class="a11y-badge a11y-pass" data-filename-id="${safeId}" data-filename-kind="${safeKind}" onclick="event.stopPropagation(); openFileNameCheckReport(this.dataset.filenameKind, this.dataset.filenameId)" title="File name follows naming conventions — click to view">${SVGS.check} Pass</button>`;
    }

    const count = result.issues.length;
    return `<button type="button" class="a11y-badge a11y-fail" data-filename-id="${safeId}" data-filename-kind="${safeKind}" onclick="event.stopPropagation(); openFileNameCheckReport(this.dataset.filenameKind, this.dataset.filenameId)" title="File name does not follow naming conventions — click for details">${SVGS.x} ${count} Issue${count > 1 ? 's' : ''}</button>`;
}

window.openFileNameCheckReport = function openFileNameCheckReport(kind, id) {
    const item = kind === 'image'
        ? (courseImages || []).find(img => img.src === id)
        : (courseDocuments || []).find(doc => doc.path === id)
          || (typeof getUnlinkedDocuments === 'function' ? getUnlinkedDocuments().find(doc => doc.path === id) : null);
    if (!item) return;

    const fileName   = item.fileName || '';
    const result      = evaluateFileNameCheck(fileName);
    const fileNameEl  = document.getElementById('filename-check-report-filename');
    const body        = document.getElementById('filename-check-report-body');
    const modal       = document.getElementById('filename-check-report-modal');
    if (!body || !modal) return;

    if (fileNameEl) fileNameEl.textContent = fileName;

    if (result.status === 'pass') {
        body.innerHTML = `
            <div class="a11y-report-pass">
                ${SVGS.checkCircle} This file name follows the required naming conventions.
            </div>`;
        modal.classList.add('active');
        return;
    }

    const suggested  = buildSuggestedFileName(fileName);
    const issuesList = result.issues.map(issue => `<li>${escapeHtml(issue.message)}</li>`).join('');

    body.innerHTML = `
        <div class="a11y-issue-card">
            <div class="a11y-issue-title">${SVGS.x} File name does not follow naming conventions</div>
            <p class="a11y-issue-location"><strong>Current file name:</strong> ${escapeHtml(fileName)}</p>
            <ul class="a11y-issue-desc" style="margin:0 0 8px 20px; padding:0;">${issuesList}</ul>
            <div class="a11y-issue-recommendation"><strong>Suggested file name:</strong> ${escapeHtml(suggested)}</div>
        </div>`;

    modal.classList.add('active');
};

window.closeFileNameCheckReportModal = function closeFileNameCheckReportModal(event) {
    if (event && event.target.id !== 'filename-check-report-modal') return;
    const modal = document.getElementById('filename-check-report-modal');
    if (modal) modal.classList.remove('active');
};

function fileNameCheckInfoButton() {
    return `<button type="button" class="info-btn" onclick="event.stopPropagation(); openFileNameCheckInfo()" title="What does the File Name check look for?">${SVGS.info}</button>`;
}

window.openFileNameCheckInfo = function openFileNameCheckInfo() {
    const modal = document.getElementById('filename-check-info-modal');
    const body  = document.getElementById('filename-check-info-body');
    if (!modal || !body) return;

    body.innerHTML = `
        <p style="margin-top:0; color:var(--text-light); font-size:0.9rem;">
            This validation checks each referenced image and download file name against the
            required naming conventions:
        </p>
        <ul style="color:var(--text-light); font-size:0.9rem; margin:0 0 10px 20px; padding:0;">
            <li>Only lowercase letters — no capitals, including in the extension.</li>
            <li>No blank spaces anywhere in the name.</li>
            <li>Words separated with an underscore ( _ ) only — no hyphens or other separators.</li>
            <li>Only one period, immediately before the file extension.</li>
        </ul>
        <p style="color:var(--text-light); font-size:0.9rem;">
            A red badge (${SVGS.x}) means one or more rules were broken — click it to see exactly
            what's wrong and a suggested corrected file name.
        </p>`;

    modal.classList.add('active');
};

window.closeFileNameCheckInfoModal = function closeFileNameCheckInfoModal(event) {
    if (event && event.target.id !== 'filename-check-info-modal') return;
    const modal = document.getElementById('filename-check-info-modal');
    if (modal) modal.classList.remove('active');
};

// File Name Check applies to every download regardless of linked/unlinked
// status or file type, so it registers unconditionally.
if (typeof registerDownloadsFlagPredicate === 'function') {
    registerDownloadsFlagPredicate(doc => evaluateFileNameCheck(doc.fileName).status === 'fail');
}
