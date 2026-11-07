# CLAUDE.md: writing Pattern Playbook scenes

## Every incident must be realistic
- The bug is one a real team ships: a missed case, a copied line, a default that was fine until a new feature,
  a release that changed one thing. Never a bug written to justify a pattern.
- The broken code must cause exactly the incident in the chat, and a reader must be able to point at the line.
- The impact is believable: who noticed, how (support, finance, a host, monitoring), and how many were hit.
- One problem per scene. The pattern appears only if a real team would write it for this fix; otherwise none.
- Best practice first: never rebuild what Laravel or PHP already does (`Http::retry()`, job middleware, `match`).
  A class hierarchy or interface needs a real difference between its members, and a builder or factory needs
  more than one real caller today.
- The timeline stays consistent with the scenes before and after it (days, teasers, numbers).
- Code is production quality, type annotations included, no silent failures.

## The real cause behind each scene
| Scene | Incident | The real cause |
|---|---|---|
| 26 | The cleaner arrived while guests were still inside | The guests extended by a night; the task was created once at confirmation, and date changes skipped `CalendarSync` |
| 27 | Summer prices ignored the weekend rule | The season code returns the season price early and skips the weekend rule (no pattern) |
| 28 | Changed the copy’s prices, the original’s changed too | `replicate()` copies `rate_plan_id`, so both listings share one rate plan (Prototype) |
| 29 | A 1-night Booking.com stay on a 3-night-minimum cabin | Minimum stay is only in the website’s Form Request and never pushed to the channels (no pattern) |
| 30 | Search said free, the booking said taken | Search wrote its own overlap query and ignores pending holds; booking counts them (Specification) |
| 31 | The calendar didn’t update when Airbnb booked | Broadcast fired only from the website’s controller, not from channel imports, and before commit |
| 32 | The properties page takes 4 seconds | Queries inside a resource, once per property (N+1); strict mode missed it because dev and tests had one property, and query-builder calls are never flagged (no pattern) |
| 33 | Prices went up at 09:00, guests paid the old ones until 10:00 | The quote is cached inline for an hour and a price change never invalidates it (Proxy: a caching proxy with versioned keys) |
| 34 | Booking saved, the partner never heard about it | The event is published after commit; the process died between the two (Transactional Outbox) |
| 35 | The mobile app retried and booked twice | A timeout made the app retry a POST that had already succeeded (Chain of Responsibility, Pipeline: an Idempotency-Key middleware) |
| 36 | The tax report export included another host’s bookings | The tax export was copied from the payouts export and lost the account scope; it also loads every row at once (Template Method: a base export that always scopes and chunks) |
| 37 | iCal calendars are three hours out of date | Row-by-row updateOrCreate per event; at 3,000 feeds every 15 minutes the sync queue never catches up (Unit of Work: changes worked out in memory, written once) |
| 38 | Busiest day of the year: search p99 is 8 seconds | Every search hits the primary; one unindexed filter scans the whole table |
| 39 | Meilisearch restarted, search returned 500 for ten minutes | Search moved to Meilisearch and the controller calls it directly, with no fallback (Repository: one search interface, Meilisearch and SQL implementations) |
| 40 | Adding a column locked bookings for 20 minutes | An instant ALTER waited for the metadata lock behind a 25-minute report on the primary, and every booking query queued behind it |
| 41 | Deployed at 14:00, workers ran old code until 16:00 | The deploy script never ran `horizon:terminate` |
| 42 | Stuck queue, a worker eating memory | A long-running worker keeps every model it loaded in a static array |
| 43–45 | Onboarding, interview, code review | No incident needed; the code under review has real bugs only |
