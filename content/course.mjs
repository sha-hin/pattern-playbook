// The course: one story in 7 days, 45 scenes. Nordic Stays, a vacation-rental PMS, grows from launch to scale,
// and every scene starts with a production incident. Patterns are named after the fix, never before.
// Each ready scene's content lives in content/scenes/<slug>.mjs.

export const DAYS = [
  { n: 1, title: 'Launch week', blurb: 'The first guests book and pay. Money, dates, the booking endpoint, double bookings, Stripe.' },
  { n: 2, title: 'Money comes in', blurb: 'Quotes, Stripe webhooks, the booking lifecycle, refunds, reports and reconciliation.' },
  { n: 3, title: 'Channels', blurb: 'Airbnb and Booking.com: iCal, real APIs, rate limits, queues and overbookings.' },
  { n: 4, title: 'Hosts and guests', blurb: 'Teams and roles, automatic guest messages, notifications and changed dates.' },
  { n: 5, title: 'Operations and pricing', blurb: 'Cleaning between stays, rate plans, the calendar, search and live updates.' },
  { n: 6, title: 'Scale', blurb: 'Slow pages, caching, events for other systems, the public API, load and big tables.' },
  { n: 7, title: 'Production', blurb: 'Deploys, incidents, how it all fits together, the interview and code review.' },
];

export const SCENES = [
  // Day 1 · Launch week
  { n: 1, day: 1, slug: '01-money', incident: '38 bookings, one cent short each', patterns: ['Value Object'], learn: 'Money in cents, Currency, Eloquent casts, CarbonImmutable', ready: true },
  { n: 2, day: 1, slug: '02-stay', incident: 'Every stay billed one night short', patterns: ['Value Object'], learn: 'Stay as calendar dates, nights, dates vs moments, property timezones', ready: true },
  { n: 3, day: 1, slug: '03-booking-endpoint', incident: '500 error, and a stranger booked our cabin', patterns: ['Active Record'], learn: 'Form Request, Policy, action, Resource; 201, 403, 409, 422; the two trap tests', ready: true },
  { n: 4, day: 1, slug: '04-race', incident: 'Two guests, same night, same second', patterns: [], learn: 'Transactions, lockForUpdate(), Cache::lock(), why SQLite hides the bug, a real concurrency test', ready: true },
  { n: 5, day: 1, slug: '05-container', incident: 'Our test suite charged a real card', patterns: ['Singleton', 'Dependency Injection Container'], learn: 'Bindings, autowiring, register() vs boot(), swapping a service in tests', ready: true },
  { n: 6, day: 1, slug: '06-confirm', incident: 'Marked paid by hand, but the guest never heard', patterns: ['Facade'], learn: 'One entry point for confirming a booking; Laravel facades inside; how fakes swap the real object', ready: true },

  // Day 2 · Money comes in
  { n: 7, day: 2, slug: '07-quote', incident: 'The quote said €1,098.90, the card was charged €1,105.50', patterns: ['Builder'], learn: 'One price built step by step: nights, discount, fee, tax; percentages in basis points; line items', ready: true },
  { n: 8, day: 2, slug: '08-webhooks', incident: 'Stripe said paid, the booking is still pending', patterns: ['Simple Factory'], learn: 'Webhooks: verify the signature, store, answer 200, process in a job; createOrFirst(); typed events', ready: true },
  { n: 9, day: 2, slug: '09-booking-states', incident: 'She paid two minutes after her hold expired', patterns: ['State'], learn: 'The booking lifecycle as states, holds that expire on a schedule, late payments, refunds with Idempotency-Key', ready: true },
  { n: 10, day: 2, slug: '10-refunds', incident: 'Refunded 100% on a strict booking', patterns: ['Strategy', 'Null Object'], learn: 'Cancellation policies as classes, partial refunds after commit, bookings with no policy', ready: true },
  { n: 11, day: 2, slug: '11-reconciliation', incident: 'Stripe and our books disagree by €40', patterns: ['Iterator', 'Generators'], learn: 'Nightly reconciliation: Stripe’s pages and our table as iterators, a comparing generator, lazyById() vs cursor()', ready: true },

  // Day 3 · Channels
  { n: 12, day: 3, slug: '12-ical', incident: 'Two families, one cabin, one night', patterns: [], learn: 'iCal sync: match by UID, updateOrCreate, deletes scoped to the source, one transaction', ready: true },
  { n: 13, day: 3, slug: '13-channel-api', incident: 'Every Airbnb call has failed with 401 for an hour', patterns: ['Adapter', 'Manager / Driver', 'Factory Method'], learn: 'One interface for every channel, an adapter each, Laravel’s Manager, OAuth token refresh under a lock', ready: true },
  { n: 14, day: 3, slug: '14-channel-kits', incident: 'Two days of Booking.com reservations never arrived', patterns: ['Abstract Factory'], learn: 'One kit per channel: API client, signature verifier and payload mapper built from that channel’s own configuration', ready: true },
  { n: 15, day: 3, slug: '15-out-of-order', incident: 'A cancellation arrived before the booking', patterns: [], learn: 'Versioned upserts under a lock, tombstones, a polling fallback, recorded payloads with Http::fake()', ready: true },
  { n: 16, day: 3, slug: '16-rate-limits', incident: 'Airbnb blocked us for an hour', patterns: ['Decorator'], learn: 'Retries only for real blips, a shared Redis rate limit, 429 and Retry-After, release() and retryUntil()', ready: true },
  { n: 17, day: 3, slug: '17-queues', incident: '642 pushes queued in one minute', patterns: ['Command', 'Command Bus'], learn: 'State instead of changes, ShouldBeUniqueUntilProcessing, WithoutOverlapping, two Redis queues, Horizon, retry_after, the worker loop', ready: true },
  { n: 18, day: 3, slug: '18-overbooking', incident: 'Same night sold on Airbnb and Booking.com', patterns: ['Mediator'], learn: 'One coordinator for every calendar change: overbookings recorded and reported once, every channel updated', ready: true },

  // Day 4 · Hosts and guests
  { n: 19, day: 4, slug: '19-tenancy', incident: 'A host saw another host’s bookings', patterns: [], learn: 'IDOR, queries that start from the account, policies with 404s, scoped exists rules, no mass assignment', ready: true },
  { n: 20, day: 4, slug: '20-roles', incident: 'The cleaner can see payouts', patterns: [], learn: 'Roles and policies, Gate::before, invitations with signed URLs, removing a member', ready: true },
  { n: 21, day: 4, slug: '21-send-times', incident: 'Arrival message sent at 3 a.m.', patterns: [], learn: 'Message templates, send_at built in the property’s timezone, DST tests, a scheduler with chunkById()', ready: true },
  { n: 22, day: 4, slug: '22-never-twice', incident: 'Guest got the door code twice', patterns: ['Observer', 'Event Dispatcher'], learn: 'An atomic pending → sent claim; a BookingCancelled event with independent listeners', ready: true },
  { n: 23, day: 4, slug: '23-date-change', incident: 'Dates changed, the payment failed, the booking is half-changed', patterns: ['Memento'], learn: 'Snapshot before the change, restore exactly when the payment fails, messages rescheduled', ready: true },
  { n: 24, day: 4, slug: '24-template-variables', incident: '{guest_name} showed up literally in the email', patterns: [], learn: 'A fixed list checked on save, escaping after Markdown, an encrypted door code only near arrival', ready: true },
  { n: 25, day: 4, slug: '25-channels', incident: 'SMS guests got an email instead', patterns: ['Bridge'], learn: 'Laravel Notifications as a bridge, the guest’s chosen channel, custom SMS and WhatsApp channels, hosts’ choices', ready: true },

  // Day 5 · Operations and pricing
  { n: 26, day: 5, slug: '26-turnovers', incident: 'The cleaner arrived while guests were still inside', patterns: [], learn: 'Cleaning tasks that follow the calendar, start times in the property’s timezone, telling the cleaner', ready: true },
  { n: 27, day: 5, slug: '27-rate-plans', incident: 'Summer prices ignored the weekend rule', patterns: [], learn: 'Rate plans with seasons and a weekend rule, each night priced on its own, the order rules apply in', ready: true },
  { n: 28, day: 5, slug: '28-duplicate-listing', incident: 'Changed the copy’s prices, the original’s changed too', patterns: ['Prototype'], learn: 'Eloquent replicate(), shallow vs deep copies, what a copy must never take along', ready: true },
  { n: 29, day: 5, slug: '29-minimum-stay', incident: 'A 1-night Booking.com stay on a 3-night-minimum cabin', patterns: [], learn: 'Minimum stay sent to the channels with availability, one rule check for every booking path', ready: true },
  { n: 30, day: 5, slug: '30-search', incident: 'Search said free, the booking said taken', patterns: ['Specification'], learn: 'One availability rule as an Eloquent scope, shared by search, bookings, date changes and moves; whereDoesntHave(); when SQL is enough', ready: true },
  { n: 31, day: 5, slug: '31-real-time', incident: 'The calendar didn’t update when Airbnb booked', patterns: [], learn: 'Reverb, broadcasting after commit, channels scoped to the account, presence, scaling', ready: true },

  // Day 6 · Scale
  { n: 32, day: 6, slug: '32-slow-page', incident: 'The properties page takes 4 seconds', patterns: [], learn: 'N+1 queries, eager loading with constraints, withCount() and ofMany(), why lazy-loading protection missed it, EXPLAIN', ready: true },
  { n: 33, day: 6, slug: '33-caching', incident: 'Prices went up at 09:00, guests paid the old ones until 10:00', patterns: ['Proxy'], learn: 'A caching proxy, versioned keys bumped after commit, never caching the price a guest pays, cache-aside', ready: true },
  { n: 34, day: 6, slug: '34-outbox', incident: 'Booking saved, the partner never heard about it', patterns: ['Transactional Outbox'], learn: 'Writing the message in the same transaction, a relay job, at-least-once delivery, idempotent consumers, event versions', ready: true },
  { n: 35, day: 6, slug: '35-public-api', incident: 'The mobile app retried and booked twice', patterns: ['Chain of Responsibility', 'Pipeline'], learn: 'An Idempotency-Key middleware, how Laravel’s middleware pipeline works, replaying the stored response', ready: true },
  { n: 36, day: 6, slug: '36-exports', incident: 'The tax report export included another host’s bookings', patterns: ['Template Method'], learn: 'One base class for every CSV export: the account scope, chunked reads and streamed downloads that no export can skip', ready: true },
  { n: 37, day: 6, slug: '37-ical-at-scale', incident: 'iCal calendars are three hours out of date', patterns: ['Unit of Work'], learn: 'Changes worked out in memory and written in one short transaction: upsert(), one delete, only real differences written', ready: true },
  { n: 38, day: 6, slug: '38-load', incident: 'Busiest day of the year: search p99 is 8 seconds', patterns: [], learn: 'k6 at a fixed arrival rate, p95 and p99, EXPLAIN and a composite index, read replicas, sticky, what must read the primary', ready: true },
  { n: 39, day: 6, slug: '39-search-fallback', incident: 'Meilisearch restarted, search returned 500 for ten minutes', patterns: ['Repository'], learn: 'Scout and Meilisearch behind one search interface, the SQL search as a fallback, contract tests for both, the Eloquent repository debate', ready: true },

  // Day 7 · Production
  { n: 40, day: 7, slug: '40-big-tables', incident: 'Adding a column locked bookings for 20 minutes', patterns: [], learn: 'Metadata locks, ALGORITHM=INSTANT and lock_wait_timeout, reports off the primary, batched backfills, gh-ost', ready: true },
  { n: 41, day: 7, slug: '41-deploys', incident: 'Deployed at 14:00, workers ran old code until 16:00', patterns: [], learn: 'Release directories and an atomic switch, OPcache, horizon:terminate, Supervisor, onOneServer() on two servers, CI, Octane', ready: true },
  { n: 42, day: 7, slug: '42-incident', incident: 'Stuck queue, a worker eating memory', patterns: [], learn: 'Logs → metrics → reproduce → fix → postmortem; monitoring failed jobs' },
  { n: 43, day: 7, slug: '43-how-it-fits', incident: 'A new developer asks how it all fits together', patterns: [], learn: 'Laravel internals, architecture, Larastan, Pint, Rector, arch tests, mutation testing, upgrades' },
  { n: 44, day: 7, slug: '44-interview', incident: 'The interview', patterns: [], learn: 'System design: a PMS, a channel manager, a message scheduler; behavioural answers' },
  { n: 45, day: 7, slug: '45-code-review', incident: 'Review this pull request', patterns: [], learn: 'AI-written code with hidden bugs' },
];

// After the story: patterns that have no honest place in this PMS, each built for real outside the app.
export const OUTSIDE = {
  slug: '46-outside-the-story',
  title: 'Five patterns outside the story',
  learn: 'Composite, Data Mapper, Visitor, Flyweight and Interpreter, each built with real code',
  patterns: ['Composite', 'Data Mapper', 'Visitor', 'Flyweight', 'Interpreter'],
  ready: false,
};

export const FOUNDATION = {
  slug: '00-foundation',
  title: 'Foundation',
  learn: 'The app every scene starts from: setup, the core tables, models, factories and test helpers',
};

export const dayOf = scene => DAYS.find(d => d.n === scene.day);
