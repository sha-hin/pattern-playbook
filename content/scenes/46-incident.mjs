// Scene 46 · A production incident from start to end: logs, metrics, reproduce, fix, postmortem.

export default {
  description: 'The channels queue stopped moving and its workers were killed by the server again and again: a static array added as a "cache" grew with every job, because a queue worker never ends. Work the incident the way real teams do: logs, then metrics, then a reproduction, then the one-line fix, then the settings and alerts that would have caught it, and a blameless postmortem.',
  incident: {
    channel: '#incidents',
    when: 'Thursday 09:30',
    messages: [
      ['Monitoring', '**Horizon: channels queue wait 41 min** (normal: under 10 s) · 4,800 jobs pending · 0 processed in the last 12 minutes'],
      ['Mona · support', 'Hosts say Airbnb and Booking.com aren’t showing changes from this morning.'],
      ['Karim · developer', '`dmesg` on worker-2: **Out of memory: Killed process 31337 (php)**, four times since 07:00. Supervisor restarts Horizon each time.'],
    ],
  },
  sections: [
    {
      title: 'Step 1: logs — what exactly happens',
      text: ['The first job is to describe the failure precisely, before guessing at causes. Three sources, read in order:'],
      blocks: [
        {
          path: 'worker-2: dmesg, horizon.log, the failed_jobs table',
          lang: 'shell',
          code: String.raw`$ dmesg -T | grep -i "killed process"
[Thu 07:41] Out of memory: Killed process 30114 (php) total-vm:2.6GB, anon-rss:2.1GB
[Thu 08:22] Out of memory: Killed process 30871 (php) total-vm:2.6GB, anon-rss:2.1GB
[Thu 09:03] Out of memory: Killed process 31202 (php) total-vm:2.6GB, anon-rss:2.1GB
[Thu 09:24] Out of memory: Killed process 31337 (php) total-vm:2.5GB, anon-rss:2.0GB

$ tail storage/logs/horizon.log
[09:24:51] App\Jobs\PushAvailability ........ RUNNING
# no "DONE", no "FAIL": the process vanished in the middle of the job

$ php artisan queue:failed
# empty: a process killed by the kernel never gets to record a failure`,
          after: [
            'Three facts. The kernel, not PHP, kills the workers: PHP’s own `memory_limit` never fires. Each worker reaches **about 2 GB** first. And killed jobs aren’t failed, they are **reserved**: Redis hands them out again only after `retry_after` (660 seconds, scene 17). Four workers dying in turn, each leaving its jobs invisible for 11 minutes, is a queue that barely moves.',
          ],
        },
      ],
    },
    {
      title: 'Step 2: metrics — when did it start',
      text: ['A worker’s memory is in the server metrics. The shape of the graph says what kind of problem it is:'],
      blocks: [
        {
          table: [
            ['Worker memory (channels)', 'Last week', 'Since Tuesday’s 14:00 deploy'],
            ['After start', '62 MB', '62 MB'],
            ['After 1,000 jobs', '64 MB', '1.1 GB'],
            ['Shape', 'flat', '**a straight line up, ~1 MB per job**, until the kill'],
          ],
          after: [
            'A spike would mean one big job. A straight line up means something is **kept** after every job and never released: a leak. It started with a deploy, so the cause is in that deploy’s diff.',
            'Why it reached 2 GB at all: last month someone raised Horizon’s `memory` setting to 2048 MB because workers "restarted too often". They restarted often because of an older, smaller leak. The setting hid it, and this week it let a big one run until the kernel stepped in.',
          ],
        },
      ],
    },
    {
      title: 'Step 3: reproduce — prove the cause before fixing it',
      text: ['Tuesday’s deploy changed one class used by `PushAvailability`: a small "cache" so that two listings of the same property don’t compute the same calendar twice:'],
      blocks: [
        {
          path: 'app/Channels/AvailabilityRuns.php',
          broken: true,
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\Property;
use Carbon\CarbonImmutable;

final class AvailabilityRuns
{
    /** @var array<string, list<array{nights: Stay, open: bool, minNights: int}>> */
    private static array $computed = [];                               // the bug: static, so it lives as long as the process

    /** @return list<array{nights: Stay, open: bool, minNights: int}> consecutive nights with the same state and minimum */
    public function for(Property $property, CarbonImmutable $from, int $days): array
    {
        return self::$computed["{$property->id}:{$from->toDateString()}:{$days}"] ??= $this->compute($property, $from, $days);
    }

    /** @return list<array{nights: Stay, open: bool, minNights: int}> */
    private function compute(Property $property, CarbonImmutable $from, int $days): array
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

        $minimums = $property->calendarDays()                           // 'Y-m-d' => the date's own minimum (scene 30)
            ->whereBetween('date', [$window->checkIn->toDateString(), $window->checkOut->toDateString()])
            ->pluck('min_nights', 'date')
            ->all();

        /** @return array{0: bool, 1: int} whether the night is open, and its minimum (0 when closed: no minimum to send) */
        $stateOf = function (CarbonImmutable $night) use ($closed, $minimums, $property): array {
            $date = $night->toDateString();
            $open = ! isset($closed[$date]);

            return [$open, $open ? (int) ($minimums[$date] ?? $property->min_nights) : 0];
        };

        $runs = [];
        $start = $window->checkIn;
        for ($night = $window->checkIn; $night->lessThan($window->checkOut); $night = $night->addDay()) {
            $next = $night->addDay();
            [$isOpen, $minNights] = $stateOf($night);

            if ($next->equalTo($window->checkOut) || $stateOf($next) !== [$isOpen, $minNights]) {
                $runs[] = ['nights' => Stay::fromDates($start->toDateString(), $next->toDateString()), 'open' => $isOpen, 'minNights' => $minNights];
                $start = $next;                                         // the next run starts tomorrow
            }
        }

        return $runs;
    }
}`,
          after: [
            'In a web request a static property lives for one request: the "cache" would be harmless. A queue worker is one process that runs for hours, so `self::$computed` keeps every property’s 365-day calendar it has ever pushed, as `Stay` and Carbon objects: about 1 MB per property, never freed.',
            'And it is **wrong**, not only big: the second push for a property, after a new booking, gets the first push’s calendar from the array. While the worker lived, the channels were sent stale availability. That is what the hosts saw.',
          ],
        },
        {
          title: 'The reproduction',
          text: ['Run the code the way a worker does, many jobs in one process, and print the memory. On staging, with Tuesday’s release:'],
          path: 'php artisan tinker (staging)',
          fragment: true,
          code: String.raw`$runs = app(App\Channels\AvailabilityRuns::class);
App\Models\Property::query()->limit(500)->get()->each(function ($property, $i) use ($runs) {
    $runs->for($property, now()->startOfDay(), 365);
    if ($i % 100 === 0) echo $i, ': ', round(memory_get_usage() / 1e6), " MB\n";
});
// 0: 58 MB   100: 161 MB   200: 265 MB   300: 368 MB   400: 471 MB   — the straight line from the graph`,
          after: ['Same shape, same rate. The cause is proven before anything is changed, so the fix can be proven too: with the static array gone, the same loop stays at 58 MB.'],
        },
      ],
    },
    {
      title: 'Step 4: the fix',
      text: [
        'The cache goes. Computing a property’s calendar twice (once per listing) costs two indexed queries, a few milliseconds; it was never worth keeping state for. If a job ever does need a memo, it belongs on an object that lives as long as the job: a property of the job itself, which is gone when the job is done.',
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
    /** @return list<array{nights: Stay, open: bool, minNights: int}> consecutive nights with the same state and minimum */
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

        $minimums = $property->calendarDays()                           // 'Y-m-d' => the date's own minimum (scene 30)
            ->whereBetween('date', [$window->checkIn->toDateString(), $window->checkOut->toDateString()])
            ->pluck('min_nights', 'date')
            ->all();

        /** @return array{0: bool, 1: int} whether the night is open, and its minimum (0 when closed: no minimum to send) */
        $stateOf = function (CarbonImmutable $night) use ($closed, $minimums, $property): array {
            $date = $night->toDateString();
            $open = ! isset($closed[$date]);

            return [$open, $open ? (int) ($minimums[$date] ?? $property->min_nights) : 0];
        };

        $runs = [];
        $start = $window->checkIn;
        for ($night = $window->checkIn; $night->lessThan($window->checkOut); $night = $night->addDay()) {
            $next = $night->addDay();
            [$isOpen, $minNights] = $stateOf($night);

            if ($next->equalTo($window->checkOut) || $stateOf($next) !== [$isOpen, $minNights]) {
                $runs[] = ['nights' => Stay::fromDates($start->toDateString(), $next->toDateString()), 'open' => $isOpen, 'minNights' => $minNights];
                $start = $next;                                         // the next run starts tomorrow
            }
        }

        return $runs;
    }
}`,
        },
        {
          title: 'Workers recycle themselves before a leak can grow',
          text: ['Even with this leak fixed, the next one will come. Horizon is told to restart each worker on a schedule, gracefully, between jobs, and the memory limit goes back to a value that catches a leak early. In `config/horizon.php`, replace the `environments` array, and add `waits` and `admins`:'],
          path: 'config/horizon.php (the admins, waits and environments entries)',
          fragment: true,
          code: String.raw`'admins' => array_filter(explode(',', env('HORIZON_ADMINS', ''))),   // who may open /horizon: emails, comma-separated

'waits' => [
    'redis:default' => 60,                              // alert when a guest-facing job waits over a minute
    'redis:channels' => 300,
],

'environments' => [
    'production' => [
        'guests' => [
            'connection' => 'redis',
            'queue' => ['default'],
            'balance' => 'auto',
            'minProcesses' => 2,
            'maxProcesses' => 10,
            'tries' => 0,                                   // the jobs decide: $tries, retryUntil()
            'timeout' => 120,
            'memory' => 256,                                // MB: a worker over this restarts after its current job
            'maxJobs' => 1000,                              // and after 1,000 jobs anyway
            'maxTime' => 3600,                              // or an hour: no process lives long enough to grow far
        ],
        'channels' => [
            'connection' => 'redis',
            'queue' => ['channels'],
            'maxProcesses' => 4,                            // more workers wouldn't help: the channels' limits are the limit
            'tries' => 0,
            'timeout' => 600,                               // a full push can take minutes; still < retry_after (660)
            'memory' => 256,
            'maxJobs' => 1000,
            'maxTime' => 3600,
        ],
    ],
],`,
          after: ['Horizon checks `memory` **after** each job and restarts the worker cleanly. That is why the old setting of 2048 was the real failure: with 4 workers × 2 GB on a 6 GB server, the kernel was always going to kill one first.'],
        },
        {
          title: 'Someone is told, before hosts are',
          text: ['`waits` from above makes Horizon raise a `LongWaitDetected` notification. This provider, created by `horizon:install` (scene 17), sends it and limits the dashboard to the team:'],
          path: 'app/Providers/HorizonServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Laravel\Horizon\Horizon;
use Laravel\Horizon\HorizonApplicationServiceProvider;

class HorizonServiceProvider extends HorizonApplicationServiceProvider
{
    public function boot(): void
    {
        parent::boot();

        Horizon::routeMailNotificationsTo(config('services.oncall.email'));                      // long waits, failing jobs
        Horizon::routeSlackNotificationsTo(config('services.oncall.slack_webhook'), '#incidents');
    }

    /** Who may open /horizon in production: the team, by email, from config/horizon.php. */
    protected function gate(): void
    {
        Gate::define('viewHorizon', fn (?User $user = null): bool => $user !== null
            && in_array($user->email, config('horizon.admins'), true));   // config(), never env(): config:cache (scene 45)
    }
}`,
          after: ['`config/services.php` gets an `oncall` entry with `email` and `slack_webhook`, read from `ONCALL_EMAIL` and `ONCALL_SLACK_WEBHOOK` in `.env`. A queue that waits 41 minutes now pages someone at minute five.'],
        },
        {
          path: 'config/services.php (the oncall entry)',
          fragment: true,
          code: String.raw`'oncall' => [
    'email' => env('ONCALL_EMAIL'),
    'slack_webhook' => env('ONCALL_SLACK_WEBHOOK'),
],`,
        },
      ],
    },
    {
      title: 'Step 5: the postmortem',
      text: ['Written the same day, shared with the whole team, and **blameless**: it describes what the system allowed, not who typed what. The questions that matter are why it was possible and why nothing caught it sooner.'],
      blocks: [
        {
          table: [
            ['', 'Postmortem: channels queue stalled, Thursday 07:00–10:05'],
            ['Impact', '3 hours of delayed or stale availability on Airbnb and Booking.com; 2 overbookings caught by scene 18’s check'],
            ['Cause', 'A static array in `AvailabilityRuns`, added Tuesday as a cache, grew ~1 MB per job in long-running workers and returned stale calendars'],
            ['Why it reached production', 'Tests run each job once in a fresh process: a static that grows can’t show up there. Review read it as a harmless cache'],
            ['Why it took 3 hours to see', 'Horizon’s `memory` was 2048 MB (raised to hide an older leak), and nothing alerted on queue wait times'],
            ['Actions', '1. Static array removed (done). 2. `memory` 256, `maxJobs` and `maxTime` on every supervisor (done). 3. Wait-time alerts to on-call (done). 4. An arch test forbids static properties in `app/` outside a short allowlist (scene 47). 5. Find the older leak the 2048 MB hid (owner: Karim)'],
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'A second push sees the booking made after the first',
    blocks: [
      {
        path: 'tests/Feature/AvailabilityRunsTest.php',
        code: String.raw`<?php

use App\Channels\AvailabilityRuns;
use App\Models\Booking;
use App\Models\Property;
use Carbon\CarbonImmutable;

it('computes the calendar again every time, as a long-running worker needs', function () {
    $property = Property::factory()->create();
    $runs = app(AvailabilityRuns::class);
    $from = CarbonImmutable::parse('2027-06-01');

    $before = $runs->for($property, $from, 7);
    Booking::factory()->for($property)->forStay('2027-06-03', 2)->create();      // a booking between two pushes, in the same process
    $after = $runs->for($property, $from, 7);

    expect(count($before))->toBe(1)                                             // one open run
        ->and(count($after))->toBe(3);                                          // the incident: open, closed, open — never the stale one
});`,
        after: ['This is the test the postmortem asks for: it runs two "jobs" in one process, the way a worker does, which is exactly what the fresh-process tests never did.'],
      },
    ],
  },
  next: 'The queue moves again, and the next leak will be caught by settings and alerts. Next: a developer joins the team and asks how all of this fits together.',
};
