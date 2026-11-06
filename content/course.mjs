// The course: one story in 7 days, 42 scenes. Nordic Stays, a vacation-rental PMS, grows from launch to scale,
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
  { n: 1, day: 1, slug: '01-money', incident: 'Guest charged €450.29 for a €450.30 stay', patterns: ['Value Object'], learn: 'Money in cents, Currency, Eloquent casts, CarbonImmutable', ready: true },
  { n: 2, day: 1, slug: '02-stay', incident: 'She booked 4 nights, we billed 3', patterns: ['Value Object'], learn: 'Stay as calendar dates, nights, dates vs moments, property timezones', ready: true },
  { n: 3, day: 1, slug: '03-booking-endpoint', incident: '500 error, and a stranger booked our cabin', patterns: ['Active Record'], learn: 'Form Request, Policy, action, Resource; 201, 403, 409, 422; the two trap tests', ready: true },
  { n: 4, day: 1, slug: '04-race', incident: 'Two guests, same night, same second', patterns: [], learn: 'Transactions, lockForUpdate(), Cache::lock(), why SQLite hides the bug, a real concurrency test', ready: true },
  { n: 5, day: 1, slug: '05-container', incident: 'Our test suite charged a real card', patterns: ['Singleton', 'Dependency Injection Container'], learn: 'Bindings, autowiring, register() vs boot(), swapping a service in tests', ready: true },
  { n: 6, day: 1, slug: '06-confirm', incident: 'Marked paid by hand, but the guest never heard', patterns: ['Facade'], learn: 'One entry point for confirming a booking; Laravel facades inside; how fakes swap the real object', ready: true },

  // Day 2 · Money comes in
  { n: 7, day: 2, slug: '07-quote', incident: 'The quote said €612, the invoice €598', patterns: ['Builder'], learn: 'A price quote built step by step: nights, fees, discounts, tax; line items' },
  { n: 8, day: 2, slug: '08-webhooks', incident: 'Stripe said paid, the booking is still pending', patterns: ['Simple Factory'], learn: 'Webhooks: verify the signature, store, answer 200, process in a job; typed events' },
  { n: 9, day: 2, slug: '09-booking-states', incident: 'A booking went from expired back to confirmed', patterns: ['State'], learn: 'The booking lifecycle; PaymentIntents, Idempotency-Key, deposits and balances, holds that expire' },
  { n: 10, day: 2, slug: '10-refunds', incident: 'Refunded 100% on a strict policy', patterns: ['Strategy', 'Null Object'], learn: 'Cancellation policies, partial refunds, properties with no cleaning fee' },
  { n: 11, day: 2, slug: '11-reconciliation', incident: 'Stripe and our books disagree by €40', patterns: ['Iterator', 'Generators'], learn: 'Nightly reconciliation: chunkById, lazy(), LazyCollection; owner payouts, currencies' },

  // Day 3 · Channels
  { n: 12, day: 3, slug: '12-ical', incident: 'Dates blocked on Airbnb never reached us', patterns: ['Template Method', 'Factory Method'], learn: 'iCal sync: match by UID, updateOrCreate, deletes scoped to the source, one transaction' },
  { n: 13, day: 3, slug: '13-channel-api', incident: 'We need the real Airbnb API now', patterns: ['Adapter', 'Manager / Driver'], learn: 'One interface for every channel, listings mapping, OAuth token refresh' },
  { n: 14, day: 3, slug: '14-channel-kits', incident: 'A Booking.com webhook passed Airbnb’s signature check', patterns: ['Abstract Factory'], learn: 'One matching set per channel: client, signature verifier, payload mapper' },
  { n: 15, day: 3, slug: '15-out-of-order', incident: 'A cancellation arrived before the booking', patterns: [], learn: 'Upsert by (channel, external_id), versions, polling fallback, recorded payloads with Http::fake()' },
  { n: 16, day: 3, slug: '16-rate-limits', incident: 'Airbnb blocked us for an hour', patterns: ['Decorator'], learn: 'Timeouts, retries, 429 and Retry-After, the RateLimited job middleware' },
  { n: 17, day: 3, slug: '17-queues', incident: '200 pushes for one calendar edit', patterns: ['Command', 'Command Bus'], learn: 'Jobs, tries, backoff, failed(), ShouldBeUnique, WithoutOverlapping, Redis, Horizon, the worker loop' },
  { n: 18, day: 3, slug: '18-overbooking', incident: 'Same night sold on Airbnb and Booking.com', patterns: ['Mediator'], learn: 'One sync coordinator between channels; handling overbookings' },

  // Day 4 · Hosts and guests
  { n: 19, day: 4, slug: '19-tenancy', incident: 'A host saw another host’s bookings', patterns: [], learn: 'Scoping every query and exists rule to the account, IDOR, mass assignment' },
  { n: 20, day: 4, slug: '20-roles', incident: 'The cleaner can see payouts', patterns: [], learn: 'Roles and policies, Gate::before, invitations with signed URLs, removing a member' },
  { n: 21, day: 4, slug: '21-send-times', incident: 'Arrival message sent at 3 a.m.', patterns: [], learn: 'send_at from the property timezone, DST with frozen time, the scheduler, withoutOverlapping()' },
  { n: 22, day: 4, slug: '22-never-twice', incident: 'Guest got the door code twice', patterns: ['Observer', 'Event Dispatcher'], learn: 'Unique index + atomic pending → sent; one event, many reactions' },
  { n: 23, day: 4, slug: '23-date-change', incident: 'Dates changed, the payment failed, the booking is half-changed', patterns: ['Memento'], learn: 'Snapshot and restore; rescheduling guest messages' },
  { n: 24, day: 4, slug: '24-template-variables', incident: '{guest_name} showed up literally in the email', patterns: [], learn: 'Template variables, escaping, sensitive values only close to check-in' },
  { n: 25, day: 4, slug: '25-channels', incident: 'SMS guests got an email instead', patterns: ['Bridge'], learn: 'Notifications inside; via() per guest; a WhatsApp channel; Notification::fake()' },

  // Day 5 · Operations and pricing
  { n: 26, day: 5, slug: '26-turnovers', incident: 'The cleaner arrived while guests were still inside', patterns: [], learn: 'Cleaning tasks between stays, due times in the property timezone, review requests' },
  { n: 27, day: 5, slug: '27-duplicate-listing', incident: 'Host duplicated a listing, editing the copy changed the original', patterns: ['Prototype'], learn: 'Eloquent replicate(), deep vs shallow copies' },
  { n: 28, day: 5, slug: '28-rate-plans', incident: 'Summer prices ignored the weekend rule', patterns: ['Composite'], learn: 'Rate plans as a tree of rules; the calendar_days table' },
  { n: 29, day: 5, slug: '29-acceptance-rules', incident: 'Accepted 1 night with a 3-night minimum', patterns: ['Pipeline', 'Chain of Responsibility'], learn: 'Booking rules and price stages; Laravel’s middleware pipeline inside' },
  { n: 30, day: 5, slug: '30-search', incident: 'Free 12–15 July, 3 bedrooms, pets OK?', patterns: ['Specification', 'Repository'], learn: 'Availability search on SQL, then Meilisearch behind the same interface' },
  { n: 31, day: 5, slug: '31-real-time', incident: 'The calendar didn’t update when Airbnb booked', patterns: [], learn: 'Reverb, broadcasting after commit, channels scoped to the account, presence, scaling' },

  // Day 6 · Scale
  { n: 32, day: 6, slug: '32-slow-page', incident: 'The property page takes 4 seconds', patterns: ['Proxy'], learn: 'N+1, eager loading, indexes and EXPLAIN; how Eloquent’s lazy relations work' },
  { n: 33, day: 6, slug: '33-caching', incident: 'Cached price, guest charged the old one', patterns: [], learn: 'Cache-aside, invalidation after commit, versioned keys, stampedes, ETag, CDN, Redis eviction' },
  { n: 34, day: 6, slug: '34-outbox', incident: 'Booking saved, the partner never heard about it', patterns: ['Transactional Outbox', 'Unit of Work'], learn: 'At-least-once delivery, idempotent consumers, event versions, SQS and Kafka' },
  { n: 35, day: 6, slug: '35-public-api', incident: 'The mobile app retried and booked twice', patterns: [], learn: 'Idempotency-Key middleware, versioning, one error format, Sanctum, rate limits, pagination, OAuth' },
  { n: 36, day: 6, slug: '36-load', incident: 'Busiest day of the year: search p99 is 8 seconds', patterns: [], learn: 'k6, read replicas and sticky, isolation levels, archiving, partitioning, sharding' },
  { n: 37, day: 6, slug: '37-big-tables', incident: 'Adding a column locked bookings for 20 minutes', patterns: [], learn: 'Online DDL, batched backfills, zero-downtime migrations' },

  // Day 7 · Production
  { n: 38, day: 7, slug: '38-deploys', incident: 'Deployed at 14:00, workers ran old code until 16:00', patterns: [], learn: 'Docker, CI, Horizon, queue:restart, config:cache, OPcache, Octane, stateless servers' },
  { n: 39, day: 7, slug: '39-incident', incident: 'Stuck queue, a worker eating memory', patterns: [], learn: 'Logs → metrics → reproduce → fix → postmortem; monitoring failed jobs' },
  { n: 40, day: 7, slug: '40-how-it-fits', incident: 'A new developer asks how it all fits together', patterns: [], learn: 'Laravel internals, architecture, Larastan, Pint, Rector, arch tests, mutation testing, upgrades' },
  { n: 41, day: 7, slug: '41-interview', incident: 'The interview', patterns: [], learn: 'System design: a PMS, a channel manager, a message scheduler; behavioural answers' },
  { n: 42, day: 7, slug: '42-code-review', incident: 'Review this pull request', patterns: [], learn: 'AI-written code with hidden bugs' },
];

// After the story: the four patterns a Laravel PMS doesn't need, each built for real outside the app.
export const OUTSIDE = {
  slug: '43-outside-the-story',
  title: 'Four patterns outside the story',
  learn: 'Data Mapper, Visitor, Flyweight and Interpreter, each built with real code',
  patterns: ['Data Mapper', 'Visitor', 'Flyweight', 'Interpreter'],
  ready: false,
};

export const FOUNDATION = {
  slug: '00-foundation',
  title: 'Foundation',
  learn: 'The app every scene starts from: setup, the core tables, models, factories and test helpers',
};

export const dayOf = scene => DAYS.find(d => d.n === scene.day);
