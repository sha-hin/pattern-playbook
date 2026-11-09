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
| 21 | Arrival message sent at 3 a.m. | `send_at` built in UTC, not the property’s timezone; the review request is the after-check-out template (no pattern) |
| 26 | The cleaner arrived while guests were still inside | The guests extended by a night; the task was created once at confirmation, and date changes skipped `CalendarSync` |
| 27 | Summer prices ignored the weekend rule | The season code returns the season price early and skips the weekend rule (no pattern) |
| 28 | Changed the copy’s prices, the original’s changed too | `replicate()` copies `rate_plan_id`, so both listings share one rate plan (Prototype) |
| 29 | A 1-night Booking.com stay on a 3-night-minimum cabin | Minimum stay is only in the website’s Form Request and never pushed to the channels (no pattern) |
| 30 | A Christmas minimum stay closed short stays all year | `min_nights` is one number per property, and scene 29 pushes it for all 365 nights; fix: `calendar_days` per arrival date (no pattern) |
| 31 | Search said free, the booking said taken | Search wrote its own overlap query and ignores pending holds; booking counts them (Specification) |
| 32 | The calendar didn’t update when Airbnb booked | Broadcast fired only from the website’s controller, not from channel imports, and before commit |
| 33 | Two co-hosts sent the same guest different check-in times | The inbox loads once; no presence, no live messages, and the server accepts a reply written without seeing a teammate’s (no pattern) |
| 34 | The properties page takes 4 seconds | Queries inside a resource, once per property (N+1); strict mode missed it because dev and tests had one property, and query-builder calls are never flagged (no pattern) |
| 35 | Prices went up at 09:00, guests paid the old ones until 10:00 | The quote is cached inline for an hour and a price change never invalidates it (Proxy: a caching proxy with versioned keys). Follow-up: one Redis with `allkeys-lru` for cache, queue, sessions and locks evicts sessions, delayed jobs and the price versions |
| 36 | Booking saved, the partner never heard about it | The event is published after commit; the process died between the two (Transactional Outbox) |
| 37 | The mobile app retried and booked twice | A timeout made the app retry a POST that had already succeeded (Chain of Responsibility, Pipeline: an Idempotency-Key middleware) |
| 38 | A partner’s nightly sync missed bookings | The changes endpoint uses offset pages over rows that move while they are read; the cursor fix changes the response shape, so it ships as `/api/v2` (no pattern) |
| 39 | A channel manager cancelled 14 bookings with a host’s token | `createToken($name)` gives `['*']` with no expiry and no account; fix: abilities per route, expiry, an account per token, a rate limit per token, JSON errors (no pattern) |
| 40 | The tax report export included another host’s bookings | The tax export was copied from the payouts export and lost the account scope; it also loads every row at once (Template Method: a base export that always scopes and chunks) |
| 41 | iCal calendars are three hours out of date | Row-by-row updateOrCreate per event; at 3,100 feeds every 15 minutes the sync queue never catches up (Unit of Work). Follow-up: the overlap key is per feed, so two feeds of one property upsert the same index at once and deadlock on next-key locks |
| 42 | Busiest day of the year: search p99 is 8 seconds | Every search hits the primary; one unindexed filter scans the whole table. Follow-up: a 5-minute `Cache::remember()` stampedes on expiry. Second follow-up (postmortem action): public pages behind the CDN with purging |
| 43 | Meilisearch restarted, search returned 500 for ten minutes | Search moved to Meilisearch and the controller calls it directly, with no fallback (Repository). Follow-up: `scout:flush` + `scout:import` on the live index |
| 44 | Adding a column locked bookings for 20 minutes | An instant ALTER waited for the metadata lock behind a 25-minute report on the primary, and every booking query queued behind it. Follow-up: one 31-million-row DELETE puts the replica 40 minutes behind |
| 45 | Deployed at 14:00, workers ran old code until 16:00 | The deploy script never ran `horizon:terminate`. Follow-up: Reverb on two servers without Redis scaling |
| 46 | Stuck queue, a worker eating memory | A long-running worker keeps every model it loaded in a static array |
| 47–49 | Onboarding, interview, code review | No incident needed; the code under review has real bugs only. The interview covers sharding as a design question, never as an invented incident |

## Follow-up parts
- A scene may have `followups`: a later problem caused by the same incident or its fix, the same day or from its postmortem.
  Each has its own incident (or a postmortem ticket), sections and tests, and still teaches one problem.
- Never use a follow-up to fit a topic that has no honest cause in that scene.
