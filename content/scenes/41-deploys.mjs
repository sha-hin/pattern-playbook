// Scene 41 · Deploys: releases switched atomically, caches rebuilt, workers restarted on the new code, two servers.

export default {
  description: 'A 14:00 deploy fixed the door codes in arrival messages, and guests kept getting the wrong ones until 16:00: the deploy script switched the web servers to the new release but never told the queue workers, which kept running the code they had loaded at start. Fix it with a deploy script that migrates first, switches atomically, reloads PHP-FPM’s OPcache and terminates Horizon, plus Supervisor for the long-running processes and a schedule that runs once across two servers.',
  incident: {
    channel: '#incidents',
    when: 'Wednesday 16:05',
    messages: [
      ['Mona · support', 'Guests arriving today still got door codes with the **old format**, after the 14:00 fix. Eleven guests couldn’t get in, the last at 15:50.'],
      ['Karim · developer', 'The web servers ran the new code from 14:00. The messages are sent by queue jobs, and Horizon’s workers were still running **the 13:00 code**. At 16:00 Horizon restarted them after their memory limit, and from then on the messages were right.'],
      ['Sara · tech lead', 'Our deploy script never restarts the workers. It never has. We were lucky until today.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'deploy.sh',
          lang: 'shell',
          broken: true,
          code: String.raw`#!/usr/bin/env bash
set -euo pipefail

cd /var/www/pms
git pull origin main
composer install --no-dev --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan config:cache
sudo systemctl reload php8.4-fpm
# the bug: nothing tells the queue workers that the code changed`,
          after: [
            'A PHP-FPM worker reads the code fresh for every request (through OPcache, which the reload clears). A **queue worker** is one PHP process that started once and loops for hours, taking job after job (scene 17). Every class it has already loaded, and the config it read at start, stay in its memory. New files on disk change nothing for it until it restarts.',
            'Three more problems sit in the same script. `git pull` changes files under the running site, so a request in the middle of a deploy can load half old, half new code. A failed `composer install` leaves the site broken. And there is no way back but a second deploy.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: a release directory, switched in one step',
      text: [
        'Each deploy builds a complete new release in its own directory, while the old one keeps serving. Only when everything succeeded does one command switch the `current` symlink, and the order of the steps after that is the point of this scene.',
      ],
      blocks: [
        {
          path: 'deploy.sh',
          lang: 'shell',
          code: String.raw`#!/usr/bin/env bash
# Usage: deploy.sh <git ref>. Runs on every app server; the migration step runs on one of them only.
set -euo pipefail

APP=/var/www/pms
RELEASE="$APP/releases/$(date +%Y%m%d%H%M%S)"

git clone --depth 1 --branch "$1" git@github.com:nordicstays/pms.git "$RELEASE"
cd "$RELEASE"

ln -s "$APP/shared/.env" .env                                # secrets live outside the release
rm -rf storage && ln -s "$APP/shared/storage" storage       # logs and files survive deploys

composer install --no-dev --optimize-autoloader --no-interaction
npm ci && npm run build

php artisan migrate --force --isolated                       # before the switch; --isolated: one server runs it, the others wait
php artisan config:cache                                     # one PHP file instead of reading .env on every request
php artisan route:cache
php artisan event:cache
php artisan view:cache

ln -sfn "$RELEASE" "$APP/current"                            # the switch: one atomic rename, no request sees half a release
sudo systemctl reload php8.4-fpm                             # new workers, empty OPcache: web requests run the new code

php artisan horizon:terminate                                # the fix: workers finish their current job and exit;
                                                             # Supervisor starts them again, from current, on the new code
php artisan reverb:restart                                   # the WebSocket server too; browsers reconnect and reload (scene 31)

ls -dt "$APP"/releases/* | tail -n +6 | xargs -r rm -rf      # keep the last five releases for a rollback`,
          after: [
            '`set -euo pipefail` stops the script at the first failing command. A failed `composer install`, `npm run build` or migration (scene 40’s five-second lock timeout) leaves `current` pointing at the old release, which never stopped serving.',
            '**Why the reload matters.** Production runs OPcache with `opcache.validate_timestamps=0`: PHP never checks files for changes, which is fast. It also means FPM would keep running the cached old release forever. The reload starts fresh workers with an empty cache.',
            '**Why terminate, not kill.** `horizon:terminate` lets each worker finish the job in its hands first. A worker killed in the middle of a job would leave it to `retry_after` (scene 17) and run it twice.',
          ],
        },
        {
          title: 'Rolling back',
          path: 'rollback.sh',
          lang: 'shell',
          code: String.raw`#!/usr/bin/env bash
# Point current at the previous release and restart what runs code. Migrations are not undone:
# every migration is written so the previous release still works with it (add first, remove in a later deploy).
set -euo pipefail

APP=/var/www/pms
PREVIOUS=$(ls -dt "$APP"/releases/* | sed -n 2p)

ln -sfn "$PREVIOUS" "$APP/current"
sudo systemctl reload php8.4-fpm
cd "$APP/current" && php artisan horizon:terminate && php artisan reverb:restart`,
          after: ['A rollback takes seconds because the previous release is still on disk, fully built. It is only safe because migrations never break the code before them: a column is added in one deploy, used in the next, and dropped no earlier than the one after (scene 40).'],
        },
      ],
    },
    {
      title: 'The fix, part 2: Supervisor keeps the long-running processes alive',
      text: [
        '`horizon:terminate` only works because something starts Horizon again. On each server, Supervisor runs Horizon and Reverb, restarts them when they exit, and always starts them from `current`, so they pick up the new release.',
      ],
      blocks: [
        {
          path: '/etc/supervisor/conf.d/pms.conf',
          lang: 'env',
          code: String.raw`[program:horizon]
command=php /var/www/pms/current/artisan horizon
user=www-data
autostart=true
autorestart=true
stopwaitsecs=660                         ; longer than the slowest job (600 s, scene 17): a deploy never cuts one off
stdout_logfile=/var/www/pms/shared/storage/logs/horizon.log

[program:reverb]
command=php /var/www/pms/current/artisan reverb:start --host=0.0.0.0 --port=8080
user=www-data
autostart=true
autorestart=true
minfds=65536                             ; one open file per WebSocket connection: the default 1,024 is a hard ceiling
stdout_logfile=/var/www/pms/shared/storage/logs/reverb.log`,
          after: [
            '`minfds` is the open-file limit scene 31 promised: every browser tab with a calendar open is one connection, and every connection is a file descriptor. At the default of 1,024, the 1,025th host is refused.',
            'The load balancer must keep WebSocket connections open: its idle timeout goes above Reverb’s ping interval (30 seconds by default), or it cuts quiet connections every minute.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 3: two servers, one schedule',
      text: [
        'Since the busy Sunday (scene 38) there are two app servers behind the load balancer, and both run the same cron line. Each server’s scheduler would run every task. `withoutOverlapping()` only stops two runs at the **same time**: if server A finishes `bookings:expire-holds` in 200 ms, server B starts it again a second later. `onOneServer()` takes a lock in Redis, shared by both servers, so only the first server to reach a task in a given minute runs it (scene 9 promised this).',
        'It works because nothing is kept on one server: sessions, cache, locks and queues all live in Redis (Foundation), and the database is shared. A server can be added or removed without anyone noticing.',
      ],
      blocks: [
        {
          path: 'routes/console.php',
          code: String.raw`<?php

use App\Jobs\SyncIcalFeed;
use App\Models\IcalFeed;
use Illuminate\Support\Facades\Schedule;

// Every app server runs the scheduler once a minute:  * * * * * php artisan schedule:run
// Locally:                                             php artisan schedule:work
// onOneServer(): a lock in Redis, so each task runs on one server per run, not on all of them

Schedule::command('bookings:expire-holds')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('payments:reconcile-refunds')->dailyAt('03:10')->withoutOverlapping()->onOneServer();

Schedule::call(function (): void {
    IcalFeed::query()->lazyById()->each(fn (IcalFeed $feed) => SyncIcalFeed::dispatch($feed));
})->everyFifteenMinutes()->name('sync-ical-feeds')->withoutOverlapping()->onOneServer();
Schedule::command('channels:poll')->everyTenMinutes()->withoutOverlapping()->onOneServer();
Schedule::command('messages:send-due')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('bookings:revert-unpaid-changes')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('outbox:relay')->everyMinute()->withoutOverlapping()->onOneServer();   // one relay at a time keeps the order
Schedule::command('model:prune')->dailyAt('04:20')->withoutOverlapping()->onOneServer();            // delivered outbox messages, after a week`,
        },
        {
          path: 'crontab (on every app server)',
          lang: 'shell',
          code: String.raw`* * * * * cd /var/www/pms/current && php artisan schedule:run >> /dev/null 2>&1`,
        },
      ],
    },
    {
      title: 'The fix, part 4: CI runs everything before a deploy can start',
      text: ['The deploy only starts from a commit that passed CI. The workflow starts the same services the app uses, so the tests run against MySQL, Redis and Meilisearch like production (scene 39’s contract tests included):'],
      blocks: [
        {
          path: '.github/workflows/ci.yml',
          lang: 'yaml',
          code: String.raw`name: CI
on: [push, pull_request]

jobs:
  tests:
    runs-on: ubuntu-24.04
    services:
      mysql:
        image: mysql:8.4
        env: { MYSQL_ROOT_PASSWORD: secret, MYSQL_DATABASE: pms_test }
        ports: ['3306:3306']
        options: --health-cmd="mysqladmin ping -psecret" --health-interval=5s
      redis:
        image: redis:7.4
        ports: ['6379:6379']
      meilisearch:
        image: getmeili/meilisearch:v1.11
        env: { MEILI_MASTER_KEY: ci-key }
        ports: ['7700:7700']
    env:
      DB_HOST: 127.0.0.1
      DB_PASSWORD: secret
      REDIS_HOST: 127.0.0.1
      MEILISEARCH_HOST: http://127.0.0.1:7700
      MEILISEARCH_KEY: ci-key
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.4', extensions: 'pdo_mysql, redis, pcntl', coverage: none }
      - run: composer install --no-interaction --prefer-dist
      - run: cp .env.example .env && php artisan key:generate
      - run: vendor/bin/pest --parallel`,
          after: ['`--parallel` runs the suite across CPU cores, each process with its own test database. The `meilisearch` group runs here because the service is there; locally it is skipped (scene 39).'],
        },
      ],
    },
    {
      title: 'Octane: the same lesson, for web requests',
      text: [
        'Nordic Stays serves web requests with PHP-FPM: every request starts from a clean application. **Laravel Octane** (Swoole, RoadRunner, FrankenPHP) keeps one application in memory and serves thousands of requests with it, which is faster, and turns every web server into something like a queue worker. Three things from this course then change:',
      ],
      blocks: [
        {
          table: [
            ['Under Octane', 'In this app'],
            ['A deploy must reload the workers, like Horizon', '`php artisan octane:reload` after the switch, in place of the FPM reload'],
            ['A `singleton()` resolved during a request lives into the next one', 'Scene 5: the Stripe client is fine (no request data); anything holding a user or account is not'],
            ['Request data must be bound per request', 'Scene 19: the current `Account` is bound with `scoped()`, which Octane forgets after each request, never with `singleton()`'],
            ['Static properties and arrays that grow are never freed', 'Scene 42 shows what that does to a worker’s memory'],
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'Every scheduled task runs on one server, and never overlaps itself',
    blocks: [
      {
        path: 'tests/Feature/ScheduleTest.php',
        code: String.raw`<?php

use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Contracts\Console\Kernel;

it('runs every scheduled task on one server only, and never twice at once', function () {
    app(Kernel::class)->bootstrap();                                            // loads routes/console.php, where the schedule lives
    $events = collect(app(Schedule::class)->events());

    expect($events)->not->toBeEmpty()
        ->and($events->reject(fn (Event $event): bool => $event->onOneServer)->map->getSummaryForDisplay()->all())->toBe([])
        ->and($events->reject(fn (Event $event): bool => $event->withoutOverlapping)->map->getSummaryForDisplay()->all())->toBe([]);
});`,
        after: ['A task added next year without `onOneServer()` fails this test, with its name in the message. The deploy script itself is tested where it runs: every deploy goes to staging first, and the incident’s check (send a message, look at the door code) is part of the staging checklist.'],
      },
    ],
  },
  next: 'Deploys reach every process now. Next: the channels queue stops moving, and one worker’s memory grows until the server kills it.',
};
