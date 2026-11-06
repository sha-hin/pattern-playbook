# Pattern Playbook: design patterns in Laravel, inside a real PMS

**Live course:** https://sha-hin.github.io/pattern-playbook/

All 23 Gang of Four design patterns and 15 modern ones (Value Object, Repository, Data Mapper,
Active Record, Simple Factory, Null Object, DI Container, Manager/Driver, Generators, Event Dispatcher,
Command Bus, Unit of Work, Transactional Outbox, Pipeline, Specification), each applied to the business
logic of a vacation-rental property management system: bookings, pricing, payments, channel sync,
guest messaging, operations. When Laravel already ships a pattern, the lesson shows how Laravel builds it
inside. Every lesson ends with "When not to use it" and its Pest tests, folded.

For Laravel developers: the course is about business logic and patterns, not about learning Laravel.

By [Mohammed Shahin](https://sha-hin.github.io).

## Editing the course

- The plan (29 lessons, which ones are published): [`content/course.mjs`](content/course.mjs)
- Each lesson's text, code and tests: [`content/lessons/<slug>.mjs`](content/lessons)

```bash
node build/check-php.mjs   # php -l on every PHP block in the lessons
node build/build.mjs       # regenerates the pages, sitemap and 404
```
