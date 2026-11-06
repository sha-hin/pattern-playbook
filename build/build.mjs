// Generates the static site from content/course.mjs and the real project code in chapters/:
//   index.html (course overview), one folder per ready chapter, sitemap.xml, robots.txt, 404.html.
//
//   node build/build.mjs
//
// Code on the pages is read from chapters/<slug>/ at build time, and each chapter's output
// from chapters/<slug>/output.txt (refresh it with node build/run-chapters.mjs), so the site always
// shows exactly the code that runs.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { esc, inline, paras, codeHtml, diffHtml, svg, markers } from './render.mjs';
import { PARTS, PLAN, GOF, CHAPTERS } from '../content/course.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sha-hin.github.io/pattern-playbook/';
const REPO = 'https://github.com/sha-hin/pattern-playbook';
const BRAND = 'Pattern Playbook';
const COURSE = 'Evalu8';
const TODAY = new Date().toISOString().slice(0, 10);
const PUBLISHED = '2026-11-06';
const AUTHOR = { name: 'Mohammed Shahin', url: 'https://sha-hin.github.io' };
// Umami Cloud website id (same account as the portfolio). Tracking only runs on sha-hin.github.io.
const UMAMI_ID = '37b7903a-c779-475f-b20f-18fe98cd4d70';

// Cache-busting: each asset URL carries a hash of its content.
const version = file => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex').slice(0, 10);
const V = { css: version('assets/style.css'), js: version('assets/site.js'), icon: version('assets/favicon.svg') };

const LAST = PLAN.length - 1;
const ready = PLAN.filter(c => c.ready);
const read = (slug, file) => readFileSync(join(ROOT, 'chapters', slug, file), 'utf8');

// Patterns → the chapter that teaches them (for the index and the search).
const PATTERNS = PLAN.flatMap(c => c.patterns.flatMap(name => name.split(' vs ').map(single => ({
  name: single, chapter: c.n, chapterTitle: c.title, slug: c.slug || '', ready: !!c.ready, gof: GOF.has(single),
}))));

const courseData = JSON.stringify({
  chapters: PLAN.map(c => ({ n: c.n, title: c.title, patterns: c.patterns, slug: c.slug || '', ready: !!c.ready })),
  patterns: PATTERNS,
}).replace(/</g, '\\u003c');

const tagHtml = name => name.split(' vs ').map(n =>
  `<span class="ptag${GOF.has(n) ? ' gof' : ''}" title="${GOF.has(n) ? 'In the Gang of Four book' : 'Not in the Gang of Four book'}">${esc(n)}</span>`).join('');

const tools = `<div class="tools">
<button type="button" class="searchbtn" aria-label="Find a chapter or pattern (Ctrl K)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><span>Find a pattern</span><span class="keys" aria-hidden="true"><kbd class="k-mod">Ctrl</kbd><kbd>K</kbd></span></button>
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
<meta property="og:image:alt" content="${BRAND}: design patterns in PHP, learned by fixing one real app">
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

// ── Building blocks of a chapter page ──────────────────────────────────
function codeBlock({ path, html, copy, badge, github, cls = '' }) {
  return `<div class="codebox">
<div class="filehead"><span class="path">${esc(path)}</span>${badge || ''}${github ? `<a class="gh" href="${github}" data-umami-event="Open file on GitHub">GitHub</a>` : ''}</div>
<pre class="code${cls}"${copy !== undefined ? ` data-copy="${esc(copy)}"` : ''}><code>${html}</code></pre>
</div>`;
}

function stepHtml(step, c, prev, index) {
  let block = '';
  if (step.code) {
    block = codeBlock({ path: step.path || 'idea, not part of the project', html: codeHtml(step.code) });
  } else {
    const src = read(c.slug, step.file);
    const github = `${REPO}/blob/main/chapters/${c.slug}/${step.file}`;
    if (step.diff) {
      const old = read(prev.slug, step.diff);
      const d = diffHtml(old, src);
      block = codeBlock({
        path: step.file, html: d.html, copy: src, github, cls: ' diff',
        badge: `<span class="badge chg" title="Lines added and removed since chapter ${prev.n}"><b class="plus">+${d.added}</b> <b class="minus">−${d.removed}</b></span>`,
      });
    } else {
      const isNew = !prev || !existsSync(join(ROOT, 'chapters', prev.slug, step.file));
      block = codeBlock({
        path: step.file, html: codeHtml(src.replace(/\n$/, '')), github,
        badge: isNew && c.n > 0 ? '<span class="badge new">new file</span>' : '',
      });
    }
  }
  return `<li class="step"><h3><span class="num">${index + 1}</span>${inline(step.title)}</h3>${paras(step.text)}${block}</li>`;
}

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

function chapterHtml(c, body, prev, next) {
  const part = `Part ${c.part} · ${PARTS[c.part]}`;
  const p = body.pattern;
  const sections = [];

  sections.push(`<header class="chead">
<p class="crumbs"><a href="../">${COURSE} course</a> › ${esc(part)}</p>
<p class="eyebrow">Chapter ${c.n} of ${LAST}</p>
<h1>${inline(c.title)}</h1>
${c.patterns.length ? `<p class="tags">${c.patterns.map(tagHtml).join('')}</p>` : ''}
</header>`);

  if (body.intro) sections.push(`<section class="lead">${paras(body.intro)}</section>`);

  if (body.ticket) {
    sections.push(`<section class="ticket" aria-label="The ticket">
<p class="tk-label">New ticket</p>
<h2>${inline(body.ticket.title)}</h2>
<p class="tk-from">From ${esc(body.ticket.from)}</p>
<p>${inline(body.ticket.body)}</p>
</section>`);
  }

  if (body.pain) {
    sections.push(`<section><h2>Why the quick fix is a trap</h2>${paras(body.pain.text)}
${codeBlock({ path: 'the quick fix (we won’t do this)', html: codeHtml(body.pain.code), cls: ' rejected' })}
${paras(body.pain.after)}</section>`);
  }

  if (p) {
    sections.push(`<section class="pattern"><h2>The pattern: ${esc(p.name)}</h2>
<p class="rule"><span>Remember it</span>${inline(p.rule)}</p>
${paras(p.explain)}
${drawingHtml(p.name, p.drawing)}
${p.extra ? `<div class="extra"><h3>${inline(p.extra.title)}</h3>${paras(p.extra.text)}${tableHtml(p.extra.rows)}</div>` : ''}
</section>`);
  }

  sections.push(`<section><h2>${c.n === 0 ? 'The code' : 'Build it, step by step'}</h2>
${c.n > 0 ? `<p class="hint">Changed files show only what changed since chapter ${prev.n}: <b class="plus">green</b> lines are new, <b class="minus">red</b> lines are removed. <b>Copy</b> always copies the complete file.</p>` : ''}
<ol class="steps">${body.steps.map((s, i) => stepHtml(s, c, prev, i)).join('')}</ol></section>`);

  const output = read(c.slug, 'output.txt').trimEnd();
  sections.push(`<section class="run"><h2>Run it</h2>${paras(body.run.text)}
${codeBlock({ path: `terminal, inside chapters/${c.slug}`, html: esc(body.run.cmd) })}
<div class="output"><span>Output</span><pre>${esc(output)}</pre></div></section>`);

  if (body.findings) {
    sections.push(`<section><h2>What’s wrong with it</h2><ol class="findings">${body.findings.map(f => {
      const target = PLAN[f.fix];
      const link = target.ready ? `<a href="../${target.slug}/">Fixed in chapter ${target.n}: ${esc(target.patterns.join(', '))}</a>` : `Fixed in chapter ${target.n}`;
      return `<li><h3>${inline(f.title)}</h3><p>${inline(f.text)}</p><p class="fixlink">${link}</p></li>`;
    }).join('')}</ol>${body.takeaway ? `<p class="takeaway">${inline(body.takeaway)}</p>` : ''}</section>`);
  }

  if (body.laravel) {
    sections.push(`<section class="laravel"><h2>How Laravel does it</h2>${paras(body.laravel.text)}
${codeBlock({ path: 'Laravel', html: codeHtml(body.laravel.code) })}</section>`);
  }

  if (body.check) {
    sections.push(`<section class="check"><h2>Check yourself</h2><p class="hint">Answer in your head, then open the answer.</p>
${body.check.map(q => `<details><summary>${inline(q.q)}</summary><p>${inline(q.a)}</p></details>`).join('')}</section>`);
  }

  const nextChapter = PLAN[c.n + 1];
  sections.push(`<section class="nextup">${body.next ? `<p>${inline(body.next)}</p>` : ''}
<nav class="pager" aria-label="Chapters">
${prev ? `<a rel="prev" href="../${prev.slug}/"><small>← Chapter ${prev.n}</small>${inline(prev.title)}</a>` : '<span></span>'}
${next ? `<a rel="next" href="../${next.slug}/"><small>Chapter ${next.n} →</small>${inline(next.title)}</a>`
    : nextChapter ? `<span class="soon"><small>Chapter ${nextChapter.n}, coming soon</small>${inline(nextChapter.title)}</span>` : '<span></span>'}
</nav></section>`);

  return `<article class="chapter">${sections.join('\n')}</article>`;
}

// ── Course overview (hub) ──────────────────────────────────────────────
function hubHtml() {
  const parts = Object.entries(PARTS).map(([n, name]) => {
    const rows = PLAN.filter(c => c.part === Number(n)).map(c => {
      const tags = c.patterns.length ? `<span class="tags">${c.patterns.map(tagHtml).join('')}</span>` : '<span class="tags"><span class="ptag start">Start here</span></span>';
      const inner = `<span class="cn">${c.n}</span><span class="ct">${inline(c.title)}${tags}</span>`;
      return c.ready
        ? `<li><a class="crow" href="${c.slug}/" data-umami-event="Open chapter" data-umami-event-chapter="${c.n}">${inner}<span class="cs go">Read</span></a></li>`
        : `<li><div class="crow off">${inner}<span class="cs">Soon</span></div></li>`;
    }).join('');
    return `<section class="part"><h3><span>Part ${n}</span>${esc(name)}</h3><ol class="clist">${rows}</ol></section>`;
  }).join('');

  const patternRows = [...PATTERNS].sort((a, b) => a.name.localeCompare(b.name)).map(p =>
    `<tr><th scope="row">${p.ready ? `<a href="${p.slug}/">${esc(p.name)}</a>` : esc(p.name)}</th><td>${p.gof ? '<span class="ptag gof">Gang of Four</span>' : '<span class="ptag">Not in the book</span>'}</td><td>${p.ready ? `<a href="${p.slug}/">Chapter ${p.chapter}</a>` : `Chapter ${p.chapter} <small>(soon)</small>`}</td></tr>`).join('');

  const gofCount = PATTERNS.filter(p => p.gof).length;
  return `<section class="hero">
<p class="eyebrow">A design patterns course for PHP developers</p>
<h1>Learn design patterns by fixing one real app</h1>
<p class="intro">${COURSE} is a school evaluation platform that starts as one messy PHP script. Every chapter brings a real ticket, a bug, a new requirement or a scaling problem, and fixes it with the pattern made for it. By the end, the same codebase uses all ${gofCount} Gang of Four patterns and ${PATTERNS.length - gofCount} modern ones.</p>
<p class="cta">${ready.length > 1 ? `<a class="btn" href="${ready[0].slug}/" data-umami-event="Start course">Start with chapter 0</a>` : ''}<a class="btn ghost" href="${REPO}/tree/main/chapters" data-umami-event="View source">Browse the code</a></p>
</section>
<section class="how" aria-label="How each chapter works">
<div><b>1. A real ticket</b>From a school or the product owner: a bug, a new rule, a slow export.</div>
<div><b>2. The trap</b>The quick fix most of us would write, and why it hurts later.</div>
<div><b>3. The pattern</b>One sentence to remember, and a drawing of before and after.</div>
<div><b>4. The refactor</b>Step by step on the real code, with exact diffs, then run it.</div>
</section>
<section id="chapters" class="course"><h2>The chapters</h2>
<p class="hint">${ready.length} of ${PLAN.length} chapters are published. Each one is a complete, runnable snapshot of the project in <a href="${REPO}/tree/main/chapters"><code>chapters/</code></a>. PHP 8.2+ and Composer are all you need.</p>
${parts}</section>
<section id="patterns" class="pindex"><h2>Every pattern, and where it is taught</h2>
<div class="tablewrap"><table><thead><tr><th scope="col">Pattern</th><th scope="col">Source</th><th scope="col">Chapter</th></tr></thead><tbody>${patternRows}</tbody></table></div></section>`;
}

// ── Write the pages ────────────────────────────────────────────────────
// Remove pages of chapters that no longer exist (and of the old pattern-per-page site).
for (const old of ['strategy', 'simple-factory', 'null-object', 'adapter', 'decorator', 'observer', 'event-dispatcher', 'facade', 'static-proxy', 'template', 'builder', 'value-object', 'state', 'command', 'command-bus', 'outbox', 'iterator', 'generators', 'composite', 'container', 'factory-method', 'manager', 'prototype', 'bridge', 'abstract-factory']) {
  rmSync(join(ROOT, old), { recursive: true, force: true });
}

const hubTitle = 'Design Patterns in PHP, Learned by Fixing One Real App | Pattern Playbook';
const hubDescription = 'A free course: fix a real PHP school-evaluation app one ticket at a time, using all 23 Gang of Four patterns plus Repository, Value Object, DI Container, Outbox and more.';
writeFileSync(join(ROOT, 'index.html'), page({
  title: hubTitle,
  description: hubDescription,
  url: SITE,
  prefix: '',
  pageId: 'hub',
  type: 'website',
  jsonld: {
    '@context': 'https://schema.org',
    '@graph': [
      { ...website, description: hubDescription, author: person },
      {
        '@type': 'Course',
        name: `${COURSE}: design patterns in PHP, learned by fixing one real app`,
        description: hubDescription,
        url: SITE,
        inLanguage: 'en',
        provider: person,
        isAccessibleForFree: true,
        educationalLevel: 'Beginner to intermediate',
        teaches: PATTERNS.map(p => p.name),
        hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: 'PT10H' },
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', category: 'Free' },
      },
      {
        '@type': 'ItemList',
        name: 'Chapters',
        numberOfItems: ready.length,
        itemListElement: ready.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: `Chapter ${c.n}: ${c.title}`, url: `${SITE}${c.slug}/` })),
      },
    ],
  },
  main: hubHtml(),
}));

for (const c of ready) {
  const body = CHAPTERS[c.slug];
  if (!body) throw new Error(`No content for ${c.slug}`);
  const prev = c.n > 0 ? PLAN[c.n - 1] : null;
  const next = PLAN[c.n + 1] && PLAN[c.n + 1].ready ? PLAN[c.n + 1] : null;
  const url = `${SITE}${c.slug}/`;
  const title = `Chapter ${c.n}: ${c.title}${c.patterns.length ? ` (${c.patterns.join(', ')} in PHP)` : ''} | ${BRAND}`;
  mkdirSync(join(ROOT, c.slug), { recursive: true });
  writeFileSync(join(ROOT, c.slug, 'index.html'), page({
    title,
    description: body.description,
    url,
    prefix: '../',
    pageId: c.slug,
    type: 'article',
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          headline: `Chapter ${c.n}: ${c.title}`,
          description: body.description,
          url,
          mainEntityOfPage: url,
          image: `${SITE}assets/og.png`,
          inLanguage: 'en',
          datePublished: PUBLISHED,
          dateModified: TODAY,
          author: person,
          publisher: person,
          isPartOf: { '@id': `${SITE}#website` },
          about: [...c.patterns.map(p => `${p} pattern`), 'PHP'],
          proficiencyLevel: 'Beginner',
        },
        {
          '@type': 'SoftwareSourceCode',
          name: `${COURSE}, chapter ${c.n}`,
          programmingLanguage: 'PHP',
          codeRepository: REPO,
          url: `${REPO}/tree/main/chapters/${c.slug}`,
          runtimePlatform: 'PHP 8.2+',
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: BRAND, item: SITE },
            { '@type': 'ListItem', position: 2, name: `Chapter ${c.n}`, item: url },
          ],
        },
      ],
    },
    main: chapterHtml(c, body, prev, next),
  }));
}

// ── sitemap.xml, robots.txt, 404.html ──────────────────────────────────
const urls = [SITE, ...ready.map(c => `${SITE}${c.slug}/`)];
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
<body><div class="wrap"><h1>Page not found</h1><p class="intro">That page doesn't exist. The course moved to a chapter format: <a href="/pattern-playbook/">see all chapters</a>.</p></div></body></html>
`);

console.log(`Built the overview + ${ready.length} chapter pages, sitemap with ${urls.length} URLs.`);
