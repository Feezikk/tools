'use strict';

// modules/dashboard.js
// Exam Dashboard modal: aggregates parsed questions into a
// group/complexity/points summary table.
// Depends on: state.js.

// ─────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────

function buildDashboardData(questions) {
  const byGroup = {};
  const TYPE_LABELS = {
    'mc:radio:':       'MC',
    'essay:':          'Essay',
    'fib:':            'FIB',
    'tf:':             'T/F',
    'matching:label:': 'Matching'
  };
  for (const q of questions) {
    if (q.group === null) continue;
    if (!byGroup[q.group]) byGroup[q.group] = { count: 0, types: new Set(), points: new Set(), complexities: new Set(), lessons: new Set(), standards: new Set(), suffixes: new Set(), hasImages: false };
    const g = byGroup[q.group];
    g.count++;
    if (q.code) g.types.add(TYPE_LABELS[q.code] || q.code);
    if (q.points !== null) g.points.add(q.points);
    // Check if this question's stem or answers contain an <img> tag
    if (!g.hasImages && /<img\b/i.test(q.stem)) g.hasImages = true;
    if (!g.hasImages) {
      for (const ans of (q.answers || [])) {
        if (/<img\b/i.test(ans.text)) { g.hasImages = true; break; }
      }
    }
    const spanMatch = q.stem.match(/<span([^>]*)>/i);
    if (spanMatch) {
      const attrs = spanMatch[1];
      const cm2 = attrs.match(/data-complexity\s*=\s*"([^"]*)"/i);
      if (cm2 && cm2[1].trim()) g.complexities.add(cm2[1].trim().toUpperCase());
      const lm = attrs.match(/data-associatedlessons\s*=\s*"([^"]*)"/i);
      if (lm && lm[1].trim()) {
        lm[1].split('|').forEach(l => { 
          const t = l.trim(); 
          if(t) {
            g.lessons.add(t); 
            const suffixMatch = t.match(/[RH]$/i);
            if (suffixMatch) g.suffixes.add(suffixMatch[0].toUpperCase());
          }
        });
      }
      const stdRe = /data-standard-[a-z0-9_-]+\s*=\s*"([^"]*)"/gi;
      let sm;
      while ((sm = stdRe.exec(attrs)) !== null) {
        if (sm[1].trim()) g.standards.add(sm[1].trim());
      }
    }
  }
  return Object.entries(byGroup).map(([gNum, data]) => ({
    group: parseInt(gNum),
    count: data.count,
    types: [...data.types],
    points: [...data.points].sort((a,b)=>a-b),
    complexities: [...data.complexities],
    lessons: [...data.lessons],
    standards: [...data.standards],
    suffixes: [...data.suffixes],
    hasImages: data.hasImages
  })).sort((a,b) => a.group - b.group);
}

function openDashboard() {
  const data = AppState.dashData;
  if (!data) return;
  
  let totalPoints = 0;
  data.forEach(row => {
    if (row.points && row.points.length > 0) {
      totalPoints += row.points[0] || 0;
    }
  });
  
  const meta = AppState.dashMeta || {};
  DOM.dashMeta.textContent =
    (meta.questions||0)+' questions · '+(meta.groups||0)+' groups · ' + totalPoints + ' total points';
  const tbody = DOM.dashTbody;
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="dash-empty">No group data found. Make sure questions have group: lines.</td></tr>';
  } else {
    // Calculate majority count for questions per group
    const countFreq = {};
    let maxFreq = 0;
    let majorityCount = null;
    data.forEach(row => {
      countFreq[row.count] = (countFreq[row.count] || 0) + 1;
    });
    for (const [countStr, freq] of Object.entries(countFreq)) {
      if (freq > maxFreq) {
        maxFreq = freq;
        majorityCount = parseInt(countStr);
      }
    }

    tbody.innerHTML = data.map((row, idx) => {
      const isMixed = row.types.length > 1 || row.points.length > 1 || row.complexities.length > 1 || (row.suffixes && row.suffixes.length > 1);
      const isCountMismatch = Object.keys(countFreq).length > 1 && row.count !== majorityCount;
      const isWarning = isMixed || isCountMismatch;

     const warnIcon = (title) => '<span style="color:var(--warn);font-size:12px;margin-left:4px;vertical-align:middle;cursor:help;" title="' + title + '">⚠</span>';
      
      // Count
      const countBadgeStyle = isCountMismatch ? ' style="background:var(--error);color:#fff;border-color:var(--error)" title="Differs from majority"' : '';
      const countHtml = '<span class="dash-count"' + countBadgeStyle + '>' + row.count + '</span>' + (isCountMismatch ? warnIcon('Count differs from majority') : '');
      // Type
      const TYPE_COLORS = { 'MC':'dash-type-mc', 'Essay':'dash-type-essay', 'FIB':'dash-type-fib', 'T/F':'dash-type-tf', 'Matching':'dash-type-matching' };
      const typeHtml = row.types.length
        ? row.types.map(t => '<span class="dash-type-chip ' + (TYPE_COLORS[t]||'dash-type-other') + '">' + esc(t) + '</span>').join(' ') + (row.types.length > 1 ? warnIcon('Mixed types') : '')
        : '<span style="color:var(--text-dim);font-style:italic;font-size:11px">—</span>';
      // Points
      let ptHtml;
      if (!row.points.length) {
        ptHtml = '<span style="color:var(--text-dim);font-style:italic;font-size:11px">—</span>';
      } else if (row.points.length === 1) {
        ptHtml = '<span class="dash-pt-chip">' + row.points[0] + '</span>';
      } else {
        ptHtml = row.points.map(p => '<span class="dash-pt-chip">' + p + '</span>').join(' ') + warnIcon('Mixed point values');
      }
      // Complexity
      let cxHtml;
      if (!row.complexities.length) {
        cxHtml = '<span style="color:var(--text-dim);font-style:italic;font-size:11px">—</span>';
      } else if (row.complexities.length === 1) {
        cxHtml = '<span class="dash-complexity ' + row.complexities[0] + '">' + row.complexities[0] + '</span>';
      } else {
        cxHtml = row.complexities.map(c => '<span class="dash-complexity ' + c + '">' + c + '</span>').join(' ') + warnIcon('Mixed complexities');
      }
      const lessonHtml = row.lessons.length
        ? '<span class="dash-lesson">' + row.lessons.map(l => esc(l)).join('<br>') + '</span>'
        : '<span style="color:var(--text-dim);font-style:italic;font-size:11px">—</span>';
      const stdHtml = row.standards.length
        ? '<span class="dash-standard">' + row.standards.map(s => esc(s)).join('<br>') + '</span>'
        : '<span style="color:var(--text-dim);font-style:italic;font-size:11px">—</span>';
      const imgHtml = row.hasImages
        ? '<span style="font-size:15px;color:var(--pass)" title="This group contains images">✓</span>'
        : '<span style="color:var(--text-dim);font-size:13px" title="No images in this group">—</span>';
        
      let suffixHtml;
      if (!row.suffixes || !row.suffixes.length) {
        suffixHtml = '<span style="color:var(--text-dim);font-style:italic;font-size:11px">—</span>';
      } else {
        suffixHtml = row.suffixes.map(s => {
          const colorClass = s === 'R' ? 'dash-type-mc' : (s === 'H' ? 'dash-type-essay' : 'dash-type-other');
          return '<span class="dash-type-chip ' + colorClass + '">' + s + '</span>';
        }).join(' ') + (row.suffixes.length > 1 ? warnIcon('Mixed Regular/Honors') : '');
      }
		
      let rowClasses = [];
      if (isWarning) rowClasses.push('dash-row-warn');
      else if (idx % 2 === 1) rowClasses.push('dash-row-alt');
      const classAttr = rowClasses.length ? ' class="' + rowClasses.join(' ') + '"' : '';

      return '<tr' + classAttr + '>' +
        '<td>' + typeHtml + '</td>' +
        '<td><span class="dash-group-num">' + row.group + '</span></td>' +
        '<td>' + suffixHtml + '</td>' +
        '<td>' + countHtml + '</td>' +
        '<td><div class="dash-points">' + ptHtml + '</div></td>' +
        '<td>' + cxHtml + '</td>' +
        '<td>' + lessonHtml + '</td>' +
        '<td>' + stdHtml + '</td>' +
        '<td style="text-align:center">' + imgHtml + '</td>' +
        '</tr>';
    }).join('');
  }
  DOM.dashOverlay.classList.add('open');
  DOM.dashModal.classList.add('open');
}

function closeDashboard() {
  DOM.dashOverlay.classList.remove('open');
  DOM.dashModal.classList.remove('open');
}
