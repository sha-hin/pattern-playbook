// Generates the static site from content/course.mjs and content/lessons/<slug>.mjs:
//   index.html (course overview), one folder per ready lesson, sitemap.xml, robots.txt, 404.html.
//
//   node build/build.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { esc, inline, paras, codeHtml, svg, markers } from './render.mjs';
import { PLAN, GOF, lessonTitle } from '../content/course.mjs';

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

const LAST = PLAN.length - 1;
const ready = PLAN.filter(l => l.ready);

const LESSONS = {};
for (const l of ready) {
  LESSONS[l.slug] = (await import(pathToFileURL(join(ROOT, 'content', 'lessons', `${l.slug}.mjs`)).href)).default;
}

// Pattern → the lesson that teaches it (for the index and the search).
const PATTERNS = PLAN.flatMap(l => l.patterns.map(name => ({
  name, lesson: l.n, lessonTitle: l.problem, slug: l.slug, ready: !!l.ready, gof: GOF.has(name),
})));

const courseData = JSON.stringify({
  chapters: PLAN.map(l => ({ n: l.n, title: lessonTitle(l), patterns: l.patterns.length ? [l.problem] : [l.problem], slug: l.slug, ready: !!l.ready })),
  patterns: PATTERNS.map(p => ({ name: p.name, chapter: p.lesson, chapterTitle: p.lessonTitle, slug: p.slug, ready: p.ready, gof: p.gof })),
}).replace(/</g, '\\u003c');

const tagHtml = name => `<span class="ptag${GOF.has(name) ? ' gof' : ''}" title="${GOF.has(name) ? 'In the Gang of Four book' : 'Not in the Gang of Four book'}">${esc(name)}</span>`;

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
<meta property="og:image:alt" content="${BRAND}: design patterns in Laravel, taught through a real vacation-rental PMS">
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
function codeBlock({ path, code, lang }) {
  const html = codeHtml(code.replace(/\n$/, ''), lang);
  return `<div class="codebox">
<div class="filehead"><span class="path">${esc(path || 'code')}</span></div>
<pre class="code"><code>${html}</code></pre>
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

function lessonHtml(l, body, prev, next) {
  const s = [];
  s.push(`<header class="chead">
<p class="crumbs"><a href="../">All lessons</a> › Lesson ${l.n} of ${LAST}</p>
<h1>${inline(lessonTitle(l))}</h1>
<p class="subtitle">${inline(l.problem)}</p>
${l.patterns.length ? `<p class="tags">${l.patterns.map(tagHtml).join('')}</p>` : ''}
</header>`);

  if (body.intro) s.push(`<section class="lead">${paras(body.intro)}</section>`);

  if (body.toc) {
    s.push(`<nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${(body.sections || []).filter(sec => sec.id).map(sec =>
      `<li><a href="#${sec.id}">${inline(sec.title)}</a>${sec.blocks.some(b => b.id) ? `<ul>${sec.blocks.filter(b => b.id).map(b => `<li><a href="#${b.id}">${inline(b.title)}</a></li>`).join('')}</ul>` : ''}</li>`).join('')}</ol></nav>`);
  }

  if (body.ticket) {
    s.push(`<section class="ticket" aria-label="The ticket"><p class="tk-label">The ticket</p>
<h2>${inline(body.ticket.title)}</h2><p class="tk-from">From ${esc(body.ticket.from)}</p><p>${inline(body.ticket.body)}</p></section>`);
  }

  if (body.pain) {
    s.push(`<section><h2>The quick fix, and why it hurts</h2>${paras(body.pain.text)}
${body.pain.code ? codeBlock({ path: body.pain.path || 'the quick fix (we won’t keep this)', code: body.pain.code }).replace('<pre class="code">', '<pre class="code rejected">') : ''}
${paras(body.pain.after)}</section>`);
  }

  for (const p of body.patterns || []) {
    s.push(`<section class="pattern"><h2>The pattern: ${esc(p.name)}</h2>
<p class="rule"><span>Remember it</span>${inline(p.rule)}</p>
${paras(p.explain)}
${p.drawing ? drawingHtml(p.name, p.drawing) : ''}
${p.table ? tableHtml(p.table) : ''}</section>`);
  }

  for (const sec of body.sections || []) {
    s.push(`<section${sec.id ? ` id="${sec.id}"` : ''}><h2>${inline(sec.title)}</h2>${paras(sec.text)}<div class="blocks${sec.numbered === false ? '' : ' numbered'}">${blocksHtml(sec.blocks, sec.numbered !== false)}</div></section>`);
  }

  if (body.laravel) {
    s.push(`<section class="laravel"><h2>How Laravel does it inside</h2>${paras(body.laravel.text)}<div class="blocks">${blocksHtml(body.laravel.blocks)}</div></section>`);
  }

  if (body.topics) {
    s.push(`<section class="topics"><h2>PMS topics in this lesson</h2>${paras(body.topics.text)}<div class="blocks">${blocksHtml(body.topics.blocks)}</div></section>`);
  }

  if (body.whenNot) {
    s.push(`<section class="whennot"><h2>When not to use it</h2><ul>${body.whenNot.map(w => `<li>${inline(w)}</li>`).join('')}</ul></section>`);
  }

  if (body.tests) {
    s.push(`<section class="tests"><details><summary><span>Pest tests for this lesson</span><small>${esc(body.tests.summary || 'open to see the tests')}</small></summary>
<div class="testbody">${paras(body.tests.text)}<div class="blocks">${blocksHtml(body.tests.blocks)}</div></div></details></section>`);
  }

  const upcoming = PLAN[l.n + 1];
  s.push(`<section class="nextup">${body.next ? `<p>${inline(body.next)}</p>` : ''}
<nav class="pager" aria-label="Lessons">
${prev ? `<a rel="prev" href="../${prev.slug}/"><small>← Lesson ${prev.n}</small>${inline(lessonTitle(prev))}</a>` : '<span></span>'}
${next ? `<a rel="next" href="../${next.slug}/"><small>Lesson ${next.n} →</small>${inline(lessonTitle(next))}</a>`
    : upcoming ? `<span class="soon"><small>Lesson ${upcoming.n}, coming soon</small>${inline(lessonTitle(upcoming))}</span>` : '<span></span>'}
</nav></section>`);

  return `<article class="chapter">${s.join('\n')}</article>`;
}

function hubHtml() {
  const rows = PLAN.map(l => {
    const tags = l.patterns.length ? `<span class="tags">${l.patterns.map(tagHtml).join('')}</span>` : '';
    const inner = `<span class="cn">${l.n}</span><span class="ct">${inline(lessonTitle(l))}<small>${inline(l.problem)}</small>${tags}</span>`;
    return l.ready
      ? `<li><a class="crow" href="${l.slug}/" data-umami-event="Open lesson" data-umami-event-lesson="${l.n}">${inner}<span class="cs go">Read</span></a></li>`
      : `<li><div class="crow off">${inner}<span class="cs">Soon</span></div></li>`;
  }).join('');

  const patternRows = [...PATTERNS].sort((a, b) => a.name.localeCompare(b.name)).map(p =>
    `<tr><th scope="row">${p.ready ? `<a href="${p.slug}/">${esc(p.name)}</a>` : esc(p.name)}</th><td>${p.gof ? '<span class="ptag gof">Gang of Four</span>' : '<span class="ptag">Not in the book</span>'}</td><td>${p.ready ? `<a href="${p.slug}/">Lesson ${p.lesson}</a>` : `Lesson ${p.lesson} <small>(soon)</small>`}</td></tr>`).join('');

  const gof = PATTERNS.filter(p => p.gof).length;
  return `<section class="hero">
<p class="eyebrow">For Laravel developers</p>
<h1>Design patterns in Laravel, inside a real PMS</h1>
<p class="intro">All ${gof} Gang of Four patterns and ${PATTERNS.length - gof} modern ones, each applied to the business logic of a vacation-rental property management system: bookings, pricing, payments, channel sync, guest messaging. When Laravel already ships a pattern, you see how Laravel builds it inside.</p>
<p class="cta"><a class="btn" href="${PLAN[0].slug}/" data-umami-event="Start course">Start with lesson 0</a><a class="btn ghost" href="#patterns">Find a pattern</a></p>
</section>
<section class="how" aria-label="How each lesson works">
<div><b>1. A PMS ticket</b>A real problem from a host, finance or the channel team.</div>
<div><b>2. The pattern</b>One sentence to remember, and a drawing of before and after.</div>
<div><b>3. Laravel inside</b>How the framework itself uses the same pattern.</div>
<div><b>4. When not to</b>The limits, then the Pest tests, folded at the end.</div>
</section>
<section id="chapters" class="course"><h2>The lessons</h2>
<p class="hint">${ready.length} of ${PLAN.length} lessons are published. You should already know Laravel; the course is about business logic and patterns.</p>
<ol class="clist">${rows}</ol></section>
<section id="patterns" class="pindex"><h2>Every pattern, and where it is taught</h2>
<div class="tablewrap"><table><thead><tr><th scope="col">Pattern</th><th scope="col">Source</th><th scope="col">Lesson</th></tr></thead><tbody>${patternRows}</tbody></table></div></section>`;
}

// ── Write the pages ────────────────────────────────────────────────────
// Remove every old lesson/chapter folder first, so renamed or removed pages don't linger.
for (const entry of readdirSync(ROOT)) {
  if (/^\d\d-/.test(entry) && existsSync(join(ROOT, entry, 'index.html'))) rmSync(join(ROOT, entry), { recursive: true, force: true });
}

const hubDescription = `A free course for Laravel developers: all ${PATTERNS.filter(p => p.gof).length} Gang of Four design patterns plus ${PATTERNS.filter(p => !p.gof).length} modern ones, applied to a real vacation-rental PMS, with Laravel's own implementation of each pattern.`;
writeFileSync(join(ROOT, 'index.html'), page({
  title: 'Design Patterns in Laravel, Inside a Real PMS | Pattern Playbook',
  description: hubDescription,
  url: SITE, prefix: '', pageId: 'hub', type: 'website',
  jsonld: {
    '@context': 'https://schema.org',
    '@graph': [
      { ...website, description: hubDescription, author: person },
      {
        '@type': 'Course', name: 'Design patterns in Laravel, inside a real PMS', description: hubDescription, url: SITE,
        inLanguage: 'en', provider: person, isAccessibleForFree: true, educationalLevel: 'Intermediate to advanced',
        teaches: PATTERNS.map(p => p.name),
        hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', courseWorkload: 'PT20H' },
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', category: 'Free' },
      },
      {
        '@type': 'ItemList', name: 'Lessons', numberOfItems: ready.length,
        itemListElement: ready.map((l, i) => ({ '@type': 'ListItem', position: i + 1, name: `Lesson ${l.n}: ${lessonTitle(l)}`, url: `${SITE}${l.slug}/` })),
      },
    ],
  },
  main: hubHtml(),
}));

for (const l of ready) {
  const body = LESSONS[l.slug];
  const prev = l.n > 0 ? PLAN[l.n - 1] : null;
  const next = PLAN[l.n + 1] && PLAN[l.n + 1].ready ? PLAN[l.n + 1] : null;
  const url = `${SITE}${l.slug}/`;
  const title = `${l.patterns.length ? `${l.patterns.join(', ')} in Laravel` : lessonTitle(l)}: ${l.problem.replace(/[“”]/g, '')} | ${BRAND}`;
  mkdirSync(join(ROOT, l.slug), { recursive: true });
  writeFileSync(join(ROOT, l.slug, 'index.html'), page({
    title, description: body.description, url, prefix: '../', pageId: l.slug, type: 'article',
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle', headline: `Lesson ${l.n}: ${lessonTitle(l)}`, description: body.description, url,
          mainEntityOfPage: url, image: `${SITE}assets/og.png`, inLanguage: 'en', datePublished: PUBLISHED, dateModified: TODAY,
          author: person, publisher: person, isPartOf: { '@id': `${SITE}#website` },
          about: [...l.patterns.map(p => `${p} pattern`), 'Laravel', 'PHP'], proficiencyLevel: 'Expert',
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: BRAND, item: SITE },
            { '@type': 'ListItem', position: 2, name: `Lesson ${l.n}`, item: url },
          ],
        },
      ],
    },
    main: lessonHtml(l, body, prev, next),
  }));
}

const urls = [SITE, ...ready.map(l => `${SITE}${l.slug}/`)];
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
<body><div class="wrap"><h1>Page not found</h1><p class="intro">That page doesn't exist. <a href="/pattern-playbook/">See all lessons</a>.</p></div></body></html>
`);

console.log(`Built the overview + ${ready.length} lesson pages, sitemap with ${urls.length} URLs.`);
