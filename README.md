# Pattern Playbook

Design patterns for PHP and Laravel developers, one pattern per screen:

- **A memory hook** from everyday life (Adapter = a travel plug, State = a traffic light)
- **The pain vs the fix**, drawn side by side, so you recognise when you need it
- **Real-world before / after code**: exports, SMS providers, caching, queues, imports, approval workflows, paginated APIs
- **Build it yourself**: a complete, runnable plain-PHP implementation of every pattern, with each part labelled by its role (no framework needed)
- **In a real Laravel project**: the same pattern the framework way, plus how Laravel builds it internally
- **Where you already use it** in Laravel
- **Test me** mode: shuffled real-world scenarios to check you can pick the right pattern

25 patterns: 15 from the Gang of Four book and 10 modern ones every PHP framework relies on
(DI Container, Simple Factory, Null Object, Value Object, Event Dispatcher, Generators,
Command Bus, Transactional Outbox, Manager/Driver, Laravel's static-proxy "Facades").

**Live:** https://sha-hin.github.io/pattern-playbook/

A single static `index.html`, no build step.

By [Mohammed Shahin](https://sha-hin.github.io).

## Run the examples

Every pattern has a standalone file in [`examples/`](examples). PHP 8.2+ and the built-in SQLite extension are all you need:

```bash
php examples/strategy.php
php examples/outbox.php
```

## Editing

Card content lives in `assets/app.js` (the `BASE` and `EXTRA` arrays); each plain-PHP implementation is `examples/<pattern>.php`, with its roles and Laravel note in the file's docblock. After editing, refresh the saved outputs and regenerate the pages:

```bash
for f in examples/*.php; do php "$f" > "examples/output/$(basename "$f" .php).txt"; done
node build/build.mjs
```

This writes `index.html`, one folder per pattern (`strategy/index.html`, …), `sitemap.xml`, `robots.txt` and `404.html`.
Every page is complete static HTML, so search engines index each pattern under its own URL.
