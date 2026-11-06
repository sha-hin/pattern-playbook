# Pattern Playbook: design patterns in PHP, learned by fixing one real app

**Live course:** https://sha-hin.github.io/pattern-playbook/

**Evalu8** is a school evaluation platform: students, peers and principals score teachers from 1 to 5,
and the app produces term reports, emails and a CSV for the Ministry. It starts as one messy PHP script.
Every chapter brings a real ticket (a bug, a new rule, a scaling problem) and fixes it with the design
pattern made for it, until the codebase uses all 23 Gang of Four patterns plus the modern ones every PHP
framework relies on (Value Object, Repository, DI Container, Outbox, Pipeline, Specification and more).

Each chapter page has: the ticket, the quick fix that would hurt later, the pattern in one sentence with a
before/after drawing, the refactor step by step as exact diffs of the real code, the output, and how
Laravel does the same thing.

By [Mohammed Shahin](https://sha-hin.github.io).

## Run any chapter

Every chapter is a complete, runnable snapshot in [`chapters/`](chapters). You need PHP 8.2+ with the
SQLite extension, and Composer (it only generates the autoloader; nothing is downloaded).

```bash
cd chapters/03-strategy
composer dump-autoload
php bin/evaluations.php
```

Chapter 0 is the original single script: `php chapters/00-the-mess/evaluations.php`.

## Editing the course

- Chapter text, tickets and drawings: [`content/course.mjs`](content/course.mjs)
- Code shown on the pages is read from `chapters/<slug>/` at build time, so it is always the code that runs.

After changing chapter code or text:

```bash
build/run-chapters.sh   # re-runs every chapter and saves chapters/<slug>/output.txt
node build/build.mjs    # regenerates the pages, sitemap and 404
```
