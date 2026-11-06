// Foundation, part 1: the stack, Docker, installation and configuration.

export const setup = {
  id: 'setup',
  title: 'Setup',
  text: ['Everything the course runs on. Nothing here changes in later lessons.'],
  numbered: false,
  blocks: [
    {
      id: 'stack',
      title: 'The stack',
      table: [
        ['Service', 'Why'],
        ['PHP 8.4 + Laravel 13', 'Backed enums, readonly classes and `match` are used throughout.'],
        ['MySQL 8.4', 'Row locks (`lockForUpdate()`), gap locks and isolation levels matter for bookings. SQLite ignores `lockForUpdate()`, so tests run on MySQL too.'],
        ['Redis 7', 'Queue, cache, atomic locks and sessions, each on its own Redis connection.'],
        ['Laravel Sanctum', 'API tokens with abilities.'],
        ['Laravel Horizon', 'Runs and monitors the Redis queue workers.'],
        ['Pest', 'Tests. Every lesson ends with its own, folded.'],
        ['Stripe PHP SDK', 'PaymentIntents and refunds.'],
      ],
    },
    {
      id: 'docker',
      title: 'Docker for local work',
      text: ['The app, a queue worker, the scheduler, MySQL (with a second database for tests) and Redis. The project folder is mounted, so code changes are live; restart the worker after changing a job, because it loads the code once.'],
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

  horizon:
    build: docker/app
    volumes: ['.:/var/www/html']
    command: php artisan horizon
    depends_on: [app]

  scheduler:
    build: docker/app
    volumes: ['.:/var/www/html']
    command: php artisan schedule:work
    depends_on: [app]

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
    command: redis-server --appendonly yes --maxmemory-policy noeviction
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s

volumes:
  mysql-data:`,
      after: ['`--appendonly yes` writes every change to disk, so a Redis restart does not lose queued jobs. `noeviction` makes Redis refuse writes when memory is full instead of silently deleting keys: right for a queue, wrong for a pure cache (the caching lesson splits the two).'],
    },
    {
      id: 'dockerfile',
      title: 'The PHP image',
      path: 'docker/app/Dockerfile',
      lang: 'dockerfile',
      code: String.raw`FROM php:8.4-cli
RUN apt-get update && apt-get install -y git unzip libzip-dev libicu-dev \
 && docker-php-ext-install pdo_mysql pcntl zip intl bcmath \
 && pecl install redis && docker-php-ext-enable redis
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html`,
      after: ['`pcntl` lets workers stop cleanly between jobs; `intl` powers `Number::currency()`; the `redis` extension (phpredis) is faster than the pure-PHP client.'],
    },
    {
      id: 'test-db',
      title: 'The test database',
      text: ['MySQL runs this once, on first start, so tests get their own database next to the dev one.'],
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
php artisan install:api                         # Sanctum + routes/api.php + personal_access_tokens
composer require laravel/horizon stripe/stripe-php
php artisan horizon:install
php artisan make:notifications-table            # the "database" notification channel
composer require pestphp/pest pestphp/pest-plugin-laravel --dev --with-all-dependencies
composer require larastan/larastan rector/rector --dev
./vendor/bin/pest --init`,
    },
    {
      id: 'env',
      title: 'Environment',
      text: ['Secrets live only in `.env` (never committed) and in the deploy platform’s secret store. In code, read them through `config()`, never `env()`, so `config:cache` works.'],
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
SESSION_DRIVER=redis

STRIPE_SECRET=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=...                # the version your Stripe account is pinned to
AIRBNB_CLIENT_ID=...
AIRBNB_CLIENT_SECRET=...
BOOKING_COM_USERNAME=...
BOOKING_COM_PASSWORD=...`,
      after: ['`phpunit.xml` sets `DB_DATABASE=pms_test`, `QUEUE_CONNECTION=sync` and `CACHE_STORE=array`, so tests never touch dev data or a real queue.'],
    },
    {
      id: 'redis-config',
      title: 'Redis: one connection per job',
      text: ['Four logical databases on the same server. The queue never shares a connection with the cache, so flushing the cache can’t delete jobs, and each one can later move to its own server.'],
      path: 'config/database.php (redis section)',
      code: String.raw`<?php

return [
    'redis' => [
        'client' => env('REDIS_CLIENT', 'phpredis'),

        'default' => ['host' => env('REDIS_HOST'), 'port' => 6379, 'database' => 0],
        'cache' => ['host' => env('REDIS_HOST'), 'port' => 6379, 'database' => 1],
        'queue' => ['host' => env('REDIS_HOST'), 'port' => 6379, 'database' => 2],
        'locks' => ['host' => env('REDIS_HOST'), 'port' => 6379, 'database' => 3],
        'sessions' => ['host' => env('REDIS_HOST'), 'port' => 6379, 'database' => 4],
    ],
];

// config/cache.php    'redis' => ['driver' => 'redis', 'connection' => 'cache', 'lock_connection' => 'locks']
// config/queue.php    'redis' => ['driver' => 'redis', 'connection' => 'queue', 'queue' => 'default',
//                                 'retry_after' => 120, 'block_for' => 5, 'after_commit' => true]
// config/session.php  'connection' => 'sessions'`,
      after: ['`after_commit => true`: a job dispatched inside a transaction is only pushed once the transaction commits, so a worker never picks up a job for a booking that was rolled back. `retry_after` must be longer than the slowest job, or Redis hands the job to a second worker while the first is still running.'],
    },
    {
      id: 'services-config',
      title: 'Third-party services',
      path: 'config/services.php',
      code: String.raw`<?php

return [
    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        'version' => env('STRIPE_API_VERSION'),                  // pinned, so a Stripe release can't change responses
    ],

    'airbnb' => [
        'base_url' => 'https://api.airbnb.com/v2',
        'client_id' => env('AIRBNB_CLIENT_ID'),
        'client_secret' => env('AIRBNB_CLIENT_SECRET'),
    ],

    'booking_com' => [
        'base_url' => 'https://supply-xml.booking.com',
        'username' => env('BOOKING_COM_USERNAME'),
        'password' => env('BOOKING_COM_PASSWORD'),
    ],
];`,
    },
    {
      id: 'app-provider',
      title: 'App-wide defaults',
      text: ['Set once, in `boot()`. Each line removes a class of bugs from every later lesson.'],
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
        Date::use(CarbonImmutable::class);                        // every date Laravel creates is immutable
        Model::shouldBeStrict(! $this->app->isProduction());     // lazy loading, silently discarded and missing attributes throw
    }
}`,
    },
  ],
};
