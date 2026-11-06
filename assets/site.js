// Browser behaviour for every page: light/dark toggle, quick search (Ctrl/⌘ K or "/"),
// copy buttons on code blocks, and Umami custom events. Pages are complete HTML without it.
(() => {
  const $ = s => document.querySelector(s);
  const prefix = document.body.dataset.prefix || '';
  const pageId = document.body.dataset.page;
  // Umami custom events; a no-op when the script is blocked or not loaded yet.
  const track = (name, data) => { try { window.umami && window.umami.track(name, data); } catch (e) {} };
  let data = { chapters: [], patterns: [] };
  try { data = JSON.parse($('#course-data').textContent); } catch (e) {}

  /* ── Light / dark toggle (shared with sha-hin.github.io: same origin, same key) ── */
  const root = document.documentElement;
  const themeBtn = $('.theme-toggle');
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const currentTheme = () => root.getAttribute('data-theme') || (mq && mq.matches ? 'dark' : 'light');
  const syncTheme = () => themeBtn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    syncTheme();
    track('Switch theme', { to: next });
  }
  themeBtn.addEventListener('click', toggleTheme);
  if (mq) { const f = () => { if (!root.getAttribute('data-theme')) syncTheme(); }; mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f); }
  syncTheme();

  /* ── Quick search ── */
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll('.k-mod').forEach(k => { k.textContent = mac ? '⌘' : 'Ctrl'; });

  const wrap = document.createElement('div');
  wrap.className = 'cmdk';
  wrap.hidden = true;
  wrap.innerHTML = `<div class="cmdk-back" data-close></div>
    <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Find a scene or pattern">
      <div class="cmdk-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
      <input type="text" placeholder="A pattern or an incident: refunds, webhooks, cache, locks…" aria-label="Find a scene or pattern" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <ul class="cmdk-list" role="listbox"></ul>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('input'), list = wrap.querySelector('.cmdk-list');
  const go = (url, from) => { track('Open chapter', { to: url, from }); location.href = url; };

  const items = [
    ...data.chapters.map(c => ({
      g: 'Scenes', t: c.title, sub: c.label + ' · ' + c.patterns.join(' · '), i: String(c.n), id: c.slug,
      s: c.ready ? '' : 'coming soon', off: !c.ready,
      kw: c.patterns.join(' '),
      run: () => go(c.ready ? prefix + c.slug + '/' : prefix + '#chapters', 'search'),
    })),
    ...data.patterns.map(p => ({
      g: 'Patterns', t: p.name, sub: `Scene ${p.chapter}: ${p.chapterTitle}`, i: p.gof ? 'G' : '·', s: p.gof ? 'Gang of Four' : 'not in the book', off: !p.ready,
      kw: p.chapterTitle,
      run: () => go(p.ready ? prefix + p.slug + '/' : prefix + '#patterns', 'search'),
    })),
    { g: 'Actions', t: 'Switch light / dark theme', i: '◐', kw: 'dark light mode theme', run: toggleTheme },
    { g: 'Actions', t: 'Source on GitHub', i: '↗', kw: 'github code repo', run: () => { track('View source'); location.href = 'https://github.com/sha-hin/pattern-playbook'; } },
  ];

  let shown = [], sel = 0, lastFocus = null;
  function score(it, q) {
    if (!q) return 1;
    const name = it.t.toLowerCase(), rest = ((it.sub || '') + ' ' + (it.kw || '') + ' ' + it.g).toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (!words.every(w => name.includes(w) || rest.includes(w))) return 0;
    return name.startsWith(q) ? 4 : name.includes(q) ? 3 : (it.sub || '').toLowerCase().includes(q) ? 2 : 1;
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    const ranked = items.map((it, i) => ({ it, sc: score(it, q), i })).filter(x => x.sc > 0);
    if (q) ranked.sort((a, b) => b.sc - a.sc || a.i - b.i);
    shown = [];
    let grp = null;
    ranked.forEach(({ it }) => {
      if (!q && it.g !== grp) { grp = it.g; const h = document.createElement('li'); h.className = 'cmdk-grp'; h.setAttribute('role', 'presentation'); h.textContent = grp; list.appendChild(h); }
      const li = document.createElement('li');
      li.className = 'cmdk-item' + (it.off ? ' off' : '');
      li.setAttribute('role', 'option');
      li.id = 'cmdk-opt-' + shown.length;
      li.innerHTML = `<span class="ci"></span><span class="ct"><span></span>${it.sub ? '<small></small>' : ''}</span><span class="cs"></span>`;
      li.querySelector('.ci').textContent = it.i;
      li.querySelector('.ct span').textContent = it.t;
      if (it.sub) li.querySelector('.ct small').textContent = it.sub;
      li.querySelector('.cs').textContent = it.id && it.id === pageId ? 'you are here' : (it.s || '');
      const idx = shown.length;
      li.addEventListener('mousemove', () => { if (sel !== idx) { sel = idx; mark(); } });
      li.addEventListener('click', () => { sel = idx; run(); });
      shown.push({ it, el: li });
      list.appendChild(li);
    });
    if (!shown.length) { const e = document.createElement('li'); e.className = 'cmdk-empty'; e.textContent = 'Nothing matches. Try a problem word like "pricing" or "webhook".'; list.appendChild(e); }
    sel = Math.min(sel, Math.max(shown.length - 1, 0));
    mark();
  }
  function mark() {
    shown.forEach((x, i) => { x.el.setAttribute('aria-selected', i === sel ? 'true' : 'false'); if (i === sel) x.el.scrollIntoView({ block: 'nearest' }); });
    input.setAttribute('aria-activedescendant', shown[sel] ? shown[sel].el.id : '');
  }
  function run() { const x = shown[sel]; if (!x) return; close(); setTimeout(() => x.it.run(), 20); }
  function open() {
    if (!wrap.hidden) return;
    lastFocus = document.activeElement;
    wrap.hidden = false; input.value = ''; sel = 0; render(); input.focus();
    document.body.style.overflow = 'hidden';
    track('Open search');
  }
  function close() {
    if (wrap.hidden) return;
    wrap.hidden = true; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  input.addEventListener('input', () => { sel = 0; render(); });
  wrap.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) close(); });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { sel = (sel + 1) % shown.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); wrap.hidden ? open() : close(); return; }
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === '/' && !typing && wrap.hidden) { e.preventDefault(); open(); }
  });
  $('.searchbtn').addEventListener('click', open);

  /* ── Copy buttons on code blocks (not on program output) ── */
  document.querySelectorAll('pre.code').forEach(pre => {
    const box = pre.closest('.codebox');
    if (!box) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copybtn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    box.appendChild(btn);
    btn.addEventListener('click', () => {
      // A diff copies the complete new file, not the + / − view.
      const text = pre.dataset.copy !== undefined ? pre.dataset.copy : pre.textContent;
      const done = ok => {
        btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      };
      const select = () => {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        done(false);
      };
      try {
        navigator.clipboard.writeText(text).then(() => { done(true); track('Copy code', { page: pageId }); }, select);
      } catch (e) {
        select();
      }
    });
  });

  /* ── Previous / next chapter with the arrow keys ── */
  document.addEventListener('keydown', e => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing || !wrap.hidden || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const link = e.key === 'ArrowRight' ? $('a[rel="next"]') : e.key === 'ArrowLeft' ? $('a[rel="prev"]') : null;
    if (link) location.href = link.href;
  });
})();
