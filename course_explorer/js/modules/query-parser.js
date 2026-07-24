// =============================================================================
// QUERY-PARSER.JS
// Boolean/AST query tokenizer + parser for the Advanced Search modal, plus the guided rule-builder UI (buckets of ALL/ANY/NONE terms).
// =============================================================================


const TokenType = {
    AND: 'AND', OR: 'OR', NOT: 'NOT',
    LPAREN: 'LPAREN', RPAREN: 'RPAREN',
    TERM: 'TERM'
};

function tokenizeQuery(query) {
    const tokens = [];
    let i = 0;
    while (i < query.length) {
        let char = query[i];
        if (char === ' ' || char === '\t' || char === '\n') { i++; continue; }
        if (char === '(') { tokens.push({ type: TokenType.LPAREN, value: '(' }); i++; continue; }
        if (char === ')') { tokens.push({ type: TokenType.RPAREN, value: ')' }); i++; continue; }
        if (char === '"') {
            i++;
            let phrase = "";
            while (i < query.length && query[i] !== '"') { phrase += query[i]; i++; }
            i++; 
            if (phrase.trim()) tokens.push({ type: TokenType.TERM, value: phrase.trim(), exact: true });
            continue;
        }
        
        let word = "";
        while (i < query.length && ![' ', '\t', '\n', '(', ')', '"'].includes(query[i])) { word += query[i]; i++; }
        
        if (word) {
            let upperWord = word.toUpperCase();
            if (upperWord === 'AND') tokens.push({ type: TokenType.AND, value: upperWord });
            else if (upperWord === 'OR') tokens.push({ type: TokenType.OR, value: upperWord });
            else if (upperWord === 'NOT' || upperWord === 'EXCLUDE') tokens.push({ type: TokenType.NOT, value: 'NOT' });
            else tokens.push({ type: TokenType.TERM, value: word, exact: false });
        }
    }
    return tokens;
}

class BooleanParser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    peek() { return this.tokens[this.pos] || null; }
    consume() { return this.tokens[this.pos++]; }
    parse() {
        if (this.tokens.length === 0) return null;
        const ast = this.parseExpression();
        if (this.pos < this.tokens.length) throw new Error(`Unexpected token at end of query: ${this.peek().value}`);
        return ast;
    }
    parseExpression() {
        let left = this.parseTerm();
        while (this.peek() && this.peek().type === TokenType.OR) {
            this.consume(); 
            let right = this.parseTerm();
            left = { type: 'OR', left, right };
        }
        return left;
    }
    parseTerm() {
        let left = this.parseFactor();
        while (this.peek() && (this.peek().type === TokenType.AND || this.peek().type === TokenType.TERM || this.peek().type === TokenType.LPAREN || this.peek().type === TokenType.NOT)) {
            let isImplicit = true;
            if (this.peek().type === TokenType.AND) { this.consume(); isImplicit = false; }
            let right = this.parseFactor();
            left = { type: 'AND', left, right, implicit: isImplicit };
        }
        return left;
    }
    parseFactor() {
        const token = this.peek();
        if (!token) throw new Error("Unexpected end of query. Check your formatting.");
        if (token.type === TokenType.NOT) { this.consume(); let operand = this.parseFactor(); return { type: 'NOT', operand }; }
        if (token.type === TokenType.LPAREN) {
            this.consume();
            let expr = this.parseExpression();
            let next = this.consume();
            if (!next || next.type !== TokenType.RPAREN) throw new Error("Missing closing parenthesis ')'");
            return expr;
        }
        if (token.type === TokenType.TERM) return this.consume();
        throw new Error(`Unexpected operator: ${token.value}. Expected a search term.`);
    }
}

function compileQueryToAST(queryString) {
    try {
        const tokens = tokenizeQuery(queryString);
        const parser = new BooleanParser(tokens);
        return { ast: parser.parse(), error: null };
    } catch (err) {
        return { ast: null, error: err.message };
    }
}

function extractPositiveTerms(node, terms = []) {
    if (!node) return terms;
    if (node.type === 'AND' || node.type === 'OR') {
        extractPositiveTerms(node.left, terms);
        extractPositiveTerms(node.right, terms);
    }
    if (node.type === 'TERM') {
        terms.push(node);
    }
    return terms;
}

// ── ADVANCED SEARCH UI (GUIDED BUILDER) ──────────────────────────────────────
let advSearchMode = 'guided'; 
let ruleCounter = 0;

let bucketState = {
    all: [{ id: generateId(), value: '' }],
    any: [],
    none: []
};

function generateId() { return 'node_' + (ruleCounter++); }

window.toggleAdvancedSearch = function() {
    document.getElementById('advanced-search-modal').classList.add('active');
    document.body.style.overflow = 'hidden'; 
    renderBuckets();
};

window.closeAdvSearchModal = function(e) {
    if (e && e.target !== e.currentTarget && !e.target.classList.contains('close-modal-btn')) return; 
    document.getElementById('advanced-search-modal').classList.remove('active');
    document.body.style.overflow = ''; 
};

window.setAdvMode = function(mode) {
    advSearchMode = mode;
    document.getElementById('btn-mode-guided').classList.toggle('active', mode === 'guided');
    document.getElementById('btn-mode-power').classList.toggle('active', mode === 'power');
    document.getElementById('guided-builder-area').style.display = mode === 'guided' ? 'flex' : 'none';
    document.getElementById('power-user-area').style.display = mode === 'power' ? 'flex' : 'none';
    
    if (mode === 'power') {
        const compiled = buildBucketQueryString();
        if (compiled.trim()) document.getElementById('power-user-input').value = compiled;
    }
    updatePreview();
};

window.addBucketRule = function(bucketType) {
    bucketState[bucketType].push({ id: generateId(), value: '' });
    renderBuckets();
};

window.removeBucketRule = function(bucketType, id) {
    bucketState[bucketType] = bucketState[bucketType].filter(rule => rule.id !== id);
    renderBuckets();
};

window.updateBucketRule = function(bucketType, id, value) {
    const rule = bucketState[bucketType].find(r => r.id === id);
    if (rule) {
        rule.value = value;
        updatePreview();
    }
};

function renderBuckets() {
    ['all', 'any', 'none'].forEach(type => {
        const container = document.getElementById(`bucket-${type}-rules`);
        if (!container) return;
        
        if (bucketState[type].length === 0) {
            container.innerHTML = `<div style="font-size: 0.85rem; color: var(--secondary); font-style: italic; margin-bottom: 10px;">No terms added.</div>`;
            return;
        }
        
        let html = '';
        bucketState[type].forEach(rule => {
            html += `
                <div class="query-rule" id="${rule.id}">
                    <input type="text" class="rule-input" placeholder="Enter term or &quot;exact phrase&quot;" value="${escapeHtml(rule.value)}" oninput="updateBucketRule('${type}', '${rule.id}', this.value)">
                    <button class="remove-rule-btn" onclick="removeBucketRule('${type}', '${rule.id}')" title="Remove Term">&times;</button>
                </div>
            `;
        });
        container.innerHTML = html;
    });
    updatePreview();
}

function buildBucketQueryString() {
    let parts = [];
    const allTerms = bucketState.all.map(r => r.value.trim()).filter(v => v !== '');
    if (allTerms.length > 0) {
        if (allTerms.length === 1) parts.push(allTerms[0]);
        else parts.push(`(${allTerms.join(' AND ')})`);
    }
    const anyTerms = bucketState.any.map(r => r.value.trim()).filter(v => v !== '');
    if (anyTerms.length > 0) {
        if (anyTerms.length === 1) parts.push(anyTerms[0]);
        else parts.push(`(${anyTerms.join(' OR ')})`);
    }
    const noneTerms = bucketState.none.map(r => r.value.trim()).filter(v => v !== '');
    if (noneTerms.length > 0) {
         if (noneTerms.length === 1) parts.push(`NOT (${noneTerms[0]})`);
         else parts.push(`NOT (${noneTerms.join(' OR ')})`); 
    }
    return parts.join(' AND ');
}

window.updatePreview = function() {
    let rawString = '';
    if (advSearchMode === 'guided') { rawString = buildBucketQueryString(); } 
    else { const inputEl = document.getElementById('power-user-input'); rawString = inputEl ? inputEl.value : ''; }
    
    const previewEl = document.getElementById('adv-query-preview');
    const outputEl = document.getElementById('adv-compiled-output');
    
    if (!rawString.trim()) { previewEl.className = 'adv-preview'; outputEl.innerText = '...'; return; }
    
    const compiled = compileQueryToAST(rawString);
    if (compiled.error) {
        previewEl.className = 'adv-preview adv-error';
        outputEl.innerText = `Syntax Error: ${compiled.error}`;
    } else {
        previewEl.className = 'adv-preview';
        outputEl.innerText = rawString;
    }
};

window.clearAdvancedSearch = function() {
    bucketState = { all: [{ id: generateId(), value: '' }], any: [], none: [] };
    if (document.getElementById('power-user-input')) document.getElementById('power-user-input').value = '';
    renderBuckets(); 
    document.getElementById('search-input').value = ''; 
    runSearch('');
};

window.executeAdvancedSearch = function() {
    let rawString = '';
    if (advSearchMode === 'guided') rawString = buildBucketQueryString();
    else rawString = document.getElementById('power-user-input').value;
    
    const searchInput = document.getElementById('search-input');
    if (searchInput && rawString.trim()) {
        searchInput.value = rawString;
        document.getElementById('search-clear-btn').style.display = 'block';
        runSearch(rawString);
        closeAdvSearchModal();
    }
};

