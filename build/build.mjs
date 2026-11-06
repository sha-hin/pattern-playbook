// Generates every static page from assets/app.js:
//   index.html (hub), one folder per pattern (/strategy/index.html ...), sitemap.xml, robots.txt, 404.html.
//
//   node build/build.mjs
//
// Every page is complete HTML before any JavaScript runs, so search engines index the full
// content of each pattern under its own URL. The browser script only adds the Test-me mode.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = new Date().toISOString().slice(0, 10);
const PUBLISHED = '2026-11-06';
const AUTHOR = { name: 'Mohammed Shahin', url: 'https://sha-hin.github.io' };
// Umami Cloud website id (same account as the portfolio). Tracking only runs on sha-hin.github.io, never locally.
const UMAMI_ID = '37b7903a-c779-475f-b20f-18fe98cd4d70';

// Load the shared data + renderers exactly as the browser does (no DOM: the browser part is skipped).
const ctx = vm.createContext({});
const app = vm.runInContext(
  readFileSync(join(ROOT, 'assets/app.js'), 'utf8') + ';({ P, SITE, FAMILY, esc, cardHtml, chipsHtml, hubHtml })',
  ctx,
);
const { P, SITE, FAMILY, esc, cardHtml, chipsHtml, hubHtml } = app;

const TITLES = {
  'static-proxy': 'Laravel Facades Explained: a Static Proxy, Not the GoF Facade',
  'container': 'Dependency Injection Container in PHP & Laravel, with Real Code',
  'manager': 'Manager / Driver Pattern in Laravel: Backends Chosen by Config',
  'generators': 'PHP Generators (yield) for Large Data, with Real Code',
  'outbox': 'Transactional Outbox Pattern in PHP & Laravel, with Real Code',
  'value-object': 'Value Objects in PHP & Laravel (Money Example), with Real Code',
};
const titleFor = p => TITLES[p.id] ?? `${p.name} Pattern in PHP & Laravel, with Real Code`;

function clip(text, max = 158) {
  if (text.length <= max) return text;
  return text.slice(0, text.lastIndexOf(' ', max - 1)).replace(/[,;:.\s]+$/, '') + '…';
}
const descriptionFor = p => clip(`${p.name} explained for PHP and Laravel developers. ${p.rule.replace(/→/g, '-')} Real-world example and code.`);

const markers = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<marker id="ar" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" fill="#8a94a3"/></marker>
<marker id="arx" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" fill="#d1453b"/></marker>
</defs></svg>`;

const modes = `<div class="modes" role="group" aria-label="Mode">
<button id="m-learn" aria-pressed="true">Learn</button>
<button id="m-test" aria-pressed="false">Test me</button>
</div>`;

function page({ title, description, url, prefix, pageId, type, jsonld, header, main, current }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="author" content="${AUTHOR.name}">
<meta name="theme-color" content="#f1f3f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1218" media="(prefers-color-scheme: dark)">
<meta property="og:site_name" content="Pattern Playbook">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Pattern Playbook: design patterns for PHP and Laravel">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}assets/og.png">
<link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${prefix}assets/style.css">
<script defer src="https://cloud.umami.is/script.js" data-website-id="${UMAMI_ID}" data-domains="sha-hin.github.io"></script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body data-page="${pageId}" data-prefix="${prefix}">
${markers}
<div class="wrap">
<header>
${header}
${modes}
</header>
<nav class="chips" aria-label="All patterns">${chipsHtml(current, prefix)}</nav>
<main id="view">
${main}
</main>
<footer class="credit">By <a href="${AUTHOR.url}" data-umami-event="Visit portfolio">${AUTHOR.name}</a> · PHP / Laravel developer · <a href="https://github.com/sha-hin/pattern-playbook" data-umami-event="View source">Source on GitHub</a></footer>
</div>
<script src="${prefix}assets/app.js" defer></script>
</body>
</html>
`;
}

const website = { '@type': 'WebSite', '@id': `${SITE}#website`, name: 'Pattern Playbook', url: SITE, inLanguage: 'en' };
const person = { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url };

// ── Hub ────────────────────────────────────────────────────────────────
const hubTitle = 'Pattern Playbook: Design Patterns in PHP & Laravel, with Real Code';
const hubDescription = 'Learn 25 design patterns the practical way: a memory hook, a pain-vs-fix drawing and real Laravel code for each one, plus a test mode to check you can pick the right pattern.';

writeFileSync(join(ROOT, 'index.html'), page({
  title: hubTitle,
  description: hubDescription,
  url: SITE,
  prefix: '',
  pageId: 'hub',
  type: 'website',
  current: null,
  jsonld: {
    '@context': 'https://schema.org',
    '@graph': [
      { ...website, description: hubDescription, author: person },
      {
        '@type': 'ItemList',
        name: 'Design patterns for PHP and Laravel',
        numberOfItems: P.length,
        itemListElement: P.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: `${SITE}${p.id}/` })),
      },
    ],
  },
  header: `<div>
<h1>Pattern Playbook: design patterns for PHP &amp; Laravel developers</h1>
<p class="intro">25 patterns: 15 from the Gang of Four book and 10 modern ones every PHP framework relies on. Each one has a memory hook, a drawing of the pain and the fix, and real before/after code, so you know <b>when</b> to use it, not just what it is.</p>
<div class="why">
<div><b>Remember it</b>A one-line hook from everyday life: Adapter is a travel plug.</div>
<div><b>Recognise it</b>The pain drawn next to the fix, plus the code smells that call for it.</div>
<div><b>Write it</b>Real Laravel code: exports, SMS providers, queues, imports, workflows.</div>
</div>
</div>`,
  main: hubHtml(''),
}));

// ── One page per pattern ───────────────────────────────────────────────
for (const p of P) {
  const url = `${SITE}${p.id}/`;
  const title = titleFor(p);
  const description = descriptionFor(p);
  const dir = join(ROOT, p.id);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'index.html'), page({
    title,
    description,
    url,
    prefix: '../',
    pageId: p.id,
    type: 'article',
    current: p.id,
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          headline: title,
          description,
          url,
          mainEntityOfPage: url,
          image: `${SITE}assets/og.png`,
          inLanguage: 'en',
          datePublished: PUBLISHED,
          dateModified: TODAY,
          author: person,
          publisher: person,
          isPartOf: { '@id': `${SITE}#website` },
          about: [`${p.name} design pattern`, 'PHP', 'Laravel'],
          proficiencyLevel: 'Beginner',
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Pattern Playbook', item: SITE },
            { '@type': 'ListItem', position: 2, name: p.name, item: url },
          ],
        },
      ],
    },
    header: `<div>
<a class="brand" href="../">Pattern Playbook</a>
<p class="crumbs"><a href="../">All patterns</a> › ${FAMILY[p.fam]} › ${esc(p.name)}</p>
</div>`,
    main: cardHtml(p, '../'),
  }));
}

// ── sitemap.xml, robots.txt, 404.html ──────────────────────────────────
const urls = [SITE, ...P.map(p => `${SITE}${p.id}/`)];
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);

// Note: crawlers only read robots.txt at the domain root (sha-hin.github.io/robots.txt).
// This copy documents the sitemap location; submit the sitemap in Google Search Console.
writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

writeFileSync(join(ROOT, '404.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Pattern Playbook</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="/pattern-playbook/assets/style.css"></head>
<body><div class="wrap"><h1>Page not found</h1><p class="intro">That page doesn't exist. <a href="/pattern-playbook/">See all 25 patterns</a>.</p></div></body></html>
`);

console.log(`Built hub + ${P.length} pattern pages, sitemap with ${urls.length} URLs.`);
