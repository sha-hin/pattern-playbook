// Lesson 0: the setup and the data model every later lesson builds on. No pattern here.

export default {
  description: 'Set up a Laravel 13 vacation-rental PMS on PHP 8.4, MySQL and Redis with Pest, and design every table the design patterns course uses: accounts, properties, bookings, calendar days, payments, channels, messages.',
  intro: [
    'This course teaches design patterns inside the business logic of a **vacation-rental PMS** (property management system): the software hosts use to run their rentals. Hosts list properties, guests book stays directly or through Airbnb and Booking.com, payments go through Stripe, guests get automatic messages, and cleaners get a task between every two stays.',
    'You already know Laravel, so this lesson is short on explanations and long on decisions: the tools, the tables and the indexes every later lesson relies on. From lesson 1 on, everything is about patterns.',
  ],
  sections: [
    {
      title: 'The stack',
      blocks: [
        {
          title: 'What runs, and why',
          table: [
            ['Service', 'Why'],
            ['PHP 8.4 + Laravel 13', 'Enums, readonly classes and `match` are used throughout the course.'],
            ['MySQL 8.4', 'Row locks (`lockForUpdate()`), gap locks and isolation levels matter for bookings. SQLite ignores `lockForUpdate()`, so tests run on MySQL too.'],
            ['Redis', 'Queue, cache, atomic locks and sessions. Each gets its own Redis connection (lesson 10).'],
            ['Pest', 'Every lesson ends with its tests, folded.'],
          ],
        },
        {
          title: 'Docker for local work',
          text: ['One `compose.yaml`: the app, MySQL with a second database for tests, and Redis. The project folder is mounted, so code changes are live.'],
          path: 'compose.yaml',
          lang: 'text',
          code: String.raw`services:
  app:
    build: docker/app
    volumes: ['.:/var/www/html']
    ports: ['8000:8000']
    command: php artisan serve --host=0.0.0.0 --port=8000
    depends_on:
      mysql: { condition: service_healthy }
      redis: { condition: service_started }

  worker:
    build: docker/app
    volumes: ['.:/var/www/html']
    command: php artisan queue:work redis --tries=3
    depends_on: [app]

  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: pms
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/mysql/create-test-db.sql:/docker-entrypoint-initdb.d/01-test-db.sql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-psecret']
      interval: 5s

  redis:
    image: redis:7.4
    command: redis-server --appendonly yes   # a restart must not lose queued jobs

volumes:
  mysql-data:`,
        },
        {
          title: 'The PHP image',
          path: 'docker/app/Dockerfile',
          lang: 'text',
          code: String.raw`FROM php:8.4-cli
RUN apt-get update && apt-get install -y git unzip libzip-dev \
 && docker-php-ext-install pdo_mysql pcntl zip \
 && pecl install redis && docker-php-ext-enable redis
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html`,
        },
        {
          title: 'The app, Pest and the environment',
          text: ['`pcntl` lets the queue worker stop cleanly between jobs. The `redis` extension (phpredis) is faster than the pure-PHP client.'],
          path: 'terminal',
          lang: 'text',
          code: String.raw`composer create-project laravel/laravel pms
cd pms
composer require pestphp/pest pestphp/pest-plugin-laravel --dev --with-all-dependencies
./vendor/bin/pest --init

# .env
DB_CONNECTION=mysql
DB_HOST=mysql
DB_DATABASE=pms
QUEUE_CONNECTION=redis
CACHE_STORE=redis
SESSION_DRIVER=redis
REDIS_HOST=redis`,
          after: ['Tests use their own database: in `phpunit.xml` set `DB_DATABASE=pms_test`, so `RefreshDatabase` never touches your dev data.'],
        },
      ],
    },
    {
      title: 'The data model',
      text: [
        'Every table the course uses, created now so later lessons can focus on patterns. Three rules apply everywhere: **money is an integer in the smallest unit** (cents) with its currency next to it; **dates are dates** (`check_in` is a `DATE`, not a timestamp), interpreted in the property’s timezone; and **every rule the database can enforce is enforced there too** (unique indexes, foreign keys).',
      ],
      blocks: [
        {
          title: 'Accounts, users and roles',
          text: ['One account owns the properties; several users work in it with a role. The pivot gets its own table and model because the role lives on it.'],
          path: 'database/migrations/2026_01_01_000001_create_accounts_tables.php',
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

        Schema::create('memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role');                                   // owner, co_host, cleaner
            $table->timestamps();
            $table->unique(['account_id', 'user_id']);                // one role per person per account
        });

        Schema::create('account_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->string('role');
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->unique(['account_id', 'email']);                  // invite the same person once
        });
    }
};`,
        },
        {
          title: 'Properties and their calendar',
          text: [
            'A property has a timezone and check-in and check-out times: "1 day before check-in at 15:00" means nothing without them. `calendar_days` holds one row per property per day that differs from the defaults: a blocked day, a custom price, a longer minimum stay.',
          ],
          path: 'database/migrations/2026_01_01_000002_create_properties_tables.php',
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
            $table->string('timezone');                               // IANA name, e.g. Europe/Copenhagen
            $table->time('check_in_time')->default('15:00');
            $table->time('check_out_time')->default('11:00');
            $table->unsignedTinyInteger('max_guests');
            $table->unsignedSmallInteger('min_nights')->default(1);
            $table->unsignedInteger('nightly_rate_cents');
            $table->unsignedInteger('cleaning_fee_cents')->nullable();
            $table->char('currency', 3);                              // ISO 4217
            $table->string('cancellation_policy')->default('moderate');
            $table->timestamps();
            $table->index('account_id');
        });

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
          title: 'Bookings and payments',
          text: [
            'A stay is `[check_in, check_out)`: the guest leaves on the check-out day, so a new guest can arrive that same day. The composite index serves the overlap query every booking runs. Channel bookings carry the channel’s own id and version, so the same reservation is never imported twice and older updates can be ignored (lesson 23).',
          ],
          path: 'database/migrations/2026_01_01_000003_create_bookings_tables.php',
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
            $table->date('check_in');
            $table->date('check_out');                                 // exclusive: the guest leaves that day
            $table->unsignedTinyInteger('guests');
            $table->string('status');                                  // pending, confirmed, cancelled, expired
            $table->unsignedInteger('total_cents');
            $table->char('currency', 3);
            $table->string('source')->default('direct');               // direct, airbnb, booking_com, vrbo
            $table->string('external_id')->nullable();                 // the channel's reservation id
            $table->unsignedBigInteger('external_version')->nullable();
            $table->timestamp('expires_at')->nullable();               // unpaid holds expire
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index(['property_id', 'status', 'check_in', 'check_out']);
            $table->unique(['source', 'external_id']);                 // NULLs don't collide, so direct bookings are fine
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained();
            $table->string('kind');                                    // deposit, balance, refund
            $table->unsignedInteger('amount_cents');
            $table->char('currency', 3);
            $table->string('status');                                  // pending, succeeded, failed, cancelled
            $table->string('provider_payment_id')->nullable()->unique();   // Stripe's PaymentIntent id
            $table->timestamp('due_at')->nullable();
            $table->timestamps();
        });
    }
};`,
        },
        {
          title: 'Channels and incoming events',
          text: [
            'One listing per property per channel. Webhooks are stored before they are processed, and `unique(provider, event_id)` turns a duplicate delivery into a no-op (lesson 6).',
          ],
          path: 'database/migrations/2026_01_01_000004_create_channel_tables.php',
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
            $table->string('channel');                                 // airbnb, booking_com, vrbo
            $table->string('external_listing_id');
            $table->timestamps();
            $table->unique(['channel', 'external_listing_id']);
            $table->unique(['property_id', 'channel']);
        });

        Schema::create('ical_feeds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->string('source');
            $table->string('url', 2048);
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();
        });

        Schema::create('webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('provider');                                // stripe, airbnb, booking_com
            $table->string('event_id');
            $table->string('type');
            $table->json('payload');
            $table->string('status')->default('received');             // received, processed, failed
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
            $table->unique(['provider', 'event_id']);
        });
    }
};`,
        },
        {
          title: 'Messaging, operations and the outbox',
          text: [
            '`send_at` is stored in UTC and calculated from the property timezone. `unique(booking_id, message_template_id)` is the database’s guarantee that a guest never gets the same message twice. `outbox_messages` holds events for other services until a relay publishes them (lesson 27).',
          ],
          path: 'database/migrations/2026_01_01_000005_create_messaging_tables.php',
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
            $table->integer('offset_minutes')->default(0);             // e.g. -1440 = one day before
            $table->time('send_time')->nullable();                     // e.g. 15:00 in the property timezone
            $table->text('body');
            $table->timestamps();
        });

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

        Schema::create('cleaning_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->foreignId('booking_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('cleaner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('due_at');                                // UTC, from the property's check-out time
            $table->string('status')->default('open');
            $table->json('checklist');
            $table->timestamps();
        });

        Schema::create('outbox_messages', function (Blueprint $table) {
            $table->id();
            $table->string('type');
            $table->json('payload');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->index('published_at');                             // the relay reads unpublished rows
        });
    }
};`,
        },
      ],
    },
    {
      title: 'Models, enums and relations',
      text: ['Statuses and roles are backed enums, cast on the model, so `$booking->status` is a `BookingStatus`, never a typo-prone string.'],
      blocks: [
        {
          title: 'The enums',
          path: 'app/Enums/BookingStatus.php · MembershipRole.php',
          code: String.raw`<?php

namespace App\Enums;

enum BookingStatus: string
{
    case Pending = 'pending';
    case Confirmed = 'confirmed';
    case Cancelled = 'cancelled';
    case Expired = 'expired';

    /** Statuses that occupy the calendar. */
    public static function blocking(): array
    {
        return [self::Pending, self::Confirmed];
    }
}

enum MembershipRole: string
{
    case Owner = 'owner';
    case CoHost = 'co_host';
    case Cleaner = 'cleaner';
}`,
        },
        {
          title: 'Property',
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Property extends Model
{
    use HasFactory;

    protected $fillable = [
        'name', 'timezone', 'check_in_time', 'check_out_time', 'max_guests', 'min_nights',
        'nightly_rate_cents', 'cleaning_fee_cents', 'currency', 'cancellation_policy',
    ];                                                                // account_id is never mass assigned

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function calendarDays(): HasMany
    {
        return $this->hasMany(CalendarDay::class);
    }

    public function channelListings(): HasMany
    {
        return $this->hasMany(ChannelListing::class);
    }
}`,
        },
        {
          title: 'Booking',
          text: ['`date:Y-m-d` keeps a date a date: a plain `date` cast becomes a Carbon at midnight in the app timezone, which shifts in comparisons.'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\BookingStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'guest_phone', 'check_in', 'check_out', 'guests'];

    protected function casts(): array
    {
        return [
            'check_in' => 'date:Y-m-d',
            'check_out' => 'date:Y-m-d',
            'status' => BookingStatus::class,
            'expires_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    /** Bookings that occupy any night in [checkIn, checkOut). */
    public function scopeOverlapping(Builder $query, string $checkIn, string $checkOut): void
    {
        $query->whereIn('status', BookingStatus::blocking())
            ->where('check_in', '<', $checkOut)                         // starts before the new stay ends
            ->where('check_out', '>', $checkIn);                        // ends after the new stay starts
    }
}`,
        },
        {
          title: 'The other models',
          text: ['They follow the same rules; their business logic arrives in the lesson that needs it.'],
          table: [
            ['Model', 'Relations', 'Casts'],
            ['`Account`', 'hasMany properties, belongsToMany users through `Membership`', '–'],
            ['`User`', 'belongsToMany accounts through `Membership` (with `role`)', '–'],
            ['`Membership`', 'pivot model: account, user', '`role` → `MembershipRole`'],
            ['`CalendarDay`', 'belongsTo property', '`date` → `date:Y-m-d`, `blocked` → bool'],
            ['`Payment`', 'belongsTo booking', '`kind`, `status` → enums'],
            ['`ChannelListing`, `IcalFeed`', 'belongsTo property', '`channel` → `Channel` enum'],
            ['`WebhookEvent`', '–', '`payload` → array'],
            ['`MessageTemplate`, `ScheduledMessage`', 'template ↔ scheduled messages, booking', '`send_at` → datetime'],
            ['`CleaningTask`', 'property, booking, cleaner (user)', '`checklist` → array, `due_at` → datetime'],
            ['`OutboxMessage`', '–', '`payload` → array'],
          ],
        },
      ],
    },
    {
      title: 'Factories and seed data',
      blocks: [
        {
          title: 'Factories with states',
          text: ['States read like the sentence a test needs: `Booking::factory()->confirmed()->forStay(\'2027-07-01\', 3)`. Lesson 5 shows how factories work inside (they are builders).'],
          path: 'database/factories/BookingFactory.php',
          code: String.raw`<?php

namespace Database\Factories;

use App\Enums\BookingStatus;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;

class BookingFactory extends Factory
{
    public function definition(): array
    {
        $checkIn = CarbonImmutable::parse(fake()->dateTimeBetween('+1 week', '+6 months'))->startOfDay();

        return [
            'property_id' => Property::factory(),
            'guest_name' => fake()->name(),
            'guest_email' => fake()->safeEmail(),
            'check_in' => $checkIn->toDateString(),
            'check_out' => $checkIn->addDays(3)->toDateString(),
            'guests' => 2,
            'status' => BookingStatus::Confirmed,
            'total_cents' => 45_000,
            'currency' => 'EUR',
        ];
    }

    public function forStay(string $checkIn, int $nights): static
    {
        return $this->state(fn () => [
            'check_in' => $checkIn,
            'check_out' => CarbonImmutable::parse($checkIn)->addDays($nights)->toDateString(),
        ]);
    }

    public function pending(): static
    {
        return $this->state(fn () => ['status' => BookingStatus::Pending, 'expires_at' => now()->addMinutes(30)]);
    }

    public function cancelled(): static
    {
        return $this->state(fn () => ['status' => BookingStatus::Cancelled, 'cancelled_at' => now()]);
    }

    public function fromChannel(string $channel, string $externalId): static
    {
        return $this->state(fn () => ['source' => $channel, 'external_id' => $externalId, 'external_version' => 1]);
    }
}`,
        },
        {
          title: 'Seed data',
          text: ['A realistic starting point: one account, an owner and a cleaner, two properties in different timezones, and a few bookings, including a cancelled one and a back-to-back pair.'],
          path: 'database/seeders/DatabaseSeeder.php',
          code: String.raw`<?php

namespace Database\Seeders;

use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $account = Account::create(['name' => 'Nordic Stays']);

        $owner = User::factory()->create(['email' => 'owner@nordicstays.test']);
        $cleaner = User::factory()->create(['email' => 'cleaner@nordicstays.test']);
        $account->users()->attach($owner, ['role' => MembershipRole::Owner->value]);
        $account->users()->attach($cleaner, ['role' => MembershipRole::Cleaner->value]);

        $cabin = Property::factory()->for($account)->create([
            'name' => 'Lake Cabin', 'timezone' => 'Europe/Copenhagen', 'nightly_rate_cents' => 15_000, 'currency' => 'EUR',
        ]);
        Property::factory()->for($account)->create([
            'name' => 'Cairo Loft', 'timezone' => 'Africa/Cairo', 'nightly_rate_cents' => 450_000, 'currency' => 'EGP',
        ]);

        Booking::factory()->for($cabin)->forStay('2027-07-01', 3)->create();
        Booking::factory()->for($cabin)->forStay('2027-07-04', 2)->create();        // back to back: arrives as the first leaves
        Booking::factory()->for($cabin)->forStay('2027-07-10', 5)->cancelled()->create();
        Booking::factory()->for($cabin)->forStay('2027-08-01', 7)->fromChannel('airbnb', 'HMABC123')->create();
    }
}`,
        },
      ],
    },
  ],
  topics: {
    text: ['Where each decision of this lesson is used later:'],
    blocks: [
      {
        table: [
          ['Decision', 'Used in'],
          ['Money in cents + currency', 'Lesson 1 (Money value object), 15 (refunds), 20 (payments)'],
          ['Stays as `[check_in, check_out)`', 'Lesson 1 (Stay), 16 (overlap rule), 26 (availability search)'],
          ['`calendar_days` rows only where they differ', 'Lesson 12 (rate plans), 14 (Flyweight)'],
          ['`unique(source, external_id)`, `external_version`', 'Lesson 9 (channel import), 23 (out-of-order events)'],
          ['`webhook_events` unique per provider', 'Lesson 6 (typed events), 27 (inbox and outbox)'],
          ['`unique(booking_id, message_template_id)`', 'Lesson 20 (never send twice)'],
          ['MySQL, not SQLite', 'Lesson 27 (locks and isolation levels)'],
          ['Redis for queue, cache, locks, sessions', 'Lessons 10, 17, 18'],
        ],
      },
    ],
  },
  tests: {
    summary: 'Pest setup and the factory states later lessons rely on',
    text: [
      'Every test file uses `RefreshDatabase` on the MySQL test database. Factories are tested only where later lessons depend on what a state means; the schema itself is not tested (that would test MySQL, not our code).',
    ],
    blocks: [
      {
        title: 'Pest configuration',
        path: 'tests/Pest.php',
        code: String.raw`<?php

use Illuminate\Foundation\Testing\RefreshDatabase;

pest()->extend(Tests\TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');`,
      },
      {
        title: 'The states mean what the lessons assume',
        path: 'tests/Feature/BookingFactoryTest.php',
        code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Models\Booking;

it('creates a stay of the requested number of nights', function () {
    $booking = Booking::factory()->forStay('2027-07-01', 3)->create();

    expect($booking->check_in->toDateString())->toBe('2027-07-01')
        ->and($booking->check_out->toDateString())->toBe('2027-07-04');
});

it('creates pending bookings as holds that expire', function () {
    $booking = Booking::factory()->pending()->create();

    expect($booking->status)->toBe(BookingStatus::Pending)
        ->and($booking->expires_at)->not->toBeNull();
});

it('treats only pending and confirmed bookings as occupying the calendar', function (BookingStatus $status, bool $blocks) {
    expect(in_array($status, BookingStatus::blocking(), true))->toBe($blocks);
})->with([
    [BookingStatus::Pending, true],
    [BookingStatus::Confirmed, true],
    [BookingStatus::Cancelled, false],
    [BookingStatus::Expired, false],
]);`,
      },
    ],
  },
  next: 'Lesson 1 starts the patterns: the PMS passes money and stays around as bare integers and strings, and the bugs that causes.',
};
