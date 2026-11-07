# CLAUDE.md: writing Pattern Playbook scenes

## Every incident must be realistic
- The bug is one a real team ships: a missed case, a copied line, a default that was fine until a new feature,
  a release that changed one thing. Never a bug written to justify a pattern.
- The broken code must cause exactly the incident in the chat, and a reader must be able to point at the line.
- The impact is believable: who noticed, how (support, finance, a host, monitoring), and how many were hit.
- One problem per scene. The pattern appears only if a real team would write it for this fix; otherwise none.
- The timeline stays consistent with the scenes before and after it (days, teasers, numbers).
- Code is production quality, type annotations included, no silent failures.

## Planned bugs for the upcoming scenes
| Scene | Incident | The real cause |
|---|---|---|
| 26 | The cleaner arrived while guests were still inside | The guests extended by a night; the date change never moved the cleaning task |
| 27 | Changed the copy’s prices, the original’s changed too | `replicate()` copies `rate_plan_id`, so both listings share one rate plan |
| 28 | Summer prices ignored the weekend rule | A season replaces the base rules instead of combining with them |
| 29 | A 1-night Booking.com stay on a 3-night-minimum cabin | Minimum stay is checked only in the website’s Form Request; channel imports skip it |
| 30 | Search said free, the booking said taken | Search wrote its own overlap query and ignores pending holds; booking counts them |
| 31 | The calendar didn’t update when Airbnb booked | Broadcast fired only from the website’s controller, not from channel imports, and before commit |
| 32 | The property page takes 4 seconds | Lazy-loaded relations in a loop (N+1), plus a missing index |
| 33 | Prices went up at 09:00, guests paid the old ones until 10:00 | The quote is cached for an hour and a price change never invalidates it |
| 34 | Booking saved, the partner never heard about it | The event is published after commit; the process died between the two |
| 35 | The mobile app retried and booked twice | A timeout made the app retry a POST that had already succeeded |
| 36 | Busiest day of the year: search p99 is 8 seconds | Every search hits the primary; one unindexed filter scans the whole table |
| 37 | Adding a column locked bookings for 20 minutes | A migration with a column change that MySQL can’t do online |
| 38 | Deployed at 14:00, workers ran old code until 16:00 | The deploy script never ran `queue:restart` |
| 39 | Stuck queue, a worker eating memory | A long-running worker keeps every model it loaded in a static array |
| 40–42 | Onboarding, interview, code review | No incident needed; the code under review has real bugs only |
