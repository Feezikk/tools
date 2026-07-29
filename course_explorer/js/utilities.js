// =============================================================================
// UTILITIES.JS
// Small, generic, dependency-free helper functions (string padding, regex escaping, HTML escaping/stripping, etc.) used throughout the app.
// =============================================================================


function padNum(num) { return (num == null) ? "00" : num.toString().padStart(2, '0'); }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtml(t) {
    if (!t) return "";
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

function stripHtml(html) {
    _stripHtmlEl.innerHTML = html.replace(/<[^>]+>/g, ' ');
    return _stripHtmlEl.textContent || _stripHtmlEl.innerText || "";
}

const isMissingId = (id) => !id || id === "Unknown" || id.trim() === "";
const safeSheetName = (name) => name.substring(0, 31).replace(/[\\/*?:\[\]]/g, '');

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type} show`;
    toast.innerHTML = `${type === 'success' ? SVGS.check : SVGS.x} <span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function downloadWorkbook(wb, filename) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob  = new Blob([wbout], { type: "application/octet-stream" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    document.body.appendChild(a);
    a.href = url; a.download = filename; a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
}

function copyTextToClipboard(text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const original   = btn.innerHTML;
        btn.innerHTML    = SVGS.check;
        btn.style.color  = '#28a745';
        setTimeout(() => { btn.innerHTML = original; btn.style.color = ''; }, 1500);
    }).catch(() => showToast("Copy failed.", "error"));
}

window.updateStickyHeaderOffset = function updateStickyHeaderOffset() {
        const auditHeader = document.querySelector('#audit-detail-area .sticky-top-wrapper');
        if (auditHeader && auditHeader.offsetParent !== null) {
            const h = auditHeader.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--header-offset', h + 'px');
            const lessonSum    = document.querySelector('summary.lesson-summary');
            const lessonHeight = lessonSum ? lessonSum.getBoundingClientRect().height : 48;
            document.documentElement.style.setProperty('--state-offset', (h + lessonHeight - 1) + 'px');
        }
        const stdsHeader = document.querySelector('#stds-search-area .sticky-top-wrapper');
        if (stdsHeader && stdsHeader.offsetParent !== null) {
            document.documentElement.style.setProperty(
                '--stds-header-offset',
                stdsHeader.getBoundingClientRect().height + 'px'
            );
        }
        const readHeader = document.querySelector('#readability-area .sticky-top-wrapper');
        if (readHeader && readHeader.offsetParent !== null) {
            document.documentElement.style.setProperty(
                '--read-header-offset',
                readHeader.getBoundingClientRect().height + 'px'
            );
        }
    };

window.toggleFilterDropdown = function toggleFilterDropdown(id, event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById(id);
    if (!dropdown) return;
    const wasShowing = dropdown.classList.contains('show');
    document.querySelectorAll('.filter-dropdown-content.show').forEach(d => d.classList.remove('show'));
    if (!wasShowing) dropdown.classList.add('show');
    if (id === 'media-filter-dropdown') isMediaFilterOpen = !wasShowing;
};
	
