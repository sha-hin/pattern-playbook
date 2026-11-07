// Generates the static site from content/course.mjs, content/scenes/<slug>.mjs and the foundation:
//   index.html (course overview), one folder per ready scene, sitemap.xml, robots.txt, 404.html.
//
//   node build/build.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { esc, inline, paras, codeHtml, changedFileHtml, svg, markers } from './render.mjs';
import { DAYS, SCENES, FOUNDATION, OUTSIDE, dayOf } from '../content/course.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sha-hin.github.io/pattern-playbook/';
const REPO = 'https://github.com/sha-hin/pattern-playbook';
const BRAND = 'Pattern Playbook';
const TODAY = new Date().toISOString().slice(0, 10);
const PUBLISHED = '2026-11-06';
const AUTHOR = { name: 'Mohammed Shahin', url: 'https://sha-hin.github.io' };
// Umami Cloud website id (same account as the portfolio). Tracking only runs on sha-hin.github.io.
const UMAMI_ID = '37b7903a-c779-475f-b20f-18fe98cd4d70';

// Cache-busting: each asset URL carries a hash of its content.
const version = file => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex').slice(0, 10);
const V = { css: version('assets/style.css'), js: version('assets/site.js'), icon: version('assets/favicon.svg') };

const TOTAL = SCENES.length;
const ready = SCENES.filter(s => s.ready);
const load = async file => (await import(pathToFileURL(join(ROOT, 'content', file)).href)).default;

const BODY = {};
for (const s of ready) BODY[s.slug] = await load(`scenes/${s.slug}.mjs`);
const foundation = await load('foundation/index.mjs');

// Every file the reader writes is followed through the course. When a later scene shows the same
// file again, it is shown complete, with the lines that changed since its last version marked.
// A block is one file: its path is the file, optionally followed by a note in brackets.
const fileKey = path => (path ? path.replace(/ \(.*$/, '').trim() : '');
const isAppFile = key => /^(app|config|routes|database|tests|resources|bootstrap)\//.test(key) || /^(phpunit\.xml|composer\.json|Dockerfile|compose\.yaml)$/.test(key);
const codeBlocksOf = body => {
  const out = [];
  const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.code !== undefined) out.push(o); else Object.values(o).forEach(walk); } };
  if (body.sections) {
    for (const sec of [...body.sections, ...(body.afterReveal || [])]) walk(sec.blocks || []);
    walk(body.laravel?.blocks || []);
    walk(body.tests?.blocks || []);
  } else walk(body);
  return out;
};
const lastSeen = new Map();
const excerpts = [], combined = [];
for (const [where, body] of [['the foundation', foundation], ...ready.map(s => [`scene ${s.n}`, BODY[s.slug]])]) {
  for (const b of codeBlocksOf(body)) {
    const key = fileKey(b.path);
    if (!isAppFile(key)) continue;
    if (b.fragment) { if (!b.broken) excerpts.push(`${where}: ${b.path}`); continue; }
    if (key.includes(' · ')) { combined.push(`${where}: ${b.path}`); continue; }
    // A complete broken file is the "before": the fixed file right after it shows what the fix changed.
    // rewrite: a file replaced as a whole is shown plainly, because a diff of every line helps nobody.
    const seen = lastSeen.get(key);
    if (!b.broken) {
      if (b.rewrite) b.isRewrite = true;
      else if (seen) { b.prev = seen.code; b.prevWhere = seen.where === where ? 'the version above' : seen.where; }
      else b.isNew = true;
    }
    lastSeen.set(key, { code: b.code, where });
  }
}
if (combined.length) throw new Error(`One block per file. Split these:\n  ${combined.join("\n  ")}`);
if (process.env.LIST_EXCERPTS) console.log(`Excerpts of app files (${excerpts.length}):\n  ${excerpts.join('\n  ')}`);

// Pattern → the scene where it is named (for the index and the search). A pattern is listed once.
const PATTERNS = [];
for (const s of SCENES) for (const name of s.patterns) {
  if (!PATTERNS.some(p => p.name === name)) PATTERNS.push({ name, scene: s.n, sceneTitle: s.incident, slug: s.slug, ready: !!s.ready });
}
for (const name of OUTSIDE.patterns) PATTERNS.push({ name, scene: null, sceneTitle: OUTSIDE.title, slug: OUTSIDE.slug, ready: OUTSIDE.ready });
const whereTaught = p => p.scene === null ? 'End page' : `Scene ${p.scene}`;

const courseData = JSON.stringify({
  chapters: [
    { n: 0, title: FOUNDATION.title, patterns: [FOUNDATION.learn], slug: FOUNDATION.slug, ready: true, label: 'Foundation' },
    ...SCENES.map(s => ({ n: s.n, title: s.incident, patterns: [s.learn], slug: s.slug, ready: !!s.ready, label: `Day ${s.day} · Scene ${s.n}` })),
  ],
  patterns: PATTERNS.map(p => ({ name: p.name, chapter: p.scene ?? 'end', chapterTitle: p.sceneTitle, slug: p.slug, ready: p.ready })),
}).replace(/</g, '\\u003c');

const tagHtml = name => `<span class="ptag">${esc(name)}</span>`;

const tools = `<div class="tools">
<button type="button" class="searchbtn" aria-label="Search scenes and patterns (Ctrl K)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><span>Search</span><span class="keys" aria-hidden="true"><kbd class="k-mod">Ctrl</kbd><kbd>K</kbd></span></button>
<button type="button" class="iconbtn theme-toggle" aria-label="Switch to dark mode"><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>
</div>`;

function page({ title, description, url, prefix, pageId, type, jsonld, main }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="author" content="${AUTHOR.name}">
<meta name="theme-color" content="#f1f3f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1218" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${BRAND}: advanced Laravel in 7 days, one PMS, 44 production incidents">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}assets/og.png">
<link rel="icon" href="${prefix}assets/favicon.svg?v=${V.icon}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${prefix}assets/style.css?v=${V.css}">
<script defer src="https://cloud.umami.is/script.js" data-website-id="${UMAMI_ID}" data-domains="sha-hin.github.io"></script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body data-page="${pageId}" data-prefix="${prefix}">
${markers}
<div class="wrap">
<div class="topbar">
${pageId === 'hub' ? `<span class="brand">${BRAND}</span>` : `<a class="brand" href="${prefix}">${BRAND}</a>`}
${tools}
</div>
<main>
${main}
</main>
<footer class="credit">By <a href="${AUTHOR.url}" data-umami-event="Visit portfolio">${AUTHOR.name}</a> · PHP / Laravel developer · <a href="${REPO}" data-umami-event="View source">Source on GitHub</a></footer>
</div>
<script id="course-data" type="application/json">${courseData}</script>
<script src="${prefix}assets/site.js?v=${V.js}" defer></script>
</body>
</html>
`;
}

const website = { '@type': 'WebSite', '@id': `${SITE}#website`, name: BRAND, url: SITE, inLanguage: 'en' };
const person = { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url };

// ── Building blocks ────────────────────────────────────────────────────
// broken: the code that caused the incident, shown struck through in red so nobody copies it.
// prev: the file's previous version (an earlier scene), so the full file is shown with its changes marked.
function codeBlock({ path, code, lang, broken, prev, prevWhere, isNew, isRewrite }) {
  if (prev !== undefined && prev !== code) {
    const { html, added, removed } = changedFileHtml(prev, code, lang);
    const note = `changed since ${prevWhere}: <span class="plus">+${added}</span>${removed ? ` <span class="minus">−${removed}</span>` : ''}`;
    return `<div class="codebox changed">
<div class="filehead"><span class="path">${esc(path)}</span><span class="badge">${note}</span></div>
<pre class="code diff" data-copy="${esc(code.replace(/\n$/, ''))}"><code>${html}</code></pre>
</div>`;
  }
  const html = codeHtml(code.replace(/\n$/, ''), lang);
  const badge = broken ? '<span class="badge">the bug</span>' : isNew ? '<span class="badge new">new file</span>' : isRewrite ? '<span class="badge new">rewritten</span>' : '';
  return `<div class="codebox${broken ? ' broken' : ''}">
<div class="filehead"><span class="path">${esc(path || 'code')}</span>${badge}</div>
<pre class="code${broken ? ' rejected' : ''}"><code>${html}</code></pre>
</div>`;
}

// A block is { title?, text?: string[], code?, path?, lang?, after?: string[], table?: string[][] }.
function blockHtml(b, numbered, index) {
  const head = b.title ? `<h3>${numbered ? `<span class="num">${index + 1}</span>` : ''}${inline(b.title)}</h3>` : '';
  return `<div class="block"${b.id ? ` id="${b.id}"` : ''}>${head}${paras(b.text)}${b.table ? tableHtml(b.table) : ''}${b.code ? codeBlock(b) : ''}${paras(b.after)}</div>`;
}

const blocksHtml = (list, numbered = false) => (list || []).map((b, i) => blockHtml(b, numbered, i)).join('');

function drawingHtml(name, d) {
  return `<div class="panels">
<figure class="panel bad"><figcaption><h3>Without it</h3></figcaption>${svg(d.bad, `${name}: the problem`)}<p>${inline(d.badCaption)}</p></figure>
<figure class="panel good"><figcaption><h3>With ${esc(name)}</h3></figcaption>${svg(d.good, `${name}: the fix`)}<p>${inline(d.goodCaption)}</p></figure>
</div>`;
}

function tableHtml(rows) {
  const [head, ...body] = rows;
  return `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead>
<tbody>${body.map(r => `<tr>${r.map((cell, i) => i === 0 ? `<th scope="row">${inline(cell)}</th>` : `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}


const sectionHtml = sec => `<section${sec.id ? ` id="${sec.id}"` : ''}${sec.kind ? ` class="${sec.kind}"` : ''}><h2>${inline(sec.title)}</h2>${paras(sec.text)}<div class="blocks">${blocksHtml(sec.blocks)}</div>${paras(sec.after)}</section>`;

const tocHtml = sections => `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${sections.filter(sec => sec.id).map(sec =>
  `<li><a href="#${sec.id}">${inline(sec.title)}</a>${(sec.blocks || []).some(b => b.id) ? `<ul>${sec.blocks.filter(b => b.id).map(b => `<li><a href="#${b.id}">${inline(b.title)}</a></li>`).join('')}</ul>` : ''}</li>`).join('')}</ol></nav>`;

// The incident that opens a scene: a chat message, a ticket or an alert, as the team received it.
function incidentHtml(inc) {
  return `<section class="incident" aria-label="The incident">
<p class="inc-head"><span class="inc-dot" aria-hidden="true"></span>${esc(inc.channel)}<span class="inc-when">${esc(inc.when)}</span></p>
${inc.messages.map(([who, text]) => `<p class="inc-msg"><span class="inc-who">${esc(who)}</span>${inline(text)}</p>`).join('')}
</section>`;
}

// "You just wrote the X pattern": the name comes after the reader has seen why the code needed it.
function revealHtml(r) {
  const names = r.names;
  const heading = names.length === 1 ? `You just wrote the ${esc(names[0])} pattern` : `You just met ${names.map(esc).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return `<section class="reveal"><h2>${heading}</h2>
${(r.rules || []).map(([name, rule]) => `<p class="rule"><span>${esc(name)}</span>${inline(rule)}</p>`).join('')}
${paras(r.text)}
${r.drawing ? drawingHtml(names[0], r.drawing) : ''}
${r.table ? tableHtml(r.table) : ''}
${r.points ? `<ul class="points">${r.points.map(p => `<li>${inline(p)}</li>`).join('')}</ul>` : ''}
${r.whenNot ? `<p class="whennot-label">When not to use it</p><ul class="whennot">${r.whenNot.map(w => `<li>${inline(w)}</li>`).join('')}</ul>` : ''}
</section>`;
}

const sceneLabel = s => `Scene ${s.n}`;

function pagerHtml(prev, next, upcoming) {
  const link = (s, rel, label) => `<a rel="${rel}" href="../${s.slug}/"><small>${label}</small>${inline(s.incident || s.title)}</a>`;
  return `<nav class="pager" aria-label="Scenes">
${prev ? link(prev, 'prev', prev.n ? `← ${sceneLabel(prev)}` : '← Start here') : '<span></span>'}
${next ? link(next, 'next', `${sceneLabel(next)} →`)
    : upcoming ? `<span class="soon"><small>${sceneLabel(upcoming)}, coming soon</small>${inline(upcoming.incident)}</span>` : '<span></span>'}
</nav>`;
}

function sceneHtml(scene, body, prev, next) {
  const day = dayOf(scene);
  const s = [`<header class="chead">
<p class="crumbs"><a href="../">Course</a> › Day ${day.n} · ${esc(day.title)} › ${sceneLabel(scene)} of ${TOTAL}</p>
<h1>${inline(scene.incident)}</h1>
<p class="subtitle">${inline(scene.learn)}</p>
${scene.patterns.length ? `<p class="tags">${scene.patterns.map(tagHtml).join('')}</p>` : ''}
</header>`];
  s.push(incidentHtml(body.incident));
  for (const sec of body.sections) s.push(sectionHtml(sec));
  if (body.reveal) s.push(revealHtml(body.reveal));
  for (const sec of body.afterReveal || []) s.push(sectionHtml(sec));
  if (body.laravel) s.push(sectionHtml({ kind: 'laravel', title: body.laravel.title || 'Laravel does the same', ...body.laravel }));
  if (body.tests) {
    s.push(`<section class="tests"><details><summary><span>Tests</span><small>${esc(body.tests.summary)}</small></summary>
<div class="testbody">${paras(body.tests.text)}<div class="blocks">${blocksHtml(body.tests.blocks)}</div></div></details></section>`);
  }
  s.push(`<section class="nextup">${body.next ? `<p>${inline(body.next)}</p>` : ''}${pagerHtml(prev, next, SCENES[scene.n])}</section>`);
  return `<article class="chapter">${s.join('\n')}</article>`;
}

function foundationHtml(body) {
  const first = SCENES[0];
  return `<article class="chapter"><header class="chead">
<p class="crumbs"><a href="../">Course</a> › Before Day 1</p>
<h1>${esc(FOUNDATION.title)}</h1>
<p class="subtitle">${inline(FOUNDATION.learn)}</p>
</header>
<section class="lead">${paras(body.intro)}</section>
${tocHtml(body.sections)}
${body.sections.map(sectionHtml).join('\n')}
<section class="nextup">${pagerHtml(null, first.ready ? first : null, first)}</section></article>`;
}

function hubHtml() {
  const days = DAYS.map(d => {
    const rows = SCENES.filter(s => s.day === d.n).map(s => {
      const tags = s.patterns.length ? `<span class="tags">${s.patterns.map(tagHtml).join('')}</span>` : '';
      const inner = `<span class="cn">${s.n}</span><span class="ct">${inline(s.incident)}<small>${inline(s.learn)}</small>${tags}</span>`;
      return s.ready
        ? `<li><a class="crow" href="${s.slug}/" data-umami-event="Open scene" data-umami-event-scene="${s.n}">${inner}<span class="cs go">Read</span></a></li>`
        : `<li><div class="crow off">${inner}<span class="cs">Soon</span></div></li>`;
    }).join('');
    return `<section class="day" id="day-${d.n}"><h3><span>Day ${d.n}</span>${esc(d.title)}</h3><p class="hint">${esc(d.blurb)}</p><ol class="clist">${rows}</ol></section>`;
  }).join('');

  return `<section class="hero">
<p class="eyebrow">Advanced Laravel, in 7 days</p>
<h1>One rental platform, 44 production incidents</h1>
<p class="intro">Follow Nordic Stays, a vacation-rental property management system, from its first booking to its busiest day. Every scene starts with something breaking in production. You read the broken code, fix it the way a senior Laravel team would, and see the pattern and the framework internals behind the fix.</p>
<p class="cta"><a class="btn" href="${FOUNDATION.slug}/" data-umami-event="Start course">Start here</a></p>
</section>
<section class="how" aria-label="How each scene works">
<div><b>1. The incident</b>The message the team got: a guest, finance, a partner, an alert.</div>
<div><b>2. The broken code</b>The few lines that caused it, and why.</div>
<div><b>3. The fix</b>Production code, a short “why” on every important line.</div>
<div><b>4. The name</b>The pattern you just wrote, how Laravel uses it, then the tests, folded.</div>
</section>
<section id="chapters" class="course"><h2>The story</h2>
<p class="hint">About 2–3 hours a day. ${ready.length} of ${TOTAL} scenes are published. You should already know Laravel.</p>
<a class="crow found" href="${FOUNDATION.slug}/"><span class="cn">0</span><span class="ct">${esc(FOUNDATION.title)}<small>${inline(FOUNDATION.learn)}</small></span><span class="cs go">Read</span></a>
${days}
<section class="day" id="end"><h3><span>After Day 7</span>${esc(OUTSIDE.title)}</h3><p class="hint">Patterns a Laravel PMS doesn’t need, built for real on their own, so you know them when you meet them.</p>
<ol class="clist"><li>${OUTSIDE.ready ? `<a class="crow" href="${OUTSIDE.slug}/">` : '<div class="crow off">'}<span class="cn">+</span><span class="ct">${esc(OUTSIDE.title)}<small>${inline(OUTSIDE.learn)}</small><span class="tags">${OUTSIDE.patterns.map(tagHtml).join('')}</span></span><span class="cs${OUTSIDE.ready ? ' go">Read' : '">Soon'}</span>${OUTSIDE.ready ? '</a>' : '</div>'}</li></ol></section></section>
`;
}

// ── Write the pages ────────────────────────────────────────────────────
// Remove every old page folder first, so renamed or removed pages don't linger.
for (const entry of readdirSync(ROOT)) {
  if (/^\d\d-/.test(entry) && existsSync(join(ROOT, entry, 'index.html'))) rmSync(join(ROOT, entry), { recursive: true, force: true });
}

const hubDescription = `An advanced Laravel course told as one story: a vacation-rental PMS from launch to scale in 44 production incidents, with the design patterns, framework internals and engineering behind each fix, in 7 days.`;
writeFileSync(join(ROOT, 'index.html'), page({
  title: 'Advanced Laravel in 7 Days: One PMS, 42 Production Incidents | Pattern Playbook',
  description: hubDescription,
  url: SITE, prefix: '', pageId: 'hub', type: 'website',
  jsonld: {
    '@context': 'https://schema.org',
    '@graph': [
      { ...website, description: hubDescription, author: person },
      {
        '@type': 'Course', name: 'Advanced Laravel in 7 days: one PMS, 44 production incidents', description: hubDescription, url: SITE,
        inLanguage: 'en', provider: person, isAccessibleForFree: true, educationalLevel: 'Advanced',
        teaches: PATTERNS.map(p => p.name),
        hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: 'PT18H' },
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', category: 'Free' },
      },
      {
        '@type': 'ItemList', name: 'Scenes', numberOfItems: ready.length,
        itemListElement: ready.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: `Scene ${s.n}: ${s.incident}`, url: `${SITE}${s.slug}/` })),
      },
    ],
  },
  main: hubHtml(),
}));

const articleLd = (headline, description, url, about) => ({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'TechArticle', headline, description, url, mainEntityOfPage: url, image: `${SITE}assets/og.png`, inLanguage: 'en',
      datePublished: PUBLISHED, dateModified: TODAY, author: person, publisher: person, isPartOf: { '@id': `${SITE}#website` },
      about: [...about, 'Laravel', 'PHP'], proficiencyLevel: 'Expert',
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [{ '@type': 'ListItem', position: 1, name: BRAND, item: SITE }, { '@type': 'ListItem', position: 2, name: headline, item: url }],
    },
  ],
});

const write = (slug, html) => { mkdirSync(join(ROOT, slug), { recursive: true }); writeFileSync(join(ROOT, slug, 'index.html'), html); };

{
  const url = `${SITE}${FOUNDATION.slug}/`;
  write(FOUNDATION.slug, page({
    title: `Foundation: the Laravel PMS every scene starts from | ${BRAND}`, description: foundation.description, url,
    prefix: '../', pageId: FOUNDATION.slug, type: 'article',
    jsonld: articleLd('Foundation', foundation.description, url, ['Laravel migrations', 'Eloquent models', 'Pest']),
    main: foundationHtml(foundation),
  }));
}

for (const scene of ready) {
  const body = BODY[scene.slug];
  const prev = scene.n === 1 ? { ...FOUNDATION, n: 0 } : SCENES[scene.n - 2];
  const next = SCENES[scene.n] && SCENES[scene.n].ready ? SCENES[scene.n] : null;
  const url = `${SITE}${scene.slug}/`;
  const what = scene.patterns.length ? `${scene.patterns.join(', ')} in Laravel` : `Laravel: ${scene.learn.split(',')[0]}`;
  write(scene.slug, page({
    title: `${scene.incident.replace(/[“”]/g, '')} · ${what} | ${BRAND}`, description: body.description, url,
    prefix: '../', pageId: scene.slug, type: 'article',
    jsonld: articleLd(`Scene ${scene.n}: ${scene.incident}`, body.description, url, scene.patterns.map(p => `${p} pattern`)),
    main: sceneHtml(scene, body, prev, next),
  }));
}

const urls = [SITE, `${SITE}${FOUNDATION.slug}/`, ...ready.map(s => `${SITE}${s.slug}/`)];
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);
// Crawlers only read robots.txt at the domain root; this copy documents the sitemap location.
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
writeFileSync(join(ROOT, '404.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${BRAND}</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="/pattern-playbook/assets/style.css?v=${V.css}"></head>
<body><div class="wrap"><h1>Page not found</h1><p class="intro">That page doesn't exist. <a href="/pattern-playbook/">See the course</a>.</p></div></body></html>
`);

console.log(`Built the overview, the foundation and ${ready.length} scene pages; sitemap with ${urls.length} URLs.`);
