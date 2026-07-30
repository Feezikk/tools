// =============================================================================
// READABILITY.JS
// Flesch-Kincaid style readability scoring/parsing and the Readability Dashboard UI (rendering, filtering, exporting the report).
// =============================================================================


function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;
    
    // Heuristic syllable counter: strip silent endings, count vowel groups
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const syllables = word.match(/[aeiouy]+/g);
    return syllables ? syllables.length : 1;
}

function analyzeTextReadability(text) {
    if (!text || !text.trim()) {
        return { words: 0, sentences: 0, syllables: 0, longSentences: [], fkGrade: 0 };
    }

    // FIX: Convert block-level HTML tags and line breaks into periods BEFORE stripping HTML.
    // This ensures list items, headers, and hard returns are treated as separate sentences.
    let preparedText = text.replace(/(<\/li>|<\/p>|<\/div>|<br\s*\/?>|<\/h[1-6]>|\n|\r)/gi, '. ');

    // Strip HTML, normalize whitespace, and clean up any accidental double-periods
    const cleanStr = stripHtml(preparedText)
        .replace(/\s+/g, ' ')
        .replace(/\.+/g, '.') 
        .trim();

    if (!cleanStr) return { words: 0, sentences: 0, syllables: 0, longSentences: [], fkGrade: 0 };

    // Extract sentences using punctuation boundaries (requires space or end of string after punctuation)
    const sentenceMatches = cleanStr.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [cleanStr];
    let totalSentences = sentenceMatches.length;
    let totalWords = 0;
    let totalSyllables = 0;
    const longSentences = [];

    // Get current maximum sentence length threshold from UI
    const currentGradeObj = window.getCurrentGradeThresholds();
    const maxSentenceLen = currentGradeObj.maxWords;

    sentenceMatches.forEach(sentence => {
        const words = sentence.match(/\b[a-zA-Z0-9_]+\b/g) || [];
        const wordCount = words.length;
        if (wordCount === 0) return;
        
        totalWords += wordCount;
        
        // Flag sentences exceeding cognitive overload limit
        if (wordCount > maxSentenceLen) {
            longSentences.push({ text: sentence.trim(), count: wordCount });
        }
        
        words.forEach(word => {
            totalSyllables += countSyllables(word);
        });
    });

    if (totalWords === 0) return { words: 0, sentences: 0, syllables: 0, longSentences: [], fkGrade: 0 };
    if (totalSentences === 0) totalSentences = 1;

    // Standard Flesch-Kincaid Grade Level Formula
    let fkGrade = 0.39 * (totalWords / totalSentences) + 11.8 * (totalSyllables / totalWords) - 15.59;
    
    // Clamp at 0 and round to 1 decimal place
    fkGrade = Math.max(0, Math.round(fkGrade * 10) / 10); 

    return {
        words: totalWords,
        sentences: totalSentences,
        syllables: totalSyllables,
        longSentences: longSentences,
        fkGrade: fkGrade
    };
}
	
window.buildReadabilityHierarchy = function() {
    readabilityHierarchy = {
        title: customCourseName || extractedCourseTitle || "Course Metrics",
        type: "course",
        words: 0, sentences: 0, syllables: 0, longSentences: [],
        children: {} 
    };

    if (!courseTree || !courseTree.modules) return;

    // 1. Scaffold the Hierarchy (Segment -> Module -> Lesson)
    courseTree.modules.forEach(mod => {
        const segVal = parseInt(mod.seg, 10);
        
        // Strict filter: Only include segment 1 or 2
        if (segVal !== 1 && segVal !== 2) return; 

        const segKey = `Segment ${segVal}`;
        if (!readabilityHierarchy.children[segKey]) {
            readabilityHierarchy.children[segKey] = {
                title: segKey, type: "segment",
                words: 0, sentences: 0, syllables: 0, longSentences: [],
                children: {}
            };
        }
        const segNode = readabilityHierarchy.children[segKey];

        const modNum = padNum(mod.num);
        const modKey = `Module ${modNum}`;
        segNode.children[modKey] = {
            title: `Module ${modNum}: ${mod.title}`, type: "module",
            words: 0, sentences: 0, syllables: 0, longSentences: [],
            children: {}
        };
        const modNode = segNode.children[modKey];

        (mod.lessons || []).forEach(lesson => {
            const lesNum = padNum(lesson.num);
            const fullLesID = `${modNum}.${lesNum}`;
            const lesKey = `Lesson ${fullLesID}`;
            
            modNode.children[lesKey] = {
                title: `${fullLesID} ${lesson.title}`, type: "lesson",
                words: 0, sentences: 0, syllables: 0, longSentences: [],
                children: [] // Pages will be an array
            };
        });
    });

    // 2. Map Indexed Content to the Scaffold
    courseIndex.forEach(item => {
        // Skip interactives from global pacing metrics to avoid skewing standard page read times
        if (item.isInteractive) return; 

        const parts = item.locationId.split('.');
        if (parts.length < 3) return;
        
        const modNum = parts[0];
        const lesNum = parts[1];
        const pgNum  = parts[2];
        
        // Ensure module matches the seg 1/2 criteria
        const modMatch = courseTree.modules.find(m => padNum(m.num) === modNum);
        if (!modMatch) return;
        const segVal = parseInt(modMatch.seg, 10);
        if (segVal !== 1 && segVal !== 2) return;

        const segKey = `Segment ${segVal}`;
        const modKey = `Module ${modNum}`;
        const lesKey = `Lesson ${modNum}.${lesNum}`;

        const segNode = readabilityHierarchy.children[segKey];
        if (!segNode) return;
        const modNode = segNode.children[modKey];
        if (!modNode) return;
        const lesNode = modNode.children[lesKey];
        if (!lesNode) return;

        const excludeMedia = document.getElementById('read-exclude-media')?.checked || false;

        // Combine all extracted RAW text streams so the analyzer can see the HTML tags
        let fullText = (item.normalRaw || "") + " " + (item.mlRaw || "") + " " + (item.noteRaw || "");
        if (!excludeMedia) {
            fullText += " " + (item.mediaRaw || "");
        }
        
        const metrics = analyzeTextReadability(fullText);

        // Assign Page
        lesNode.children.push({
            title: `Page ${pgNum}`,
            type: "page", locationId: item.locationId, filename: item.filename,
            words: metrics.words, sentences: metrics.sentences, syllables: metrics.syllables,
            longSentences: metrics.longSentences, fkGrade: metrics.fkGrade
        });

        // Roll up to Lesson
        lesNode.words += metrics.words; lesNode.sentences += metrics.sentences;
        lesNode.syllables += metrics.syllables; lesNode.longSentences.push(...metrics.longSentences);
        
        // Roll up to Module
        modNode.words += metrics.words; modNode.sentences += metrics.sentences;
        modNode.syllables += metrics.syllables; modNode.longSentences.push(...metrics.longSentences);
        
        // Roll up to Segment
        segNode.words += metrics.words; segNode.sentences += metrics.sentences;
        segNode.syllables += metrics.syllables; segNode.longSentences.push(...metrics.longSentences);
        
        // Roll up to Course
        readabilityHierarchy.words += metrics.words; readabilityHierarchy.sentences += metrics.sentences;
        readabilityHierarchy.syllables += metrics.syllables; readabilityHierarchy.longSentences.push(...metrics.longSentences);
    });

    // 3. Final Pass: Calculate Aggregated Flesch-Kincaid Scores
    function calcAgg(node) {
        if (node.type !== "page") {
            let sents = node.sentences === 0 ? 1 : node.sentences;
            let fk = 0.39 * (node.words / sents) + 11.8 * (node.syllables / node.words) - 15.59;
            node.fkGrade = node.words === 0 ? 0 : Math.max(0, Math.round(fk * 10) / 10);
            
            if (Array.isArray(node.children)) {
                node.children.forEach(calcAgg);
            } else {
                Object.values(node.children).forEach(calcAgg);
            }
        }
    }
    calcAgg(readabilityHierarchy);
};
	

window.getCurrentGradeThresholds = function() {
    const targetSelect = document.getElementById('target-grade-select');
    const val = targetSelect ? targetSelect.value : 'high';
    
    if (val === 'custom') {
        const maxG = parseFloat(document.getElementById('custom-max').value) || 12;
        const minG = parseFloat(document.getElementById('custom-min').value) || 0;
        
        // Dynamically assign sentence leniency and reading speed based on the requested maximum grade
        let calcWpm = 250;
        let calcMaxWords = 30;
        
        if (maxG < 3) { calcWpm = 80; calcMaxWords = 12; }
        else if (maxG < 6) { calcWpm = 130; calcMaxWords = 15; }
        else if (maxG < 9) { calcWpm = 170; calcMaxWords = 20; }
        else if (maxG < 13) { calcWpm = 220; calcMaxWords = 25; }

        return {
            name: "Custom Range",
            wpm: calcWpm,
            maxWords: calcMaxWords,
            targetMin: minG,
            targetMax: maxG
        };
    }
    return GRADE_LEVEL_THRESHOLDS[val];
};

window.updateReadabilitySettings = function() {
        const targetSelect = document.getElementById('target-grade-select');
        const customDiv = document.getElementById('custom-grade-inputs');
        if (customDiv && targetSelect) {
            customDiv.style.display = targetSelect.value === 'custom' ? 'flex' : 'none';
        }
        
        // Changing the settings alters how we flag long sentences, so we must rebuild the hierarchy
        if (courseIndex && courseIndex.length > 0) {
            buildReadabilityHierarchy();
            renderReadabilityDashboard();
        }
        
        // Re-calculate the sticky header offset since the control panel height may have changed
        setTimeout(updateStickyHeaderOffset, 50);
    };
	
window.renderReadabilityDashboard = function() {
    const container = document.getElementById('readability-grid-container');
    if (!container) return;

    // Capture the exact expand/collapse state before redrawing the table
    const expandedState = new Map();
    const hiddenState = new Set();
    container.querySelectorAll('.readability-row').forEach(row => {
        const titleEl = row.querySelector('span[style="font-weight:inherit;"]');
        if (titleEl) {
            const title = titleEl.textContent;
            expandedState.set(title, row.dataset.expanded === "true");
            if (row.classList.contains('hidden-row')) hiddenState.add(title);
        }
    });

    if (!readabilityHierarchy || !readabilityHierarchy.children || Object.keys(readabilityHierarchy.children).length === 0) {
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#999;">No readability data available. Please ensure a valid course is loaded.</div>';
        return;
    }

    const currentGradeObj = window.getCurrentGradeThresholds();
    const filterSelect = document.getElementById('readability-filter-select');
    const currentFilter = filterSelect ? filterSelect.value : 'all';

    // Helper to check if a specific node has the filtered issue
    function nodeHasIssue(n) {
        if (currentFilter === 'all') return true;
        const isHighGrade = n.fkGrade > currentGradeObj.targetMax;
        const hasLongSents = n.longSentences && n.longSentences.length > 0;
        
        if (currentFilter === 'grade') return isHighGrade;
        if (currentFilter === 'sentences') return hasLongSents;
        if (currentFilter === 'flagged') return isHighGrade || hasLongSents;
        return true;
    }

    // Recursive helper to check if a node or ANY of its children have the issue
    function branchHasIssue(n) {
        if (currentFilter === 'all') return true;
        if (nodeHasIssue(n)) return true;
        if (n.children) {
            if (Array.isArray(n.children)) {
                return n.children.some(c => branchHasIssue(c));
            } else {
                return Object.values(n.children).some(c => branchHasIssue(c));
            }
        }
        return false;
    }
    
    // Contextual Header for F-K Grade
    const targetRangeText = `Target: ${currentGradeObj.targetMin} - ${currentGradeObj.targetMax}`;

    let html = `
        <div class="readability-row readability-header-row">
            <div>Content Hierarchy</div>
            <div class="r-metric" title="Calculated using Flesch-Kincaid formula">F-K Grade <br><span style="font-size:0.65rem; opacity:0.8;">(${targetRangeText})</span></div>
            <div class="r-metric">Total Words</div>
            <div class="r-metric" title="Based on ${currentGradeObj.wpm} WPM">Est. Read Time</div>
            <div class="r-metric" title="Sentences > ${currentGradeObj.maxWords} words">Long Sentences</div>
        </div>
    `;

    let rowIdCounter = 0;

    function buildRow(node, levelClass, parentId = '') {
        // Drop this entire branch if it doesn't match the active filter
        if (!branchHasIssue(node)) return;

        const currentId = `r-row-${rowIdCounter++}`;
        const hasChildren = (node.children && Object.keys(node.children).length > 0) || (Array.isArray(node.children) && node.children.length > 0);
        
        // Heatmap Badge Logic for Grade Level
        let gradeBadge = 'r-badge-good';
        let isHigh = false; // Flag to trigger page-level context
        
        if (node.fkGrade < currentGradeObj.targetMin) {
            // Below target (too easy). Safe, so it's a neutral gray.
            gradeBadge = 'r-badge-low';
        } else if (node.fkGrade > currentGradeObj.targetMax) {
            isHigh = true;
            // Calculate how far over the max they went
            const variance = node.fkGrade - currentGradeObj.targetMax;
            
            if (variance <= 1.5) {
                // Slightly high (+1.5 grade levels over). Light warning.
                gradeBadge = 'r-badge-high-1';
            } else {
                // Very high (> 1.5 grade levels over). Danger!
                gradeBadge = 'r-badge-high-2';
            }
        }

        /// Est Time Logic
        const readTimeMins = Math.ceil(node.words / currentGradeObj.wpm);
        const timeText = readTimeMins > 0 ? `${readTimeMins} min${readTimeMins !== 1 ? 's' : ''}` : '< 1 min';
        
        // Overload Logic: 0 is unbadged, > 0 is yellow, > 5 is red.
        let overloadHtml = node.longSentences.length;
        let hasOverload = false;
        if (node.longSentences.length > 5) {
            overloadHtml = `<span class="r-metric-badge r-badge-high-2">${node.longSentences.length}</span>`;
            hasOverload = true;
        } else if (node.longSentences.length > 0) {
            overloadHtml = `<span class="r-metric-badge r-badge-high-1">${node.longSentences.length}</span>`;
            hasOverload = true;
        }

        const toggleBtn = hasChildren 
            ? `<button class="r-toggle-btn" onclick="toggleReadabilityRow('${currentId}')">▼</button>` 
            : `<span style="display:inline-block; width:20px;"></span>`;

        // Determine the visual icon based on the node level
        let typeIcon = '';
        if (node.type === 'course') {
            typeIcon = `<span style="opacity:0.9; margin-right:8px; display:inline-flex; width:1.2em; height:1.2em; vertical-align:middle;">${SVGS.map}</span>`;
        } else if (node.type === 'segment') {
            typeIcon = `<span style="opacity:0.6; margin-right:8px; display:inline-flex; width:1.2em; height:1.2em; vertical-align:middle;">${SVGS.layers}</span>`;
        } else if (node.type === 'module') {
            typeIcon = `<span style="opacity:0.8; color:var(--primary); margin-right:8px; display:inline-flex; width:1.2em; height:1.2em; vertical-align:middle;">${SVGS.folder}</span>`;
        } else if (node.type === 'lesson') {
            typeIcon = `<span style="opacity:0.6; color:var(--text); margin-right:8px; display:inline-flex; width:1.1em; height:1.1em; vertical-align:middle;">${SVGS.folder}</span>`;
        } else if (node.type === 'page') {
            typeIcon = `<span style="opacity:0.5; margin-right:8px; display:inline-flex; width:1.1em; height:1.1em; vertical-align:middle;">${SVGS.fileText}</span>`;
        }

        // Show context if the F-K score is high, if it's getting close to the ceiling, OR if there are overloaded sentences
        let isGettingClose = (currentGradeObj.targetMax - node.fkGrade) <= 2.5; 
        let showContext = node.type === 'page' && (isHigh || isGettingClose || hasOverload);

        // Contextual analysis for pages
        let contextHtml = '';
        if (showContext) {
            const avgWps = (node.words / (node.sentences || 1)).toFixed(1);
            const avgSpw = (node.syllables / (node.words || 1)).toFixed(2);
            
            // Package all stats to send to the modal
            const statsObj = {
                title: node.locationId || node.title,
                fkGrade: node.fkGrade.toFixed(1),
                targetMin: currentGradeObj.targetMin,
                targetMax: currentGradeObj.targetMax,
                maxWords: currentGradeObj.maxWords, // <-- Added this
                words: node.words,
                sentences: node.sentences,
                syllables: node.syllables,
                avgWps: avgWps,
                avgSpw: avgSpw,
                longSentences: node.longSentences 
            };
            const encStats = encodeURIComponent(JSON.stringify(statsObj)).replace(/'/g, "%27");
            
            contextHtml = `<button style="background:none; border:none; padding:0; margin-left:8px; cursor:pointer; color:var(--primary); opacity: 0.7; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" onclick="openReadabilityStatsModal('${encStats}')" title="View Detailed Readability Stats">
                              <svg class="svg-icon" viewBox="0 0 24 24" style="width:1.1em;height:1.1em;vertical-align:text-bottom;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                           </button>`;
        }

        html += `
            <div class="readability-row ${levelClass}" id="${currentId}" data-parent="${parentId}" data-expanded="true">
                <div style="display:flex; align-items:center; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;" title="${escapeHtml(node.title)}">
                    ${toggleBtn} ${typeIcon} <span style="font-weight:inherit;">${escapeHtml(node.title)}</span> ${contextHtml}
                </div>
                <div class="r-metric"><span class="r-metric-badge ${gradeBadge}">${node.fkGrade.toFixed(1)}</span></div>
                <div class="r-metric">${node.words.toLocaleString()}</div>
                <div class="r-metric">${timeText}</div>
                <div class="r-metric">${overloadHtml}</div>
            </div>
        `;

        // Recurse children
        if (hasChildren) {
            if (Array.isArray(node.children)) {
                node.children.forEach(child => buildRow(child, 'r-level-page', currentId));
            } else {
                Object.values(node.children).forEach(child => {
                    let nextClass = 'r-level-segment';
                    if (child.type === 'module') nextClass = 'r-level-module';
                    else if (child.type === 'lesson') nextClass = 'r-level-lesson';
                    buildRow(child, nextClass, currentId);
                });
            }
        }
    }

    // Pass the entire course hierarchy as the root row, which will automatically recurse into its children!
        buildRow(readabilityHierarchy, 'r-level-course', 'root');
        container.innerHTML = html;
        
        // 1. Apply the global state as a baseline (catches any brand new rows if you changed the dropdown filter)
        if (typeof isAllReadabilityExpanded !== 'undefined') {
            toggleAllReadability(isAllReadabilityExpanded);
        }

        // 2. Restore the exact expand/collapse state of every row you previously tracked
        if (expandedState.size > 0) {
            container.querySelectorAll('.readability-row').forEach(row => {
                const titleEl = row.querySelector('span[style="font-weight:inherit;"]');
                if (titleEl) {
                    const title = titleEl.textContent;
                    if (expandedState.has(title)) {
                        const isExpanded = expandedState.get(title);
                        row.dataset.expanded = isExpanded ? "true" : "false";
                        
                        const btn = row.querySelector('.r-toggle-btn');
                        if (btn) btn.style.transform = isExpanded ? "rotate(0deg)" : "rotate(-90deg)";
                        
                        if (hiddenState.has(title)) {
                            row.classList.add('hidden-row');
                        } else {
                            row.classList.remove('hidden-row');
                        }
                    }
                }
            });
        }
    };

window.toggleReadabilityRow = function(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const btn = row.querySelector('.r-toggle-btn');
    const isExpanded = row.dataset.expanded === "true";
    
    row.dataset.expanded = isExpanded ? "false" : "true";
    if (btn) btn.style.transform = isExpanded ? "rotate(-90deg)" : "rotate(0deg)";

    const allRows = document.querySelectorAll('.readability-row');
    
    function setVisibility(parentId, show) {
        allRows.forEach(r => {
            if (r.dataset.parent === parentId) {
                if (show) r.classList.remove('hidden-row');
                else r.classList.add('hidden-row');
                const childExpanded = show && r.dataset.expanded === "true";
                setVisibility(r.id, childExpanded);
            }
        });
    }
    setVisibility(rowId, !isExpanded);
};

window.openReadabilityStatsModal = function(encStats) {
    const stats = JSON.parse(decodeURIComponent(encStats));
    const modalHeader = document.getElementById('modal-header-content');
    const modalBody   = document.getElementById('modal-body-content');

    modalHeader.innerHTML = `
            <h3 style="margin:0 0 5px 0; font-size:1.25rem; color:var(--primary);">
                📊 Readability Analysis
            </h3>
            <div style="font-size:0.85rem; color:var(--text-light);">
                <span class="id-number"># ${escapeHtml(stats.title)}</span>
            </div>`;

   let reasons = [];
    if (parseFloat(stats.avgWps) > stats.maxWords) reasons.push(`<li><strong>High Words per Sentence:</strong> Long sentences increase cognitive load. <em>(Target: &lt; ${stats.maxWords})</em></li>`);
    if (parseFloat(stats.avgSpw) > 1.5) reasons.push("<li><strong>Complex Vocabulary:</strong> High syllable count per word indicates jargon or advanced vocabulary. <em>(Target: &lt; 1.5)</em></li>");
    if (stats.longSentences.length > 0) reasons.push(`<li><strong>Overloaded Sentences:</strong> ${stats.longSentences.length} sentence(s) exceeded the maximum recommended length of <strong>${stats.maxWords} words</strong>.</li>`);

    let reasonsHtml = reasons.length > 0 
        ? `<div style="background:#fff3cd; color:#856404; padding:15px; border-radius:6px; margin-bottom:20px; border:1px solid #ffeeba;">
             <strong style="display:block; margin-bottom:8px;">Why is this score flagged?</strong>
             <ul style="margin:0; padding-left:20px; font-size:0.9rem;">${reasons.join('')}</ul>
           </div>`
        : '';

    let longSentencesHtml = '';
    if (stats.longSentences.length > 0) {
        longSentencesHtml = `
            <div style="margin-top:20px;">
                <h4 style="color:var(--primary); margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">Flagged Long Sentences (&gt; ${stats.maxWords} words)</h4>
                <div style="max-height: 250px; overflow-y: auto; background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
                    ${stats.longSentences.map(s => `
                        <div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px dashed #dee2e6; font-size:0.9rem;">
                            <span style="display:inline-block; background:#dc3545; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; font-size:0.75rem; margin-right:8px; vertical-align:top;">${s.count} words</span>
                            <span style="color:var(--text);">${escapeHtml(s.text)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    modalBody.innerHTML = `
        ${reasonsHtml}
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 20px;">
            <div style="background:#f8f9fa; border:1px solid var(--border); border-radius:8px; padding:15px; text-align:center;">
                <div style="font-size:0.75rem; text-transform:uppercase; color:var(--text-light); font-weight:700;">F-K Grade</div>
                <div style="font-size:1.5rem; color:var(--primary); font-weight:bold;">${stats.fkGrade}</div>
                <div style="font-size:0.75rem; color:var(--text-light);">Target: ${stats.targetMin} - ${stats.targetMax}</div>
            </div>
            <div style="background:#f8f9fa; border:1px solid var(--border); border-radius:8px; padding:15px; text-align:center;">
                <div style="font-size:0.75rem; text-transform:uppercase; color:var(--text-light); font-weight:700;">Avg Words/Sent</div>
                <div style="font-size:1.5rem; color:var(--primary); font-weight:bold;">${stats.avgWps}</div>
                <div style="font-size:0.75rem; color:var(--text-light);">Target: &lt; ${stats.maxWords} words</div>
            </div>
            <div style="background:#f8f9fa; border:1px solid var(--border); border-radius:8px; padding:15px; text-align:center;">
                <div style="font-size:0.75rem; text-transform:uppercase; color:var(--text-light); font-weight:700;">Avg Syl/Word</div>
                <div style="font-size:1.5rem; color:var(--primary); font-weight:bold;">${stats.avgSpw}</div>
                <div style="font-size:0.75rem; color:var(--text-light);">Target: &lt; 1.5 syls</div>
            </div>
        </div>
        ${longSentencesHtml}
    `;

    document.getElementById('media-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
};	
	
// Table initializes in an expanded state
let isAllReadabilityExpanded = true;

window.toggleAllReadabilityState = function() {
    isAllReadabilityExpanded = !isAllReadabilityExpanded;
    const btn = document.getElementById('readability-toggle-all-btn');
    if (btn) {
        btn.innerHTML = isAllReadabilityExpanded ? "Collapse All" : "Expand All";
    }
    toggleAllReadability(isAllReadabilityExpanded);
};

window.toggleAllReadability = function(expand) {
    const allRows = document.querySelectorAll('.readability-row[id]');
    allRows.forEach(row => {
        const btn = row.querySelector('.r-toggle-btn');
        row.dataset.expanded = expand ? "true" : "false";
        if (btn) btn.style.transform = expand ? "rotate(0deg)" : "rotate(-90deg)";
        if (row.dataset.parent && row.dataset.parent !== 'root') {
            if (expand) row.classList.remove('hidden-row');
            else row.classList.add('hidden-row');
        }
    });
};

window.exportReadabilityReport = function() {
    if (!readabilityHierarchy || !readabilityHierarchy.children) {
        showToast("No readability data to export.", "error"); return;
    }
    if (typeof XLSX === 'undefined') { showToast("Excel library failed to load.", "error"); return; }

    try {
        const wb = XLSX.utils.book_new();
        const { sHeader, sText, sNumber, sTitle, sHeaderLeft } = ExcelStyles;
        
        const currentGradeObj = window.getCurrentGradeThresholds();

        const rows = [
            [{ v: "Course Readability & Pacing Report", s: sTitle }],
            [{ v: "Target Grade Level", s: sHeaderLeft }, { v: currentGradeObj.name, s: sText }],
            [{ v: "Assumed Reading Speed", s: sHeaderLeft }, { v: `${currentGradeObj.wpm} WPM`, s: sText }],
            [{ v: "Max Recommended Sentence Length", s: sHeaderLeft }, { v: `${currentGradeObj.maxWords} words`, s: sText }],
            [{ v: "Export Date", s: sHeaderLeft }, { v: new Date().toLocaleString(), s: sText }],
            [],
            [
                { v: "Hierarchy Level", s: sHeader }, { v: "Title", s: sHeader },
                { v: "Flesch-Kincaid Grade", s: sHeader }, { v: "Total Words", s: sHeader },
                { v: "Est. Read Time (Mins)", s: sHeader }, { v: "Overloaded Sentences", s: sHeader }
            ]
        ];

        function addExportRow(node, levelText) {
            const readTimeMins = Math.ceil(node.words / currentGradeObj.wpm);
            rows.push([
                { v: levelText, s: sText },
                { v: node.title, s: sText },
                { v: node.fkGrade, s: sNumber },
                { v: node.words, s: sNumber },
                { v: readTimeMins, s: sNumber },
                { v: node.longSentences.length, s: sNumber }
            ]);
            
            if (node.children) {
                if (Array.isArray(node.children)) {
                    node.children.forEach(c => addExportRow(c, "Page"));
                } else {
                    Object.values(node.children).forEach(c => {
                        let nextLevel = "Segment";
                        if (c.type === 'module') nextLevel = "Module";
                        else if (c.type === 'lesson') nextLevel = "Lesson";
                        addExportRow(c, nextLevel);
                    });
                }
            }
        }

        Object.values(readabilityHierarchy.children).forEach(seg => addExportRow(seg, "Segment"));

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 15 }, { wch: 60 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 25 }];
        ws['!views'] = [{ showGridLines: false }];
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Readability Metrics"));

        const filename = customCourseName 
            ? `${customCourseName.replace(/[^a-z0-9]/gi, '_')}_Readability_Report.xlsx` 
            : "Course_Readability_Report.xlsx";
        
        downloadWorkbook(wb, filename);

    } catch (e) { showToast("Export error: " + e.message, "error"); }
};

