// Lesson 0: everything the course builds on, ready before lesson 1. No pattern here.
// The parts live in content/foundation/; lessons link to their anchors with [text](F#anchor).

import { setup } from '../foundation/setup.mjs';
import { migrations } from '../foundation/migrations.mjs';
import { enums, models } from '../foundation/models.mjs';
import { factories, seeders } from '../foundation/factories.mjs';
import { testing, foundationTests } from '../foundation/testing.mjs';

export default {
  description: 'The complete foundation of a Laravel 13 vacation-rental PMS on PHP 8.4, MySQL and Redis: Docker, configuration, every migration, enum, model, factory, seeder and Pest helper the design patterns course uses.',
  intro: [
    'This course teaches design patterns inside the business logic of a **vacation-rental PMS** (property management system): the software hosts use to run their rentals. Hosts list properties, guests book stays directly or through Airbnb and Booking.com, payments go through Stripe, guests get automatic messages, and cleaners get a task between every two stays.',
    'This page holds **everything the lessons stand on**: the setup, every table, enum, model, factory and test helper. Nothing in it is created later. Lessons only add the pattern code, and link back here when they use a column or a factory state, with a line on why the decision was made.',
    'Three rules apply everywhere: **money is an integer in the smallest unit** with its currency next to it; **dates are dates** (`check_in` is a `DATE`), read in the property’s timezone, and instants are stored in UTC; and **every rule the database can enforce is enforced there too** (unique indexes, foreign keys).',
  ],
  toc: true,
  sections: [setup, migrations, enums, models, factories, seeders, testing, {
    id: 'map',
    title: 'Where each piece is used',
    text: ['Each lesson links back to the piece it uses.'],
    numbered: false,
    blocks: [
      {
        table: [
          ['Piece', 'Used in'],
          ['Money in cents + `currency`, `booking_line_items`', 'Lesson 1 (Money), 5 (quote builder), 15 (refunds), 25 (folio visitor)'],
          ['`check_in`/`check_out` as `[in, out)` dates, `scopeOverlapping`', 'Lesson 1 (Stay), 2 (create booking), 16 (acceptance rules), 26 (availability search)'],
          ['`accounts`, `memberships`, `roleIn()`, `memberOf()`', 'Lesson 2 (policy), 11 (roles, scoping, invitations), 26 (tenant scoping)'],
          ['`payments`, `provider_payment_id` unique, Stripe config', 'Lesson 3 (gateway), 20 (payment states), 27 (reconciliation)'],
          ['`properties.timezone`, check-in/out times', 'Lesson 15 (send times across DST), 21 (cleaning due times)'],
          ['`calendar_days`, `rate_rules` tree', 'Lesson 12 (Composite rate plans), 14 (Flyweight), 16 (price pipeline)'],
          ['`checklist_templates`, `cleaning_tasks`', 'Lesson 8 (Prototype), 21 (tasks between stays)'],
          ['`channel_connections`, `channel_listings`, `ical_feeds`', 'Lesson 7 (channel kits), 9 (adapters), 11 (token refresh), 17 (iCal sync)'],
          ['`unique(source, external_id)`, `external_version`', 'Lesson 9 (upsert), 23 (out-of-order events)'],
          ['`webhook_events`, `unique(provider, event_id)`', 'Lesson 6 (typed events), 18 (queued processing), 27 (inbox)'],
          ['`message_templates`, `scheduled_messages` unique per booking + template', 'Lesson 13 (Bridge), 15 (triggers), 19 (due messages), 24 (variables)'],
          ['`conversations`, `chat_messages`', 'Lesson 22 (chat mediator, presence)'],
          ['`review_requests` unique per booking', 'Lesson 21 (after check-out, never twice)'],
          ['`outbox_messages`, `idempotency_keys`', 'Lesson 27 (outbox relay), 16 (Idempotency-Key middleware)'],
          ['Redis connections, `after_commit`, `retry_after`', 'Lesson 10 (caching), 17 (`Cache::lock`), 18 (Horizon)'],
          ['MySQL for tests, frozen clock, `preventStrayRequests()`', 'Every lesson’s tests'],
        ],
      },
    ],
  }],
  tests: foundationTests,
  next: 'Lesson 1 starts the patterns: money and stays are passed around as bare integers and strings, and the bugs that causes.',
};
