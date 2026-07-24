// =============================================================================
// SEARCH-WORKER.JS
// Web Worker that runs the AST-based full-text search off the main thread (with a graceful main-thread fallback), plus the code that dispatches search jobs to it.
// =============================================================================


const _stripHtmlEl = document.createElement('div');
let _pendingSearchOptions = null;

function _searchWorkerBody() {
    let _index = [];

    self.onmessage = function (e) {
        if      (e.data.type === 'INIT')   { _index = e.data.index; }
        else if (e.data.type === 'SEARCH') { self.postMessage(_search(e.data.query, e.data.options)); }
    };

    function isInsideHTMLTag(text, index) {
        const lastOpen = text.lastIndexOf('<', index);
        const lastClose = text.lastIndexOf('>', index);
        const nextClose = text.indexOf('>', index);
        return (lastOpen !== -1 && lastOpen > lastClose && nextClose !== -1);
    }

    function isImageFilename(text, index) {
        let start = index;
        while (start > 0 && !/[ \n\r\t"'<>,{}[\]\\]/.test(text[start - 1])) start--;
        let end = index;
        while (end < text.length && !/[ \n\r\t"'<>,{}[\]\\]/.test(text[end])) end++;
        const token = text.substring(start, end).toLowerCase();
        return /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)(?:\?.*)?$/.test(token);
    }

    function termExists(term, textObj, isCaseSensitive, exactMatch, excludeHTML) {
        let pattern = _reEscape(term);
        if (exactMatch) pattern = `(?<=^|\\W)${pattern}(?=\\W|$)`;
        const regex = new RegExp(pattern, isCaseSensitive ? 'g' : 'gi'); 

        const checkText = (text) => {
            if (!text) return false;
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (!excludeHTML || (!isInsideHTMLTag(text, match.index) && !isImageFilename(text, match.index))) return true;
            }
            return false;
        };

        if (checkText(textObj.normalText)) return true;
        if (checkText(textObj.mlText)) return true;
        if (checkText(textObj.stdText)) return true;
        if (checkText(textObj.noteText)) return true;
        
        const queryForId = isCaseSensitive ? term : term.toLowerCase();
        if (textObj.locId && textObj.locId.includes(queryForId)) return true;

        return false;
    }

    function evaluateASTNode(node, textObj, isCaseSensitive, isWholeWord, excludeHTML) {
        if (!node) return true; 
        if (node.type === 'AND') {
            return evaluateASTNode(node.left, textObj, isCaseSensitive, isWholeWord, excludeHTML) && 
                   evaluateASTNode(node.right, textObj, isCaseSensitive, isWholeWord, excludeHTML);
        }
        if (node.type === 'OR') {
            return evaluateASTNode(node.left, textObj, isCaseSensitive, isWholeWord, excludeHTML) || 
                   evaluateASTNode(node.right, textObj, isCaseSensitive, isWholeWord, excludeHTML);
        }
        if (node.type === 'NOT') {
            return !evaluateASTNode(node.operand, textObj, isCaseSensitive, isWholeWord, excludeHTML);
        }
        if (node.type === 'TERM') {
            return termExists(node.value, textObj, isCaseSensitive, isWholeWord || node.exact, excludeHTML);
        }
        return false;
    }

    function _search(query, opts) {
        const {
            ast, isHtmlMode, isWholeWord, isCaseSensitive,
            excludePages, excludeInteractives, excludeHTML,
            excludeML, excludeStds, excludeNotes,
            activeModules, positiveTerms
        } = opts;

        if (!ast) return { results: [], totalHits: 0 };

        const activeModulesSet = new Set(activeModules);
        const MAX              = 25;

        // Create a regex for highlighting positive terms (used to find index positions)
        let hlRegex = null;
        if (positiveTerms && positiveTerms.length > 0) {
            const termsRegexStr = positiveTerms.map(t => {
                let p = _reEscape(t.value);
                if (isWholeWord || t.exact) p = `(?<=^|\\W)${p}(?=\\W|$)`;
                return p;
            }).join('|');
            hlRegex = new RegExp(`(${termsRegexStr})`, isCaseSensitive ? 'g' : 'gi');
        }

        const queryForId = isCaseSensitive ? query : query.toLowerCase();

        let totalHits = 0;
        const results = [];

        for (const item of _index) {
            if (!item.locationId) continue;

           if (activeModulesSet.size > 0 &&
                !activeModulesSet.has(item.locationId.split('.')[0])) continue;

            const isInt = item.locationId.includes('.INT-');
            if (isInt && excludeInteractives) continue;
            if (!isInt && excludePages) continue;

            // Re-combine media text into the normal text bucket specifically for search
            const nText = isHtmlMode 
                ? (item.normalRaw + (item.mediaRaw ? " " + item.mediaRaw : "")) 
                : (item.normalClean + (item.mediaClean ? " " + item.mediaClean : ""));
            const mText = !excludeML    ? (isHtmlMode ? item.mlRaw   : item.mlClean)   : '';
            const sText = !excludeStds  ? (isHtmlMode ? item.stdRaw  : item.stdClean)  : '';
            const oText = !excludeNotes ? (isHtmlMode ? item.noteRaw : item.noteClean) : '';

            if (!nText && !mText && !sText && !oText) continue;

            const idStr     = item.locationId || '';
            const isIdMatch = (isCaseSensitive ? idStr : idStr.toLowerCase()).includes(queryForId);

            const textObj = { normalText: nText, mlText: mText, stdText: sText, noteText: oText, locId: idStr };

            // excludeHTML is now passed explicitly from the UI filters
            const isMatch = evaluateASTNode(ast, textObj, isCaseSensitive, isWholeWord, excludeHTML);

            if (!isMatch && !isIdMatch) continue;

            const getMatches = (text) => {
                if (!text || !hlRegex) return [];
                hlRegex.lastIndex = 0;
                const hits = []; let m;
                while ((m = hlRegex.exec(text)) !== null) {
                    if (!excludeHTML || (!isInsideHTMLTag(text, m.index) && !isImageFilename(text, m.index))) {
                        hits.push(m.index);
                        if (hits.length >= MAX) break;
                    }
                }
                return hits;
            };

            const nm = getMatches(nText), mm = getMatches(mText);
            const sm = getMatches(sText), om = getMatches(oText);
            const combined = nm.length + mm.length + sm.length + om.length;

            if (!combined && !isIdMatch) continue;

            totalHits += (isIdMatch && !combined) ? 1 : combined;

            results.push({
                locationId:    item.locationId,
                breadcrumb:    item.breadcrumb,
                filename:      item.filename,
                normalText:    nText,  mlText:   mText,
                stdText:       sText,  noteText: oText,
                normalRaw:     item.normalRaw,
                normalClean:   item.normalClean,
                normalMatches: nm, mlMatches: mm,
                stdMatches:    sm, noteMatches: om,
                isIdMatch,
                hasML:   item.hasML,
                hasNote: item.hasNote
            });
        }

        return { results, totalHits };
    }

    function _reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
}

(function _initSearchWorker() {
    try {
        const code   = '(' + _searchWorkerBody.toString() + ')()';
        const blob   = new Blob([code], { type: 'application/javascript' });
        searchWorker = new Worker(URL.createObjectURL(blob));
        searchWorker.onmessage = (e) => _handleWorkerResults(e.data);
        searchWorker.onerror   = (err) => { console.warn('Search worker error:', err.message); };
    } catch (e) {
        console.warn('Web Worker unavailable — search will run on main thread.', e.message);
        searchWorker = null;
    }
})();

function _handleWorkerResults({ results, totalHits }) {
    if (!_pendingSearchOptions) return;
    const { isHtmlMode, isWholeWord, isCaseSensitive, positiveTerms } = _pendingSearchOptions;
    _pendingSearchOptions = null;

    if (positiveTerms && positiveTerms.length > 0) {
        const termsRegexStr = positiveTerms.map(t => {
            let p = escapeRegExp(t.value);
            if (isWholeWord || t.exact) p = `(?<=^|\\W)${p}(?=\\W|$)`;
            return p;
        }).join('|');
        currentSearchHighlightRegex = new RegExp(`(${termsRegexStr})`, isCaseSensitive ? 'g' : 'gi');
    } else {
        currentSearchHighlightRegex = null;
    }

    currentSearchResults = results;
    searchRenderCount    = 0;
    elements.results.innerHTML = '';

    if (!results.length) {
        elements.results.innerHTML =
            `<div style="text-align:center; padding:40px; color:#999;">
                <div class="flex-center" style="margin-bottom:10px; opacity:0.3;">
                    ${SVGS.search}
                </div>
                <p>No matches found for this complex query.</p>
             </div>`;
        elements.exportSearchBtn.style.display = 'none';
        elements.searchStats.style.display     = 'none';
    } else {
        renderSearchBatch();
        elements.exportSearchBtn.style.display = 'inline-flex';
        elements.searchStats.innerHTML =
            `Found ${totalHits} match${totalHits !== 1 ? 'es' : ''} ` +
            `across ${results.length} location${results.length !== 1 ? 's' : ''}`;
        elements.searchStats.style.display = 'inline-block';
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
}

function _runSearchSync(query, options) {
    const {
        ast, isHtmlMode, isWholeWord, isCaseSensitive,
        excludePages, excludeInteractives, excludeHTML,
        excludeML, excludeStds, excludeNotes,
        activeModules, positiveTerms
    } = options;

    if (!ast) {
        _handleWorkerResults({ results: [], totalHits: 0 });
        return;
    }

    const activeModSet  = new Set(activeModules);
    const MAX           = 25;

    let hlRegex = null;
    if (positiveTerms && positiveTerms.length > 0) {
        const termsRegexStr = positiveTerms.map(t => {
            let p = escapeRegExp(t.value);
            if (isWholeWord || t.exact) p = `(?<=^|\\W)${p}(?=\\W|$)`;
            return p;
        }).join('|');
        hlRegex = new RegExp(`(${termsRegexStr})`, isCaseSensitive ? 'g' : 'gi');
    }

    const queryForId = isCaseSensitive ? query : query.toLowerCase();

    function isInsideHTMLTag(text, index) {
        const lastOpen = text.lastIndexOf('<', index);
        const lastClose = text.lastIndexOf('>', index);
        const nextClose = text.indexOf('>', index);
        return (lastOpen !== -1 && lastOpen > lastClose && nextClose !== -1);
    }

    function isImageFilename(text, index) {
        let start = index;
        while (start > 0 && !/[ \n\r\t"'<>,{}[\]\\]/.test(text[start - 1])) start--;
        let end = index;
        while (end < text.length && !/[ \n\r\t"'<>,{}[\]\\]/.test(text[end])) end++;
        const token = text.substring(start, end).toLowerCase();
        return /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)(?:\?.*)?$/.test(token);
    }

    function termExists(term, textObj, isCaseSensitive, exactMatch, excludeHTML) {
        let pattern = escapeRegExp(term);
        if (exactMatch) pattern = `(?<=^|\\W)${pattern}(?=\\W|$)`;
        const regex = new RegExp(pattern, isCaseSensitive ? 'g' : 'gi'); 

        const checkText = (text) => {
            if (!text) return false;
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(text)) !== null) {
                if (!excludeHTML || (!isInsideHTMLTag(text, match.index) && !isImageFilename(text, match.index))) return true;
            }
            return false;
        };

        if (checkText(textObj.normalText)) return true;
        if (checkText(textObj.mlText)) return true;
        if (checkText(textObj.stdText)) return true;
        if (checkText(textObj.noteText)) return true;
        
        const locIdCheck = isCaseSensitive ? term : term.toLowerCase();
        if (textObj.locId && textObj.locId.includes(locIdCheck)) return true;

        return false;
    }

    function evaluateASTNode(node, textObj, isCaseSensitive, isWholeWord, excludeHTML) {
        if (!node) return true; 
        if (node.type === 'AND') {
            return evaluateASTNode(node.left, textObj, isCaseSensitive, isWholeWord, excludeHTML) && 
                   evaluateASTNode(node.right, textObj, isCaseSensitive, isWholeWord, excludeHTML);
        }
        if (node.type === 'OR') {
            return evaluateASTNode(node.left, textObj, isCaseSensitive, isWholeWord, excludeHTML) || 
                   evaluateASTNode(node.right, textObj, isCaseSensitive, isWholeWord, excludeHTML);
        }
        if (node.type === 'NOT') {
            return !evaluateASTNode(node.operand, textObj, isCaseSensitive, isWholeWord, excludeHTML);
        }
        if (node.type === 'TERM') {
            return termExists(node.value, textObj, isCaseSensitive, isWholeWord || node.exact, excludeHTML);
        }
        return false;
    }

    let totalHits = 0;
    const results = [];
    // excludeHTML is explicitly destructured from options above

    for (const item of courseIndex) {
        if (!item.locationId) continue;
        if (activeModSet.size > 0 && !activeModSet.has(item.locationId.split('.')[0])) continue;

        const isInt = item.locationId.includes('.INT-');
        if (isInt && excludeInteractives) continue;
        if (!isInt && excludePages) continue;

        // Re-combine media text into the normal text bucket specifically for search
        const nText = isHtmlMode 
            ? (item.normalRaw + (item.mediaRaw ? " " + item.mediaRaw : "")) 
            : (item.normalClean + (item.mediaClean ? " " + item.mediaClean : ""));
        const mText = !excludeML    ? (isHtmlMode ? item.mlRaw   : item.mlClean)   : '';
        const sText = !excludeStds  ? (isHtmlMode ? item.stdRaw  : item.stdClean)  : '';
        const oText = !excludeNotes ? (isHtmlMode ? item.noteRaw : item.noteClean) : '';

        if (!nText && !mText && !sText && !oText) continue;

        const idStr     = item.locationId || '';
        const isIdMatch = (isCaseSensitive ? idStr : idStr.toLowerCase()).includes(queryForId);
        
        const textObj = { normalText: nText, mlText: mText, stdText: sText, noteText: oText, locId: idStr };
        const isMatch = evaluateASTNode(ast, textObj, isCaseSensitive, isWholeWord, excludeHTML);

        if (!isMatch && !isIdMatch) continue;

        const getMatches = (text) => {
            if (!text || !hlRegex) return [];
            hlRegex.lastIndex = 0;
            const hits = []; let m;
            while ((m = hlRegex.exec(text)) !== null) {
                if (!excludeHTML || (!isInsideHTMLTag(text, m.index) && !isImageFilename(text, m.index))) {
                    hits.push(m.index);
                    if (hits.length >= MAX) break;
                }
            }
            return hits;
        };

        const nm = getMatches(nText), mm = getMatches(mText);
        const sm = getMatches(sText), om = getMatches(oText);
        const combined = nm.length + mm.length + sm.length + om.length;
        
        if (!combined && !isIdMatch) continue;

        totalHits += (isIdMatch && !combined) ? 1 : combined;
        results.push({
            locationId: item.locationId, breadcrumb: item.breadcrumb, filename: item.filename,
            normalText: nText, mlText: mText, stdText: sText, noteText: oText,
            normalRaw:  item.normalRaw, normalClean: item.normalClean,
            normalMatches: nm, mlMatches: mm, stdMatches: sm, noteMatches: om,
            isIdMatch, hasML: item.hasML, hasNote: item.hasNote
        });
    }

    _handleWorkerResults({ results, totalHits });
}

