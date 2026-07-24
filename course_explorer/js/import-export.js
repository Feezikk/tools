// =============================================================================
// IMPORT-EXPORT.JS
// Building export artifacts (Excel workbooks, JSON, etc.) from the current course/audit data.
// =============================================================================


function parseLocDetails(locationId, breadcrumb) {
    const locParts        = locationId ? locationId.split('.') : [];
    const modId           = locParts[0] || "Unknown";
    const lesId           = locParts.length >= 2 ? `${locParts[0]}.${locParts[1]}` : "Unknown";
    const breadcrumbParts = breadcrumb ? breadcrumb.split(' > ') : [];
    const rawModTitle     = breadcrumbParts[0] || `Module ${modId}`;
    const rawLesTitle     = breadcrumbParts[1] || `Lesson ${lesId}`;
    return {
        modId, lesId,
        modTitle: rawModTitle.includes(modId) ? rawModTitle : `${modId} ${rawModTitle}`,
        lesTitle: rawLesTitle.includes(lesId) ? rawLesTitle : `${lesId} ${rawLesTitle}`
    };
}

function sortStdsByCode(stds) {
    return [...stds].sort((a, b) =>
        ((a.code !== "N/A" ? a.code : a.statement) || "")
            .localeCompare(
                (b.code !== "N/A" ? b.code : b.statement) || "",
                undefined, { numeric: true }
            )
    );
}

window.exportSearchResults = function exportSearchResults() {
    if (!currentSearchResults?.length) { showToast("No results to export.", "error"); return; }
    if (typeof XLSX === 'undefined')   { showToast("Excel library failed to load.", "error"); return; }

    try {
        const wb = XLSX.utils.book_new();
        const { sHeader, sHeaderLeft, sTitle, sText, sNumber,
                sLocation, sLessonDivider } = ExcelStyles;

        let totalHits = 0;
        const moduleBreakdown = {}, lessonBreakdown = {}, resultsByModule = {};

        currentSearchResults.forEach(res => {
            const allMatchCount =
                (res.normalMatches?.length || 0) + (res.mlMatches?.length    || 0) +
                (res.stdMatches?.length    || 0) + (res.noteMatches?.length  || 0);
            const hitsInFile = (res.isIdMatch && !allMatchCount) ? 1 : allMatchCount;
            totalHits += hitsInFile;

            const loc = parseLocDetails(res.locationId, res.breadcrumb);

            if (!moduleBreakdown[loc.modId]) {
                moduleBreakdown[loc.modId] = { hits: 0, pages: 0, title: loc.modTitle };
            }
            moduleBreakdown[loc.modId].hits  += hitsInFile;
            moduleBreakdown[loc.modId].pages += 1;

            if (!lessonBreakdown[loc.lesId]) {
                lessonBreakdown[loc.lesId] = { hits: 0, pages: 0, title: loc.lesTitle };
            }
            lessonBreakdown[loc.lesId].hits  += hitsInFile;
            lessonBreakdown[loc.lesId].pages += 1;

            if (!resultsByModule[loc.modId]) resultsByModule[loc.modId] = [];
            resultsByModule[loc.modId].push(res);
        });

        const numericSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });

        const sumRows = [
            [{ v: "Search Overview",         s: sTitle }],
            [{ v: "Search Query",            s: sHeaderLeft }, { v: currentSearchQuery,                               s: sText   }],
            [{ v: "Total Hits (Matches)",    s: sHeaderLeft }, { v: totalHits,                                        s: sNumber }],
            [{ v: "Total Files Affected",    s: sHeaderLeft }, { v: currentSearchResults.length,                      s: sNumber }],
            [{ v: "HTML View Mode",          s: sHeaderLeft }, { v: currentSearchIsHtmlMode ? "Enabled" : "Disabled", s: sText   }],
            [{ v: "Exclude Standards",       s: sHeaderLeft }, { v: activeSearchExcludeStandards ? "Yes" : "No",      s: sText   }],
            [{ v: "Exclude ML",              s: sHeaderLeft }, { v: activeSearchExcludeML        ? "Yes" : "No",      s: sText   }],
            [{ v: "Exclude Notes",           s: sHeaderLeft }, { v: activeSearchExcludeNotes     ? "Yes" : "No",      s: sText   }],
            [{ v: "Export Date",             s: sHeaderLeft }, { v: new Date().toLocaleString(),                       s: sText   }],
            [],
            [{ v: "Breakdown by Module", s: sTitle }],
            [
                { v: "Module ID",      s: sHeader },
                { v: "Module Name",    s: sHeader },
                { v: "Total Hits",     s: sHeader },
                { v: "Files Affected", s: sHeader }
            ]
        ];

        Object.keys(moduleBreakdown).sort(numericSort).forEach(modId => {
            const m = moduleBreakdown[modId];
            sumRows.push([
                { v: modId,  s: sLocation }, { v: m.title, s: sText   },
                { v: m.hits, s: sNumber   }, { v: m.pages, s: sNumber }
            ]);
        });
        sumRows.push([]);
        sumRows.push([{ v: "Breakdown by Lesson", s: sTitle }]);
        sumRows.push([
            { v: "Lesson ID",      s: sHeader }, { v: "Lesson Name",    s: sHeader },
            { v: "Total Hits",     s: sHeader }, { v: "Files Affected", s: sHeader }
        ]);
        Object.keys(lessonBreakdown).sort(numericSort).forEach(lesId => {
            const l = lessonBreakdown[lesId];
            sumRows.push([
                { v: lesId,  s: sLocation }, { v: l.title, s: sText   },
                { v: l.hits, s: sNumber   }, { v: l.pages, s: sNumber }
            ]);
        });

        const wsSummary = XLSX.utils.aoa_to_sheet(sumRows);
        wsSummary['!cols']   = [{ wch: 25 }, { wch: 45 }, { wch: 15 }, { wch: 15 }];
        wsSummary['!views']  = [{ showGridLines: false }];
        const lesBreakdownRow = 11 + Object.keys(moduleBreakdown).length;
        wsSummary['!merges'] = [
            { s: { r: 0,               c: 0 }, e: { r: 0,               c: 3 } },
            { s: { r: 9,               c: 0 }, e: { r: 9,               c: 3 } },
            { s: { r: lesBreakdownRow, c: 0 }, e: { r: lesBreakdownRow, c: 3 } }
        ];
        XLSX.utils.book_append_sheet(wb, wsSummary, safeSheetName("Search Summary"));

        const resultHeaders = [
            { v: "Location ID",    s: sHeader }, { v: "Breadcrumb",     s: sHeader },
            { v: "Filename",       s: sHeader }, { v: "Search Snippet", s: sHeader }
        ];

        Object.keys(resultsByModule).sort(numericSort).forEach(modId => {
            const rows   = [resultHeaders];
            const merges = [];
            let currentLessonId = null;

            resultsByModule[modId]
                .sort((a, b) => (a.locationId || "").localeCompare(b.locationId || "", undefined, { numeric: true }))
                .forEach(res => {
                    const loc = parseLocDetails(res.locationId, res.breadcrumb);
                    if (loc.lesId !== currentLessonId) {
                        currentLessonId = loc.lesId;
                        rows.push([
                            { v: loc.lesTitle, s: sLessonDivider },
                            { v: "",           s: sLessonDivider },
                            { v: "",           s: sLessonDivider },
                            { v: "",           s: sLessonDivider }
                        ]);
                        merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 3 } });
                    }

                    const allMatches = [];
                    res.normalMatches.forEach(idx => allMatches.push({ idx, type: 'normal', text: res.normalText }));
                    res.mlMatches.forEach(idx    => allMatches.push({ idx, type: 'ml',     text: res.mlText     }));
                    res.stdMatches.forEach(idx   => allMatches.push({ idx, type: 'std',    text: res.stdText    }));
                    res.noteMatches.forEach(idx  => allMatches.push({ idx, type: 'note',   text: res.noteText   }));

                    if (res.isIdMatch && !allMatches.length) {
                        rows.push([
                            { v: res.locationId, s: sLocation },
                            { v: res.breadcrumb, s: sText     },
                            { v: res.filename,   s: sText     },
                            { v: "[Matched by Location ID only]", s: sText }
                        ]);
                    } else {
                        allMatches.forEach(m => {
                            const pad     = currentSearchIsHtmlMode ? 80 : 60;
                            const mLen    = currentSearchQuery.length;
                            const st      = Math.max(0, m.idx - pad);
                            const en      = Math.min(m.text.length, m.idx + mLen + pad);
                            const prefix  = m.text.substring(st, m.idx);
                            const exact   = m.text.substring(m.idx, m.idx + mLen);
                            const suffix  = m.text.substring(m.idx + mLen, en);
                            const bracket = { ml: " 【 ML: ", std: " 【 STND: ", note: " 【 NOTE: " }[m.type] || " 【 ";
                            const snippet = (st > 0 ? "…" : "") +
                                            prefix + bracket + exact.toUpperCase() + " 】 " + suffix +
                                            (en < m.text.length ? "…" : "");
                            rows.push([
                                { v: res.locationId, s: sLocation },
                                { v: res.breadcrumb, s: sText     },
                                { v: res.filename,   s: sText     },
                                { v: snippet,        s: sText     }
                            ]);
                        });
                    }
                });

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']   = [{ wch: 15 }, { wch: 45 }, { wch: 30 }, { wch: 100 }];
            ws['!views']  = [{ showGridLines: false }];
            ws['!merges'] = merges;
            XLSX.utils.book_append_sheet(wb, ws,
                safeSheetName(modId === "Unknown" ? "Unknown Module" : `Module ${modId}`)
            );
        });

        const safeQuery = currentSearchQuery.replace(/[^a-z0-9\-_]/gi, '_').substring(0, 30) || "Search";
        downloadWorkbook(wb, `${safeQuery}_Search_Results.xlsx`);

    } catch (e) { showToast("Export error: " + e.message, "error"); }
};

window.exportStdsSearchResults = function exportStdsSearchResults() {
    if (!currentStdsSearchResults?.length) { showToast("No results to export.", "error"); return; }
    if (typeof XLSX === 'undefined')        { showToast("Excel library failed to load.", "error"); return; }

    try {
        const wb = XLSX.utils.book_new();
        const { sHeader, sHeaderLeft, sTitle, sText, sNumber,
                sLocation, sLessonDivider, sCode } = ExcelStyles;

        let totalHits = currentStdsSearchResults.length;
        const moduleBreakdown = {}, lessonBreakdown = {}, resultsByModule = {};
        const uniqueStatesSet = new Set();

        currentStdsSearchResults.forEach(res => {
            const loc = parseLocDetails(res.locationId, res.breadcrumb);
            uniqueStatesSet.add(res.group);

            if (!moduleBreakdown[loc.modId]) {
                moduleBreakdown[loc.modId] = { hits: 0, title: loc.modTitle, stateCounts: {} };
            }
            moduleBreakdown[loc.modId].hits += 1;
            moduleBreakdown[loc.modId].stateCounts[res.group] =
                (moduleBreakdown[loc.modId].stateCounts[res.group] || 0) + 1;

            if (!lessonBreakdown[loc.lesId]) {
                lessonBreakdown[loc.lesId] = { hits: 0, title: loc.lesTitle, stateCounts: {} };
            }
            lessonBreakdown[loc.lesId].hits += 1;
            lessonBreakdown[loc.lesId].stateCounts[res.group] =
                (lessonBreakdown[loc.lesId].stateCounts[res.group] || 0) + 1;

            if (!resultsByModule[loc.modId]) resultsByModule[loc.modId] = [];
            resultsByModule[loc.modId].push(res);
        });

        const uniqueStates  = Array.from(uniqueStatesSet).sort();
        const maxSummaryCol = 2 + uniqueStates.length;
        const numericSort   = (a, b) => a.localeCompare(b, undefined, { numeric: true });

        const queryDisplay = elements.stdsSearchInput.value.trim() || "(No Text Query)";
        const viewDisplay  = { lesson: "Lesson View (Aggregated)", table: "Table View (Aggregated)" }[currentStdsView]
                             || "Page View (All Instances)";
        const modDisplay   = activeStdsModules.size === 0 ? "All Modules"       : `${activeStdsModules.size} Selected`;
        const stateDisplay = activeStdsStates.size  === 0 ? "All States/Groups" : `${activeStdsStates.size} Selected`;

        const sumRows = [
            [{ v: "Standards Search Overview", s: sTitle }],
            [{ v: "Search Query",          s: sHeaderLeft }, { v: queryDisplay, s: sText   }],
            [{ v: "View Mode",             s: sHeaderLeft }, { v: viewDisplay,  s: sText   }],
            [{ v: "Module Filter",         s: sHeaderLeft }, { v: modDisplay,   s: sText   }],
            [{ v: "State/Group Filter",    s: sHeaderLeft }, { v: stateDisplay, s: sText   }],
            [{ v: "Total Standards Found", s: sHeaderLeft }, { v: totalHits,    s: sNumber }],
            [{ v: "Export Date",           s: sHeaderLeft }, { v: new Date().toLocaleString(), s: sText }],
            [],
            [{ v: "Breakdown by Module", s: sTitle }],
            [
                { v: "Module ID",       s: sHeader },
                { v: "Module Name",     s: sHeader },
                { v: "Total Standards", s: sHeader },
                ...uniqueStates.map(state => ({ v: state.toUpperCase(), s: sHeader }))
            ]
        ];

        Object.keys(moduleBreakdown).sort(numericSort).forEach(modId => {
            const m = moduleBreakdown[modId];
            sumRows.push([
                { v: modId,   s: sLocation }, { v: m.title, s: sText }, { v: m.hits, s: sNumber },
                ...uniqueStates.map(state => ({ v: m.stateCounts[state] || 0, s: sNumber }))
            ]);
        });
        sumRows.push([]);
        sumRows.push([{ v: "Breakdown by Lesson", s: sTitle }]);
        sumRows.push([
            { v: "Lesson ID",       s: sHeader },
            { v: "Lesson Name",     s: sHeader },
            { v: "Total Standards", s: sHeader },
            ...uniqueStates.map(state => ({ v: state.toUpperCase(), s: sHeader }))
        ]);
        Object.keys(lessonBreakdown).sort(numericSort).forEach(lesId => {
            const l = lessonBreakdown[lesId];
            sumRows.push([
                { v: lesId,   s: sLocation }, { v: l.title, s: sText }, { v: l.hits, s: sNumber },
                ...uniqueStates.map(state => ({ v: l.stateCounts[state] || 0, s: sNumber }))
            ]);
        });

        const wsSummary = XLSX.utils.aoa_to_sheet(sumRows);
        let sumCols = [{ wch: 25 }, { wch: 45 }, { wch: 20 }];
        uniqueStates.forEach(() => sumCols.push({ wch: 18 }));
        wsSummary['!cols']   = sumCols;
        wsSummary['!views']  = [{ showGridLines: false }];
        const lesBreakdownRow = 11 + Object.keys(moduleBreakdown).length;
        wsSummary['!merges'] = [
            { s: { r: 0,               c: 0 }, e: { r: 0,               c: maxSummaryCol } },
            { s: { r: 7,               c: 0 }, e: { r: 7,               c: maxSummaryCol } },
            { s: { r: 8,               c: 0 }, e: { r: 8,               c: maxSummaryCol } },
            { s: { r: lesBreakdownRow, c: 0 }, e: { r: lesBreakdownRow, c: maxSummaryCol } }
        ];
        XLSX.utils.book_append_sheet(wb, wsSummary, safeSheetName("Search Summary"));

        const groupedResultsMap = new Map();
        currentStdsSearchResults.forEach(std => {
            if (!groupedResultsMap.has(std.locationId)) {
                groupedResultsMap.set(std.locationId, {
                    locationId: std.locationId, breadcrumb: std.breadcrumb, standards: []
                });
            }
            groupedResultsMap.get(std.locationId).standards.push(std);
        });

        const snapshotRows = [[
            { v: "SECTION", s: sHeader },
            ...uniqueStates.map(state => ({ v: state.toUpperCase(), s: sHeader }))
        ]];

        Array.from(groupedResultsMap.values()).forEach(group => {
            const stdsByState = {};
            group.standards.forEach(std => {
                if (!stdsByState[std.group]) stdsByState[std.group] = [];
                stdsByState[std.group].push(std);
            });
            const row = [{ v: group.locationId, s: sLocation }];
            uniqueStates.forEach(state => {
                if (stdsByState[state]) {
                    const codesStr = sortStdsByCode(stdsByState[state]).map(s => s.code).join("\r\n");
                    row.push({ v: codesStr, s: sCode });
                } else {
                    row.push({ v: "—", s: sCode });
                }
            });
            snapshotRows.push(row);
        });

        const wsSnapshot = XLSX.utils.aoa_to_sheet(snapshotRows);
        let snapCols = [{ wch: 15 }];
        uniqueStates.forEach(() => snapCols.push({ wch: 25 }));
        wsSnapshot['!cols']   = snapCols;
        wsSnapshot['!views']  = [{ showGridLines: false }];
        wsSnapshot['!freeze'] = { xSplit: 1, ySplit: 1, topLeftCell: 'B2', activePane: 'bottomRight', state: 'frozen' };
        XLSX.utils.book_append_sheet(wb, wsSnapshot, safeSheetName("Snapshot"));

        const resultHeaders = [
            { v: "Location ID",      s: sHeader }, { v: "Breadcrumb",         s: sHeader },
            { v: "State / Group",    s: sHeader }, { v: "Standard Code",      s: sHeader },
            { v: "Standard Statement", s: sHeader }
        ];

        Object.keys(resultsByModule).sort(numericSort).forEach(modId => {
            const rows   = [resultHeaders];
            const merges = [];
            let currentLessonId = null;

            resultsByModule[modId]
                .sort((a, b) => (a.locationId || "").localeCompare(b.locationId || "", undefined, { numeric: true }))
                .forEach(res => {
                    const loc = parseLocDetails(res.locationId, res.breadcrumb);
                    if (loc.lesId !== currentLessonId) {
                        currentLessonId = loc.lesId;
                        rows.push([
                            { v: loc.lesTitle, s: sLessonDivider },
                            { v: "",           s: sLessonDivider },
                            { v: "",           s: sLessonDivider },
                            { v: "",           s: sLessonDivider },
                            { v: "",           s: sLessonDivider }
                        ]);
                        merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: 4 } });
                    }
                    rows.push([
                        { v: res.locationId, s: sLocation },
                        { v: res.breadcrumb, s: sText     },
                        { v: res.group,      s: sText     },
                        { v: res.code,       s: sCode     },
                        { v: res.statement,  s: sText     }
                    ]);
                });

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']   = [{ wch: 15 }, { wch: 45 }, { wch: 20 }, { wch: 20 }, { wch: 80 }];
            ws['!views']  = [{ showGridLines: false }];
            ws['!merges'] = merges;
            XLSX.utils.book_append_sheet(wb, ws,
                safeSheetName(modId === "Unknown" ? "Unknown Module" : `Module ${modId}`)
            );
        });

        const safeQuery = (elements.stdsSearchInput.value.trim() || "Standards_Search")
            .replace(/[^a-z0-9\-_]/gi, '_').substring(0, 30);
        downloadWorkbook(wb, `${safeQuery}_Standards_Results.xlsx`);

    } catch (e) { showToast("Export error: " + e.message, "error"); }
};

window.exportMediaReport = function exportMediaReport() {
    const expVideos = courseVideos.filter(m =>
        passesModuleFilter(m) &&
        (!activeMediaFilterMissingId || isMissingId(m.entryId)) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(m.kalturaType))
    );
    const expAudio = courseAudio.filter(m =>
        passesModuleFilter(m) &&
        (!activeMediaFilterMissingId || isMissingId(m.entryId)) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(m.kalturaType))
    );
    const expInteractives = courseInteractives.filter(m =>
        passesModuleFilter(m) &&
        (activeMediaFilterTypes.size === 0 || activeMediaFilterTypes.has(m.interactiveType))
    );
    const expImages = courseImages.filter(img => {
        if (!passesModuleFilter(img)) return false;
        if (activeMediaFilterTypes.size > 0 && !activeMediaFilterTypes.has(img.fileType)) return false;
        if (activeMediaFilterHasAlt && !img.altText.trim()) return false;
        if (activeMediaFilterHasCaption && !img.caption.trim()) return false;
        if (activeMediaFilterHasCaptionHeader && !img.captionHeader.trim()) return false;
        if (activeMediaFilterHasTextVer && !img.textVersion.trim()) return false;
        
        // Audit Check: Copyrights
        if (activeMediaFilterCheckCopyright) {
            if (img.copyright.trim() !== '') return false;
            const nameWithoutExt = img.fileName.substring(0, img.fileName.lastIndexOf('.')) || img.fileName;
            const approvedSuffixes = ['_gi', '_ts', '_flvs', '_flvs_ai', '_ai_flvs'];
            const hasApprovedSuffix = approvedSuffixes.some(suffix => nameWithoutExt.toLowerCase().endsWith(suffix));
            if (hasApprovedSuffix) return false;
        }
        
        // Audit Check: Text Versions
        if (activeMediaFilterCheckTextVer) {
            const hasTextVer = !!img.textVersion.trim();
            const hasAlt = !!img.altText.trim();
            const altContainsTextVer = img.altText.toLowerCase().includes('text version');
            
            const failsCondition1 = hasTextVer && !hasAlt;
            const failsCondition2 = altContainsTextVer && !hasTextVer;
            
            if (!failsCondition1 && !failsCondition2) return false;
        }
        
        return true;
    });

    const glossaryQuery = document.getElementById('glossary-search')?.value.toLowerCase() || '';
    const expGlossary = courseGlossary.filter(g => {
        if (activeMediaModules.size > 0 &&
            !g.locations.some(loc => activeMediaModules.has(loc.split('.')[0]))) return false;
        if (showOnlyDuplicates && g.locations.length <= 1) return false;
        if (glossaryQuery &&
            !g.title.toLowerCase().includes(glossaryQuery) &&
            !g.definition.toLowerCase().includes(glossaryQuery)) return false;
        if (activeGlossaryLetters.size > 0) {
            const letter = /[A-Z]/.test(g.title.charAt(0).toUpperCase())
                ? g.title.charAt(0).toUpperCase() : '#';
            if (!activeGlossaryLetters.has(letter)) return false;
        }
        return true;
    });

    if (!expVideos.length && !expAudio.length && !expInteractives.length && !expGlossary.length && !expImages.length) {
        showToast("No active media found to export.", "error"); return;
    }
    if (typeof XLSX === 'undefined') { showToast("Excel library failed to load.", "error"); return; }

    try {
        const wb = XLSX.utils.book_new();
        const { sHeader, sText, sLocation, sCode,
                sLocationWrap, sHighlightLoc, sHighlightText } = ExcelStyles;

        if (expImages.length) {
            const rows = [[
                { v: "Location",     s: sHeader }, { v: "File Name",    s: sHeader },
                { v: "Type",         s: sHeader }, { v: "Alt Text",     s: sHeader },
                { v: "Text Version", s: sHeader }, { v: "Caption",      s: sHeader },
                { v: "Caption Header", s: sHeader }, { v: "Copyright",  s: sHeader }
            ]];
            expImages.forEach(img => rows.push([
                { v: img.locationId    || "",  s: sLocation },
                { v: img.fileName      || "",  s: sText },
                { v: img.fileType      || "",  s: sText },
                { v: img.altText       || "—", s: sText },
                { v: img.textVersion   || "—", s: sText },
                { v: img.caption       || "—", s: sText },
                { v: img.captionHeader || "—", s: sText },
                { v: img.copyright     || "—", s: sText }
            ]));
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']  = [{ wch: 15 }, { wch: 35 }, { wch: 10 }, { wch: 40 }, { wch: 30 }, { wch: 40 }, { wch: 20 }, { wch: 40 }];
            ws['!views'] = [{ showGridLines: false }];
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Images"));
        }

        if (expVideos.length) {
            const rows = [[
                { v: "Location",   s: sHeader }, { v: "Kaltura ID", s: sHeader },
                { v: "Title",      s: sHeader }, { v: "Type",       s: sHeader }
            ]];
            expVideos.forEach(m => rows.push([
                { v: m.locationId  || "", s: sLocation },
                { v: m.entryId     || "Unknown", s: sCode },
                { v: m.title       || "", s: sText },
                { v: m.kalturaType || "", s: sText }
            ]));
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']  = [{ wch: 15 }, { wch: 15 }, { wch: 60 }, { wch: 15 }];
            ws['!views'] = [{ showGridLines: false }];
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Videos"));
        }

        if (expAudio.length) {
            const rows = [[
                { v: "Location",            s: sHeader }, { v: "Kaltura ID / Source", s: sHeader },
                { v: "Title",               s: sHeader }, { v: "Type",                s: sHeader }
            ]];
            expAudio.forEach(m => {
                let loc        = m.locationId || "";
                let idOrSource = m.entryId    || "Unknown";
                if (m.kalturaType === 'mp3') {
                    loc        = loc.replace(/\.INT-\d+/i, '');
                    idOrSource = "In Course";
                }
                rows.push([
                    { v: loc,        s: sLocation },
                    { v: idOrSource, s: sCode     },
                    { v: m.title       || "", s: sText },
                    { v: m.kalturaType || "", s: sText }
                ]);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']  = [{ wch: 15 }, { wch: 20 }, { wch: 60 }, { wch: 15 }];
            ws['!views'] = [{ showGridLines: false }];
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Audio"));
        }

        if (expInteractives.length) {
            const rows = [[
                { v: "Location",    s: sHeader }, { v: "Title",       s: sHeader },
                { v: "Folder Name", s: sHeader }, { v: "Type",        s: sHeader }
            ]];
            expInteractives.forEach(m => rows.push([
                { v: m.locationId ? m.locationId.replace(/\.INT-\d+/i, '') : "", s: sLocation },
                { v: m.title           || "", s: sText },
                { v: m.folder          || "", s: sText },
                { v: m.interactiveType || "", s: sText }
            ]));
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']  = [{ wch: 15 }, { wch: 60 }, { wch: 30 }, { wch: 20 }];
            ws['!views'] = [{ showGridLines: false }];
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Interactives"));
        }

        if (expGlossary.length) {
            const rows = [[
                { v: "Location",   s: sHeader },
                { v: "Term",       s: sHeader },
                { v: "Definition", s: sHeader }
            ]];
            expGlossary.forEach(g => {
                const isDup = g.locations?.length > 1;
                rows.push([
                    { v: g.locations ? g.locations.join('\n') : "", s: isDup ? sHighlightLoc  : sLocationWrap },
                    { v: g.title     || "",                         s: isDup ? sHighlightText : sText         },
                    { v: g.definition ? stripHtml(g.definition) : "", s: sText }
                ]);
            });
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols']  = [{ wch: 15 }, { wch: 30 }, { wch: 80 }];
            ws['!views'] = [{ showGridLines: false }];
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName("Glossary"));
        }

        const filename = customCourseName
            ? `${customCourseName.replace(/[^a-z0-9]/gi, '_')}_Media_Report.xlsx`
            : "Course_Media_Report.xlsx";
        downloadWorkbook(wb, filename);

    } catch (e) { showToast("Export error: " + e.message, "error"); }
};

window.generateSpreadsheet = function generateSpreadsheet() {
    if (typeof XLSX === 'undefined')   { showToast("Excel library failed to load.", "error"); return; }
    if (!validModules?.length)         { showToast("No modules found to export.", "error"); return; }

    try {
        const wb = XLSX.utils.book_new();
        const { sHeader, sModRow, sLesBar, sGap, sGood, sNeutral,
                sText, sTextBold, sCode } = ExcelStyles;

        const objRows    = [[
            { v: "Module",       s: sHeader }, { v: "ID",           s: sHeader },
            { v: "Lesson Title", s: sHeader }, { v: "Status",       s: sHeader },
            { v: "Topic",        s: sHeader }, { v: "Objectives",   s: sHeader }
        ]];
        const objRowMeta = [{ level: 0 }];

        validModules.forEach(mod => {
            const modNum = padNum(mod.num);
            objRows.push([
                { v: `MODULE ${modNum}: ${mod.title}`, s: sModRow },
                { v: "", s: sModRow }, { v: "", s: sModRow },
                { v: "", s: sModRow }, { v: "", s: sModRow }, { v: "", s: sModRow }
            ]);
            objRowMeta.push({ level: 0 });

            (mod.lessons || []).forEach(lesson => {
                const fullLesID      = `${modNum}.${padNum(lesson.num)}`;
                const isMissingTopic = !lesson._topic;
                const isMissingObjs  = !lesson._parsedObjectives?.length;

                let statusCell;
                if (!lesson._reqContent) {
                    statusCell = { v: "Not Required", s: sNeutral };
                } else if (isMissingTopic || isMissingObjs) {
                    const issues = [];
                    if (isMissingTopic) issues.push("Topic");
                    if (isMissingObjs)  issues.push("Objs");
                    statusCell = { v: `MISSING: ${issues.join(" & ")}`, s: sGap };
                } else {
                    statusCell = { v: "✅ OK", s: sGood };
                }

                const topicText = lesson._topic ||
                    (!lesson._reqContent ? "(Not Required)" : "MISSING");
                const objText   = lesson._parsedObjectives?.length
                    ? lesson._parsedObjectives.map(o => `• ${o}`).join("\r\n")
                    : (!lesson._reqContent ? "(Not Required)" : "MISSING");

                objRows.push([
                    { v: "Lesson",      s: sText     }, { v: fullLesID,    s: sText     },
                    { v: lesson.title,  s: sTextBold }, statusCell,
                    { v: topicText,     s: sText     }, { v: objText,      s: sText     }
                ]);
                objRowMeta.push({ level: 1, hidden: false });
            });
        });

        const wsObj = XLSX.utils.aoa_to_sheet(objRows);
        wsObj['!cols']   = [{ wch: 10 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 40 }, { wch: 60 }];
        wsObj['!rows']   = objRowMeta;
        wsObj['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
        if (!wsObj['!merges']) wsObj['!merges'] = [];
        objRows.forEach((row, idx) => {
            if (row[0].v.toString().startsWith("MODULE")) {
                wsObj['!merges'].push({ s: { r: idx, c: 0 }, e: { r: idx, c: 5 } });
            }
        });
        XLSX.utils.book_append_sheet(wb, wsObj, "Objectives Map");

        const exportStdGroups = activeStandardGroups.size > 0
            ? Array.from(activeStandardGroups).sort()
            : Array.from(courseStandardGroups).sort();
        const stdHeaderLabel = exportStdGroups.length === 1 ? "Standards Codes" : null;

        const stdBaseHeaders = [
            { v: "Module",                s: sHeader }, { v: "ID",              s: sHeader },
            { v: "Context (Lesson/Page)", s: sHeader }, { v: "Check",           s: sHeader }
        ];
        const stdDynamicHeaders = exportStdGroups.map(g => ({
            v: stdHeaderLabel || g.toUpperCase(), s: sHeader
        }));

        const stdRows    = [[...stdBaseHeaders, ...stdDynamicHeaders]];
        const stdRowMeta = [{ level: 0 }];

        validModules.forEach(mod => {
            const modNum = padNum(mod.num);
            const modRow = [
                { v: `MODULE ${modNum}: ${mod.title}`, s: sModRow },
                { v: "", s: sModRow }, { v: "", s: sModRow }, { v: "", s: sModRow },
                ...exportStdGroups.map(() => ({ v: "", s: sModRow }))
            ];
            stdRows.push(modRow);
            stdRowMeta.push({ level: 0 });

            (mod.lessons || []).forEach(lesson => {
                const fullLesID = `${modNum}.${padNum(lesson.num)}`;
                const reqStd    = lesson._reqStd;
                const isGrouped = checkIdenticalStandards(lesson.pages);

                if (isGrouped) {
                    const standards  = lesson.pages?.[0]?._parsedStandards || [];
                    const statusCell = !reqStd            ? { v: "Not Required", s: sNeutral }
                                     : !standards.length  ? { v: "❌ EMPTY",     s: sGap     }
                                                          : { v: "✅ OK",        s: sGood    };
                    const lesRow = [
                        { v: "Lesson",     s: sLesBar }, { v: fullLesID,   s: sLesBar },
                        { v: lesson.title, s: sLesBar }, statusCell,
                        ...exportStdGroups.map(group => {
                            const groupStds = sortStdsByCode(
                                standards.filter(s =>
                                    exportStdGroups.length === 1 ||
                                    ((s.group && s.group !== "N/A") ? s.group : "Uncategorized") === group
                                )
                            );
                            const codesStr = groupStds.map(s => s.code).join("\r\n");
                            return { v: codesStr || (standards.length ? "-" : "None"), s: sCode };
                        })
                    ];
                    stdRows.push(lesRow);
                    stdRowMeta.push({ level: 1 });

                } else {
                    const mixedRow = [
                        { v: "Lesson",                  s: sLesBar  },
                        { v: fullLesID,                 s: sLesBar  },
                        { v: `${lesson.title} (Mixed)`, s: sLesBar  },
                        { v: "⬇",                       s: sNeutral },
                        ...exportStdGroups.map(() => ({ v: "See pages below", s: sNeutral }))
                    ];
                    stdRows.push(mixedRow);
                    stdRowMeta.push({ level: 1 });

                    (lesson.pages || []).forEach(page => {
                        const fullPgID = `${fullLesID}.${padNum(Number(page.num) + 1)}`;
                        const stds     = page._parsedStandards || [];
                        const pgStatus = !reqStd       ? { v: "Not Required", s: sNeutral }
                                        : !stds.length ? { v: "EMPTY",        s: sGap     }
                                                       : { v: "OK",           s: sGood    };
                        const pgRow = [
                            { v: "Page",     s: sText }, { v: fullPgID,  s: sText },
                            { v: page.title, s: sText }, pgStatus,
                            ...exportStdGroups.map(group => {
                                const groupStds = sortStdsByCode(
                                    stds.filter(s =>
                                        exportStdGroups.length === 1 ||
                                        ((s.group && s.group !== "N/A") ? s.group : "Uncategorized") === group
                                    )
                                );
                                return { v: groupStds.map(s => s.code).join("\r\n") || "-", s: sCode };
                            })
                        ];
                        stdRows.push(pgRow);
                        stdRowMeta.push({ level: 1 });
                    });
                }
            });
        });

        const wsStd = XLSX.utils.aoa_to_sheet(stdRows);
        const codeColWidth = exportStdGroups.length > 2 ? 20 : 35;
        wsStd['!cols']   = [
            { wch: 15 }, { wch: 12 }, { wch: 50 }, { wch: 15 },
            ...exportStdGroups.map(() => ({ wch: codeColWidth }))
        ];
        wsStd['!rows']   = stdRowMeta;
        wsStd['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
        if (!wsStd['!merges']) wsStd['!merges'] = [];
        stdRows.forEach((row, idx) => {
            if (row[0].v.toString().startsWith("MODULE")) {
                wsStd['!merges'].push({ s: { r: idx, c: 0 }, e: { r: idx, c: 3 + exportStdGroups.length } });
            }
        });
        XLSX.utils.book_append_sheet(wb, wsStd, "Standards Map");

        const filename = customCourseName
            ? `${customCourseName.replace(/[^a-z0-9]/gi, '_')}_Audit_Maps.xlsx`
            : "Course_Audit_Maps.xlsx";
        downloadWorkbook(wb, filename);

    } catch (e) { showToast("Export error: " + e.message, "error"); }
};

