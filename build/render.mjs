// Shared HTML renderers used by build.mjs: escaping, inline text, PHP syntax colours,
// file diffs and the small box-and-arrow drawings.

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline text: `code`, **bold**. Everything else is escaped.
// [text](F#anchor) links to a section of the foundation page (lesson 0).
export const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${url.startsWith('F#') ? `../00-foundation/#${url.slice(2)}` : url}">${text}</a>`);

export const paras = list => (list || []).map(p => `<p>${inline(p)}</p>`).join('');

// ── PHP syntax colours. Returns one HTML string per source line. ──
const KW = new Set('abstract and as break case catch class clone const continue declare default do echo else elseif enum extends final finally fn for foreach function if implements instanceof interface match namespace new or private protected public readonly require return static switch throw trait try use var while yield'.split(' '));
const LIT = new Set(['true', 'false', 'null', 'TRUE', 'FALSE', 'NULL']);
const TYPES = new Set('array bool callable float int iterable mixed never object string void self parent'.split(' '));

export function highlightLines(src) {
  const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?!\[)[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(\$[A-Za-z_]\w*)|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
  const out = [];
  let last = 0, m;
  const push = (text, cls) => { if (text) out.push([text, cls]); };
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index), '');
    last = re.lastIndex;
    const [t, com, str, v, num, word] = m;
    if (com) push(t, 'c');
    else if (str) push(t, 's');
    else if (v) push(t, v === '$this' ? 'k' : 'v');
    else if (num) push(t, 'n');
    else if (word) {
      const before = src.slice(Math.max(0, m.index - 2), m.index);
      const after = /^\s*\(/.test(src.slice(last));
      if (before === '->') push(t, after ? 'f' : '');
      else if (KW.has(t.toLowerCase()) && !before.endsWith(':')) push(t, 'k');
      else if (LIT.has(t) || TYPES.has(t)) push(t, 'k');
      else if (after) push(t, 'f');
      else if (/^[A-Z]/.test(t)) push(t, 't');
      else push(t, '');
    }
  }
  push(src.slice(last), '');

  const lines = [''];
  for (const [text, cls] of out) {
    text.split('\n').forEach((piece, i) => {
      if (i > 0) lines.push('');
      if (piece) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(piece)}</span>` : esc(piece);
    });
  }
  return lines;
}

// ── Other languages: one combined regex per language. Each rule is [pattern, class];
// patterns use only non-capturing groups, so the matching rule is the group that matched.
const LANGS = {
  yaml: [
    [String.raw`(?:^|(?<=\s))#[^\n]*`, 'c'],
    [String.raw`'[^'\n]*'|"[^"\n]*"`, 's'],
    [String.raw`^[ \t]*(?:- )?[\w.-]+(?=:(?:\s|$))`, 't'],
    [String.raw`(?<=:\s*|[\[,]\s*|- )(?:true|false|null|yes|no)\b`, 'k'],
    [String.raw`\b\d+(?:\.\d+)?\b`, 'n'],
  ],
  dockerfile: [
    [String.raw`^\s*#[^\n]*`, 'c'],
    [String.raw`^(?:FROM|RUN|COPY|ADD|WORKDIR|ENV|ARG|EXPOSE|CMD|ENTRYPOINT|USER|LABEL|VOLUME|HEALTHCHECK)\b`, 'k'],
    [String.raw`'[^'\n]*'|"[^"\n]*"`, 's'],
    [String.raw`(?<=\s)--?[\w-]+(?:=[^\s]+)?`, 'v'],
    [String.raw`(?<=^|&&\s|RUN\s|\|\s)\s*(?:apt-get|docker-php-ext-install|docker-php-ext-enable|pecl|composer|php)\b`, 'f'],
  ],
  shell: [
    [String.raw`(?:^|(?<=\s))#[^\n]*`, 'c'],
    [String.raw`'[^'\n]*'|"[^"\n]*"`, 's'],
    [String.raw`^\s*(?:\S+)`, 'f'],
    [String.raw`(?<=\s)--?[\w-]+(?:=[^\s]+)?`, 'v'],
  ],
  env: [
    [String.raw`(?:^|(?<=\s))#[^\n]*`, 'c'],
    [String.raw`^[A-Z0-9_]+(?==)`, 't'],
    [String.raw`(?<==)\d+(?=\s|$)`, 'n'],
    [String.raw`(?<==)[^\s#]+`, 's'],
  ],
  xml: [
    [String.raw`<!--[\s\S]*?-->`, 'c'],
    [String.raw`</?[\w:-]+|/?>`, 'k'],
    [String.raw`"[^"]*"`, 's'],
    [String.raw`(?<=\s)[\w:-]+(?==)`, 'v'],
  ],
  sql: [
    [String.raw`--[^\n]*`, 'c'],
    [String.raw`'[^'\n]*'`, 's'],
    [String.raw`\b(?:CREATE|DATABASE|TABLE|IF|NOT|EXISTS|SELECT|FROM|WHERE|AND|OR|INSERT|INTO|VALUES|UPDATE|SET|DELETE|GRANT|ON|TO|EXPLAIN|INDEX|ORDER|BY|LIMIT|IN)\b`, 'k'],
    [String.raw`\b\d+\b`, 'n'],
  ],
  json: [
    [String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`, 't'],
    [String.raw`"(?:\\.|[^"\\])*"`, 's'],
    [String.raw`\b(?:true|false|null)\b`, 'k'],
    [String.raw`-?\b\d+(?:\.\d+)?\b`, 'n'],
  ],
  js: [
    [String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, 'c'],
    [String.raw`'[^'\n]*'|"[^"\n]*"|` + '`[^`]*`', 's'],
    [String.raw`\b(?:import|from|export|default|const|let|var|function|return|if|else|async|await|new|class|of|in|for|while|true|false|null|undefined)\b`, 'k'],
    [String.raw`\b\d+(?:\.\d+)?\b`, 'n'],
    [String.raw`\b[A-Za-z_$][\w$]*(?=\()`, 'f'],
  ],
  // iCalendar (RFC 5545): BEGIN/END as keywords, property names as types, parameters as variables.
  ics: [
    [String.raw`^(?:BEGIN|END)(?=:)`, 'k'],
    [String.raw`^[A-Z][A-Z-]*(?=[;:])`, 't'],
    [String.raw`(?<=;)[A-Z-]+=[^:;\n]+`, 'v'],
  ],
  // A directory tree: the drawing characters muted, folder names as types, (notes) as comments.
  tree: [
    [String.raw`[│├└─]+`, 'c'],
    [String.raw`[\w.-]+/`, 't'],
    [String.raw`\([^)\n]*\)`, 'c'],
  ],
};
const LANG_RE = Object.fromEntries(Object.entries(LANGS).map(([k, rules]) => [k, new RegExp(rules.map(([p]) => `(${p})`).join('|'), 'gm')]));

function highlightOther(src, lang) {
  const re = LANG_RE[lang], rules = LANGS[lang];
  let html = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(src))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const i = m.slice(1).findIndex(g => g !== undefined);
    html += esc(src.slice(last, m.index)) + `<span class="${rules[i][1]}">${esc(m[0])}</span>`;
    last = re.lastIndex;
  }
  return html + esc(src.slice(last));
}

// lang: 'php' (default) or one of LANGS. An unknown lang is a build error, never silent plain text.
export const codeHtml = (src, lang = 'php') => {
  if (lang === 'php') return highlightLines(src).join('\n');
  if (!LANGS[lang]) throw new Error(`No highlighter for lang "${lang}"`);
  return highlightOther(src, lang);
};

// ── Line diff (longest common subsequence; files here are small) ──
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(['=', i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', i, null]); i++; }
    else { ops.push(['+', null, j]); j++; }
  }
  while (i < n) ops.push(['-', i++, null]);
  while (j < m) ops.push(['+', null, j++]);
  return groupChanges(ops, a);
}

// Readability pass: a blank line or a lone brace that "matches" between two changes splits one
// logical change into confusing fragments. Treat such short trivial matches as changed, then show
// each changed block as all removed lines followed by all added lines.
const TRIVIAL = new Set(['', '{', '}', '};', ');', '];', ')', ']', '),']);
function groupChanges(ops, a) {
  const out = ops.map(o => o.slice());
  for (let k = 0; k < out.length; k++) {
    if (out[k][0] !== '=') continue;
    let end = k;
    while (end < out.length && out[end][0] === '=') end++;
    const run = out.slice(k, end);
    const between = k > 0 && end < out.length && out[k - 1][0] !== '=' && out[end][0] !== '=';
    if (between && run.length <= 2 && run.every(o => TRIVIAL.has(a[o[1]].trim()))) {
      for (let r = k; r < end; r++) out[r] = ['~', out[r][1], out[r][2]];
    }
    k = end - 1;
  }
  const result = [];
  let dels = [], adds = [];
  const flush = () => { result.push(...dels, ...adds); dels = []; adds = []; };
  for (const o of out) {
    if (o[0] === '=') { flush(); result.push(o); continue; }
    if (o[0] === '-' || o[0] === '~') { if (o[1] !== null) dels.push(['-', o[1], null]); }
    if (o[0] === '+' || o[0] === '~') { if (o[2] !== null) adds.push(['+', null, o[2]]); }
  }
  flush();
  return result;
}

// Renders the change from oldSrc to newSrc. Unchanged runs longer than 2*context are folded.
export function diffHtml(oldSrc, newSrc, context = 3) {
  const a = oldSrc.replace(/\n$/, '').split('\n'), b = newSrc.replace(/\n$/, '').split('\n');
  const ah = highlightLines(oldSrc.replace(/\n$/, '')), bh = highlightLines(newSrc.replace(/\n$/, ''));
  const ops = diffLines(a, b);
  const changed = ops.map(o => o[0] !== '=');
  const keep = ops.map((o, k) => {
    if (changed[k]) return true;
    for (let d = -context; d <= context; d++) if (changed[k + d]) return true;
    return false;
  });
  let html = '', added = 0, removed = 0, folded = 0;
  const flush = () => { if (folded) { html += `<span class="ln fold">⋯ ${folded} unchanged line${folded > 1 ? 's' : ''}</span>`; folded = 0; } };
  ops.forEach((o, k) => {
    if (!keep[k]) { folded++; return; }
    flush();
    if (o[0] === '=') html += `<span class="ln">${bh[o[2]] || ' '}</span>`;
    else if (o[0] === '+') { added++; html += `<span class="ln add">${bh[o[2]] || ' '}</span>`; }
    else { removed++; html += `<span class="ln del">${ah[o[1]] || ' '}</span>`; }
  });
  flush();
  return { html, added, removed };
}

// A complete file shown again after a change: every line of the new file, the added ones marked,
// the removed ones shown struck through in place (they are not part of the copied file).
export function changedFileHtml(oldSrc, newSrc, lang = 'php') {
  const a = oldSrc.replace(/\n$/, '').split('\n'), b = newSrc.replace(/\n$/, '').split('\n');
  const ah = codeHtml(oldSrc.replace(/\n$/, ''), lang).split('\n'), bh = codeHtml(newSrc.replace(/\n$/, ''), lang).split('\n');
  let html = '', added = 0, removed = 0;
  for (const o of diffLines(a, b)) {
    if (o[0] === '=') html += `<span class="ln">${bh[o[2]] || ' '}</span>`;
    else if (o[0] === '+') { added++; html += `<span class="ln add">${bh[o[2]] || ' '}</span>`; }
    else { removed++; html += `<span class="ln del">${ah[o[1]] || ' '}</span>`; }
  }
  return { html, added, removed };
}

// ── Box-and-arrow drawings (300 x 166 canvas) ──
// ['b', x, y, w, h, label, kind]   kind: n normal, v pattern, v2 pattern outline, i interface (dashed), x broken
// ['a', x1, y1, x2, y2, '', kind]  kind: k pattern colour, x broken, d dashed
// ['t', x, y, text, cls, anchor]   cls: s small, m mono, kv pattern colour, kx broken colour
function shape(el) {
  const t = el[0];
  if (t === 'b') {
    const [, x, y, w, h, label, kind] = el;
    const cls = { n: 'bn', v: 'bv', v2: 'bv2', i: 'bi', x: 'bx' }[kind] || 'bn';
    let s = `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="7"/>`;
    if (label) s += `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" class="${kind === 'v' || kind === 'v2' ? 'kv' : kind === 'x' ? 'kx' : ''}">${esc(label)}</text>`;
    return s;
  }
  if (t === 'a') {
    const [, x1, y1, x2, y2, , kind] = el;
    const cls = kind === 'k' ? 'lk' : kind === 'x' ? 'lx' : kind === 'd' ? 'ld' : 'ln';
    return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${kind === 'x' ? 'arx' : 'ar'})"/>`;
  }
  if (t === 't') {
    const [, x, y, text, cls, anchor] = el;
    return `<text x="${x}" y="${y}" class="${cls || ''}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(text)}</text>`;
  }
  return '';
}

export const svg = (els, label) => `<svg class="d" viewBox="0 0 300 166" role="img" aria-label="${esc(label)}">${els.map(shape).join('')}</svg>`;

export const markers = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<marker id="ar" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" fill="#8a94a3"/></marker>
<marker id="arx" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" fill="#d1453b"/></marker>
</defs></svg>`;
