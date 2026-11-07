// The foundation: the app as it stands before scene 1. Only what many scenes use lives here;
// anything else is added by the scene that needs it, because adding it is part of that story.

const migration = body => String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
` + body + String.raw`
    }
};`;

export default {
  description: 'The Laravel 13 vacation-rental PMS every scene starts from: Docker, configuration, the core migrations, enums, models, factories and Pest helpers, one file per block.',
  intro: [
    '**Nordic Stays** rents holiday homes. Hosts list properties, guests book stays, and payments go through Stripe. This page is the app on launch day: the setup and the core tables, models and factories every scene uses.',
    'You don’t need to read it top to bottom. Skim it once (about 10 minutes), then come back through the links in the scenes. A scene that needs something new, like a webhooks table, adds it itself, because adding it is part of that scene’s story.',
  ],
  sections: [
    {
      id: 'setup',
      title: 'Setup',
      blocks: [
        {
          id: 'stack',
          title: 'The stack',
          table: [
            ['Tool', 'Why'],
            ['PHP 8.4 + Laravel 13', 'Backed enums, readonly classes and `match` are used throughout.'],
            ['MySQL 8.4', 'Row locks and isolation levels matter for bookings. SQLite ignores `lockForUpdate()`, so tests run on MySQL too (scene 4 shows why).'],
            ['Redis 7', 'Queue, cache, locks and sessions.'],
            ['Pest', 'Every scene ends with its tests, folded.'],
          ],
        },
        {
          id: 'docker',
          title: 'Docker for local work',
          text: ['The app, MySQL (with a second database for tests) and Redis. The project folder is mounted, so code changes are live.'],
          path: 'compose.yaml',
          lang: 'yaml',
          code: String.raw`services:
  app:
    build: docker/app
    volumes: ['.:/var/www/html']
    ports: ['8000:8000']
    command: php artisan serve --host=0.0.0.0 --port=8000
    depends_on:
      mysql: { condition: service_healthy }
      redis: { condition: service_healthy }

  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: pms
    ports: ['3306:3306']
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/mysql/create-test-db.sql:/docker-entrypoint-initdb.d/01-test-db.sql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-psecret']
      interval: 5s

  redis:
    image: redis:7.4
    command: redis-server --appendonly yes     # a restart must not lose queued jobs
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s

volumes:
  mysql-data:`,
        },
        {
          id: 'dockerfile',
          title: 'The PHP image',
          text: ['`pcntl` and `posix` let scene 4 run two real processes at once; `intl` powers `Number::currency()`.'],
          path: 'docker/app/Dockerfile',
          lang: 'dockerfile',
          code: String.raw`FROM php:8.4-cli
RUN apt-get update && apt-get install -y git unzip libzip-dev libicu-dev \
 && docker-php-ext-install pdo_mysql pcntl posix zip intl bcmath \
 && pecl install redis && docker-php-ext-enable redis
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html`,
        },
        {
          id: 'test-db',
          title: 'The test database',
          text: ['MySQL runs this once, on first start.'],
          path: 'docker/mysql/create-test-db.sql',
          lang: 'sql',
          code: String.raw`CREATE DATABASE IF NOT EXISTS pms_test;`,
        },
        {
          id: 'install',
          title: 'Install',
          path: 'terminal',
          lang: 'shell',
          code: String.raw`composer create-project laravel/laravel pms
cd pms
php artisan install:api                         # Sanctum + routes/api.php
composer require pestphp/pest pestphp/pest-plugin-laravel --dev --with-all-dependencies
./vendor/bin/pest --init`,
        },
        {
          id: 'env',
          title: 'Environment',
          text: ['Code reads settings through `config()`, never `env()`, so `php artisan config:cache` works in production.'],
          path: '.env',
          lang: 'env',
          code: String.raw`APP_TIMEZONE=UTC                     # always UTC; each property has its own timezone

DB_CONNECTION=mysql
DB_HOST=mysql
DB_DATABASE=pms
DB_USERNAME=root
DB_PASSWORD=secret

REDIS_CLIENT=phpredis
REDIS_HOST=redis
QUEUE_CONNECTION=redis
CACHE_STORE=redis
SESSION_DRIVER=redis`,
        },
        {
          id: 'app-provider',
          title: 'App-wide defaults',
          text: ['Two lines in `boot()`, each removing a class of bugs from every scene.'],
          path: 'app/Providers/AppServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Date::use(CarbonImmutable::class);                        // every date Laravel creates is immutable (scene 1)
        Model::shouldBeStrict(! $this->app->isProduction());     // lazy loading, unknown and unfillable attributes throw
    }
}`,
        },
      ],
    },
    {
      id: 'migrations',
      title: 'Migrations',
      text: ['Money is an integer in the currency’s smallest unit, with a `currency` column next to it (scene 1). Stay dates are `DATE` columns (scene 2). Rules the database can enforce, it enforces: foreign keys and unique indexes.'],
      blocks: [
        {
          id: 'table-accounts',
          title: '`accounts`',
          text: ['One account owns the properties. A host company is one account.'],
          path: 'database/migrations/2026_01_01_000001_create_accounts_table.php',
          code: migration(String.raw`        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->timestamps();
        });`),
        },
        {
          id: 'table-users',
          title: '`users`',
          text: ['Laravel’s own table, plus the account the user is working in right now.'],
          path: 'database/migrations/2026_01_01_000002_add_current_account_to_users_table.php',
          code: migration(String.raw`        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('current_account_id')->nullable()->constrained('accounts')->nullOnDelete();
        });`),
        },
        {
          id: 'table-memberships',
          title: '`memberships`',
          text: ['Users work in an account with a role. The unique index makes "one role per person per account" a database rule.'],
          path: 'database/migrations/2026_01_01_000003_create_memberships_table.php',
          code: migration(String.raw`        Schema::create('memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role');                                   // owner, co_host, cleaner
            $table->timestamps();
            $table->unique(['account_id', 'user_id']);
        });`),
        },
        {
          id: 'table-properties',
          title: '`properties`',
          text: ['The timezone and the check-in and check-out times live on the property: "check-in at 15:00" means nothing without them (scene 2).'],
          path: 'database/migrations/2026_01_01_000004_create_properties_table.php',
          code: migration(String.raw`        Schema::create('properties', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('city');
            $table->char('country', 2);                               // ISO 3166-1, e.g. DK
            $table->string('timezone');                               // IANA, e.g. Europe/Copenhagen
            $table->time('check_in_time')->default('15:00');
            $table->time('check_out_time')->default('11:00');
            $table->unsignedTinyInteger('max_guests');
            $table->unsignedInteger('nightly_rate_cents');
            $table->unsignedInteger('cleaning_fee_cents')->nullable();    // null = no cleaning fee
            $table->char('currency', 3);                              // ISO 4217, e.g. EUR
            $table->timestamps();
            $table->index('account_id');
        });`),
        },
        {
          id: 'table-bookings',
          title: '`bookings`',
          text: ['A stay is `[check_in, check_out)`: the guest leaves on the check-out day (scene 2). The composite index serves the overlap query every new booking runs (scene 3).'],
          path: 'database/migrations/2026_01_01_000005_create_bookings_table.php',
          code: migration(String.raw`        Schema::create('bookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained();
            $table->string('guest_name');
            $table->string('guest_email');
            $table->date('check_in');
            $table->date('check_out');                                // exclusive: the guest leaves that day
            $table->unsignedTinyInteger('guests');
            $table->string('status');                                 // pending, confirmed, cancelled, expired
            $table->unsignedInteger('total_cents');
            $table->char('currency', 3);
            $table->timestamp('expires_at')->nullable();              // unpaid holds expire
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
            $table->index(['property_id', 'status', 'check_in', 'check_out']);
        });`),
        },
        {
          id: 'table-payments',
          title: '`payments`',
          text: ['One row per Stripe PaymentIntent. The unique `provider_payment_id` means the same Stripe payment can never be recorded twice.'],
          path: 'database/migrations/2026_01_01_000006_create_payments_table.php',
          code: migration(String.raw`        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained();
            $table->unsignedInteger('amount_cents');
            $table->char('currency', 3);
            $table->string('status');                                 // pending, succeeded, failed
            $table->string('provider_payment_id')->nullable()->unique();
            $table->timestamps();
        });`),
        },
      ],
    },
    {
      id: 'enums',
      title: 'Enums',
      text: ['Every status and role is a backed enum, cast on its model, so `$booking->status` is a `BookingStatus` and a typo can’t be stored through the model. A raw query or `upsert()` bypasses the cast; if a column must reject bad values whatever writes to it, that takes a database `CHECK` constraint.'],
      blocks: [
        {
          id: 'enum-booking-status',
          title: 'BookingStatus',
          path: 'app/Enums/BookingStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum BookingStatus: string
{
    case Pending = 'pending';                 // a hold, waiting for payment
    case Confirmed = 'confirmed';
    case Cancelled = 'cancelled';
    case Expired = 'expired';                 // a hold that was never paid
}`,
        },
        {
          id: 'enum-membership-role',
          title: 'MembershipRole',
          path: 'app/Enums/MembershipRole.php',
          code: String.raw`<?php

namespace App\Enums;

enum MembershipRole: string
{
    case Owner = 'owner';
    case CoHost = 'co_host';
    case Cleaner = 'cleaner';
}`,
        },
        {
          id: 'enum-payment-status',
          title: 'PaymentStatus',
          path: 'app/Enums/PaymentStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum PaymentStatus: string
{
    case Pending = 'pending';
    case Succeeded = 'succeeded';
    case Failed = 'failed';
}`,
        },
      ],
    },
    {
      id: 'models',
      title: 'Models',
      text: ['Models hold data, relations and casts. Business rules live in the classes the scenes build. `$fillable` lists only what a request may set: ownership columns and statuses are always set by code.'],
      blocks: [
        {
          id: 'model-user',
          title: 'User',
          text: ['`roleIn()` answers the question every policy asks: what is this user allowed to be in this account?'],
          path: 'app/Models/User.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return ['email_verified_at' => 'datetime', 'password' => 'hashed'];
    }

    public function accounts(): BelongsToMany
    {
        return $this->belongsToMany(Account::class, 'memberships')
            ->using(Membership::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    public function currentAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'current_account_id');
    }

    /** The user's role in an account, or null when they are not a member. */
    public function roleIn(int $accountId): ?MembershipRole
    {
        return $this->accounts->firstWhere('id', $accountId)?->pivot->role;
    }
}`,
        },
        {
          id: 'model-account',
          title: 'Account',
          path: 'app/Models/Account.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Account extends Model
{
    use HasFactory;

    protected $fillable = ['name'];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'memberships')
            ->using(Membership::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    public function properties(): HasMany
    {
        return $this->hasMany(Property::class);
    }
}`,
        },
        {
          id: 'model-membership',
          title: 'Membership',
          text: ['The pivot has its own model so the role is cast to `MembershipRole`.'],
          path: 'app/Models/Membership.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Relations\Pivot;

class Membership extends Pivot
{
    protected $table = 'memberships';

    public $incrementing = true;

    protected function casts(): array
    {
        return ['role' => MembershipRole::class];
    }
}`,
        },
        {
          id: 'model-property',
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
        'name', 'city', 'country', 'timezone', 'check_in_time', 'check_out_time',
        'max_guests', 'nightly_rate_cents', 'cleaning_fee_cents', 'currency',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }
}`,
        },
        {
          id: 'model-booking',
          title: 'Booking',
          text: ['`date:Y-m-d` keeps a date a date, with no time attached. Scenes 1 and 2 add the `total` and `stay` casts.'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\BookingStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'check_in', 'check_out', 'guests'];

    protected function casts(): array
    {
        return [
            'check_in' => 'date:Y-m-d',
            'check_out' => 'date:Y-m-d',
            'status' => BookingStatus::class,
            'expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
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
}`,
        },
        {
          id: 'model-payment',
          title: 'Payment',
          text: ['Only our own code writes payments, never a request, so all its columns are fillable.'],
          path: 'app/Models/Payment.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    use HasFactory;

    protected $fillable = ['amount_cents', 'currency', 'status', 'provider_payment_id'];

    protected function casts(): array
    {
        return ['status' => PaymentStatus::class];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}`,
        },
      ],
    },
    {
      id: 'factories',
      title: 'Factories',
      text: ['States read like the sentence a test needs: `Booking::factory()->pending()->forStay(\'2027-07-01\', 3)`. Every default is valid on its own.'],
      blocks: [
        {
          id: 'factory-user',
          title: 'UserFactory',
          text: ['Memberships are attached, not factoried: the test helper [`hostOf()`](F#test-helpers) does it with a role.'],
          path: 'database/factories/UserFactory.php',
          code: String.raw`<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/** @extends Factory<User> */
class UserFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => Hash::make('password'),
        ];
    }
}`,
        },
        {
          id: 'factory-account',
          title: 'AccountFactory',
          path: 'database/factories/AccountFactory.php',
          code: String.raw`<?php

namespace Database\Factories;

use App\Models\Account;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Account> */
class AccountFactory extends Factory
{
    public function definition(): array
    {
        return ['name' => fake()->company()];
    }
}`,
        },
        {
          id: 'factory-property',
          title: 'PropertyFactory',
          text: ['The default is a Copenhagen flat at €150.00 a night, for up to 4 guests. Copenhagen has daylight-saving time, which scene 2 needs.'],
          path: 'database/factories/PropertyFactory.php',
          code: String.raw`<?php

namespace Database\Factories;

use App\Models\Account;
use App\Models\Property;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Property> */
class PropertyFactory extends Factory
{
    public function definition(): array
    {
        return [
            'account_id' => Account::factory(),
            'name' => fake()->streetName() . ' flat',
            'city' => 'Copenhagen',
            'country' => 'DK',
            'timezone' => 'Europe/Copenhagen',
            'check_in_time' => '15:00',
            'check_out_time' => '11:00',
            'max_guests' => 4,
            'nightly_rate_cents' => 15_000,
            'cleaning_fee_cents' => 6_000,
            'currency' => 'EUR',
        ];
    }

    public function in(string $city, string $country, string $timezone): static
    {
        return $this->state(fn (): array => ['city' => $city, 'country' => $country, 'timezone' => $timezone]);
    }
}`,
        },
        {
          id: 'factory-booking',
          title: 'BookingFactory',
          text: ['The default booking is confirmed, three nights, four weeks after the frozen test date. Each status state sets the timestamps that go with it.'],
          path: 'database/factories/BookingFactory.php',
          code: String.raw`<?php

namespace Database\Factories;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Booking> */
class BookingFactory extends Factory
{
    public function definition(): array
    {
        $checkIn = now()->addWeeks(4)->startOfDay();

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
            'confirmed_at' => now(),
        ];
    }

    public function forStay(string $checkIn, int $nights): static
    {
        return $this->state(fn (): array => [
            'check_in' => $checkIn,
            'check_out' => CarbonImmutable::parse($checkIn)->addDays($nights)->toDateString(),
        ]);
    }

    public function pending(): static
    {
        return $this->state(fn (): array => [
            'status' => BookingStatus::Pending,
            'confirmed_at' => null,
            'expires_at' => now()->addMinutes(30),
        ]);
    }

    public function cancelled(): static
    {
        return $this->state(fn (): array => ['status' => BookingStatus::Cancelled, 'cancelled_at' => now()]);
    }
}`,
        },
        {
          id: 'factory-payment',
          title: 'PaymentFactory',
          path: 'database/factories/PaymentFactory.php',
          code: String.raw`<?php

namespace Database\Factories;

use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\Payment;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Payment> */
class PaymentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'booking_id' => Booking::factory(),
            'amount_cents' => 45_000,
            'currency' => 'EUR',
            'status' => PaymentStatus::Pending,
            'provider_payment_id' => 'pi_' . fake()->unique()->bothify('????????????????'),
        ];
    }

    public function succeeded(): static
    {
        return $this->state(fn (): array => ['status' => PaymentStatus::Succeeded]);
    }
}`,
        },
      ],
    },
    {
      id: 'testing',
      title: 'Test setup',
      text: ['Every scene’s tests assume this: a MySQL test database refreshed per test, time frozen at a known moment, and no real HTTP calls.'],
      blocks: [
        {
          id: 'phpunit',
          title: 'The test environment',
          path: 'phpunit.xml',
          lang: 'xml',
          code: String.raw`<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
>
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_DATABASE" value="pms_test"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="MAIL_MAILER" value="array"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
    </php>
</phpunit>`,
        },
        {
          id: 'pest-config',
          title: 'Pest configuration',
          text: [
            'The clock is frozen at **1 June 2027, 10:00 UTC** before every test, so "four weeks from now" and "after today" give the same answer on every run. A test that needs another moment calls `$this->travelTo()` itself.',
            '`Http::preventStrayRequests()` makes any HTTP call without a matching `Http::fake()` throw, so a test can never reach a real API by accident.',
          ],
          path: 'tests/Pest.php',
          code: String.raw`<?php

use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

pest()->extend(Tests\TestCase::class)
    ->use(RefreshDatabase::class)
    ->beforeEach(function (): void {
        $this->travelTo(CarbonImmutable::parse('2027-06-01 10:00:00', 'UTC'));
        Http::preventStrayRequests();
    })
    ->in('Feature', 'Unit');

require __DIR__ . '/helpers.php';`,
        },
        {
          id: 'test-helpers',
          title: 'Test helpers',
          text: ['Almost every test first asks "who is acting, with which role?". `hostOf()` answers it in one line.'],
          path: 'tests/helpers.php',
          code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Property;
use App\Models\User;

function memberOf(Account $account, MembershipRole $role = MembershipRole::Owner): User
{
    $user = User::factory()->create(['current_account_id' => $account->id]);
    $account->users()->attach($user, ['role' => $role->value]);

    return $user;
}

function hostOf(Property $property, MembershipRole $role = MembershipRole::Owner): User
{
    return memberOf($property->account, $role);
}`,
        },
      ],
    },
  ],
};
