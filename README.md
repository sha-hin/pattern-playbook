# Pattern Playbook: advanced Laravel in 7 days, one PMS, 43 production incidents

**Live course:** https://sha-hin.github.io/pattern-playbook/

One story: Nordic Stays, a vacation-rental property management system, from its first booking to its
busiest day. Every scene starts with something breaking in production. You read the broken code, fix it,
and only then learn the name of the pattern you just wrote: all 23 Gang of Four patterns, 15 modern ones
(Value Object, Repository, Data Mapper, Active Record, Simple Factory, Null Object, DI Container,
Manager/Driver, Generators, Event Dispatcher, Command Bus, Unit of Work, Transactional Outbox, Pipeline,
Specification), and the Laravel engineering around them. Each scene ends with its Pest tests, folded.

For Laravel developers: about 2–3 hours a day for a week.

By [Mohammed Shahin](https://sha-hin.github.io).

## Editing the course

- The story (7 days, 43 scenes, which ones are published): [`content/course.mjs`](content/course.mjs)
- The app every scene starts from: [`content/foundation/index.mjs`](content/foundation/index.mjs)
- Each scene's incident, code and tests: [`content/scenes/<slug>.mjs`](content/scenes)

```bash
node build/check-php.mjs   # php -l on every PHP block, plus a check that every class used is imported
node build/build.mjs       # regenerates the pages, sitemap and 404
```
