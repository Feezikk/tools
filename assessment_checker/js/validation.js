'use strict';

// validation.js
// The AssessmentChecker parsing + rule-evaluation engine.
// Parses raw question text into structured questions, runs every rule
// handler against them, and returns a grouped pass/fail report.
// Depends on: config.js, validation-rules.js.
//
// ─────────────────────────────────────────────────────────────────
// RULE EXECUTION ORDER & DEPENDENCY MAP
// ─────────────────────────────────────────────────────────────────
// Rules run in the order they're listed in RULES_DATA (see run() below —
// `for (const rule of rules)`), and every handler is independent EXCEPT
// for the intentional dependencies documented here. This list was
// produced during the modular refactor's validation review (see
// VALIDATION_ANALYSIS.md at the project root for the full writeup).
//
// 1. group-sequence / group-numbering / group-type-consistency /
//    same-group-same-points / group-meta-consistency all skip any
//    question whose group is null (`if (q.group === null) continue;`).
//    This intentionally defers to 'group-present' (question-has-field),
//    which is the rule that reports a missing group: line — so a
//    question missing its group never gets a second, misleading
//    "group out of sequence" style error on top of the first.
//
// 2. 'tf-answer-present' explicitly skips any question where
//    'tf-answer' (both true AND false present) already fired, so one
//    bad true/false question produces exactly one error, not two.
//
// 3. table 'structure' sub-check skips a table when 'table-tag-pairs'
//    already found broken/unmatched tags on it (`if (t.hasTagPairErrors)
//    continue;`) — with broken tags, column counts aren't reliable, so
//    reporting a structure mismatch on top would likely be noise.
//
// 4. 'lt-gt-entities-check' suppresses bare < / > fragments that look
//    like part of a broken tag, deferring to 'malformed-html-tag' /
//    'unclosed-paired-tags' for those cases.
//
// 5. 'img-alt-symbol-check': known HTML entities (&gt;, &deg;, etc.) take
//    priority over bare symbols in the same alt text — an entity match
//    suppresses the bare-symbol check for that image so only the more
//    specific message is shown.
//
// 6. 'accessible-symbols-minus' explicitly excludes en dashes on
//    non-answer lines, deferring entirely to 'en-dash-context' for
//    that character so the two rules never both fire on the same dash.
//
// 7. Cross-suppression (post-processing pass, after all rules have run,
//    in run() below): if 'en-dash-context' fired for a question, any
//    en dash entry is stripped from that question's 'special-chars-auto'
//    result — and the whole result is dropped if that empties it — since
//    en-dash-context already gives the more specific, actionable message.
//
// No conflicting or duplicate-warning bugs were found during this
// review; the dependencies above were already implemented correctly.
// See VALIDATION_ANALYSIS.md for optional consolidation opportunities
// (duplicated regex helpers) that don't change behavior.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// CHECKER ENGINE
// ─────────────────────────────────────────────────────────────────

// Named constants — avoids magic numbers scattered through the codebase
const MATCHING_RIGHT_SIDE_MAX_CHARS = 42; // matching:label: right-side visible character limit
const AUDIT_RENDER_DELAY_MS = 50;         // setTimeout delay to allow spinner to paint before audit runs

const AssessmentChecker = (() => {
  const Q_CODES = ['mc:radio:','essay:','fib:','matching:label:','tf:'];

  function parseQuestions(raw) {
    const lines = raw.split('\n');
    const questions = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim(), ln = i + 1;
      const code = Q_CODES.find(c => t.startsWith(c));
      if (code) {
        if (cur) questions.push(cur);
        cur = { num:questions.length+1, code, startLine:ln, stem:t.slice(code.length),
                stemLines:[ln], answers:[], points:null, group:null, pointsLine:null, groupLine:null };
        continue;
      }
      if (!cur) continue;
      if (/^points:\s?\d+$/.test(t)) { cur.points = parseInt(t.split(':')[1]); cur.pointsLine = ln; }
      else if (/^group:\s?\d+$/.test(t)) { cur.group = parseInt(t.split(':')[1]); cur.groupLine = ln; }
      else if (cur.points === null && cur.group === null) {
        if (!t) continue; // skip blank lines
        // Determine if the stem is currently "empty" of actual question text.
        // We strip the metadata span and any trailing <br> tags to see if anything is left.
        const stemTextOnly = cur.stem.trim()
          .replace(/^:?(?:<span|span)\b[^>]*>[\s\S]*?<\/span>/i, '')
          .replace(/(?:<\/?\s*br\b[^>]*>\s*)+$/i, '')
          .trim();
        const stemNeedsText = stemTextOnly === '';

        // Stem continuation: only if the stem lacks actual question text
        const looksLikeAnswer = t.startsWith('x-') || t.startsWith('<')
          || cur.code === 'matching:label:'
          || (cur.code === 'tf:' && (t.toLowerCase() === 'true' || t.toLowerCase() === 'false'));
          
        if (cur.answers.length === 0 && !looksLikeAnswer && stemNeedsText) {
          cur.stem += '\n' + t;
          cur.stemLines.push(ln);
        } else {
          cur.answers.push({ text:t, lineNum:ln });
        }
      }
    }
    if (cur) questions.push(cur);
    return { questions, lines };
  }

  const pass = rule => ({ status:'pass', rule });
  const fail = (rule, msg, ln, err, extra) =>
    ({ status:'fail', rule, message:msg, lineNum:ln||null, errorStr:err||null, extra:extra||null });


  // Find the dash separating left from right in a matching answer, skipping dashes inside HTML tags.
  function findMatchingDash(text) {
    let inTag = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '<') { inTag = true; continue; }
      if (ch === '>') { inTag = false; continue; }
      if (!inTag && ch === '-') return i;
    }
    return -1;
  }

  const handlers = {
    'code-spacing'(rule, qs, raw, lines) {
      const re = /\b(mc\s*:\s*radio\s*:|essay\s*:\s*(?!\w)|fib\s*:\s*(?!\w)|tf\s*:\s*(?!\w)|matching\s*:\s*label\s*:\s*)/gi;
      return lines.flatMap((line, i) => {
        const matches = [...line.matchAll(re)].map(m => m[0]);
        return matches
          .filter(x => /\s/.test(x))
          .map(x => fail(rule, rule.message.replace('{found}', x.trim()), i+1, x.trim()));
      });
    },
    
  'intra-question-blank-check'(rule, qs, raw, lines) {
      const results = [];
      for (const q of qs) {
        // Find the absolute last line of this question block
        let lastLine = q.startLine;
        if (q.groupLine) lastLine = Math.max(lastLine, q.groupLine);
        if (q.pointsLine) lastLine = Math.max(lastLine, q.pointsLine);
        if (q.answers && q.answers.length) lastLine = Math.max(lastLine, q.answers[q.answers.length - 1].lineNum);
        if (q.stemLines && q.stemLines.length) lastLine = Math.max(lastLine, q.stemLines[q.stemLines.length - 1]);

        // Scan between the first line and the last line of the question
        for (let idx = q.startLine; idx < lastLine - 1; idx++) {
          if (lines[idx].trim() === '') {
            const actualLineNum = idx + 1;
            const prev = lines[idx - 1] !== undefined ? lines[idx - 1] : '';
            const next = lines[idx + 1] !== undefined ? lines[idx + 1] : '';
            
            // Build a 3-line contextual diff (previous line, the blank line, next line)
            const actual = prev + '\n' + lines[idx] + '\n' + next;
            const expected = prev + '\n' + next;
            
            results.push(fail(rule, 
              rule.message.replace('{num}', q.num), 
              actualLineNum, 'blank line', 
              { type: 'contextual-diff', actual, expected }
            ));
          }
        }
      }
      return results;
    },

    'question-spacing'(rule, qs, raw, lines) {
      if (qs.length < 2) return [];
      const results = [];
      for (let i = 0; i < qs.length - 1; i++) {
        const curr = qs[i], next = qs[i + 1];
        // End of current question: use groupLine if set, else pointsLine, else last stem line
        const endLine = Math.max(curr.groupLine || 0, curr.pointsLine || 0) || curr.startLine;
        const startNext = next.startLine;
        // Collect the gap lines between questions (exclusive on both ends)
        const gapLines = [];
        for (let ln = endLine + 1; ln < startNext; ln++) {
          if (lines[ln - 1] !== undefined) gapLines.push({ ln, text: lines[ln - 1] });
        }
        const blanks = gapLines.filter(g => g.text.trim() === '').length;
        if (blanks === 1 && gapLines.length === 1) continue; // exactly one blank line — correct
        const found = blanks === 0 ? 'No blank line' : blanks + ' blank lines';
        const lastCurrLine = lines[endLine - 1] || '';
        const firstNextLine = lines[startNext - 1] || '';

        if (blanks === 0) {
          // Missing blank line — use special type for custom green-insert rendering
          results.push(fail(rule,
            rule.message.replace('{found}', found).replace('{a}', curr.num).replace('{b}', next.num),
            endLine,
            null,
            { type: 'spacing-insert-blank', lastCurrLine, firstNextLine, gapLines: gapLines.map(g => g.text) }
          ));
        } else {
          // Too many blank lines — dedicated type for explicit before/after rendering
          results.push(fail(rule,
            rule.message.replace('{found}', found).replace('{a}', curr.num).replace('{b}', next.num),
            endLine,
            null,
            { type: 'spacing-remove-blanks', lastCurrLine, firstNextLine, blanks, gapLines: gapLines.map(g => g.text) }
          ));
        }
      }
      return results;
    },

    'group-sequence'(rule, qs) {
      let max = 0;      // running highest group seen (for violation detection)
      let prev = 0;     // immediately previous group seen (for accurate error messages)
      const violations = [];
      for (const q of qs) {
        if (q.group === null) continue;
        if (q.group < max) violations.push({ q, max: prev });
        prev = q.group;
        max = Math.max(max, q.group);
      }
      if (!violations.length) return [];
      const seq = qs.filter(q=>q.group!==null).map(q=>({num:q.num,group:q.group,line:q.groupLine}));
      // Report each violation; first one carries the full sequence detail for the fix panel
      return violations.map((v, idx) => fail(rule,
        rule.message.replace('{found}', v.q.group).replace('{previous}', v.max),
        v.q.groupLine, String(v.q.group),
        idx === 0 ? {type:'group-sequence', sequence:seq} : null));
    },

    'group-numbering'(rule, qs) {
      // Collect the unique set of group numbers actually used, in first-seen order
      const seen = new Map(); // group number → first question that used it
      for (const q of qs) {
        if (q.group === null) continue;
        if (!seen.has(q.group)) seen.set(q.group, q);
      }
      if (!seen.size) return [];

      const usedGroups = [...seen.keys()].sort((a, b) => a - b);
      const violations = []; // { kind, found, expected, q }

      // Check starts at 1
      if (usedGroups[0] !== 1) {
        violations.push({
          kind: 'first-not-one',
          found: usedGroups[0],
          expected: 1,
          q: seen.get(usedGroups[0])
        });
      }

      // Check for gaps between consecutive group numbers
      for (let i = 1; i < usedGroups.length; i++) {
        const prev = usedGroups[i - 1];
        const curr = usedGroups[i];
        if (curr !== prev + 1) {
          violations.push({
            kind: 'gap',
            found: curr,
            expected: prev + 1,
            q: seen.get(curr)
          });
        }
      }

      if (!violations.length) return [];

      // Build the full sequence for the detail panel (same shape as group-sequence)
      const seq = qs
        .filter(q => q.group !== null)
        .map(q => ({ num: q.num, group: q.group, line: q.groupLine }));

      const firstV = violations[0];
      const msgStr = firstV.kind === 'first-not-one'
        ? 'groups must start at 1, but the first group number used is ' + firstV.found
        : 'gap between group:' + (firstV.expected - 1) + ' and group:' + firstV.found + ' — group:' + firstV.expected + ' is missing';

      return [fail(rule,
        rule.message.replace('{found}', msgStr),
        firstV.q ? firstV.q.groupLine : null,
        String(firstV.found),
        { type: 'group-numbering', violations, seq }
      )];
    },

    'question-has-field'(rule, qs) {
      return qs.filter(q => rule.field==='points' ? q.points===null : q.group===null)
               .map(q => fail(rule, rule.message.replace('{num}',q.num), q.startLine));
    },

    'field-order'(rule, qs, raw, lines) {
      return qs.filter(q => q.pointsLine && q.groupLine && q.groupLine < q.pointsLine)
               .map(q => {
                 const groupText  = lines[q.groupLine  - 1] || '';
                 const pointsText = lines[q.pointsLine - 1] || '';
                 // actual: group: then points: (wrong order); expected: points: then group:
                 const actual   = groupText + '\n' + pointsText;
                 const expected = pointsText + '\n' + groupText;
                 return fail(rule, rule.message.replace('{num}',q.num), q.groupLine, null,
                   { type: 'contextual-diff', actual, expected });
               });
    },

    'group-type-consistency'(rule, qs) {
      const TYPE_LABELS = {
        'mc:radio:':'MC','mc:check:':'MC','essay:':'Essay',
        'fib:':'FIB','tf:':'T/F','matching:label:':'Matching'
      };
      const byG = {};
      for (const q of qs) {
        if (q.group===null) continue;
        (byG[q.group]=byG[q.group]||[]).push({num:q.num,code:q.code,line:q.startLine});
      }
      return Object.entries(byG).filter(([,c])=>new Set(c.map(i=>i.code)).size>1)
        .map(([g,c]) => {
          const types = [...new Set(c.map(i=>i.code))];
          return fail(rule, rule.message.replace('{group}',g).replace('{types}',types.map(t=>TYPE_LABELS[t]||t).join(', ')),
            c[0].line||null, null, {type:'group-type-consistency', group:g, items:c.map(i=>({num:i.num,label:TYPE_LABELS[i.code]||i.code,line:i.line}))});
        });
    },

    'group-points-consistency'(rule, qs) {
      const byG = {};
      for (const q of qs) {
        if (q.group===null||q.points===null) continue;
        (byG[q.group]=byG[q.group]||[]).push({num:q.num,points:q.points,line:q.pointsLine});
      }
      const results = [];
      for (const [g, items] of Object.entries(byG)) {
        const uniq = [...new Set(items.map(i=>i.points))];
        if (uniq.length < 2) continue;
        const tally = {};
        items.forEach(i => { tally[i.points]=(tally[i.points]||0)+1; });
        const expected = Object.entries(tally).sort((a,b)=>b[1]-a[1])[0][0];
        const off = items.filter(i=>String(i.points)!==expected);
        results.push(fail(rule, rule.message.replace('{group}',g).replace('{values}',uniq.join(', ')),
          off[0]?.line||null, uniq.join(' / '), {type:'group-points',group:g,expected,items}));
      }
      return results;
    },

    'group-meta-consistency'(rule, qs) {
      const byG = {};
      for (const q of qs) {
        if (q.group === null) continue;
        // Extract the full <span...>...</span> tag from the stem
        const spanMatch = q.stem.match(/<span([^>]*)>([\s\S]*?)<\/span>/i);
        const fullSpan = spanMatch ? spanMatch[0] : null;
        (byG[q.group] = byG[q.group] || []).push({
          num: q.num,
          line: q.startLine,
          span: fullSpan
        });
      }
      const results = [];
      for (const [g, items] of Object.entries(byG)) {
        // Only check groups where every question has a span (skip if any are missing — span-missing handles that)
        if (items.some(i => !i.span)) continue;
        const uniqSpans = [...new Set(items.map(i => i.span))];
        if (uniqSpans.length < 2) continue;
        results.push(fail(rule,
          rule.message.replace('{group}', g),
          items[0].line || null, null,
          { type: 'group-meta-consistency', group: g, items }
        ));
      }
      return results;
    },

    'mc-correct-count'(rule, qs) {
      return qs.filter(q=>q.code==='mc:radio:').flatMap(q => {
        const c = q.answers.filter(a=>a.text.startsWith('x-')).length;
        return c!==1 ? [fail(rule,rule.message.replace('{num}',q.num).replace('{count}',c),q.startLine)] : [];
      });
    },

    'tf-answer'(rule, qs) {
      return qs.filter(q=>q.code==='tf:').flatMap(q => {
        const a = q.answers.map(a=>a.text.toLowerCase().trim());
        return (a.includes('true')&&a.includes('false'))
          ? [fail(rule,rule.message.replace('{num}',q.num),q.startLine)] : [];
      });
    },

    'tf-answer-present'(rule, qs) {
      return qs.filter(q=>q.code==='tf:').flatMap(q => {
        const a = q.answers.map(a=>a.text.toLowerCase().trim());
        // Skip if already caught by tf-answer (both true AND false present)
        if (a.includes('true') && a.includes('false')) return [];
        // Fire if neither a valid 'true' nor a valid 'false' answer is present
        // This also catches misspellings like 'tru', 'flase', 'True', etc.
        if (!a.includes('true') && !a.includes('false')) {
          const escTxt = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
          const escAnswers = q.answers.map(ans => escTxt(ans.text.trim())).join('", "');
          const found = q.answers.length ? ' (found: "' + escAnswers + '")' : '';
          return [fail(rule, rule.message.replace('{num}',q.num) + found, q.startLine)];
        }
        return [];
      });
    },

    'malformed-tags'(rule, qs, raw, lines) {
      const CODES=['mc:radio:','essay:','tf:','fib:','matching:label:'];
      // List of HTML tags we reasonably expect to see, even if deprecated
      // Note: Table tags are removed from here so they are exclusively handled by the dedicated table-check rule
      const knownHtmlTags = ['span','img','br','strong','em','u','s','del','sup','sub','ol','ul','li','p','div','mark','font','b','i','a','h1','h2','h3','h4','h5','h6','hr','blockquote','code','pre'];

      return lines.flatMap((line, i) => {
        const lower = line.toLowerCase();
        const hasMissingLt = CODES.some(c => {
            const idx = lower.indexOf(c);
            return idx !== -1 && /^:?span\b/i.test(line.substring(idx + c.length));
        });
        if (hasMissingLt) return [];

        let checkLine = line
            .replace(/<\/?mark\b[^>]*>?/gi, '') 
            .replace(/\/?mark\b[^>]*>/gi, '');

        // Strip quoted attribute values (double or single) before counting angle brackets.
        // This prevents < and > that appear legitimately inside alt="a > b" or similar
        // attribute values from being mistaken for structural tag punctuation.
        const checkLineNoAttrs = checkLine
            .replace(/"[^"]*"/g, '""')
            .replace(/'[^']*'/g, "''");

        const o=(checkLineNoAttrs.match(/</g)||[]).length, c=(checkLineNoAttrs.match(/>/g)||[]).length;
        if (o===c) return [];
        
        // If there's an unclosed <, check if it actually looks like a known HTML tag.
        // If it doesn't (e.g. "< variable"), we ignore it here and let lt-gt-entities catch it.
        // Use checkLineNoAttrs so that < inside quoted attribute values (e.g. alt="x < y")
        // doesn't produce a false chunk that matches a tag name.
        let hasMalformedKnownTag = false;
        let badMatch = null;

        const chunks = checkLineNoAttrs.split('<');
        for (let j = 1; j < chunks.length; j++) {
           const chunk = chunks[j];
           if (!chunk.includes('>')) {
              const matchTag = chunk.match(/^\/?\s*([a-zA-Z0-9]+)\b/);
              if (matchTag && knownHtmlTags.includes(matchTag[1].toLowerCase())) {
                  hasMalformedKnownTag = true;
                  // Report from the original checkLine for an accurate error snippet
                  const origChunks = checkLine.split('<');
                  badMatch = '<' + (origChunks[j] || chunk);
                  break;
              }
           }
        }

        if (hasMalformedKnownTag) {
            return [fail(rule,rule.message.replace('{line}',i+1).replace('{found}',badMatch.substring(0,60)),i+1,badMatch)];
        }
        return [];
      });
    },

    'br-format'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const ms = line.match(/<\/?\s*br\b[^><]*(?:>|(?=<|$))/gi)||[];
        return ms.filter(m=>m!=='<br />').map(m=>fail(rule,rule.message.replace('{line}',i+1).replace('{found}',m),i+1,m, { type: 'contextual-diff', actual: m, expected: '<br />' }));
      });
    },

    'inline-style-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        // Remove allowed style="vertical-align:middle;" from img tags
        let clean = line.replace(/<img([^>]*)style\s*=\s*"([^"]*)"([^>]*)>/gi, (match, pre, styleVal, post) => {
          const norm = styleVal.replace(/\s/g,'').toLowerCase();
          return (norm === 'vertical-align:middle;') ? '<img'+pre+post+'>' : match;
        });
        // Remove allowed list-style-type styles from ol tags
        clean = clean.replace(/<ol([^>]*)style\s*=\s*"([^"]*)"([^>]*)>/gi, (match, pre, styleVal, post) => {
          const norm = styleVal.replace(/\s/g,'').toLowerCase();
          return norm.startsWith('list-style-type:') ? '<ol'+pre+post+'>' : match;
        });
        // Remove allowed style="text-align: [any]" from any element
        clean = clean.replace(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)style\s*=\s*"([^"]*)"([^>]*)>/gi, (match, tag, pre, styleVal, post) => {
          const norm = styleVal.replace(/\s/g,'').toLowerCase();
          return norm.startsWith('text-align:') ? '<'+tag+pre+post+'>' : match;
        });
        // Remove allowed style="font-family: ..." from span tags (produced by font-tag-replace auto-fix)
        clean = clean.replace(/<span([^>]*)style\s*=\s*"([^"]*)"([^>]*)>/gi, (match, pre, styleVal, post) => {
          const norm = styleVal.replace(/\s/g,'').toLowerCase();
          return norm.startsWith('font-family:') ? '<span'+pre+post+'>' : match;
        });
        // Remove allowed dir="[any]" attribute from any element
        clean = clean.replace(/\s*\bdir\s*=\s*"[^"]*"/gi, '');
        const m = clean.match(/style\s*=\s*["'][^"']*["']/i);
        return m ? [fail(rule,rule.message.replace('{line}',i+1),i+1,m[0])] : [];
      });
    },

    'forbidden-html-tags'(rule, qs, raw, lines) {
      const fixMap = {
        'b': { open: '<strong>', close: '</strong>' },
        'i': { open: '<em>', close: '</em>' },
        'u': { open: '<span class="underline">', close: '</span>' },
        's': { open: '<del>', close: '</del>' },
        'bold': { open: '<strong>', close: '</strong>' },
        'italic': { open: '<em>', close: '</em>' }
      };

      return lines.flatMap((line, i) => {
        const results = [];
        let tempLine = line;

        // 1. Look for paired tags on the same line (e.g., <b>text</b>)
        const pairRe = /<(b|i|u|s|bold|italic)\b[^>]*>(.*?)<\/\1>/gi;
        let m;
        while ((m = pairRe.exec(tempLine)) !== null) {
          const tag = m[1].toLowerCase();
          const fix = fixMap[tag];
          const actual = m[0];
          const expected = `${fix.open}${m[2]}${fix.close}`;
          
          results.push(fail(rule,
             rule.message.replace('{line}', i+1).replace('{found}', `<${tag}>...</${tag}> pair`),
             i+1, actual,
             { type: 'contextual-diff', actual, expected, truthAttr: actual }
          ));
          
          // Mask out the pair with spaces so we don't flag the single tags inside it below
          tempLine = tempLine.substring(0, m.index) + ' '.repeat(actual.length) + tempLine.substring(m.index + actual.length);
        }

        // 2. Look for any orphaned/unpaired tags left over
        const singleRe = /<\/?(b|i|u|s|bold|italic)\b[^>]*>/gi;
        while ((m = singleRe.exec(tempLine)) !== null) {
          const actual = m[0];
          const isClosing = actual.startsWith('</');
          const tag = (actual.match(/<\/?([a-z]+)/i) || [])[1].toLowerCase();
          const expected = isClosing ? fixMap[tag].close : fixMap[tag].open;

          results.push(fail(rule,
             rule.message.replace('{line}', i+1).replace('{found}', `orphaned ${actual} tag`),
             i+1, actual,
             { type: 'contextual-diff', actual, expected, truthAttr: actual }
          ));
        }

        return results;
      });
    },

    'mark-tag-check'(rule, qs, raw, lines) {
      const PARTIAL_PATTERNS = [
        { re: /<mark(?:\s[^>]*)?$/, label: 'unclosed <mark tag (missing >)' },
        { re: /\bmark\s+class\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)?\s*>/, label: 'mark remnant (missing opening <)' },
        { re: /\/mark>/, label: '/mark> remnant (missing opening <)' },
        { re: /(?<![<\/\w])mark>/, label: 'mark> remnant (missing opening <)' },
        { re: /<\/mark(?!>)/, label: '</mark remnant (missing closing >)' },
      ];

      return lines.flatMap((line, i) => {
        const results = [];
        let tempLine = line;

        // Helper to push full-line diffs safely so the smart engine highlights exact indices.
        // removeToken is the exact substring to delete; actual/expected show the full-line diff
        // for the UI, while removeToken lets the fixer work even after sibling fixes have run.
        const pushFullLineDiff = (matchIdx, matchLen, msgFound) => {
          const actualFull = line;
          const removeToken = line.substring(matchIdx, matchIdx + matchLen);
          const expectedFull = line.substring(0, matchIdx) + line.substring(matchIdx + matchLen);
          results.push(fail(rule,
            rule.message.replace('{line}', i+1).replace('{found}', msgFound),
            i+1, null, { type: 'contextual-diff', actual: actualFull.trim(), expected: expectedFull.trim(), removeToken }
          ));
        };

        // 1. Complete pairs on the same line
        const pairRe = /<mark\b[^>]*>.*?<\/mark>/gi;
        let m;
        while ((m = pairRe.exec(tempLine)) !== null) {
          const actualFull = line;
          const removeToken = m[0];
          const innerText = m[0].replace(/<\/?mark\b[^>]*>/gi, '');
          const expectedFull = line.substring(0, m.index) + innerText + line.substring(m.index + m[0].length);
          // replaceWith carries what to substitute (inner text), removeToken is the full match
          results.push(fail(rule,
            rule.message.replace('{line}', i+1).replace('{found}', 'complete <mark>...</mark> pair'),
            i+1, null, { type: 'contextual-diff', actual: actualFull.trim(), expected: expectedFull.trim(), removeToken, replaceWith: innerText }
          ));
          tempLine = tempLine.substring(0, m.index) + ' '.repeat(m[0].length) + tempLine.substring(m.index + m[0].length);
        }

        // 2. Orphaned single tags (opening or closing)
        const singleRe = /<mark\b[^>]*>|<\/mark>/gi;
        while ((m = singleRe.exec(tempLine)) !== null) {
          pushFullLineDiff(m.index, m[0].length, `orphaned ${m[0]} tag`);
          tempLine = tempLine.substring(0, m.index) + ' '.repeat(m[0].length) + tempLine.substring(m.index + m[0].length);
        }

        // 3. Partial remnants
        for (const { re, label } of PARTIAL_PATTERNS) {
          let pm;
          while ((pm = tempLine.match(re)) !== null) {
            pushFullLineDiff(pm.index, pm[0].length, `partial mark remnant "${pm[0].trim().substring(0, 40)}" (${label})`);
            tempLine = tempLine.substring(0, pm.index) + ' '.repeat(pm[0].length) + tempLine.substring(pm.index + pm[0].length);
          }
        }

        return results;
      });
    },

    'unclosed-paired-tags-check'(rule, qs, raw, lines) {
      // Check every line belonging to each question for unmatched paired tags.
      // We scan from the question's startLine to the line before the next question
      // (or end of file) so answer lines with HTML tags are never missed regardless
      // of how the parser collected them.
      const PAIRED = ['strong','em','sup','sub','u','s','del'];
      // Compile regexes once per tag (not per question) — PAIRED is static
      const PAIRED_RES = PAIRED.map(tag => ({
        tag,
        open:  new RegExp('<'+tag+'(?:\\s[^>]*)?>','gi'),
        close: new RegExp('</'+tag+'>','gi')
      }));
      return qs.flatMap((q, qi) => {
        const start = q.startLine - 1; // 0-based
        const end   = qi + 1 < qs.length ? qs[qi+1].startLine - 1 : lines.length;
        const block = lines.slice(start, end).join('\n');
        const issues = [];
        for (const { tag, open, close } of PAIRED_RES) {
          // Reset lastIndex since the same RegExp objects are reused across questions
          open.lastIndex = 0; close.lastIndex = 0;
          const opens  = (block.match(open)  || []).length;
          const closes = (block.match(close) || []).length;
          if (opens !== closes) {
            issues.push(opens > closes
              ? (opens - closes) + ' unclosed <'+tag+'>'
              : (closes - opens) + ' extra </'+tag+'>');
          }
        }
        if (!issues.length) return [];
        return [fail(rule,
          rule.message.replace('{num}', q.num).replace('{found}', issues.join('; ')),
          q.startLine)];
      });
    },

   'lt-gt-entities-check'(rule, qs, raw, lines) {
      const allowedTagsRe = /<\/?\s*(span|img|br|strong|em|u|s|del|sup|sub|table|thead|tbody|tr|th|td|caption|ol|ul|li|p|div|mark|font|b|i|a|h[1-6]|hr|blockquote|code|pre)\b[^>]*>/gi;
      // Numeric character references for < and > (decimal &#60;/&#62; or hex
      // &#x3C;/&#x3E;) are valid HTML and represent exactly the same symbols as
      // &lt;/&gt; — recognized identically everywhere in this rule so a decimal
      // entity gets the same "must be spanned" treatment as its named-entity form.
      const LT_NUM = '&#0*60;|&#[xX]0*3[cC];';
      const GT_NUM = '&#0*62;|&#[xX]0*3[eE];';
      const validSpannedRe = new RegExp('<span[^>]*>\\s*(<|>|&lt;|&gt;|&le;|&ge;|'+LT_NUM+'|'+GT_NUM+')\\s*<\\/span>', 'gi');
      // Fragments that look like broken/incomplete HTML tags — a bare < or > that is
      // actually part of a malformed tag should be suppressed here; malformed-tags
      // or table-tag-pairs will catch it instead.
      // Pattern: <tagname with no closing >, or attributes> with no opening <
      const KNOWN_TAGS = 'span|img|br|strong|em|u|s|del|sup|sub|table|thead|tbody|tr|th|td|caption|ol|ul|li|p|div|mark|font|b|i|a|h[1-6]|hr|blockquote|code|pre';
      // Orphaned opening: <tagname ... (no > before next < or end of line)
      const orphanOpenRe = new RegExp('<\\/?('+KNOWN_TAGS+')\\b[^<>]*$', 'gi');

      return lines.flatMap((line, i) => {
        // 0. Mask quoted attribute values so that < and > inside alt="..." or similar
        //    are never treated as naked math/code symbols. This also prevents the
        //    allowedTagsRe below from stopping early at a > inside an attribute value.
        let checkLine = line
            .replace(/"[^"]*"/g,  m => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
            .replace(/'[^']*'/g, m => "'" + ' '.repeat(Math.max(0, m.length - 2)) + "'");

        // 1. Mask valid, already-wrapped symbols
        checkLine = checkLine.replace(validSpannedRe, match => ' '.repeat(match.length));

        // 2. Mask complete known HTML tags
        checkLine = checkLine.replace(allowedTagsRe, match => ' '.repeat(match.length));

        // 3. Mask orphaned opening fragments (e.g. "<strong" with no closing >)
        //    These leave a bare < that would otherwise be flagged as a math symbol.
        checkLine = checkLine.replace(orphanOpenRe, match => ' '.repeat(match.length));

        // 4. Mask encoded HTML tags — &lt;tagname ...&gt; and &lt;/tagname&gt;
        //    These are real tags written as entities (e.g. &lt;font face="..."&gt;) and
        //    should not be flagged as naked symbols.
        checkLine = checkLine.replace(/&lt;\/?\s*(?:span|img|br|strong|em|u|s|del|sup|sub|table|thead|tbody|tr|th|td|caption|ol|ul|li|p|div|mark|font|b|i|a|h[1-6]|hr|blockquote|code|pre)\b[^&]*&gt;/gi, match => ' '.repeat(match.length));

        // 5. Scan whatever is left for naked <, >, &lt;, &gt;, &le;, or &ge;
        const results = [];
        const re = new RegExp('(<|>|&lt;|&gt;|&le;|&ge;|'+LT_NUM+'|'+GT_NUM+')', 'gi');
        let m;
        while ((m = re.exec(checkLine)) !== null) {
          const idx = m.index;
          const sym = m[0];

          // ── Suppress if this looks like part of a broken tag ──
          // A bare > is likely a tag tail if everything between the previous unmasked
          // character and this > looks like tag attribute content.
          if (sym === '>') {
            // Look back in the *original* line for an unclosed < — if the text between
            // looks like a real tag tail (has = or quotes, indicating attributes, or is
            // a known self-closing form like "/>"), suppress it.
            const rawLine = line;
            const lastLt = rawLine.lastIndexOf('<', idx);
            if (lastLt !== -1) {
              const between = rawLine.substring(lastLt, idx + 1);
              // A real tag tail has attributes (key="val") or is "/>" or "<tagname>"
              const hasAttr  = /=\s*["']/.test(between);
              const isSelfClose = /\/>$/.test(between);
              const isSimpleTag = /^<\/?[a-zA-Z][a-zA-Z0-9]*\s*>$/.test(between);
              if (hasAttr || isSelfClose || isSimpleTag) continue;
            } else {
              // No < before this > at all — check if the content leading up to >
              // looks like a tag tail: contains key="val" attribute syntax
              const rawBefore = rawLine.substring(0, idx + 1);
              // A tag tail has at least one attribute assignment or ends with />
              if (/=\s*["'][^"']*["']/.test(rawBefore) || rawBefore.trimEnd().endsWith('/>')) continue;
            }
            // Also suppress if the content just before > looks like a malformed tag
            // whose opening < is missing — e.g. "/tr>" or "tagname>" or "/tagname attr>"
            // This catches orphaned tag tails like /tr> that are missing their <
            const KNOWN_TAGS_GT = 'span|img|br|strong|em|u|s|del|sup|sub|table|thead|tbody|tr|th|td|caption|ol|ul|li|p|div|mark|font|b|i|a|h[1-6]|hr|blockquote|code|pre';
            // Anchored at ^ so the whole trimmed text must BE a tag tail, not just contain one.
            // Require tag name be followed by a non-word char (space, /) or end-of-string
            // so that "greater" (containing "tr") doesn't falsely match.
            const orphanTailRe = new RegExp('^\\/?(?:' + KNOWN_TAGS_GT + ')(?:[^a-zA-Z0-9][^<>]*)?$', 'i');
            const textBeforeGt = rawLine.substring(Math.max(0, lastLt !== -1 ? lastLt + 1 : 0), idx);
            if (orphanTailRe.test(textBeforeGt.trim())) continue;
          }

          if (sym === '<') {
            // Look forward in checkLine for a > — if content between looks tag-like, suppress
            const after = checkLine.substring(idx + 1);
            const nextGt = after.indexOf('>');
            if (nextGt !== -1) {
              const between = after.substring(0, nextGt);
              // Tag-like between: starts with optional / then letters (tag name or attribute)
              if (/^\/?(\w)/.test(between.trim())) continue;
            }
          }

          const actualFull = line;
          // Encode the raw symbol as an HTML entity inside the span for full LMS compatibility
          let encodedSym = sym;
          if (sym === '<' || new RegExp('^(?:'+LT_NUM+')$','i').test(sym)) encodedSym = '&lt;';
          if (sym === '>' || new RegExp('^(?:'+GT_NUM+')$','i').test(sym)) encodedSym = '&gt;';
          
          const replacement = '<span>' + encodedSym + '</span>';
          const expectedFull = line.substring(0, m.index) + replacement + line.substring(m.index + sym.length);

          results.push(fail(rule,
            rule.message.replace('{line}', i+1).replace('{found}', sym),
            i+1, null, { type: 'contextual-diff', actual: actualFull.trim(), expected: expectedFull.trim() }
          ));
        }
        return results;
      });
    },

    'commented-html'(rule, qs, raw) {
      const results = []; const re=/<!--([\s\S]*?)-->/g; let m;
      while ((m=re.exec(raw))!==null) {
        if (/<[a-zA-Z]/.test(m[1])) {
          const ln=(raw.substring(0,m.index).match(/\n/g)||[]).length+1;
          results.push(fail(rule,rule.message.replace('{line}',ln),ln));
        }
      }
      return results;
    },

    'img-alt-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        return imgs.filter(t=>{
          // Accept alt="..." or alt='...' with non-empty value — quote style is a separate rule
          return !/alt\s*=\s*"[^"]+"/i.test(t) && !/alt\s*=\s*'[^']+'/i.test(t);
        }).map(()=>fail(rule,rule.message.replace('{line}',i+1),i+1));
      });
    },

    'img-quote-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        if (!/<img/i.test(line)) return [];
        const imgs = line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi) || [];
        return imgs.flatMap(img => {
          const m = img.match(/(src|alt)\s*=\s*'([^']+)'/i);
          if (m) {
            const actual = m[0];
            const expected = `${m[1]}="${m[2]}"`;
            return [fail(rule, rule.message.replace('{line}', i+1), i+1, actual, { type: 'contextual-diff', actual, expected, truthAttr: img })];
          }
          return [];
        });
      });
    },

    'img-extension-check'(rule, qs, raw, lines) {
      const results=[];
      lines.forEach((line,i)=>{
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        imgs.forEach(img=>{
          const re=/src\s*=\s*"([^"]+)"/gi; let m;
          while((m=re.exec(img))!==null){
            const src=m[1].toLowerCase();
            if(!rule.allowed.some(e=>src.endsWith(e))){
              const ext='.'+src.split('.').pop();
              results.push(fail(rule,rule.message.replace('{line}',i+1).replace('{found}',ext),i+1,ext));
            }
          }
        });
      });
      return results;
    },

    'img-alt-quotes-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        return imgs.flatMap(img=>{
          const a=img.match(/alt\s*=\s*"([^]*?)"(?=\s*\/?>|\s+[a-z]+(?:=|\s|>))/i);
          if (a && a[1].includes('"')) {
            const actual = a[0];
            const expected = `alt="${a[1].replace(/"/g, "'")}"`;
            return [fail(rule, rule.message.replace('{line}', i+1), i+1, actual, { type: 'contextual-diff', actual, expected, truthAttr: img })];
          }
          return [];
        });
      });
    },

    'img-alt-html-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        return imgs.flatMap(img=>{
          const a=img.match(/alt\s*=\s*"([^]*?)"(?=\s*\/?>|\s+[a-z]+(?:=|\s|>))/i);
          if(!a) return [];
          // Only flag sequences that look like actual HTML tags: <tagname ...> or </tagname>
          // A real tag name starts immediately after < (with optional /) with no spaces.
          // This excludes math like "< 4 >" (space before digit) and "x < y and p > q"
          // where < is followed by a space then a word, not a run-together tag name.
          const h=a[1].match(/<\/?[a-zA-Z][^>]*>/);
          return h ? [fail(rule,rule.message.replace('{line}',i+1),i+1,h[0])] : [];
        });
      });
    },

   'img-alt-symbol-check'(rule, qs, raw, lines) {
      const SYMS={'>':'greater than','<':'less than','/':'divided by','*':'multiplied by',
                  '%':'percent','&':'ampersand','@':'at','=':'equals','°':'degree','+':'plus'};
      // Base set of symbols that also have a common named HTML entity form.
      const ENT_BASE = {
        '&amp;':   { char:'&',      word:'ampersand' },
        '&lt;':    { char:'<',      word:'less than' },
        '&gt;':    { char:'>',      word:'greater than' },
        '&deg;':   { char:'\u00b0', word:'degree' },
        '&ndash;': { char:'\u2013', word:'dash or minus' },
        '&mdash;': { char:'\u2014', word:'dash' },
      };
      // HTML numeric character references (&#60; and &#x3C;) are valid HTML — the
      // same as their named-entity equivalent (&lt;). Build decimal and hex forms
      // for each entity above so they're recognized and handled identically to the
      // named entity (same word, same priority over the bare-symbol pass below),
      // rather than being flagged for containing '&', '#', or ';'.
      const ENTS={};
      for (const [name, {char, word}] of Object.entries(ENT_BASE)) {
        const code = char.codePointAt(0), hex = code.toString(16);
        ENTS[name] = word;
        ENTS['&#'+code+';'] = word;
        ENTS['&#x'+hex+';'] = word;
        ENTS['&#x'+hex.toUpperCase()+';'] = word;
      }
      const MATH_MINUS=/(?<=\s)-(?=\d|\s)/;
      return lines.flatMap((line, i) => {
        // Updated regex gracefully handles > symbols trapped inside alt text quotes
        const imgs = line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi) || [];
        return imgs.flatMap(img=>{
          const a=img.match(/alt\s*=\s*"([^]*?)"(?=\s*\/?>|\s+[a-z]+(?:=|\s|>))/i);
          if(!a) return [];
          const txt=a[1];
          const fullAlt = a[0]; // The whole alt="..." string for context

          const imgResults = [];

          for(const[ent,word] of Object.entries(ENTS)) {
            if(txt.includes(ent)) {
              const newTxt = txt.split(ent).join(' ' + word + ' ').replace(/ {2,}/g, ' ').trim();
              const expectedAlt = fullAlt.replace(txt, newTxt);
              imgResults.push(fail(rule, `Line ${i+1} alt text contains "${ent}". Expected: "${word}"`, i+1, ent, 
                { type: 'contextual-diff', actual: fullAlt, expected: expectedAlt, truthAttr: fullAlt, targetToken: ent, replaceWith: word }));
            }
          }
          // Only check bare symbols if no entity issues were found (entities take priority
          // as they are more specific — e.g. &gt; should not also fire the '>' sym check)
          if (!imgResults.length) {
            // A bare '&' not part of ANY entity (named, decimal, or hex) is still
            // flagged — but &#169;, &copy;, &#x2603;, etc. are valid HTML entities
            // in their own right (even ones with no special meaning to this rule)
            // and must never be flagged just because they contain '&'.
            const bareAmpRe = /&(?!#\d+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/i;
            for(const sym of Object.keys(SYMS)) {
              if (sym === '&') {
                if (bareAmpRe.test(txt)) {
                  const newTxt = txt.replace(new RegExp(bareAmpRe.source, 'gi'), ' ampersand ').replace(/ {2,}/g, ' ').trim();
                  const expectedAlt = fullAlt.replace(txt, newTxt);
                  imgResults.push(fail(rule, `Line ${i+1} alt text contains symbol "&". Expected: "ampersand"`, i+1, '&',
                    { type: 'contextual-diff', actual: fullAlt, expected: expectedAlt, truthAttr: fullAlt, targetToken: sym, replaceWith: SYMS[sym] }));
                }
                continue;
              }
              if(txt.includes(sym)) {
                const newTxt = txt.split(sym).join(' ' + SYMS[sym] + ' ').replace(/ {2,}/g, ' ').trim();
                const expectedAlt = fullAlt.replace(txt, newTxt);
                imgResults.push(fail(rule, `Line ${i+1} alt text contains symbol "${sym}". Expected: "${SYMS[sym]}"`, i+1, sym, 
                  { type: 'contextual-diff', actual: fullAlt, expected: expectedAlt, truthAttr: fullAlt, targetToken: sym, replaceWith: SYMS[sym] }));
              }
            }
            if(!imgResults.length && MATH_MINUS.test(txt)) {
              const newTxt = txt.replace(/(?<=\s)-(?=\d|\s)/g, ' minus ').replace(/ {2,}/g, ' ').trim();
              const expectedAlt = fullAlt.replace(txt, newTxt);
              imgResults.push(fail(rule, `Line ${i+1} alt text contains "-" used as a math minus. Expected: "minus"`, i+1, '-', 
                { type: 'contextual-diff', actual: fullAlt, expected: expectedAlt, truthAttr: fullAlt, targetToken: /(?<=\s)-(?=\d|\s)/g, replaceWith: 'minus' }));
            }
          }
          return imgResults;
        });
      });
    },

    'img-alt-unknown-symbol-check'(rule, qs, raw, lines) {
      const KNOWN=new Set(['>','<','/','*','%','&','@','-','=','°','+']);
      const KENT=/&(?:amp|lt|gt|deg|nbsp|quot|apos|ndash|mdash|#\d+|#x[0-9a-fA-F]+);/g;
      return lines.flatMap((line, i) => {
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        return imgs.flatMap(img=>{
          // Use robust extraction consistent with other alt handlers
          const a=img.match(/alt\s*=\s*"([^]*?)"(?=\s*\/?>|\s+[a-z]+(?:=|\s|>))/i);
          if(!a) return [];
          const txt=a[1].replace(KENT,' ');
          const u=txt.match(/[^\w\s.,!?;:'()\[\]{}\-\u2019\u2018\u201C\u201D\u2013\u2014]/g);
          if(u&&!KNOWN.has(u[0])) return [fail(rule,rule.message.replace('{line}',i+1).replace('{found}',u[0]),i+1,u[0])];
          return [];
        });
      });
    },

    'img-dimensions-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        return imgs.flatMap(img => {
          // SVG exception: an .svg image is allowed to declare width directly
          // on the <img> tag (SVGs commonly need it since they have no
          // intrinsic raster dimensions). height is still flagged as usual —
          // this exception applies to width only, and only for .svg src.
          const srcMatch = img.match(/src\s*=\s*["']([^"']*)["']/i);
          const isSvg = !!(srcMatch && /\.svg(?:[?#]|$)/i.test(srcMatch[1]));
          return [
            (!isSvg && /\bwidth\s*=/i.test(img)) ? fail(rule,rule.message.replace('{line}',i+1).replace('{found}','width'),i+1,'width') : null,
            /\bheight\s*=/i.test(img) ? fail(rule,rule.message.replace('{line}',i+1).replace('{found}','height'),i+1,'height') : null
          ].filter(Boolean);
        });
      });
    },

    'img-extra-attrs-check'(rule, qs, raw, lines) {
      const ALLOWED=['src','alt','style'], ASTYLE='vertical-align:middle;';
      return lines.flatMap((line, i) => {
        const imgs=line.match(/<img[^>]*>/gi)||[];
        return imgs.flatMap(img=>{
          // SVG exception: width is allowed directly on an .svg image (see
          // img-dimensions-check) — don't also flag it here as "unexpected".
          const srcMatch = img.match(/src\s*=\s*("[^"]*"|'[^']*')/i);
          const isSvg = !!(srcMatch && /\.svg(?:[?#]|["'])/i.test(srcMatch[1]));
          const img2=img.replace(/(=\s*"[^"]*"|=\s*'[^']*')/g,'=""');
          const re=/\b([a-zA-Z][a-zA-Z0-9-]*)\s*=/g;
          let m, found=[];
          while((m=re.exec(img2))!==null){
            const name=m[1].toLowerCase();
            if(!ALLOWED.includes(name)){
              // Ignore align="absmiddle" so the dedicated rule can handle it alone
              if (name === 'align' && /\balign\s*=\s*["']?absmiddle["']?/i.test(img)) continue;
              // Ignore width on SVG images — a separate, dedicated exception
              if (name === 'width' && isSvg) continue;
              found.push(m[1]);
              continue;
            }
            if(name==='style'){
              const sv=img.match(/style\s*=\s*"([^"]*)"/i);
              if(sv&&sv[1].replace(/\s/g,'')!==ASTYLE.replace(/\s/g,'')) found.push('style="'+sv[1]+'"');
            }
          }
          return found.length ? [fail(rule,rule.message.replace('{line}',i+1).replace('{found}',found.join(', ')),i+1,found[0])] : [];
        });
      });
    },

    'img-path-check'(rule, qs, raw, lines) {
      const results=[];
      lines.forEach((line,i)=>{
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        imgs.forEach(img=>{
          const re=/src\s*=\s*"([^"]+)"/gi; let m;
          while((m=re.exec(img))!==null)
            if(/[A-Z]/.test(m[1])||/ /.test(m[1]))
              results.push(fail(rule,rule.message.replace('{line}',i+1).replace('{found}',m[1]),i+1,m[1]));
        });
      });
      return results;
    },

    'img-path-base-check'(rule, qs, raw, lines) {
      const FIXED = CDN_BASE.replace(/^\/\//, '');  // 'cdn.flvs.net/assessment_images/'
      const folder = AppState.imgCourseFolder.trim().replace(/\/+$/, '');
      const norm=s=>s.replace(/^https?:\/\//,'').replace(/^\/\//,'');
      const results=[];
      lines.forEach((line,i)=>{
        const imgs=line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi)||[];
        imgs.forEach(img=>{
          const re=/src\s*=\s*"([^"]+)"/gi; let m;
          while((m=re.exec(img))!==null){
            const src = m[1];
            const normed=norm(src);
            if(!normed.startsWith(FIXED)){
              // Wrong base entirely — suggest correct base + folder (or placeholder)
              const expectedBase = '//'+FIXED+(folder?folder+'/':'<folder>/');
              // Build a best-guess corrected src: keep just the filename
              const filename = src.split('/').pop();
              const fixedSrc = folder
                ? '//'+FIXED+folder+'/'+filename
                : null; // can't auto-fix without a folder
              const actualAttr = m[0];           // src="..."
              const expectedAttr = fixedSrc ? 'src="'+fixedSrc+'"' : null;
              results.push(fail(rule,
                rule.message.replace('{line}',i+1).replace('{found}',src).replace('{expected}',expectedBase),
                i+1, src,
                expectedAttr ? { type:'contextual-diff', actual:actualAttr, expected:expectedAttr, truthAttr:img } : null));
              continue;
            }
            if(folder){
              const afterBase=normed.slice(FIXED.length);
              if(!afterBase.startsWith(folder+'/')){
                // Right base, wrong folder segment — replace just the folder part
                const filename = afterBase.split('/').slice(1).join('/');
                // Guard: if filename is empty the src only contained the folder (malformed path),
                // so we can't build a valid corrected src — skip auto-fix for this case.
                if (!filename) {
                  results.push(fail(rule,
                    rule.message.replace('{line}',i+1).replace('{found}',src).replace('{expected}','//'+FIXED+folder+'/'),
                    i+1, src, null));
                  continue;
                }
                const fixedSrc = '//'+FIXED+folder+'/'+filename;
                const actualAttr = m[0];
                const expectedAttr = 'src="'+fixedSrc+'"';
                results.push(fail(rule,
                  rule.message.replace('{line}',i+1).replace('{found}',src).replace('{expected}','//'+FIXED+folder+'/'),
                  i+1, src,
                  { type:'contextual-diff', actual:actualAttr, expected:expectedAttr, truthAttr:img }));
              }
            }
          }
        });
      });
      return results;
    },

    'missing-lt-span-check'(rule, qs, raw, lines) {
      const CODES=['mc:radio:','essay:','tf:','fib:','matching:label:'];
      return lines.flatMap((line,i)=>{
        const lower=line.toLowerCase();
        for(const code of CODES){
          const idx=lower.indexOf(code); if(idx===-1) continue;
          const after=line.substring(idx+code.length);
          if(/^:?span\b/i.test(after)){
            const actualTag = after.match(/^:?span/i)[0];
            const found = code + actualTag;
            const expected = code + '<span';
            return [fail(rule,rule.message.replace('{line}',i+1).replace('{found}',found),i+1,actualTag, { type: 'contextual-diff', actual: found, expected: expected })];
          }
          break;
        }
        return [];
      });
    },

    'span-self-closing-check'(rule, qs) {
      return qs.filter(q => /<span\b[^>]*\/>/i.test(q.stem)).map(q => {
        const actual = q.stem.match(/<span\b[^>]*\/>/i)[0];
        const expected = actual.replace(/\/>$/, '>');
        return fail(rule, rule.message.replace('{num}', q.num), q.startLine, '/>', { type: 'contextual-diff', actual, expected, truthAttr: actual });
      });
    },

    'span-missing-check'(rule, qs) {
      return qs.filter(q => {
        if (/<span\b/i.test(q.stem)) return false;
        // If it starts with "span", the < is missing. Let missing-lt-span-check handle it.
        if (/^:?span\b/i.test(q.stem.trim())) return false; 
        return true;
      }).map(q => {
        const actual = q.code;
        const expected = `${q.code}<span data-standard-florida="[Standard]" data-complexity="LC" data-associatedlessons="01.01R">(01.01 LC)</span><br /><br />`;
        return fail(rule, rule.message.replace('{num}', q.num), q.startLine, null, { type: 'contextual-diff', actual, expected });
      });
    },

    'span-unclosed-check'(rule, qs) {
      return qs.filter(q => q.stem.includes('<span') && !/<\/span\s*>/i.test(q.stem)).map(q => {
        // Match the span tag and optionally the (...) block immediately following it, stopping exactly at the ')'
        const sm = q.stem.match(/<span([^>]*)>(?:\s*\([^)]+\))?/i);
        if (sm) {
            const actual = sm[0].trim(); // Trim actual to perfectly align with expected
            const expected = actual + '</span>';
            return fail(rule, rule.message.replace('{num}', q.num), q.startLine, null, { type: 'contextual-diff', actual, expected });
        }
        return fail(rule, rule.message.replace('{num}', q.num), q.startLine);
      });
    },
    
  'span-attr-quotes-check'(rule, qs) {
      const results=[];
      for(const q of qs){
        if(!q.stem.includes('<span')) continue;
        const sm=q.stem.match(/<span([^>]*?)\/?>/i); if(!sm) continue;
        const attrs=sm[1];
        
        const dataAttrs = attrs.match(/\bdata-[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+)/gi) || [];
        for (const attrStr of dataAttrs) {
          if (/^\bdata-[a-z0-9_-]+\s*=\s*"[^"]*"$/i.test(attrStr.trim())) continue;
          
          const name = attrStr.split('=')[0].trim();
          let val = attrStr.substring(attrStr.indexOf('=') + 1).trim();
          val = val.replace(/^["']|["']$/g, ''); 
          
          const expected = `${name}="${val}"`;
          results.push(fail(rule, rule.message.replace('{num}', q.num).replace('{found}', name), q.startLine, attrStr, { type: 'contextual-diff', actual: attrStr, expected, truthAttr: sm[0] }));
        }
      }
      return results;
    },  

   'span-data-standard-check'(rule, qs) {
      const results=[];
      for(const q of qs){
        if(!q.stem.includes('<span')) continue;
        const sm=q.stem.match(/<span([^>]*?)\/?>/i); if(!sm) continue;
        const fullTag = sm[0];
        const attrs = sm[1];
        
        const std=attrs.match(/(data-standard-[a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+))/i);
        
        if(!std){
           const expectedTag = fullTag.replace('<span', '<span data-standard-florida="[Standard]"');
           results.push(fail(rule,rule.message.replace('{num}',q.num),q.startLine,'data-standard-*', { type: 'contextual-diff', actual: fullTag, expected: expectedTag }));
           continue;
        }
        
        const actualAttr = std[0];
        let val = (std[2] !== undefined ? std[2] : (std[3] !== undefined ? std[3] : std[4])).trim();
        val = val.replace(/^["']|["']$/g, '');
        
        if(!val) {
           const expectedAttr = `${std[1]}="[Standard]"`;
           results.push(fail(rule,rule.message.replace('{num}',q.num)+' Value cannot be blank.',q.startLine,'""', { type: 'contextual-diff', actual: actualAttr, expected: expectedAttr, truthAttr: fullTag }));
        }
      }
      return results;
    },

    'span-attribute-check'(rule, qs) {
      const results=[];
      const attrRe = new RegExp('('+rule.attribute+')\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^>\\s]+))','i');
      for(const q of qs){
        if(!q.stem.includes('<span')) continue;
        const sm=q.stem.match(/<span([^>]*?)\/?>/i); if(!sm) continue;
        const attrs=sm[1];
        if(!attrs.includes(rule.attribute)){
          results.push(fail(rule,rule.message.replace('{num}',q.num).replace('{found}','missing'),q.startLine));
          continue;
        }
        const vm=attrs.match(attrRe);
        let val='';
        let actualAttr = '';
        if(vm){
          actualAttr = vm[0];
          val = (vm[2] !== undefined ? vm[2] : (vm[3] !== undefined ? vm[3] : vm[4])).trim();
          val = val.replace(/^["']|["']$/g, '');
        }
        
        if(!val){
          const expectedAttr = rule.attribute === 'data-complexity' ? 'LC' : `01.01${AppState.courseType === 'M' ? 'R' : AppState.courseType}`;
          results.push(fail(rule, `Question ${q.num} span is missing a value for ${rule.attribute}.`, q.startLine, `""`,
            { type: 'contextual-diff', actual: actualAttr || `${rule.attribute}=""`, expected: `${rule.attribute}="${expectedAttr}"`, truthAttr: sm[0] }));
          continue;
        }
        
        if(rule.validValues && !rule.validValues.includes(val)) {
          results.push(fail(rule, `Question ${q.num} span has invalid ${rule.attribute} "${val}". Valid: ${rule.validValues.join(', ')}.`, q.startLine, val, 
            { type: 'contextual-diff', actual: actualAttr, expected: `${rule.attribute}="${rule.validValues[0]}"`, truthAttr: sm[0] }));
        }
      }
      return results;
    },

    'span-associatedlessons-format-check'(rule, qs) {
      const results=[];
      // Math courses may populate data-associatedlessons with descriptive
      // lesson text (e.g. "01.02 Solving Equations") instead of the standard
      // ##.##R / ##.##H format — skip the format check entirely in that case.
      // Existence and non-empty are still enforced by span-data-associatedlessons
      // (the 'span-attribute-check' handler above), regardless of this setting.
      if (AppState.mathCourse) return results;
      for(const q of qs){
        if(!q.stem.includes('<span')) continue;
        const sm=q.stem.match(/<span([^>]*?)\/?>([\s\S]*?)(?:<\/span>|<br|\n|$)/i); if(!sm) continue;
        const lm=sm[1].match(/(data-associatedlessons)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+))/i);
        if(!lm) continue;
        
        let val = (lm[2] !== undefined ? lm[2] : (lm[3] !== undefined ? lm[3] : lm[4])).trim();
        val = val.replace(/^["']|["']$/g, '');
        if(!val) continue;

        const bad=val.split('|').filter(e=>!/^\d{2}\.\d{2}[RH]$/i.test(e.trim()));
        if(bad.length) {
          const badVal = bad[0].trim();
          // Diagnose the specific problem and build the correct fix
            const needsPad = /^\d\.\d{2}[A-Za-z]*$/i.test(badVal);   
            
            const existingSuffixMatch = badVal.match(/[A-Za-z]+$/);
            const existingSuffix = existingSuffixMatch ? existingSuffixMatch[0].toUpperCase() : '';
            const hasValidSuffix = existingSuffix === 'R' || existingSuffix === 'H';
            
            let canAutoFix = true;
            let targetSuffix = '';
            
            if (AppState.courseType === 'M') {
              if (hasValidSuffix) {
                targetSuffix = existingSuffix; // Keep existing if valid
              } else {
                canAutoFix = false; // Cannot safely append/fix suffix in mixed mode
              }
            } else {
              targetSuffix = AppState.courseType; // Enforce 'R' or 'H'
            }

            let fixedVal = badVal;
            if (canAutoFix) {
              const coreNum = badVal.replace(/[A-Za-z]*$/, '');
              const paddedNum = needsPad ? '0' + coreNum : coreNum;
              fixedVal = paddedNum + targetSuffix;
            }

            // Check if the span content (e.g. "(1.03 MC)") also uses the same un-padded lesson number
            const spanContent = sm[2].trim(); 
            const badLesson = badVal.replace(/[A-Za-z]*$/i, '');   
            const fixedLesson = canAutoFix ? fixedVal.replace(/[A-Za-z]*$/i,'') : badLesson; 
            const contentHasSameBadLesson = needsPad && spanContent.includes(badLesson) && !spanContent.includes(fixedLesson);

            let diagMsg;
            let extra;

            if (!canAutoFix) {
              diagMsg = `Question ${q.num} data-associatedlessons "${badVal}" — each entry must match ##.##R or ##.##H format. Cannot auto-fix in Mixed course mode.`;
              extra = { type: 'contextual-diff', actual: badVal, expected: badVal, truthAttr: lm[0], noAutoFix: true };
            } else if (contentHasSameBadLesson) {
              const fixedContent = spanContent.replace(badLesson, fixedLesson);
              const rawLine = q.stem; 
              const fixedLine = rawLine
                .replace(lm[0], lm[0].replace(badVal, fixedVal))   
                .replace(spanContent, fixedContent);                 

              diagMsg = `Question ${q.num} data-associatedlessons "${badVal}" and span content "${spanContent}" both need a leading zero.`;
              extra = { type: 'dual-pad-fix', actual: rawLine, expected: fixedLine, lineNum: q.startLine,
                        attrActual: badVal, attrExpected: fixedVal,
                        contentActual: spanContent, contentExpected: fixedContent };
            } else {
              diagMsg = needsPad
                ? `Question ${q.num} data-associatedlessons "${badVal}" — lesson number must use two digits.`
                : `Question ${q.num} data-associatedlessons "${badVal}" — each entry must match ##.##R or ##.##H format.`;
              extra = { type: 'contextual-diff', actual: badVal, expected: fixedVal, truthAttr: lm[0] };
            }

            results.push(fail(rule, diagMsg, q.startLine, badVal, extra));
        }
      }
      return results;
    },

    'span-br-check'(rule, qs) {
      const results=[];
      for(const q of qs){
        if(!q.stem.includes('<span')) continue;
        const after=q.stem.match(/<\/span>(.*)/i);
        if(after){
          const tail=after[1].trim();
          if(!tail.startsWith('<br /><br />')){
            // If it starts with two br tags of any format, let the br-format rule handle it
            if (/^(?:<\/?\s*br\b[^><]*(?:>|(?=<|$))\s*){2}/i.test(tail)) continue;
            
            const bad=tail.match(/^(?:<\/?\s*br\b[^><]*(?:>|(?=<|$)))+/i);
            const actualBad = bad ? bad[0] : '';
            const actual = '</span>' + actualBad;
            const expected = '</span><br /><br />';
            results.push(fail(rule,rule.message.replace('{num}',q.num),q.startLine, actualBad || '</span>', { type: 'contextual-diff', actual, expected }));
          }
        }
      }
      return results;
    },

    'span-content-match-check'(rule, qs) {
      const results=[];
      // Math courses may use descriptive data-associatedlessons text (e.g.
      // "01.02 Solving Equations") that was never meant to appear verbatim
      // inside the span's visible "(lesson complexity)" text — skip this
      // cross-check entirely in that case rather than generating false
      // positives against descriptive lesson text.
      if (AppState.mathCourse) return results;
      for(const q of qs){
        if(!q.stem.includes('<span')) continue;
        // Match attributes and handle optional self-closing (/>), then capture text up to </span>, <br, newline, or end of string
        const sm=q.stem.match(/<span([^>]*?)\/?>([\s\S]*?)(?:<\/span>|<br|\n|$)/i); if(!sm) continue;
        const attrs=sm[1],content=sm[2].trim();
        
        const cm2=attrs.match(/data-complexity\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+))/i);
        const lm=attrs.match(/data-associatedlessons\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+))/i);
        if(!cm2||!lm) continue;
        
        let complexity = (cm2[2] !== undefined ? cm2[2] : (cm2[3] !== undefined ? cm2[3] : cm2[4])).trim().replace(/^["']|["']$/g, '');
        let assocLessons = (lm[2] !== undefined ? lm[2] : (lm[3] !== undefined ? lm[3] : lm[4])).trim().replace(/^["']|["']$/g, '');
        
        const firstLesson=assocLessons.split('|')[0].trim().replace(/[RH]+$/i,'');
        
        // If the source attributes are empty, skip this check.
        // We let the span-attribute-check handle the empty attributes first
        // so we don't suggest erasing valid text to match a blank attribute.
        if (!complexity || !firstLesson) continue;

        const expectedText = `(${firstLesson} ${complexity})`;
        
        const inner=content.match(/^\(([^)]+)\)$/);
        if(!inner){
            results.push(fail(rule,
                `Question ${q.num} span content "${content}" does not match its attributes. Verify the correct lesson and/or complexity and update manually.`,
                q.startLine, content, { type: 'contextual-diff', expected: expectedText, actual: content, truthAttr: attrs.trim(), noAutoFix: true }
            ));
            continue;
        }
        
        const parts=inner[1].trim().split(/\s+/);
        const cL=parts[0]||'',cC=parts[1]||'';
        const issues=[]; let errStr=null;
        
        if(cL!==firstLesson){issues.push('lesson');errStr=cL;}
        if(cC!==complexity){issues.push('complexity');errStr=errStr||cC;}
        
        if(issues.length) {
            // Detect the specific case: only the lesson differs, and it's just a missing leading zero
            // e.g. attribute has "01.03", span content has "1.03"
            const onlyLessonMismatch = issues.length === 1 && issues[0] === 'lesson';
            const isPadOnly = onlyLessonMismatch && ('0' + cL === firstLesson);

            if (isPadOnly) {
                results.push(fail(rule,
                    `Question ${q.num} span content "${content}" is missing a leading zero — should be "${expectedText}" to match data-associatedlessons.`,
                    q.startLine, cL,
                    { type: 'contextual-diff', actual: content, expected: expectedText, truthAttr: content }
                ));
            } else {
                results.push(fail(rule,
                    `Question ${q.num} span content "${content}" does not match its attributes. Verify the correct lesson and/or complexity and update manually.`,
                    q.startLine, errStr, { type: 'contextual-diff', expected: expectedText, actual: content, truthAttr: attrs.trim(), noAutoFix: true }
                ));
            }
        }
      }
      return results;
    },

    'matching-format'(rule, qs) {
      // Valid format: term-definition  (non-empty content on both sides of the dash)
      return qs.filter(q=>q.code==='matching:label:').flatMap(q=>
        q.answers.filter(a=>!/^\S[\s\S]*-[\s\S]*\S$/.test(a.text.trim()))
          .map(a=>fail(rule,rule.message.replace('{num}',q.num).replace('{line}',a.lineNum),a.lineNum)));
    },

    'matching-points-check'(rule, qs) {
      return qs.filter(q=>q.code==='matching:label:'&&q.points!==null).flatMap(q=>{
        const pairs=q.answers.length;
        // Using a global regex /\{pairs\}/g ensures EVERY instance is replaced
        return(pairs>0&&q.points%pairs!==0)?[fail(rule,rule.message.replace('{num}',q.num).replace(/\{pairs\}/g,pairs).replace('{points}',q.points),q.pointsLine)]:[];
      });
    },

    'accessible-symbols-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const clean = line.replace(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi, '').replace(/<[^>]+>/g, '');
        const results = [];

        if (rule.subtype === 'degree') {
          const degRe = /\u00b0/g; let m;
          while ((m = degRe.exec(clean)) !== null) {
            results.push(fail(rule,
              rule.message.replace('{line}', i + 1).replace('{found}', '°').replace('{fix}', 'replace with &deg; or spell out "degrees"'),
              i + 1, '°'));
          }
        } else if (rule.subtype === 'minus') {
          // Math minus: look for plain dashes used as subtraction or negative numbers.
          // En dashes (–) in this context are handled exclusively by en-dash-context-check
          // to avoid a duplicate result panel — skip them here.
          const isAnswerLine = /^\s*x?-/.test(line.trim());
          if (!isAnswerLine) {
            // Mask out text inside <code> or <pre> tags so we NEVER flag programming syntax
            let safeText = clean;
            const codeBlocks = line.match(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1>/gi);
            if (codeBlocks) {
              codeBlocks.forEach(block => {
                const strippedBlock = block.replace(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi, '').replace(/<[^>]+>/g, '');
                safeText = safeText.replace(strippedBlock, ' '.repeat(strippedBlock.length));
              });
            }

            // Only match plain hyphens/dashes (-), not en dashes (–)
            const minusRe = /(?<=\s)(-)(?=\d|\s+[a-zA-Z0-9])/g;

            let m;
            while ((m = minusRe.exec(safeText)) !== null) {
              const before = safeText.slice(Math.max(0, m.index - 5), m.index + 1);
              if (!/&\w*$/.test(before)) {
                results.push(fail(rule,
                  rule.message.replace('{line}', i + 1).replace('{found}', '-').replace('{fix}', 'if used as math minus, replace with &minus;'),
                  i + 1, null,
                  { type: 'minus-context', lineNums: [i + 1] }));
              }
            }
          }
        }
        return results;
      });
    },

    'en-dash-context-check'(rule, qs, raw, lines) {
      const minusRe = /(?<=\s)(-|–)(?=\d|\s+[a-zA-Z0-9])/g;
      return qs.flatMap((q, qi) => {
        const start = q.startLine - 1;
        const end   = qi + 1 < qs.length ? qs[qi+1].startLine - 1 : lines.length;
        const lineNums = [];
        lines.slice(start, end).forEach((l, idx) => {
          const isAnswerLine = /^\s*x?-/.test(l.trim());
          if (isAnswerLine) return;
          const clean = l.replace(/<img\b[^>]*>/gi,'').replace(/<[^>]+>/g,'');
          if (!clean.includes('\u2013')) return;
          minusRe.lastIndex = 0;
          if (minusRe.test(clean)) lineNums.push(start + idx + 1);
        });
        if (!lineNums.length) return [];
        const firstLine = lineNums[0] || q.startLine;
        return [fail(rule,
          rule.message.replace('{num}', q.num),
          firstLine, null,
          { type:'en-dash-context', qNum:q.num, lineNums })];
      });
    },
    
    'special-chars-check'(rule, qs, raw, lines) {
      const AUTO = [
        { char:'\u201c', name:'Left double curly quote \u201c',  fix:'&ldquo;' },
        { char:'\u201d', name:'Right double curly quote \u201d', fix:'&rdquo;' },
        { char:'\u2018', name:'Left single curly quote \u2018',  fix:'&lsquo;' },
        { char:'\u2019', name:'Right single curly quote \u2019', fix:'&rsquo;' },
        { char:'\u2014', name:'Em dash \u2014',                  fix:'&mdash;' },
        { char:'\u2013', name:'En dash \u2013',                  fix:'&ndash;' },
        { char:'\u2026', name:'Ellipsis character \u2026',       fix:'... (three dots)' },
        { char:'\u00d7', name:'Multiplication sign \u00d7',      fix:'&times;' },
        { char:'\u00f7', name:'Division sign \u00f7',            fix:'&divide;' },
        { char:'\u00a0', name:'Non-breaking space',              fix:'regular space or remove' },
        { char:'\u00a9', name:'Copyright \u00a9',                fix:'&copy;' },
        { char:'\u00ae', name:'Registered trademark \u00ae',     fix:'<sup>&reg;</sup>' },
        { char:'\u2122', name:'Trademark \u2122',                fix:'<sup>&trade;</sup>' },
        { char:'\u2120', name:'Service mark \u2120',             fix:'<sup>&#8480;</sup>' },
      ];
      const REVIEW = [
        { char:'\u00b2', name:'Superscript 2 \u00b2',   fix:'<sup>2</sup>' },
        { char:'\u00b3', name:'Superscript 3 \u00b3',   fix:'<sup>3</sup>' },
        { char:'\u00b9', name:'Superscript 1 \u00b9',   fix:'<sup>1</sup>' },
        { char:'\u00bd', name:'Fraction \u00bd',         fix:'&frac12; or "1/2"' },
        { char:'\u00bc', name:'Fraction \u00bc',         fix:'&frac14; or "1/4"' },
        { char:'\u00be', name:'Fraction \u00be',         fix:'&frac34; or "3/4"' },
        { char:'\u2192', name:'Right arrow \u2192',      fix:'&rarr; or "to"' },
        { char:'\u2190', name:'Left arrow \u2190',       fix:'&larr; or "from"' },
        { char:'\u2191', name:'Up arrow \u2191',         fix:'&uarr; or spell out' },
        { char:'\u2193', name:'Down arrow \u2193',       fix:'&darr; or spell out' },
        { char:'\u03b1', name:'Greek alpha \u03b1',      fix:'&alpha; or "alpha"' },
        { char:'\u03b2', name:'Greek beta \u03b2',       fix:'&beta; or "beta"' },
        { char:'\u03b3', name:'Greek gamma \u03b3',      fix:'&gamma; or "gamma"' },
        { char:'\u03b4', name:'Greek delta \u03b4',      fix:'&delta; or "delta"' },
        { char:'\u03b8', name:'Greek theta \u03b8',      fix:'&theta; or "theta"' },
        { char:'\u03bb', name:'Greek lambda \u03bb',     fix:'&lambda; or "lambda"' },
        { char:'\u03bc', name:'Greek mu \u03bc',         fix:'&mu; or "mu"' },
        { char:'\u03c0', name:'Greek pi \u03c0',         fix:'&pi; or "pi"' },
        { char:'\u03c3', name:'Greek sigma \u03c3',      fix:'&sigma; or "sigma"' },
        { char:'\u03c9', name:'Greek omega \u03c9',      fix:'&omega; or "omega"' },
        //{ char:'\u00a9', name:'Copyright \u00a9',        fix:'&copy; or "(c)"' },
//        { char:'\u00ae', name:'Registered trademark \u00ae', fix:'&reg; or "(R)"' },
//        { char:'\u2122', name:'Trademark \u2122',        fix:'&trade; or "(TM)"' },
//        { char:'\u2120', name:'Service mark \u2120',     fix:'&#8480; or "(SM)"' },
        { char:'\u20ac', name:'Euro \u20ac',             fix:'&euro;' },
        { char:'\u00a3', name:'Pound \u00a3',            fix:'&pound;' },
        { char:'\u00a5', name:'Yen \u00a5',              fix:'&yen;' },
      ];

      const isAuto  = rule.tier === 'auto';
      const CHARS   = isAuto ? AUTO : REVIEW;

      return qs.flatMap((q, qi) => {
        const start = q.startLine - 1; // 0-based index into lines[]
        const end   = qi + 1 < qs.length ? qs[qi+1].startLine - 1 : lines.length;
        const block = lines.slice(start, end)
          .filter(l => !/^(points:|group:)/.test(l.trim()))
          .join('\n');
        // Strip img tags (incl. alt text) then all other tags — only scan visible text
        const textOnly = block.replace(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi,'').replace(/<[^>]+>/g,'');

        const found = [];
        for (const entry of CHARS) {
          if (!textOnly.includes(entry.char)) continue;
          // Collect every line number within this question block where the char appears
          const lineNums = [];
          lines.slice(start, end).forEach((l, idx) => {
            const clean = l.replace(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi,'').replace(/<[^>]+>/g,'');
            if (clean.includes(entry.char)) lineNums.push(start + idx + 1);
          });
          found.push({ ...entry, lineNums });
        }
        if (!found.length) return [];

        const firstLine = found[0].lineNums[0] || q.startLine;
        return [fail(rule,
          rule.message.replace('{num}', q.num),
          firstLine, null,
          { type:'special-chars', tier:rule.tier, qNum:q.num, chars:found })];
      });
    },

    'font-tag-check'(rule, qs, raw, lines) {
      return lines.flatMap((line,i)=>{
        const m=line.match(/<font\b[^>]*>/gi);
        return m?[fail(rule,rule.message.replace('{line}',i+1),i+1,m[0])]:[];
      });
    },

    'underscore-format-check'(rule, qs, raw, lines) {
      return lines.flatMap((line, i) => {
        const results = [];
        // Map out where the HTML tags are so we don't flag underscores inside src="file_name.jpg"
        const tagRanges = [];
        let tm;
        const tagRe = /<[^>]+>/g;
        while ((tm = tagRe.exec(line)) !== null) {
          tagRanges.push([tm.index, tm.index + tm[0].length]);
        }

        // Find sequences of 2 or more underscores
        const re = /_{2,}/g;
        let m;
        while ((m = re.exec(line)) !== null) {
          const idx = m.index;
          const len = m[0].length;
          
          // Skip if this underscore sequence is hidden inside an HTML tag
          if (tagRanges.some(([s, e]) => idx >= s && idx < e)) continue;

          const charBefore = idx > 0 ? line[idx - 1] : ' ';
          const charAfter = (idx + len) < line.length ? line[idx + len] : ' ';
          
          // Check for spaces or valid boundaries (start/end of line, > or < from tags, and trailing punctuation)
          const needsSpaceBefore = idx > 0 && !/[\s>\(]/.test(charBefore) && charBefore !== '&';
          const needsSpaceAfter = (idx + len) < line.length && !/[\s<.,!?;:\)\]]/.test(charAfter);

          // If it's already exactly 3 or 8 AND the spacing is correct, it passes!
          if ((len === 3 || len === 8) && !needsSpaceBefore && !needsSpaceAfter) continue;

          // Otherwise, determine the target count (if they typed 4 or fewer, assume 3. If 5 or more, assume 8).
          const targetCount = len <= 4 ? 3 : 8;
          const targetUnderscores = '_'.repeat(targetCount);

          let actualSnippet = m[0];
          let expectedSnippet = targetUnderscores;

          // Build the contextual diff so we can visually inject the missing spaces
          if (needsSpaceBefore) {
            actualSnippet = charBefore + actualSnippet;
            expectedSnippet = charBefore + ' ' + expectedSnippet;
          }
          if (needsSpaceAfter) {
            actualSnippet = actualSnippet + charAfter;
            expectedSnippet = expectedSnippet + ' ' + charAfter;
          }

          results.push(fail(rule, 
            rule.message.replace('{line}', i+1).replace('{found}', m[0]), 
            i+1, actualSnippet, 
            { type: 'contextual-diff', actual: actualSnippet, expected: expectedSnippet }));
        }
        return results;
      });
    },

    'replacement-char-check'(rule, qs, raw, lines) {
      const REPL = '\uFFFD';
      return lines.flatMap((line, i) => {
        if (!line.includes(REPL)) return [];
        const count = (line.match(/\uFFFD/g) || []).length;
        const msg = rule.message.replace('{line}', i + 1) +
          (count > 1 ? ' (' + count + ' occurrences on this line)' : '');
        return [fail(rule, msg, i + 1, REPL)];
      });
    },

    'matching-min-pairs-check'(rule, qs) {
      return qs.filter(q => q.code === 'matching:label:').flatMap(q => {
        const count = q.answers.length;
        return count < 3
          ? [fail(rule, rule.message.replace('{num}', q.num).replace('{count}', count), q.startLine)]
          : [];
      });
    },

    'matching-right-side-length-check'(rule, qs) {
      const MAX = MATCHING_RIGHT_SIDE_MAX_CHARS;
      const results = [];
      for (const q of qs) {
        if (q.code !== 'matching:label:') continue;
        const violations = [];
        for (const a of q.answers) {
          const text = a.text.trim();
          const dashIdx = findMatchingDash(text);
          if (dashIdx === -1) continue;
          const rightRaw = text.slice(dashIdx + 1);
          const rightText = rightRaw.replace(/<[^>]+>/g, '');
          if (rightText.length > MAX) {
            violations.push({ lineNum: a.lineNum, length: rightText.length, text: rightText });
          }
        }
        if (violations.length > 0) {
          results.push(fail(rule,
            rule.message.replace('{num}', q.num).replace('{count}', violations.length),
            q.startLine, null,
            { type: 'matching-length', violations }
          ));
        }
      }
      return results;
    },

   'matching-html-on-right-check'(rule, qs) {
      const results = [];
      for (const q of qs) {
        if (q.code !== 'matching:label:') continue;
        const violations = [];
        for (const a of q.answers) {
          const text = a.text.trim();
          const dashIdx = findMatchingDash(text);
          if (dashIdx === -1) continue;
          const rightRaw = text.slice(dashIdx + 1);
          
          if (/<[a-zA-Z!][^>]*>/.test(rightRaw)) {
            violations.push({ lineNum: a.lineNum, text: text });
          }
        }
        if (violations.length > 0) {
          results.push(fail(rule,
            rule.message.replace('{num}', q.num).replace('{count}', violations.length),
            q.startLine, null,
            { type: 'matching-html-right', violations }
          ));
        }
      }
      return results;
    },

    'matching-img-align-check'(rule, qs) {
      const checkImgs = (text, lineNum, qNum) => {
        const imgs = text.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi) || [];
        return imgs.flatMap(img => {
          const alignMatch = img.match(/\balign\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          if (!alignMatch) return [];
          const alignVal = (alignMatch[1] || alignMatch[2] || alignMatch[3] || '').trim();
          const expected = img.replace(alignMatch[0], '').replace(/\s{2,}/g, ' ').trim();
          return [fail(rule,
            rule.message.replace('{num}', qNum).replace('{line}', lineNum).replace('{found}', alignVal),
            lineNum, alignMatch[0],
            { type: 'contextual-diff', actual: img, expected, truthAttr: alignMatch[0] }
          )];
        });
      };
      return qs.filter(q => q.code === 'matching:label:').flatMap(q => [
        ...checkImgs(q.stem, q.startLine, q.num),
        ...q.answers.flatMap(a => checkImgs(a.text, a.lineNum, q.num))
      ]);
    },

    'span-lang-check'(rule, qs, raw, lines) {
      // Valid BCP-47: primary subtag 2-3 letters, optional region/script subtags after hyphen
      const VALID_LANG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
      return lines.flatMap((line, i) => {
        const results = [];
        // Find all <span ...> tags on this line
        const spanRe = /<span\b([^>]*)>/gi;
        let m;
        while ((m = spanRe.exec(line)) !== null) {
          const attrs = m[1];
          // Only process spans that have a lang attribute at all
          if (!/\blang\s*=/i.test(attrs)) continue;
          const langMatch = attrs.match(/\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
          if (!langMatch) {
            // lang= present but malformed (no value/quotes)
            results.push(fail(rule,
              rule.message.replace('{line}', i+1).replace('{found}', 'malformed lang attribute — missing value or quotes'),
              i+1, 'lang='));
            continue;
          }
          const langVal = (langMatch[1] || langMatch[2] || langMatch[3] || '').trim();
          if (!langVal) {
            results.push(fail(rule,
              rule.message.replace('{line}', i+1).replace('{found}', 'lang="" is empty — provide a valid language code'),
              i+1, 'lang=""'));
          } else if (!VALID_LANG.test(langVal)) {
            results.push(fail(rule,
              rule.message.replace('{line}', i+1).replace('{found}', '"'+langVal+'" is not a valid BCP-47 language code'),
              i+1, langVal));
          }
        }
        return results;
      });
    },

    'ol-type-check'(rule, qs, raw, lines) {
      const TYPE_MAP = {
        '1': 'decimal', 'a': 'lower-alpha', 'A': 'upper-alpha', 'i': 'lower-roman', 'I': 'upper-roman'
      };
      return lines.flatMap((line, i) => {
        const olRe = /<ol\b([^>]*)>/gi;
        let m;
        const results = [];
        while ((m = olRe.exec(line)) !== null) {
          const attrs = m[1];
          const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
          if (!typeMatch) continue;
          const typeVal = (typeMatch[1] || typeMatch[2] || typeMatch[3] || '').trim();
          const styleVal = TYPE_MAP[typeVal] || typeVal;
          const actual = typeMatch[0];
          const expected = `style="list-style-type: ${styleVal};"`;
          results.push(fail(rule,
            rule.message.replace('{line}', i+1).replace('{found}', typeVal),
            i+1, actual,
            { type: 'contextual-diff', actual, expected, truthAttr: m[0] }));
        }
        return results;
      });
    },

    'bare-url-check'(rule, qs, raw, lines) {
      // Match URLs not inside HTML tag attributes (src=, href=, etc.) and not inside <span>...</span>
      // Patterns: https?://, www., or bare domain like example.com
      // The bare-domain branch excludes common file extensions (.txt, .js, .css, etc.) that are
      // not real TLDs and would produce false positives on filenames like style.txt
      const FILE_EXT_RE = /\.(?:txt|js|css|html?|jsx?|tsx?|py|rb|php|java|c|cpp|h|sh|bat|cmd|json|xml|csv|md|pdf|docx?|xlsx?|pptx?|zip|tar|gz|log|ini|cfg|yaml|yml|svg|png|jpe?g|gif|webp|ico|mp4|mp3|wav|avi|mov)$/i;
      const URL_RE = /(?<![="'`])\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z]{2,})+(?:\/[^\s<>"']*)?)/g;
      return lines.flatMap((line, i) => {
        // Strip all HTML tags — we only want to find URLs in visible text
        // But first, remove img src values so image URLs are not flagged
        const noImgs = line.replace(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi, '');
        // Remove content inside HTML tags (attribute values etc.)
        const textOnly = noImgs.replace(/<[^>]+>/g, '\x00'); // replace tags with null byte placeholder

        // Strip the x- correct-answer prefix before URL scanning so it is not included
        // in (or erroneously triggers) a URL match. The prefix is only ever at the very
        // start of an answer line (possibly after leading whitespace).
        const textOnlyStripped = textOnly.replace(/^(\s*)x-/, '$1\x00\x00');

        // Collect text ranges that are inside <span>, <code>, or <pre> tags in textOnly
        // by masking their content directly in textOnly (avoids index-mapping errors)
        const maskedForSpans = noImgs.replace(/<(span|code|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, m => '\x00'.repeat(m.replace(/<[^>]+>/g, '\x00').length))
                                     .replace(/<[^>]+>/g, '\x00')
                                     .replace(/^(\s*)x-/, '$1\x00\x00');
        const results = [];
        let um;
        URL_RE.lastIndex = 0;
        while ((um = URL_RE.exec(textOnlyStripped)) !== null) {
          const url = um[1];
          // Skip if inside a span, code, or pre tag (or masked x- prefix area)
          if (maskedForSpans[um.index] === '\x00') continue;
          // Skip filenames / bare extensions with common non-TLD extensions
          if (FILE_EXT_RE.test(url)) continue;
          // Skip if the matched "URL" is immediately followed by (, [, or = (likely a code snippet)
          const nextChar = textOnlyStripped[um.index + url.length];
          if (nextChar === '(' || nextChar === '[' || nextChar === '=') continue;
          
          // If it is a bare domain (no http:// or www.), restrict it to common TLDs
          if (!/^(?:https?:\/\/|www\.)/i.test(url)) {
            const domainPart = url.split('/')[0];
            const tldMatch = domainPart.match(/\.([a-zA-Z]+)$/);
            const tld = tldMatch ? tldMatch[1].toLowerCase() : '';
            const commonTlds = ['com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'us', 'uk', 'ca', 'me', 'info', 'biz', 'tv', 'app', 'dev', 'mil', 'int'];
            if (!commonTlds.includes(tld)) continue;
          }

          // Re-derive the actual URL text from the original line for the fix
          // (offset is the same because we only replaced 2 chars with 2 null bytes)
          results.push(fail(rule,
            rule.message.replace('{line}', i+1).replace('{found}', url.length > 50 ? url.slice(0,50)+'…' : url),
            i+1, url, {type:'contextual-diff', actual:url, expected:'<span>'+url+'</span>'}));
        }
        return results;
      });
    },

    'img-inline-valign-check'(rule, qs, raw, lines) {
      // Shared by three rules distinguished by subtype:
      //   'missing'     — no <br /> either side, text present, no vertical-align:middle
      //   'unnecessary' — <br /> on BOTH sides, has vertical-align:middle (shouldn't)
      //   'ambiguous'   — <br /> on ONE side only (intent unclear, flag for review)
      // All lines belonging to a matching question are exempt — images there follow
      // different rules: vertical-align:middle is optional, no <br /> needed.
      const matchingLines = new Set(
        qs.filter(q => q.code === 'matching:label:').flatMap(q => [
          ...q.stemLines,
          ...q.answers.map(a => a.lineNum)
        ])
      );

      // Exception: MC answer choices that consist ONLY of an image (and an optional x- prefix)
      // do not require <br /> tags around them and are exempt from these alignment checks.
      const mcImageAnswerLines = new Set(
        qs.filter(q => q.code === 'mc:radio:').flatMap(q => 
          q.answers.filter(a => {
            const textWithoutImg = a.text.replace(/^x-/, '').replace(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi, '').trim();
            return textWithoutImg === ''; // True if the line is purely an image
          }).map(a => a.lineNum)
        )
      );

      return lines.flatMap((line, i) => {
        if (matchingLines.has(i + 1)) return [];
        if (mcImageAnswerLines.has(i + 1)) return [];
        const imgs = line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi) || [];
        if (!imgs.length) return [];
        const results = [];
        for (const img of imgs) {
          // Defer to dedicated absmiddle rule
          if (/\balign\s*=\s*["']?absmiddle["']?/i.test(img)) continue;

          const hasValign = /style\s*=\s*"[^"]*vertical-align\s*:\s*middle[^"]*"/i.test(img);
          const imgIdx    = line.indexOf(img);
          const before    = line.substring(0, imgIdx).trim();
          const after     = line.substring(imgIdx + img.length).trim();

          // A side is "br-bounded" only if it actually contains a <br /> tag at its boundary.
          // An empty string (start/end of line) does NOT count — that just means the image
          // is at the edge of the line, which is ambiguous on its own.
          const hasBrBefore = /(?:<\/?\s*br\b[^>]*>\s*)+$/i.test(before);
          const hasBrAfter  = /^(?:\s*<\/?\s*br\b[^>]*>)+/i.test(after);

          const isStandalone = hasBrBefore && hasBrAfter;
          const isAmbiguous  = hasBrBefore !== hasBrAfter;  // exactly one side has <br />
          const isInline     = !hasBrBefore && !hasBrAfter;

          if (rule.subtype === 'missing' && isInline && !hasValign) {
            results.push(fail(rule, rule.message.replace('{line}', i+1), i+1));

          } else if (rule.subtype === 'unnecessary' && isStandalone && hasValign) {
            const styleMatch = img.match(/\s*style\s*=\s*"vertical-align\s*:\s*middle\s*;?"/i);
            if (styleMatch) {
              const expected = img.replace(styleMatch[0], '');
              results.push(fail(rule,
                rule.message.replace('{line}', i+1),
                i+1, styleMatch[0].trim(),
                { type: 'contextual-diff', actual: img, expected }));
            }

          } else if (rule.subtype === 'ambiguous' && isAmbiguous) {
  const side = hasBrBefore ? 'before' : 'after';
  
  // If <br /> is before the image but not after, check whether the image is
  // the last item in the question stem — if so, a trailing <br /> is not required.
  if (hasBrBefore && !hasBrAfter) {
    const stemQuestion = qs.find(q => q.stemLines.includes(i + 1));
    
    if (stemQuestion) {
      const isAbsolutelyLast = stemQuestion.stemLines[stemQuestion.stemLines.length - 1] === i + 1;
      const isFirstLine = stemQuestion.startLine === i + 1;
      const nothingAfterImg = after.replace(/<\/?\s*br\b[^>]*>/gi, '').trim() === '';
      
      // Checking `isFirstLine` accounts for the parser absorbing the first answer choice
      if ((isAbsolutelyLast || isFirstLine) && nothingAfterImg) {
        continue;
      }
    }
  }
  
  results.push(fail(rule,
    rule.message.replace('{line}', i+1) + ' (<br /> found ' + side + ' the image only)',
    i+1, null,
    { type: 'br-ambiguous', rawLine: line, img, side }));
}
        }
        return results;
      });
    },

    'img-absmiddle-check'(rule, qs, raw, lines) {
      // All lines belonging to a matching question are exempt — the matching-img-align rule covers them.
      const matchingLines = new Set(
        qs.filter(q => q.code === 'matching:label:').flatMap(q => [
          ...q.stemLines,
          ...q.answers.map(a => a.lineNum)
        ])
      );
      return lines.flatMap((line, i) => {
        if (matchingLines.has(i + 1)) return [];
        const imgs = line.match(/<img\b(?:"[^"]*"|'[^']*'|[^>])*>/gi) || [];
        const results = [];
        for (const img of imgs) {
          if (!/\balign\s*=\s*["']?absmiddle["']?/i.test(img)) continue;
          
          const imgIdx = line.indexOf(img);
          const before = line.substring(0, imgIdx).trim();
          const after = line.substring(imgIdx + img.length).trim();
          
          // FIXED: Simplified regex to correctly detect <br> tags at the boundaries
          const hasBrBefore = before === '' || /(?:<\/?\s*br\b[^>]*>\s*)+$/i.test(before);
          const hasBrAfter = after === '' || /^(?:\s*<\/?\s*br\b[^>]*>)+/i.test(after);
          
          const strippedImg = img.replace(/\s*\balign\s*=\s*["']?absmiddle["']?/i, '');
          let expectedImg;
          let msgSuffix = '';
          
          if (hasBrBefore && hasBrAfter) {
            // Condition 1: Standalone
            expectedImg = strippedImg;
            msgSuffix = ' (Standalone image — removing align attribute entirely)';
          } else if (!hasBrBefore && !hasBrAfter) {
            // Condition 2: Inline
            const existingStyle = strippedImg.match(/\bstyle\s*=\s*"([^"]*)"/i);
            if (existingStyle) {
              expectedImg = strippedImg.replace(/\bstyle\s*=\s*"([^"]*)"/i, 'style="vertical-align:middle; ' + existingStyle[1] + '"');
            } else {
              expectedImg = strippedImg.replace(/(\/?>)$/, ' style="vertical-align:middle;"$1');
            }
            msgSuffix = ' (Inline image — replacing with style="vertical-align:middle;")';
          } else {
            // Condition 3: Mixed/Unsure
            expectedImg = strippedImg;
            msgSuffix = ' (Intent unclear — image has <br /> on only one side. Removing attribute, but please review manually to add missing <br /> or style.)';
          }
          
          results.push(fail(rule, 
            rule.message.replace('{line}', i+1).replace('{found}', 'align="absmiddle"') + msgSuffix, 
            i+1, null, 
            { type: 'contextual-diff', actual: img, expected: expectedImg, truthAttr: img }
          ));
        }
        return results;
      });
    },

    'table-check'(rule, qs, raw, lines) {
      // ── Build a set of strict boundaries to prevent unclosed tables from bleeding ──
      const boundaries = new Set();
      for (const q of qs) {
        boundaries.add(q.startLine);
        if (q.pointsLine) boundaries.add(q.pointsLine);
        if (q.groupLine) boundaries.add(q.groupLine);
      }

      // ── Extract all table blocks (multi-line) with their starting line numbers ──
      const tables = [];
      let depth = 0, startLine = -1, buf = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Force-close an open table buffer if we hit a known question boundary
        // (but don't force-close if this is the exact line the table started on)
        if (depth > 0 && boundaries.has(lineNum) && lineNum > startLine) {
          tables.push({ startLine, html: buf.join('\n'), unclosedTable: true });
          buf = []; depth = 0;
        }

        const opens  = (line.match(/<table\b/gi)  || []).length;
        const closes = (line.match(/<\/table>/gi) || []).length;
        if (opens > 0 && depth === 0) { startLine = lineNum; buf = []; }
        if (depth > 0 || opens > 0) buf.push(line);
        depth += opens - closes;
        if (depth <= 0 && buf.length > 0) {
          tables.push({ startLine, html: buf.join('\n') });
          buf = []; depth = 0;
        }
      }
      
      // If depth > 0 after the loop, a <table> was never closed
      if (depth > 0 && buf.length > 0) {
        tables.push({ startLine, html: buf.join('\n'), unclosedTable: true });
      }
      if (!tables.length) return [];

      const results = [];
      const msg = (t, found) => rule.message.replace('{line}', t.startLine).replace('{found}', found);

      for (const t of tables) {
        const h = t.html;
        const sl = t.startLine;

        // ── sub: tag-pairs ──
        if (rule.subtype === 'tag-pairs') {
          const STRUCT = ['table','thead','tbody','tr','th','td','caption'];
          const issues = []; // { tag, type, lineNum, label, hIndex, matchLen }

          const lineAt = idx => sl + (h.substring(0, idx).match(/\n/g) || []).length;

          // ── Pass 1: malformed tags missing their '>' (e.g. </tr<tr> or <tr<tr>) ──
          // Covers both closing (</tag) and opening (<tag) variants.
          const malformedRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?=[^>]*<)/g;
          let mc;
          const malformedPositions = new Set();
          while ((mc = malformedRe.exec(h)) !== null) {
            const tag2 = mc[1].toLowerCase();
            if (!STRUCT.includes(tag2)) continue;
            const fragment = h.substring(mc.index);
            const nextLt = fragment.indexOf('<', 1);
            const nextGt = fragment.indexOf('>');
            if (nextGt === -1 || (nextLt !== -1 && nextLt < nextGt)) {
              malformedPositions.add(mc.index);
              const isClose = mc[0].startsWith('</');
              issues.push({
                tag: tag2, type: 'malformed',
                lineNum: lineAt(mc.index),
                label: (isClose ? '</' : '<') + tag2 + '> tag is malformed — missing its closing ">"',
                hIndex: mc.index, matchLen: mc[0].length
              });
            }
          }

          // ── Pass 2: unmatched open/close pairs per tag type ──
          for (const tag of STRUCT) {
            const tagRe = new RegExp('<' + tag + '\\b[^>]*>|<\\/' + tag + '\\s*>', 'gi');
            let m;
            const stack = [];
            const tagErrors = [];

            while ((m = tagRe.exec(h)) !== null) {
              if (malformedPositions.has(m.index)) continue;
              if (m[0].startsWith('</')) {
                if (stack.length > 0) stack.pop();
                else tagErrors.push({ type: 'extra', match: m[0], index: m.index });
              } else {
                stack.push({ match: m[0], index: m.index });
              }
            }
            for (const u of stack) tagErrors.push({ type: 'unclosed', match: u.match, index: u.index });

            for (const err of tagErrors) {
              issues.push({
                tag,
                type: err.type,
                lineNum: lineAt(err.index),
                label: err.type === 'unclosed'
                  ? '<' + tag + '> opened but never closed — add </' + tag + '>'
                  : '</' + tag + '> found with no matching opening <' + tag + '>',
                hIndex: err.index, matchLen: err.match.length
              });
            }
          }

          // ── Pass 3: nesting order (tbody before thead) ──
          if (/<tbody/i.test(h) && /<thead/i.test(h) && h.indexOf('<tbody') < h.indexOf('<thead')) {
            const tbodyIdx = h.indexOf('<tbody');
            issues.push({
              tag: 'thead/tbody', type: 'order',
              lineNum: sl + (h.substring(0, tbodyIdx).match(/\n/g) || []).length,
              label: '<tbody> appears before <thead> — sections are in the wrong order',
              hIndex: tbodyIdx, matchLen: 6
            });
          }

          if (issues.length) {
            issues.sort((a, b) => {
              if (a.type === 'malformed' && b.type !== 'malformed') return -1;
              if (b.type === 'malformed' && a.type !== 'malformed') return 1;
              return a.lineNum - b.lineNum;
            });

            const errorCount = issues.length;
            const summaryMsg = errorCount === 1
              ? issues[0].label
              : errorCount + ' tag pair issues — see details below';

            t.hasTagPairErrors = true;

            results.push(fail(
              rule,
              msg(t, summaryMsg),
              issues[0].lineNum,
              h.substring(issues[0].hIndex, issues[0].hIndex + issues[0].matchLen),
              { type: 'table-issues', issues, rawHtml: h, tableStartLine: sl }
            ));
          }
        }
        // ── sub: required-sections ──
        else if (rule.subtype === 'required-sections') {
          if (!/<thead\b/i.test(h))
            results.push(fail(rule, msg(t, 'missing <thead> section'), sl, 'missing <thead>'));
          if (!/<\/thead>/i.test(h) && /<thead\b/i.test(h))
            results.push(fail(rule, msg(t, '<thead> is not closed with </thead>'), sl, 'not closed'));
          if (!/<tbody\b/i.test(h))
            results.push(fail(rule, msg(t, 'missing <tbody> section'), sl, 'missing <tbody>'));
          if (!/<th\b/i.test(h))
            results.push(fail(rule, msg(t, 'no <th> header cells found — tables must have column or row headers'), sl, 'no <th>'));
        }

        // ── sub: border-cellpadding ──
        else if (rule.subtype === 'border-cellpadding') {
          const tableTagM = h.match(/<table\b([^>]*)>/i);
          if (tableTagM) {
            const actualTag = tableTagM[0];
            let attrs = tableTagM[1];
            const hasBorderOk = /\bborder\s*=\s*["']?1["']?/i.test(attrs);
            const cpMatch = attrs.match(/\bcellpadding\s*=\s*["']?(\d*)["']?/i);
            const hasCpOk = cpMatch && cpMatch[1];
            if (!hasBorderOk || !hasCpOk) {
              let fixed = attrs;
              if (!/\bborder\s*=/i.test(fixed)) fixed = ' border="1"' + fixed;
              else fixed = fixed.replace(/\bborder\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, 'border="1"');
              if (!/\bcellpadding\s*=/i.test(fixed)) fixed = fixed + ' cellpadding="10"';
              else fixed = fixed.replace(/\bcellpadding\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, 'cellpadding="10"');
              const expectedTag = '<table' + fixed + '>';
              const issues = [];
              if (!hasBorderOk) issues.push('missing or incorrect border="1"');
              if (!hasCpOk) issues.push(!cpMatch ? 'missing cellpadding attribute' : 'cellpadding is empty');
              results.push(fail(rule, msg(t, issues.join('; ') + ' on <table>'), sl, actualTag,
                { type: 'contextual-diff', actual: actualTag, expected: expectedTag, truthAttr: actualTag }));
            }
          }
        }

        // ── sub: th-scope ──
        else if (rule.subtype === 'th-scope') {
          const VALID_SCOPE = ['col','row','colgroup','rowgroup'];

          // Determine suggested scope from table structure
          const theadBlock = h.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
          const tbodyBlock = h.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
          const theadHasTh = theadBlock ? /<th\b/i.test(theadBlock[1]) : false;
          const tbodyHasTh = tbodyBlock  ? /<th\b/i.test(tbodyBlock[1])  : false;
          let suggestedScope = null;
          if      (theadHasTh && !tbodyHasTh) suggestedScope = 'col';
          else if (!theadHasTh && tbodyHasTh)  suggestedScope = 'row';
          // mixed = null → flag for review

          const thRe = /<th\b([^>]*)>/gi;
          let m;
          while ((m = thRe.exec(h)) !== null) {
            const actualTag = m[0];
            const attrs = m[1];
            
            // Calculate the exact line number where this specific <th> tag lives
            const lineOffset = (h.substring(0, m.index).match(/\n/g) || []).length;
            const actualLineNum = sl + lineOffset;
            
            const scopeM = attrs.match(/\bscope\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
            
            if (!scopeM) {
              const suggestion = suggestedScope
                ? ' — suggested: scope="'+suggestedScope+'"'
                : ' — review: could not auto-determine scope (mixed th placement)';
              
              const suggestedVal = suggestedScope || 'col';
              const expectedTag = actualTag.replace(/<th\b/i, '<th scope="' + suggestedVal + '"');
              
              results.push(fail(rule, msg(t, '<th> missing scope attribute'+suggestion), actualLineNum, null, {
                type: 'contextual-diff', actual: actualTag, expected: expectedTag, truthAttr: actualTag
              }));
            } else {
              const val = (scopeM[1] || scopeM[2] || '').trim().toLowerCase();
              if (!val) {
                const expectedTag = actualTag.replace(/\bscope\s*=\s*["']{2}/i, 'scope="col"');
                results.push(fail(rule, msg(t, '<th> has empty scope="" — must be col, row, colgroup, or rowgroup'), actualLineNum, null, {
                  type: 'contextual-diff', actual: actualTag, expected: expectedTag, truthAttr: actualTag
                }));
              } else if (!VALID_SCOPE.includes(val)) {
                const expectedTag = actualTag.replace(/\bscope\s*=\s*["']([^"']*)["']/i, 'scope="col"');
                results.push(fail(rule, msg(t, '<th> has unrecognised scope="'+val+'" — valid values: col, row, colgroup, rowgroup'), actualLineNum, null, {
                  type: 'contextual-diff', actual: actualTag, expected: expectedTag, truthAttr: actualTag
                }));
              }
            }
          }
        }

       // ── sub: structure ──
        else if (rule.subtype === 'structure') {
          // Skip if tag-pairs already found issues — broken tags make column counts unreliable
          if (t.hasTagPairErrors) continue;
          // Determine column count from the header row (most reliable baseline)
          const theadBlock = h.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
          let colCount = 0;
          if (theadBlock) {
            const firstRow = theadBlock[1].match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
            if (firstRow) {
              const cells = firstRow[1].match(/<(?:th|td)\b[^>]*>/gi) || [];
              colCount = cells.reduce((sum, c) => {
                const cs = c.match(/colspan\s*=\s*["']?(\d+)["']?/i);
                return sum + (cs ? parseInt(cs[1]) : 1);
              }, 0);
            }
          }

          if (colCount === 0) continue; // can't validate without a baseline

          // Check every tbody row
          const tbodyBlock = h.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
          if (!tbodyBlock) continue;
          
          let ri = 0;
          const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
          let mRow;
          
          while ((mRow = trRe.exec(tbodyBlock[1])) !== null) {
            const rowHtml = mRow[0];
            const cells = rowHtml.match(/<(?:td|th)\b[^>]*>/gi) || [];
            const effective = cells.reduce((sum, c) => {
              const cs = c.match(/colspan\s*=\s*["']?(\d+)["']?/i);
              return sum + (cs ? parseInt(cs[1]) : 1);
            }, 0);
            
            if (effective !== colCount) {
              // Calculate exact line number of this <tr>
              const globalIndex = h.indexOf(tbodyBlock[1]) + mRow.index;
              const lineOffset = (h.substring(0, globalIndex).match(/\n/g) || []).length;
              const actualLineNum = sl + lineOffset;

              // Record the char range of this <tr>…</tr> in h for highlighting
              const trAbsStart = h.indexOf(tbodyBlock[1]) + mRow.index;
              const trAbsEnd   = trAbsStart + mRow[0].length;

              results.push(fail(rule,
                msg(t, 'tbody row '+(ri+1)+' has '+effective+' effective column(s) but header has '+colCount+' — check for missing or extra cells'),
                actualLineNum, 'check for missing or extra cells',
                { type: 'formatted-code', rawHtml: h, colCount, mismatchRanges: [{ start: trAbsStart, end: trAbsEnd, rowIdx: ri, effective }], tableStartLine: sl }));
            }
            ri++;
          }
        }

        // ── sub: align-center ──
        else if (rule.subtype === 'align-center') {
          // Check <table>, <tr>, <td>, <th>, <caption> for align="center"
          const TABLE_TAGS = /<(?:table|tr|td|th|caption)\b[^>]*>/gi;
          let m;
          while ((m = TABLE_TAGS.exec(h)) !== null) {
            if (/\balign\s*=\s*["']?center["']?/i.test(m[0])) {
              const tagName = m[0].match(/<(\w+)/)[1];
              const lineOffset = (h.substring(0, m.index).match(/\n/g) || []).length;
              const actualLineNum = sl + lineOffset;
              const actualTag = m[0];
              // Build expected: remove align="center" and add/merge style="text-align: center;"
              let expectedTag = actualTag.replace(/\s*\balign\s*=\s*["']?center["']?/gi, '');
              const existingStyle = expectedTag.match(/\bstyle\s*=\s*"([^"]*)"/i);
              if (existingStyle) {
                const merged = existingStyle[1].replace(/text-align\s*:[^;]*(;|$)/i, '').trim().replace(/;$/, '');
                expectedTag = expectedTag.replace(/\bstyle\s*=\s*"([^"]*)"/i, 'style="text-align: center;' + (merged ? ' ' + merged + ';' : '') + '"');
              } else {
                expectedTag = expectedTag.replace(/<(\w+)/, '<$1 style="text-align: center;"');
              }
              results.push(fail(rule,
                msg(t, 'align="center" found on '+tagName+' tag'),
                actualLineNum, 'align="center"',
                { type: 'contextual-diff', actual: actualTag, expected: expectedTag, truthAttr: actualTag }));
            }
          }
        }
      }

      return results;
    }
  };

  function run(rawText) {
    const{rules,categories}=RULES_DATA;
    const lines=rawText.split('\n');
    const{questions}=parseQuestions(rawText);
    const allResults=[];
    for(const rule of rules){
      const handler=handlers[rule.type];
      if(!handler){console.warn('No handler:',rule.type);continue;}
      try{
        const out=handler(rule,questions,rawText,lines);
        if(!out||out.length===0) allResults.push(pass(rule));
        else allResults.push(...out);
      }catch(e){console.error('Rule error:',rule.id,e);}
    }
    // Cross-suppression: for any question where en-dash-context fired,
    // remove the en dash entry from the special-chars-auto chars array.
    // If that leaves the chars array empty, drop the whole result.
    const enDashContextQNums = new Set(
      allResults
        .filter(r => r.status==='fail' && r.extra && r.extra.type==='en-dash-context')
        .map(r => r.extra.qNum)
    );
    const filteredResults = allResults.map(r => {
      if (r.status==='fail' && r.extra && r.extra.type==='special-chars' && r.extra.tier==='auto'
          && enDashContextQNums.has(r.extra.qNum)) {
        const trimmed = r.extra.chars.filter(c => c.char !== '\u2013');
        if (!trimmed.length) return null;
        return { ...r, extra: { ...r.extra, chars: trimmed } };
      }
      return r;
    }).filter(Boolean);

    const grouped={};
    for(const cat of Object.keys(categories)) grouped[cat]={label:categories[cat],passes:[],failures:[]};
    for(const r of filteredResults){
      if(!grouped[r.rule.category]) continue;
      (r.status==='pass'?grouped[r.rule.category].passes:grouped[r.rule.category].failures).push(r);
    }
    for(const cat of Object.values(grouped)){
      const seen=new Set();
      cat.passes=cat.passes.filter(p=>seen.has(p.rule.id)?false:(seen.add(p.rule.id),true));
    }
    const totalErrors=allResults.filter(r=>r.status==='fail'&&r.rule.severity==='error').length;
    const totalWarnings=allResults.filter(r=>r.status==='fail'&&r.rule.severity==='warning').length;
    const totalPasses=new Set(allResults.filter(r=>r.status==='pass').map(r=>r.rule.id)).size;
    return{grouped,categories,totalErrors,totalWarnings,totalPasses,total:rules.length,questionCount:questions.length,questions};
  }
  return{run};
})();
window._checker_run = text => {
  // Thin wrapper that returns a flat results array alongside the normal report,
  // used by the bulk-fix engine's silent re-audit (Pass 1 → Pass 2 bridge).
  const report = AssessmentChecker.run(text);
  const results = [];
  for (const cat of Object.values(report.grouped)) {
    for (const r of cat.failures) results.push(r);
  }
  return { ...report, results };
};

