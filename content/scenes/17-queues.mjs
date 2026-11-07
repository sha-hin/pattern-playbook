// Scene 17 · Command and Command Bus: one coalesced push per listing, on a Redis queue under Horizon.

export default {
  description: 'After a Booking.com outage, Nordic Stays queued 642 calendar pushes in a minute, and some opened nights that later pushes had closed. Fix it in Laravel with one self-contained command per listing, ShouldBeUniqueUntilProcessing to coalesce bursts, WithoutOverlapping, Redis queues under Horizon, and a look at the worker loop.',
  incident: {
    channel: '#incidents',
    when: 'Monday 07:55',
    messages: [
      ['Alert · queues', 'Queue `default`: **642 jobs** waiting, oldest 38 minutes. Guest emails are stuck behind them.'],
      ['Karim · developer', 'Booking.com was down overnight. At 07:30 the poll (scene 15) caught up 321 reservations at once, and every import queued one push per channel listing of its property: 321 × 2 = 642. And Ahmed says two nights that are **booked** show as **open** on Airbnb.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'every place that changes the calendar (before)',
          broken: true, fragment: true,
          code: String.raw`// one job per change, per listing, describing the change
foreach ($property->channelListings as $listing) {
    CloseChannelDates::dispatch($listing, $booking->stay)->afterCommit();
}

// CancelBooking: the same, with $close = false`,
          after: [
            'Each job carries a **change**: "close 1–4 August", "open 2–3 August". 321 imports produced 642 of them, and they all wait in the one queue that also sends guest emails.',
            'Worse, changes only make sense in order, and queues don’t promise order. Workers run jobs in parallel and retries come back later, so an "open" that was queued first can finish after the "close" that should have replaced it. That’s how booked nights showed as open on Airbnb.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: push the state, not the change',
      text: [
        'Instead of "what changed", each push sends **how the calendar is now**: every night for the next 12 months, grouped into runs of open and closed nights, read fresh from the database when the job runs. A push like that can run twice, late, or out of order, and the result is always correct, because the last one to run sends the latest truth.',
      ],
      blocks: [
        {
          path: 'app/Channels/AvailabilityRuns.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\Property;
use Carbon\CarbonImmutable;

final class AvailabilityRuns
{
    /** @return list<array{nights: Stay, open: bool}> consecutive nights grouped by open/closed */
    public function for(Property $property, CarbonImmutable $from, int $days): array
    {
        $window = Stay::fromDates($from->toDateString(), $from->addDays($days)->toDateString());
        $closed = [];                                                   // 'Y-m-d' => true for every occupied night

        $occupy = function (CarbonImmutable $first, CarbonImmutable $end) use (&$closed): void {
            for ($night = $first; $night->lessThan($end); $night = $night->addDay()) {
                $closed[$night->toDateString()] = true;
            }
        };

        foreach ($property->bookings()->overlapping($window)->get(['check_in', 'check_out']) as $booking) {
            $occupy($booking->check_in, $booking->check_out);                // pending and confirmed only (scene 3)
        }
        foreach ($property->externalBlocks()->overlapping($window)->get(['starts_on', 'ends_on']) as $block) {
            $occupy($block->starts_on, $block->ends_on);                     // scene 12
        }

        $runs = [];
        $start = $window->checkIn;
        for ($night = $window->checkIn; $night->lessThan($window->checkOut); $night = $night->addDay()) {
            $next = $night->addDay();
            $isOpen = ! isset($closed[$night->toDateString()]);

            if ($next->equalTo($window->checkOut) || $isOpen !== ! isset($closed[$next->toDateString()])) {
                $runs[] = ['nights' => Stay::fromDates($start->toDateString(), $next->toDateString()), 'open' => $isOpen];
                $start = $next;                                         // the next run starts tomorrow
            }
        }

        return $runs;
    }
}`,
          after: ['A year with 30 bookings is about 60 runs, so about 60 calls per push, well inside the rate limit from scene 16.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: one command, coalesced',
      text: [
        'The job is a **command**: one object that holds everything needed to do one thing ("bring this listing up to date"), and can be queued, retried and logged as a unit.',
        'Because it always sends the current state, ten pushes waiting for the same listing are worth exactly one. `ShouldBeUniqueUntilProcessing` takes a Redis lock per listing when the job is dispatched; while one push is **waiting**, further dispatches are dropped. The lock is released when the push **starts**, so a change that happens during a push queues one more, which will see it. `WithoutOverlapping` makes that next push wait until the running one ends.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_03_09_000001_add_push_status_to_channel_listings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('channel_listings', function (Blueprint $table) {
            $table->timestamp('last_pushed_at')->nullable();
            $table->text('last_push_error')->nullable();              // shown to the host: "Airbnb is not in sync"
        });
    }
};`,
        },
        {
          path: 'app/Jobs/PushAvailability.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Channels\ChannelRateLimited;
use App\Models\ChannelListing;
use App\Models\Property;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

class PushAvailability implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Queueable;

    public const DAYS = 365;

    public int $uniqueFor = 900;                                       // a stuck lock frees itself after 15 minutes

    public function __construct(public ChannelListing $listing)
    {
        $this->onQueue('channels');                                     // never in front of guest emails again
    }

    /** Dispatch one push per listing of the property, after the current transaction commits. */
    public static function forProperty(Property $property): void
    {
        foreach ($property->channelListings as $listing) {
            self::dispatch($listing)->afterCommit();
        }
    }

    public function uniqueId(): string
    {
        return (string) $this->listing->id;                             // one waiting push per listing
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping("push-listing-{$this->listing->id}"))->releaseAfter(30)->expireAfter(600)];
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addHours(2);
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function handle(ChannelManager $channels, AvailabilityRuns $runs): void
    {
        $api = $channels->for($this->listing->channel)->api();

        try {
            foreach ($runs->for($this->listing->property, now()->startOfDay(), self::DAYS) as $run) {
                $run['open'] ? $api->openDates($this->listing, $run['nights']) : $api->closeDates($this->listing, $run['nights']);
            }
        } catch (ChannelRateLimited $e) {
            $this->release($e->retryAfter);                             // scene 16
            return;
        }

        $this->listing->forceFill(['last_pushed_at' => now(), 'last_push_error' => null])->save();
    }

    public function failed(Throwable $exception): void
    {
        $this->listing->forceFill(['last_push_error' => $exception->getMessage()])->save();
    }
}`,
          after: ['Every caller that used `CloseChannelDates` now calls `PushAvailability::forProperty($property)`, and `CloseChannelDates` is deleted.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: queues on Redis, run by Horizon',
      text: [
        'Two queues: `default` for guest-facing work (emails, payments) and `channels` for pushes, each with its own workers, so a flood on one never delays the other. Horizon runs and supervises the workers, restarts them when they die, and shows throughput, wait times and failed jobs in a dashboard.',
        'One rule ties the two files together: a worker’s `timeout` must be **shorter** than the queue’s `retry_after`. Redis hands a job to another worker if it has been reserved for `retry_after` seconds without finishing. A job allowed to run longer than that runs **twice, at the same time**.',
      ],
      blocks: [
        {
          path: 'terminal · config/queue.php (redis connection)',
          lang: 'shell',
          code: String.raw`composer require laravel/horizon
php artisan horizon:install

# config/queue.php
'redis' => [
    'driver' => 'redis',
    'connection' => 'default',
    'queue' => 'default',
    'retry_after' => 660,            # longer than the slowest job's timeout (600 below)
    'block_for' => 5,                # wait up to 5 s for a job instead of polling Redis in a tight loop
    'after_commit' => true,          # every dispatch waits for the open transaction to commit
],`,
        },
        {
          path: 'config/horizon.php (environments)',
          fragment: true,
          code: String.raw`'environments' => [
    'production' => [
        'guests' => [
            'connection' => 'redis',
            'queue' => ['default'],
            'balance' => 'auto',
            'minProcesses' => 2,
            'maxProcesses' => 10,
            'tries' => 0,                                   // the jobs decide: $tries, retryUntil()
            'timeout' => 120,
        ],
        'channels' => [
            'connection' => 'redis',
            'queue' => ['channels'],
            'maxProcesses' => 4,                            // more workers wouldn't help: the channels' limits are the limit
            'tries' => 0,
            'timeout' => 600,                               // a full push can take minutes; still < retry_after (660)
        ],
    ],
],`,
          after: ['In production, `php artisan horizon` runs under Supervisor, and every deploy ends with `php artisan horizon:terminate` so workers restart on the new code (scene 38).'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Command', 'Command Bus'],
    rules: [
      ['Command', 'A request turned into an object: everything needed to perform one action, which can then be queued, retried, logged or undone.'],
      ['Command Bus', 'One dispatcher that takes any command and gets it executed: now, or through a queue. Callers only say what should happen.'],
    ],
    points: [
      '`PushAvailability` is the command: it carries the listing, and its `handle()` does the work. Everything about retries, uniqueness and overlap lives on the command itself.',
      '`PushAvailability::dispatch()` hands it to the bus. Whether it runs now (`sync` in tests) or on Redis in production is configuration, not code.',
      'Because the command sends state instead of a change, running it twice is harmless, which is what makes coalescing and retries safe.',
    ],
    whenNot: [
      'Work the caller needs the result of right now (a price for the page) is a normal method call, not a queued command.',
      'Don’t queue tiny steps of one action separately; queue the action.',
    ],
  },
  laravel: {
    title: 'Laravel inside: the bus and the worker loop',
    text: ['`dispatch()` returns a `PendingDispatch`. When it goes out of scope, its destructor asks the unique lock first (that’s where coalescing happens), then hands the job to the bus.'],
    blocks: [
      {
        path: 'Illuminate/Foundation/Bus/PendingDispatch.php · Illuminate/Bus/Dispatcher.php (simplified)',
        fragment: true,
        code: String.raw`// PendingDispatch
public function __destruct()
{
    if (! $this->shouldDispatch()) {                         // ShouldBeUnique: Cache::lock(uniqueId)->get() failed
        return;                                              // dropped: a push for this listing is already waiting
    }

    app(Dispatcher::class)->dispatch($this->job);
}

// Dispatcher
public function dispatch($command)
{
    return $this->queueResolver && $command instanceof ShouldQueue
        ? $this->dispatchToQueue($command)                   // serialize and push to Redis
        : $this->dispatchNow($command);                      // call handle() now, with its dependencies injected
}`,
      },
      {
        title: 'What a worker does, forever',
        path: 'Illuminate/Queue/Worker.php (simplified)',
        fragment: true,
        code: String.raw`public function daemon($connectionName, $queue, WorkerOptions $options)
{
    while (true) {
        if ($this->shouldQuit || $this->memoryExceeded($options->memory) || $this->queueShouldRestart($lastRestart)) {
            $this->stop();                                   // queue:restart, or a memory limit: Supervisor starts a fresh one
        }

        $job = $this->getNextJob($connection, $queue);      // Redis: move the job to a "reserved" set until retry_after

        if ($job) {
            $this->registerTimeoutHandler($job, $options);  // pcntl alarm: kill the worker if the job passes its timeout
            $this->runJob($job, $connectionName, $options); // handle(); then delete, release($delay), or fail
        } else {
            $this->sleep($options->sleep);
        }
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'A burst becomes one push, the runs are right, and the push sends them',
    blocks: [
      {
        path: 'tests/Feature/PushAvailabilityTest.php',
        code: String.raw`<?php

use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\ChannelConnection;
use App\Models\ChannelListing;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->property = Property::factory()->create();
    $this->listing = ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
});

it('queues one push for a burst of 200 changes', function () {
    Queue::fake();

    foreach (range(1, 200) as $change) {
        PushAvailability::forProperty($this->property);
    }

    Queue::assertPushedTimes(PushAvailability::class, 1);
    Queue::assertPushedOn('channels', PushAvailability::class);
});

it('groups the window into open and closed runs', function () {
    Booking::factory()->for($this->property)->forStay('2027-06-03', 2)->create();          // closes 3 and 4 June

    $runs = (new AvailabilityRuns())->for($this->property, CarbonImmutable::parse('2027-06-01'), 7);

    expect(array_map(fn (array $run): array => [$run['nights']->checkIn->toDateString(), $run['nights']->nights(), $run['open']], $runs))->toBe([
        ['2027-06-01', 2, true],
        ['2027-06-03', 2, false],
        ['2027-06-05', 3, true],
    ]);
});

it('sends every run and records the push', function () {
    config(['services.airbnb' => ['base_url' => 'https://airbnb.test/v2', 'token_url' => 'https://airbnb.test/oauth/token', 'client_id' => 'id', 'client_secret' => 'secret', 'webhook_secret' => 's']]);
    ChannelConnection::forceCreate(['account_id' => $this->property->account_id, 'channel' => Channel::Airbnb, 'access_token' => 'a', 'refresh_token' => 'r', 'expires_at' => now()->addHour()]);
    Booking::factory()->for($this->property)->forStay('2027-06-03', 2)->create();
    Http::fake(['airbnb.test/v2/*' => Http::response(['ok' => true])]);

    app()->call([new PushAvailability($this->listing), 'handle']);

    Http::assertSent(fn (Request $request): bool => $request['start_date'] === '2027-06-03' && $request['availability'] === 'unavailable');
    expect($this->listing->fresh()->last_pushed_at)->not->toBeNull();
});`,
        after: ['`Queue::fake()` keeps the unique lock: the job’s `ShouldBeUnique` check runs in `PendingDispatch` before any queue, real or fake, sees it.'],
      },
    ],
  },
  next: 'Pushes are calm and correct. Tuesday night, a guest books the Lake Cabin on Airbnb while another books the same nights on Booking.com, 40 seconds apart.',
};
