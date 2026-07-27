'use strict';

// modules/auto-fixers.js
// One auto-fix function per fixable rule id, plus GLOBAL_FIXERS (the
// set of whole-string fixers that run in Pass 1 of the bulk-fix engine).
// Depends on: nothing at load time (fixers are invoked later by events.js).

// ─────────────────────────────────────────────────────────────────
// AUTO-FIXERS
// Each key matches a rule id. Fixers that operate on the whole raw
// string without needing a line number are listed in GLOBAL_FIXERS
// below — the bulk-fix engine uses that set to decide pass order.
// ─────────────────────────────────────────────────────────────────

// Fixers that rewrite the whole string with no result.lineNum dependency.
// These run first (Pass 1) in the bulk-fix engine. All others are
// contextual and run bottom-up in Pass 2 after a silent re-audit.
const GLOBAL_FIXERS = new Set([
  'self-closing-br','no-inline-styles','img-double-quotes','img-alt-quotes',
  'no-deprecated-tags','points-before-group','span-followed-by-br',
  'img-has-alt','span-self-closing','missing-lt-span','special-chars-auto',
  'img-no-dimensions','table-border-cellpadding','table-align-center',
  'font-tag-replace','ol-use-style-not-type',
]);

const autoFixers={
  'self-closing-br':    text=>text.replace(/<\/?\s*br\b[^><]*(?:>|(?=<|$))/gi,'<br />'),
  'no-inline-styles': text => {
    // Strip disallowed inline style attributes while preserving the same exceptions
    // that the inline-style-check rule allows:
    //   • style="vertical-align:middle;" on <img> tags
    //   • style="list-style-type:..." on <ol> tags
    //   • style="text-align:..." on any element
    //   • style="font-family:..." on <span> tags (produced by font-tag-replace)
    // Process tag-by-tag so we only strip styles inside actual HTML tags.
    return text.replace(/(<[a-zA-Z][a-zA-Z0-9]*\b[^>]*?>)/g, (tag) => {
      const styleMatch = tag.match(/\s*style\s*=\s*"([^"]*)"/i);
      if (!styleMatch) return tag;
      const styleVal = styleMatch[1];
      const norm = styleVal.replace(/\s/g, '').toLowerCase();
      const tagName = (tag.match(/^<([a-zA-Z][a-zA-Z0-9]*)/) || [])[1] || '';
      const tn = tagName.toLowerCase();
      // Keep allowed styles
      if (tn === 'img'  && norm === 'vertical-align:middle;') return tag;
      if (tn === 'ol'   && norm.startsWith('list-style-type:')) return tag;
      if (tn === 'span' && norm.startsWith('font-family:'))    return tag;
      if (norm.startsWith('text-align:')) return tag;
      // Strip disallowed style attribute
      return tag.replace(/\s*style\s*=\s*"[^"]*"/i, '');
    });
  },
  'img-double-quotes':  text=>text.replace(/<img([^>]*)>/gi,(_,a)=>'<img'+a.replace(/src\s*=\s*'([^']*)'/gi,'src="$1"').replace(/alt\s*=\s*'([^']*)'/gi,'alt="$1"')+'>'),
  'img-alt-quotes':     text=>text.replace(/(<img[^>]+>)/gi,t=>t.replace(/alt\s*=\s*"([^]*?)"(?=\s*\/?>|\s+[a-z]+(?:=|\s|>))/i,(_,inner)=>'alt="'+inner.replace(/"/g,"'")+'"')),
  'img-alt-symbol-words': (text, result) => {
    if (result.extra && result.extra.type === 'contextual-diff' && result.lineNum) {
      const lines = text.split('\n');
      const idx = result.lineNum - 1;
      if (lines[idx] !== undefined) {
        if (lines[idx].includes(result.extra.actual)) {
          // If the exact original string is still intact, replace it directly
          lines[idx] = lines[idx].replace(result.extra.actual, result.extra.expected);
        } else if (result.extra.targetToken) {
          // Fallback if the line was modified by a sibling fix:
          // Find the alt attribute and strictly target the symbol inside it
          lines[idx] = lines[idx].replace(/(alt\s*=\s*)(?:"([^"]*)"|'([^']*)')/i, (match, prefix, dq, sq) => {
            const quote = dq !== undefined ? '"' : "'";
            let inner = dq !== undefined ? dq : sq;
            
            if (result.extra.targetToken instanceof RegExp) {
              inner = inner.replace(result.extra.targetToken, ' ' + result.extra.replaceWith + ' ');
            } else {
              inner = inner.split(result.extra.targetToken).join(' ' + result.extra.replaceWith + ' ');
            }
            
            inner = inner.replace(/ {2,}/g, ' ').trim();
            return prefix + quote + inner + quote;
          });
        }
      }
      return lines.join('\n');
    }
    return text;
  },
  'no-deprecated-tags': text=>text
    .replace(/<b>([\s\S]*?)<\/b>/gi,'<strong>$1</strong>')
    .replace(/<i>([\s\S]*?)<\/i>/gi,'<em>$1</em>')
    .replace(/<u>([\s\S]*?)<\/u>/gi,'<span class="underline">$1</span>')
    .replace(/<s>([\s\S]*?)<\/s>/gi,'<del>$1</del>')
    .replace(/<bold>([\s\S]*?)<\/bold>/gi,'<strong>$1</strong>')
    .replace(/<italic>([\s\S]*?)<\/italic>/gi,'<em>$1</em>')
    .replace(/<\/b>/gi,'</strong>').replace(/<\/i>/gi,'</em>')
    .replace(/<\/u>/gi,'</span>').replace(/<\/s>/gi,'</del>'),
  'intra-question-blank-lines': (text, result) => {
    if (result.extra && result.extra.type === 'contextual-diff') {
      // Safely collapse the specific blank line using the contextual text block
      return text.replace(result.extra.actual, result.extra.expected);
    }
    return text;
  },
  'question-spacing': (text, result) => {
    if (!result || !result.extra || !result.lineNum) return text;
    const lines = text.split('\n');
    const idx = result.lineNum - 1; // Index of lastCurrLine
    
    // Determine the size of the gap between this question and the next
    const gapSize = result.extra.gapLines ? result.extra.gapLines.length : 0;
    
    // Remove the entire gap (including any junk) and insert exactly one blank line
    lines.splice(idx + 1, gapSize, '');
    
    return lines.join('\n');
  },
  'points-before-group':text=>text.replace(/(group:\s?\d+)\n(points:\s?\d+)/g,'$2\n$1'),
  // ── Shared helpers ────────────────────────────────────────────────
  // Most line-based fixers follow the same pattern: split on '\n', replace
  // result.extra.actual → result.extra.expected on the flagged line, rejoin.
  // _lineReplace() centralises that logic; fixers delegate to it.
  _lineReplace(text, result) {
    if (result.extra && result.extra.type === 'contextual-diff' && result.lineNum) {
      const lines = text.split('\n');
      const idx = result.lineNum - 1;
      if (lines[idx]) lines[idx] = lines[idx].replace(result.extra.actual, result.extra.expected);
      return lines.join('\n');
    }
    return text;
  },

  // Both matching swap fixers (right-side-length and html-on-right) use the same
  // algorithm: find the first non-tag dash and swap left ↔ right sides.
  _matchingSwap(text, result) {
    if (!result.extra || !result.extra.violations) return text;
    const lines = text.split('\n');
    result.extra.violations.forEach(v => {
      const idx = v.lineNum - 1;
      if (lines[idx] === undefined) return;
      const lineText = lines[idx];
      let inTag = false, dashIdx = -1;
      for (let i = 0; i < lineText.length; i++) {
        if (lineText[i] === '<') { inTag = true; continue; }
        if (lineText[i] === '>') { inTag = false; continue; }
        if (!inTag && lineText[i] === '-') { dashIdx = i; break; }
      }
      if (dashIdx === -1) return;
      const leftRaw = lineText.slice(0, dashIdx);
      const rightRaw = lineText.slice(dashIdx + 1);
      const m = leftRaw.match(/^(\s*(?:x-)?)(.*)/);
      const [prefix, left] = m ? [m[1], m[2]] : ['', leftRaw];
      lines[idx] = prefix + rightRaw + '-' + left;
    });
    return lines.join('\n');
  },
  // ─────────────────────────────────────────────────────────────────

  'span-unclosed'(text, result)           { return this._lineReplace(text, result); },
  'span-followed-by-br':text=>text.replace(/(<\/span>)(?:\s*<\/?\s*br\b[^><]*(?:>|(?=<|$)))*/gi,'$1 <br /><br />'),
  'span-attr-quotes'(text, result)        { return this._lineReplace(text, result); },
  'span-associatedlessons-format': (text, result) => {
    if (!result.extra || !result.lineNum) return text;
    const lines = text.split('\n');
    const idx = result.lineNum - 1;
    if (!lines[idx]) return text;
    if (result.extra.type === 'dual-pad-fix') {
      // Fix both the data-associatedlessons attribute value and the span content text
      lines[idx] = lines[idx]
        .replace(result.extra.attrActual, result.extra.attrExpected)
        .replace(result.extra.contentActual, result.extra.contentExpected);
    } else if (result.extra.type === 'contextual-diff') {
      lines[idx] = lines[idx].replace(result.extra.actual, result.extra.expected);
    }
    return lines.join('\n');
  },
  'img-has-alt':        text=>text.replace(/<img\b((?:"[^"]*"|'[^']*'|[^>])*?)(\/?>)/gi,(match,attrs,close)=>{
    if(/alt\s*=\s*"[^"]+"/.test(attrs)) return match;
    if(/alt\s*=\s*""/.test(attrs)) return '<img'+attrs.replace(/alt\s*=\s*""/,'alt="[Describe image here]"')+close;
    if(/alt/.test(attrs)) return match;
    return '<img'+attrs+' alt="[Describe image here]"'+close;
  }),
  'span-self-closing':  text=>text.replace(/(<span\b[^>]*)\s*\/>/gi, '$1>'),
  'span-content-match': (text, result) => {
    if (result.extra && result.extra.noAutoFix) return text;
    return autoFixers._lineReplace(text, result);
  },
  'missing-lt-span':    text=>text.replace(/(mc:radio:|essay:|tf:|fib:|matching:label:):?span\b/gi,(_,code)=>code+'<span'),
  'lt-gt-entities'(text, result)          { return this._lineReplace(text, result); },
 
  'special-chars-auto': (text, result) => {
    // Only replace the en dash (U+2013) if it is actually present in this result's
    // chars list. When the en dash was flagged as a possible minus sign it is removed
    // from the special-chars result and handled by the separate en-dash-context panel —
    // in that case the Apply Fix here must NOT touch it.
    const charsToFix = (result && result.extra && result.extra.chars) ? result.extra.chars : null;
    const fixEndash  = !charsToFix || charsToFix.some(c => c.char === '\u2013');
    let out = text
      .replace(/\u201c/g,'&ldquo;').replace(/\u201d/g,'&rdquo;')
      .replace(/\u2018/g,'&lsquo;').replace(/\u2019/g,'&rsquo;')
      .replace(/\u2014/g,'&mdash;');
   if (fixEndash) out = out.replace(/\u2013/g,'&ndash;');
    return out
      .replace(/\u2026/g,'...')
      .replace(/\u00d7/g,'&times;')
      .replace(/\u00f7/g,'&divide;')
      .replace(/\u00a0/g,' ')
      .replace(/\u00a9/g,'&copy;')
      .replace(/\u00ae/g,'<sup>&reg;</sup>')
      .replace(/\u2122/g,'<sup>&trade;</sup>')
      .replace(/\u2120/g,'<sup>&#8480;</sup>');
  },
  'img-no-dimensions':  text=>text.replace(/<img([^>]*)>/gi,(_,a)=>{
    // SVG exception: leave width alone on .svg images (see img-dimensions-check
    // in validation.js) — height is still stripped on every image, SVG or not.
    const srcMatch = a.match(/src\s*=\s*("[^"]*"|'[^']*')/i);
    const isSvg = !!(srcMatch && /\.svg(?:[?#]|["'])/i.test(srcMatch[1]));
    let attrs = a;
    if (!isSvg) attrs = attrs.replace(/\s*\bwidth\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi,'');
    attrs = attrs.replace(/\s*\bheight\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi,'');
    return '<img'+attrs+'>';
  }),
  'mark-tag': (text, result) => {
    if (result && result.extra && result.extra.type === 'contextual-diff' && result.lineNum) {
      const lines = text.split('\n');
      const idx = result.lineNum - 1;
      if (lines[idx] !== undefined) {
        const line = lines[idx];
        const removeToken = result.extra.removeToken;
        const replaceWith = result.extra.replaceWith !== undefined ? result.extra.replaceWith : '';
        if (removeToken && line.includes(removeToken)) {
          // Replace only the first occurrence — handles cases where the same token
          // might appear more than once, applying one fix at a time
          lines[idx] = line.replace(removeToken, replaceWith);
        } else {
          // Fallback: try the full-line swap (actual→expected, both trimmed)
          const actual   = result.extra.actual;
          const expected = result.extra.expected;
          if (line.trim() === actual) {
            const leadingWS = line.match(/^\s*/)[0];
            lines[idx] = leadingWS + expected;
          }
        }
      }
      return lines.join('\n');
    }
    // Fallback: global strip of well-formed mark tags only
    return text.replace(/<mark\b[^>]*>|<\/mark>/gi, '');
  },
  'table-border-cellpadding': text => text.replace(/<table\b([^>]*)>/gi, (match, attrs) => {
    let a = attrs;
    // border: add if missing, correct if not "1"
    if (!/\bborder\s*=/i.test(a)) {
      a = ' border="1"' + a;
    } else {
      a = a.replace(/\bborder\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, 'border="1"');
    }
    // cellpadding: add if missing or empty, correct value to 10
    if (!/\bcellpadding\s*=/i.test(a)) {
      a = a + ' cellpadding="10"';
    } else {
      a = a.replace(/\bcellpadding\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, 'cellpadding="10"');
    }
    return '<table' + a + '>';
  }),
  'table-align-center': text => text.replace(/(<(?:table|tr|td|th|caption)\b[^>]*?)\s*\balign\s*=\s*["']?center["']?([^>]*>)/gi,
    (match, pre, post) => {
      // Add style="text-align: center;" if no style attr present, or merge into existing
      const existing = pre.match(/\bstyle\s*=\s*"([^"]*)"/i);
      if (existing) {
        const merged = existing[1].replace(/text-align\s*:[^;]*(;|$)/i, '').trim().replace(/;$/, '');
        return pre.replace(/\bstyle\s*=\s*"([^"]*)"/i, 'style="text-align: center;' + (merged ? ' ' + merged + ';' : '') + '"') + post;
      }
      return pre + ' style="text-align: center;"' + post;
    }),

  'font-tag-replace':   text=>text.replace(/<font\s+face\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/font>/gi,(_,face,inner)=>{
    const f=face.trim();
    const family=/courier\s*new/i.test(f)?"'Courier New', Courier, monospace":"'"+f+"'";
    return '<span style="font-family: '+family+';">'+inner+'</span>';
  }),
  'ol-use-style-not-type': text=>text.replace(/<ol\b([^>]*)\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>/gi,
    (match, pre, dq, sq, bare, post) => {
      const TYPE_MAP = {'1':'decimal','a':'lower-alpha','A':'upper-alpha','i':'lower-roman','I':'upper-roman'};
      const typeVal = (dq || sq || bare || '').trim();
      const styleVal = TYPE_MAP[typeVal] || typeVal;
      // Remove the type= attribute, add/merge style
      const attrsNoType = (pre + post).replace(/\s*\btype\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '').trim();
      const existingStyle = attrsNoType.match(/\bstyle\s*=\s*"([^"]*)"/i);
      if (existingStyle) {
        return '<ol ' + attrsNoType.replace(/\bstyle\s*=\s*"([^"]*)"/i, 'style="list-style-type: '+styleVal+'; '+existingStyle[1]+'"') + '>';
      }
      return '<ol' + (attrsNoType ? ' '+attrsNoType : '') + ' style="list-style-type: '+styleVal+';">';
    }),
  // Both matching swap fixers use the same left↔right dash-swap algorithm
  'matching-right-side-length'(text, result) { return this._matchingSwap(text, result); },
  'matching-html-on-right'(text, result)     { return this._matchingSwap(text, result); },

  'matching-img-align'(text, result)         { return this._lineReplace(text, result); },
  'img-absmiddle'(text, result)              { return this._lineReplace(text, result); },
  'img-standalone-has-valign'(text, result)  { return this._lineReplace(text, result); },
  // img-ambiguous-valign: no auto-fix — intent must be determined manually

  'img-path-base'(text, result)    { return this._lineReplace(text, result); },
  'underscore-format'(text, result){ return this._lineReplace(text, result); },
  'bare-url-in-text'(text, result) { return this._lineReplace(text, result); }
};
