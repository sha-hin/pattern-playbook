// Foundation, part 2: every migration of the course, one block per file.

export const migrations = {
  id: 'migrations',
  title: 'Migrations: every table of the course',
  text: [
    'Laravel’s default tables stay as they are: `users`, `password_reset_tokens`, `sessions`, `cache`, `jobs`, `job_batches`, `failed_jobs`, plus `personal_access_tokens` (Sanctum) and `notifications` (database notifications). Below are the PMS tables.',
    'Three rules apply everywhere. **Money** is an unsigned integer in the currency’s minor unit, with a `currency` column next to it. **Calendar dates** (`check_in`, `date`) are `DATE` columns; **moments** (`send_at`, `due_at`) are UTC datetimes, converted from the property timezone. **Every rule the database can enforce, it enforces**: unique indexes and foreign keys are the last line of defence behind the code.',
  ],
  numbered: false,
  blocks: [
    {
      id: 'table-accounts',
      title: '`accounts`',
      text: [
        'One account owns the properties. Everything a host sees is scoped to an account.',
      ],
      path: 'database/migrations/2026_01_01_000001_create_accounts_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-users',
      title: '`users`',
      text: [
        'Laravel’s `users` table, extended. A user can belong to several accounts and works in one current account at a time. `notification_channels` holds the channels this user wants (lesson 13).',
      ],
      path: 'database/migrations/2026_01_01_000002_add_account_columns_to_users_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('current_account_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->string('phone')->nullable();                      // E.164, e.g. +4512345678
            $table->json('notification_channels')->nullable();        // e.g. ["mail", "database"]
        });
    }
};`,
    },
    {
      id: 'table-memberships',
      title: '`memberships`',
      text: [
        'Users work in an account through a membership that carries their role. The unique index makes "one role per person per account" a database rule.',
      ],
      path: 'database/migrations/2026_01_01_000003_create_memberships_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role');                                   // owner, co_host, cleaner
            $table->timestamps();
            $table->unique(['account_id', 'user_id']);                // one role per person per account
        });
    }
};`,
    },
    {
      id: 'table-account-invitations',
      title: '`account_invitations`',
      text: [
        'An invitation is accepted through a signed URL (lesson 11). One open invitation per email per account.',
      ],
      path: 'database/migrations/2026_01_01_000004_create_account_invitations_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invited_by')->constrained('users');
            $table->string('email');
            $table->string('role');
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->unique(['account_id', 'email']);                  // one open invitation per person
        });
    }
};`,
    },
    {
      id: 'table-properties',
      title: '`properties`',
      text: [
        'Timezone and check-in/out times live on the property: "1 day before check-in at 15:00" means nothing without them. Basis points (`_bps`, 1/100 of a percent) keep percentages as integers: 2500 bps = 25%.',
      ],
      path: 'database/migrations/2026_01_01_000005_create_properties_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('properties', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('city');
            $table->char('country', 2);                               // ISO 3166-1
            $table->decimal('latitude', 9, 6);
            $table->decimal('longitude', 9, 6);
            $table->string('timezone');                               // IANA, e.g. Europe/Copenhagen
            $table->time('check_in_time')->default('15:00');
            $table->time('check_out_time')->default('11:00');
            $table->unsignedTinyInteger('bedrooms');
            $table->unsignedTinyInteger('max_guests');
            $table->boolean('pets_allowed')->default(false);
            $table->json('amenities');                                // ["wifi", "parking", "sauna"]
            $table->unsignedSmallInteger('min_nights')->default(1);
            $table->unsignedSmallInteger('booking_lead_hours')->default(0);   // how soon before arrival a booking is accepted
            $table->unsignedInteger('nightly_rate_cents');
            $table->unsignedInteger('cleaning_fee_cents')->nullable();        // null = no cleaning fee
            $table->unsignedSmallInteger('tax_rate_bps')->default(0);         // 2500 = 25% VAT
            $table->char('currency', 3);                              // ISO 4217
            $table->string('cancellation_policy')->default('moderate');
            $table->timestamps();
            $table->index(['account_id', 'city']);
        });
    }
};`,
    },
    {
      id: 'table-calendar-days',
      title: '`calendar_days`',
      text: [
        'Only the days that differ from the property’s defaults (blocked, a custom price, a longer minimum stay). A year of an untouched property is zero rows.',
      ],
      path: 'database/migrations/2026_01_01_000006_create_calendar_days_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calendar_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->boolean('blocked')->default(false);
            $table->unsignedInteger('price_cents')->nullable();       // null = the property's nightly rate
            $table->unsignedSmallInteger('min_nights')->nullable();
            $table->unique(['property_id', 'date']);                  // one row per day, and the index for ranges
        });
    }
};`,
    },
    {
      id: 'table-rate-rules',
      title: '`rate_rules`',
      text: [
        'A tree: a rule can be a **group** (a season) holding other rules through `parent_id` (lesson 12).',
      ],
      path: 'database/migrations/2026_01_01_000007_create_rate_rules_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rate_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parent_id')->nullable()->constrained('rate_rules')->cascadeOnDelete();
            $table->string('type');                                   // group, weekend, min_stay, length_of_stay
            $table->string('name');
            $table->date('starts_on')->nullable();                    // groups: the season
            $table->date('ends_on')->nullable();
            $table->json('settings');                                 // e.g. {"price_cents": 18000} or {"nights": 7, "discount_bps": 1000}
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();
            $table->index(['property_id', 'parent_id', 'position']);
        });
    }
};`,
    },
    {
      id: 'table-checklist-templates',
      title: '`checklist_templates`',
      text: [
        'One cleaning checklist per property. Each cleaning task gets its own copy (lesson 8).',
      ],
      path: 'database/migrations/2026_01_01_000008_create_checklist_templates_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('checklist_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->unique()->constrained()->cascadeOnDelete();
            $table->json('items');                                    // [{"area": "Kitchen", "task": "Empty dishwasher"}]
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-bookings',
      title: '`bookings`',
      text: [
        'A stay is `[check_in, check_out)`: the guest leaves on the check-out day, so the next guest can arrive the same day. The composite index serves the overlap query every booking runs.',
        'Channel bookings keep the channel’s id and version, so the same reservation is never imported twice and an older update can be recognised and ignored. The cancellation policy is **copied** onto the booking: changing the property’s policy later must not change what this guest agreed to.',
      ],
      path: 'database/migrations/2026_01_01_000009_create_bookings_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained();
            $table->string('guest_name');
            $table->string('guest_email');
            $table->string('guest_phone')->nullable();
            $table->string('guest_channel')->default('mail');           // how the guest wants messages: mail, sms, whatsapp
            $table->string('guest_locale', 5)->default('en');
            $table->date('check_in');
            $table->date('check_out');                                 // exclusive: the guest leaves that day
            $table->unsignedTinyInteger('guests');
            $table->string('status');                                  // pending, confirmed, cancelled, expired
            $table->unsignedInteger('total_cents');
            $table->char('currency', 3);
            $table->string('cancellation_policy');                     // copied from the property at booking time
            $table->text('door_code')->nullable();                     // encrypted by the model; shown only close to check-in
            $table->string('source')->default('direct');               // direct, airbnb, booking_com, vrbo
            $table->string('external_id')->nullable();                 // the channel's reservation id
            $table->unsignedBigInteger('external_version')->nullable();
            $table->timestamp('expires_at')->nullable();               // unpaid holds expire
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index(['property_id', 'status', 'check_in', 'check_out']);
            $table->unique(['source', 'external_id']);                 // NULLs never collide, so direct bookings are fine
            $table->index(['status', 'expires_at']);                   // the "expire unpaid holds" job
        });
    }
};`,
    },
    {
      id: 'table-booking-line-items',
      title: '`booking_line_items`',
      text: [
        'The folio: every amount the guest pays or gets back, line by line (nights, cleaning fee, discount, tax, refund). Signed, so refunds and discounts are negative.',
      ],
      path: 'database/migrations/2026_01_01_000010_create_booking_line_items_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_line_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained()->cascadeOnDelete();
            $table->string('type');                                    // night, cleaning_fee, discount, tax, refund
            $table->string('description');
            $table->date('night')->nullable();                         // for "night" lines
            $table->integer('amount_cents');                           // signed: discounts and refunds are negative
            $table->char('currency', 3);
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-payments',
      title: '`payments`',
      text: [
        'One row per Stripe PaymentIntent or Refund. The unique `provider_payment_id` means the same Stripe object can never be recorded twice.',
      ],
      path: 'database/migrations/2026_01_01_000011_create_payments_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained();
            $table->string('kind');                                    // deposit, balance, refund
            $table->unsignedInteger('amount_cents');
            $table->char('currency', 3);
            $table->string('status');                                  // pending, succeeded, failed, cancelled
            $table->string('provider_payment_id')->nullable()->unique();   // Stripe PaymentIntent or Refund id
            $table->timestamp('due_at')->nullable();                   // when the balance is charged
            $table->string('failure_reason')->nullable();
            $table->timestamps();
            $table->index(['status', 'due_at']);
        });
    }
};`,
    },
    {
      id: 'table-channel-connections',
      title: '`channel_connections`',
      text: [
        'The account’s OAuth tokens for one channel, encrypted by the model.',
      ],
      path: 'database/migrations/2026_01_01_000012_create_channel_connections_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channel_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('channel');                                 // airbnb, booking_com, vrbo
            $table->text('access_token');
            $table->text('refresh_token')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
            $table->unique(['account_id', 'channel']);
        });
    }
};`,
    },
    {
      id: 'table-channel-listings',
      title: '`channel_listings`',
      text: [
        'Maps one property to its listing id on one channel.',
      ],
      path: 'database/migrations/2026_01_01_000013_create_channel_listings_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channel_listings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->string('channel');
            $table->string('external_listing_id');
            $table->timestamp('last_pushed_at')->nullable();
            $table->timestamps();
            $table->unique(['channel', 'external_listing_id']);
            $table->unique(['property_id', 'channel']);
        });
    }
};`,
    },
    {
      id: 'table-ical-feeds',
      title: '`ical_feeds`',
      text: [
        'One iCal URL per property per source (lesson 17).',
      ],
      path: 'database/migrations/2026_01_01_000014_create_ical_feeds_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ical_feeds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->string('source');                                  // airbnb, booking_com, vrbo
            $table->string('url', 2048);
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();
            $table->unique(['property_id', 'source']);
        });
    }
};`,
    },
    {
      id: 'table-webhook-events',
      title: '`webhook_events`',
      text: [
        'Every incoming webhook is stored before it is processed (the **inbox**). `unique(provider, event_id)` turns a duplicate delivery into a no-op.',
      ],
      path: 'database/migrations/2026_01_01_000015_create_webhook_events_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('provider');                                // stripe, airbnb, booking_com
            $table->string('event_id');
            $table->string('type');
            $table->json('payload');
            $table->string('status')->default('received');             // received, processed, failed
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->text('error')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
            $table->unique(['provider', 'event_id']);
            $table->index(['status', 'created_at']);                   // "requeue events stuck in received"
        });
    }
};`,
    },
    {
      id: 'table-reconciliation-issues',
      title: '`reconciliation_issues`',
      text: [
        'What the nightly reconciliation finds: a payment that doesn’t match Stripe, a booking missing on a channel or here.',
      ],
      path: 'database/migrations/2026_01_01_000016_create_reconciliation_issues_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reconciliation_issues', function (Blueprint $table) {
            $table->id();
            $table->string('kind');                                    // payment_mismatch, missing_on_channel, missing_here
            $table->foreignId('property_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('booking_id')->nullable()->constrained()->nullOnDelete();
            $table->json('details');
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-message-templates',
      title: '`message_templates`',
      text: [
        'A trigger plus an offset: "1 day before check-in at 15:00" is `before_check_in`, `-1440`, `15:00`.',
      ],
      path: 'database/migrations/2026_01_01_000017_create_message_templates_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('trigger');                                 // booking_confirmed, before_check_in, after_check_out
            $table->integer('offset_minutes')->default(0);             // -1440 = one day before the trigger
            $table->time('send_time')->nullable();                     // e.g. 15:00 in the property timezone
            $table->string('subject');
            $table->text('body');                                      // with {guest_name}, {door_code}...
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-scheduled-messages',
      title: '`scheduled_messages`',
      text: [
        '`send_at` is UTC, calculated from the property timezone. `unique(booking_id, message_template_id)` is the database’s guarantee that a guest never gets the same message twice.',
      ],
      path: 'database/migrations/2026_01_01_000018_create_scheduled_messages_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scheduled_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained()->cascadeOnDelete();
            $table->foreignId('message_template_id')->constrained()->cascadeOnDelete();
            $table->dateTime('send_at');                               // UTC
            $table->string('status')->default('pending');              // pending, sent, cancelled
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->unique(['booking_id', 'message_template_id']);
            $table->index(['status', 'send_at']);                      // the scheduler's query
        });
    }
};`,
    },
    {
      id: 'table-conversations',
      title: '`conversations`',
      text: [
        'One guest–host conversation per booking.',
      ],
      path: 'database/migrations/2026_01_01_000019_create_conversations_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->unique()->constrained()->cascadeOnDelete();
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-chat-messages',
      title: '`chat_messages`',
      text: [
        'The `(conversation_id, id)` index serves "the latest messages of this conversation" and cursor pagination.',
      ],
      path: 'database/migrations/2026_01_01_000020_create_chat_messages_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chat_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->string('sender');                                  // guest, host
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();   // the host who wrote it
            $table->text('body');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();
            $table->index(['conversation_id', 'id']);
        });
    }
};`,
    },
    {
      id: 'table-review-requests',
      title: '`review_requests`',
      text: [
        'One per booking, so a guest is never asked twice.',
      ],
      path: 'database/migrations/2026_01_01_000021_create_review_requests_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('review_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->unique()->constrained()->cascadeOnDelete();
            $table->dateTime('send_at');
            $table->string('status')->default('pending');              // pending, sent, skipped
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
        });
    }
};`,
    },
    {
      id: 'table-cleaning-tasks',
      title: '`cleaning_tasks`',
      text: [
        'One turnover per stay. The task keeps its own **copy** of the checklist, so editing the template later doesn’t change tasks already planned.',
      ],
      path: 'database/migrations/2026_01_01_000022_create_cleaning_tasks_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cleaning_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->foreignId('booking_id')->nullable()->unique()->constrained()->nullOnDelete();   // one turnover per stay
            $table->foreignId('cleaner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('due_at');                                // UTC, from the property's check-out time
            $table->string('status')->default('open');                 // open, assigned, done, cancelled
            $table->json('checklist');
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->index(['cleaner_id', 'status', 'due_at']);
        });
    }
};`,
    },
    {
      id: 'table-outbox-messages',
      title: '`outbox_messages`',
      text: [
        'Events for other systems wait here until a relay publishes them (lesson 27). Consumers deduplicate on `message_id`.',
      ],
      path: 'database/migrations/2026_01_01_000023_create_outbox_messages_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outbox_messages', function (Blueprint $table) {
            $table->id();
            $table->uuid('message_id')->unique();                      // consumers deduplicate on it
            $table->string('type');                                    // e.g. booking.confirmed.v1
            $table->json('payload');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->text('last_error')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->index(['published_at', 'id']);                     // the relay reads unpublished rows in order
        });
    }
};`,
    },
    {
      id: 'table-idempotency-keys',
      title: '`idempotency_keys`',
      text: [
        'The response of each POST, stored per user and key, so a retried request returns the same result instead of acting twice.',
      ],
      path: 'database/migrations/2026_01_01_000024_create_idempotency_keys_table.php',
      code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('key');
            $table->char('request_hash', 64);                          // the same key with a different body is an error
            $table->unsignedSmallInteger('response_status')->nullable();   // null while the first request is running
            $table->json('response_body')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'key']);
        });
    }
};`,
    },
  ],
};
