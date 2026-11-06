# Pattern Playbook

Design patterns for PHP and Laravel developers, one pattern per screen:

- **A memory hook** from everyday life (Adapter = a travel plug, State = a traffic light)
- **The pain vs the fix**, drawn side by side, so you recognise when you need it
- **Real-world before / after code**: exports, SMS providers, caching, queues, imports, approval workflows, paginated APIs
- **Where you already use it** in Laravel
- **Test me** mode: shuffled real-world scenarios to check you can pick the right pattern

25 patterns: 15 from the Gang of Four book and 10 modern ones every PHP framework relies on
(DI Container, Simple Factory, Null Object, Value Object, Event Dispatcher, Generators,
Command Bus, Transactional Outbox, Manager/Driver, Laravel's static-proxy "Facades").

**Live:** https://sha-hin.github.io/pattern-playbook/

A single static `index.html`, no build step.

By [Mohammed Shahin](https://sha-hin.github.io).

## Editing

All content lives in `assets/app.js` (the `BASE` and `EXTRA` arrays). After editing it, regenerate the pages:

```bash
node build/build.mjs
```

This writes `index.html`, one folder per pattern (`strategy/index.html`, …), `sitemap.xml`, `robots.txt` and `404.html`.
Every page is complete static HTML, so search engines index each pattern under its own URL.
