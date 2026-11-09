// Scene 4 · Double bookings under load: transactions and row locks. No new pattern.

export default {
  description: 'Two guests booked the same nights 4 ms apart and both got through, because "check, then insert" is not atomic. Fix it in Laravel with a transaction and lockForUpdate(), see Cache::lock() as the alternative, and prove it with a real two-process test on MySQL.',
  incident: {
    channel: '#incidents',
    when: 'Thursday 19:47',
    messages: [
      ['Alert · bookings', '**Two confirmed bookings** for Nyhavn flat, 10–13 July. Created at 19:46:58.112 and 19:46:58.116.'],
      ['Sara · tech lead', 'The overlap check from yesterday is in place and every test is green. So how did both get through?'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Nothing in yesterday’s code is wrong on its own. The problem is the gap between two lines:'],
      blocks: [
        {
          path: 'app/Bookings/CreateBooking.php (from scene 3)',
          broken: true, fragment: true,
          code: String.raw`if ($property->bookings()->overlapping($stay)->exists()) {   // 1. check
    throw BookingConflict::for($stay);
}
// ... a few milliseconds ...
$property->bookings()->save($booking);                        // 2. insert`,
        },
        {
          text: ['Two requests run this at the same time, each in its own PHP worker:'],
          table: [
            ['Time', 'Request A (Mona)', 'Request B (Omar)'],
            ['.112', 'checks: no overlap ✓', ''],
            ['.113', '', 'checks: no overlap ✓ (A hasn’t saved yet)'],
            ['.114', 'inserts its booking', ''],
            ['.116', '', 'inserts its booking'],
          ],
          after: [
            'Each request saw a free calendar, because each one checked before the other saved. This is a **race condition**: the result depends on timing, so it never shows up when you click through the app alone, and only appears under real traffic.',
          ],
        },
      ],
    },
    {
      title: 'Why not a unique index?',
      text: [
        'For "one row per X", a unique index is the best backstop there is: the database refuses the second insert no matter what the code does. But overlap isn’t equality. 10–13 July and 11–14 July are different rows that share two nights, and **MySQL has no index that can say "these ranges must not overlap"**. (PostgreSQL can, with an exclusion constraint. MySQL can’t.)',
        'So the fix is to make the check and the insert happen **one request at a time per property**.',
      ],
      blocks: [],
    },
    {
      title: 'The fix: lock the property row',
      blocks: [
        {
          path: 'app/Bookings/CreateBooking.php (after)',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if ($property->bookings()->overlapping($stay)->exists()) {
                throw BookingConflict::for($stay);
            }

            $booking = new Booking($guest);
            $booking->stay = $stay;                                                // scene 2
            $booking->total = $property->nightly_rate->times($stay->nights());     // scene 1
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);                                 // sets property_id

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
          after: [
            '`lockForUpdate()` sends `SELECT … FOR UPDATE`. MySQL gives this transaction an exclusive lock on the property’s row. A second request for **the same property** reaches the same line and waits until the first transaction commits. When it continues, the first booking is there, the check sees it, and the guest gets a 409. Requests for other properties don’t wait at all.',
            'Why lock the **property** and not the bookings? The rows that would clash don’t exist yet, and you can’t lock a row that isn’t there. The property row is the one thing both requests share.',
          ],
        },
        {
          title: 'Run it again',
          table: [
            ['Time', 'Request A (Mona)', 'Request B (Omar)'],
            ['.112', 'locks the flat, checks: free ✓', ''],
            ['.113', '', 'tries to lock the flat… **waits**'],
            ['.114', 'inserts, commits, lock released', ''],
            ['.115', '', 'gets the lock, checks: **taken** → 409'],
          ],
        },
      ],
    },
    {
      title: 'The alternative: a Redis lock',
      text: [
        'When there is no shared row to lock (the work spans two databases, or calls an API in the middle), an **atomic lock in Redis** does the same job. `block(5)` waits up to 5 seconds for the lock; the `10` is a safety expiry, so a crashed worker can’t hold it forever.',
      ],
      blocks: [
        {
          path: 'an alternative to the row lock (not used here)',
          fragment: true,
          code: String.raw`return Cache::lock("property:{$property->id}:booking", 10)->block(5, function () use ($property, $stay, $guest): Booking {
    // the same check and insert, inside DB::transaction()
});`,
          after: ['The row lock is the better fit here: it lives and dies with the transaction, needs nothing extra running, and can’t expire halfway through. A Redis lock that expires while the work is still running lets the next request in, and Redis has to be up for anyone to book.'],
        },
      ],
    },
    {
      title: 'Why every test stayed green',
      text: [
        'A normal test sends one request at a time, so the race can’t happen in it. And on **SQLite** it can’t happen at all: SQLite lets only one writer touch the whole database at a time, and it ignores `FOR UPDATE`. A test suite on SQLite would pass with the lock and without it. That’s why the [foundation](F#phpunit) runs tests on MySQL, and why the test below starts **two real processes**.',
      ],
      blocks: [],
    },
  ],
  laravel: {
    title: 'Laravel inside',
    blocks: [
      {
        title: 'lockForUpdate() is one line of SQL',
        text: ['The query builder only records that you want a lock; the grammar of each database turns it into SQL. The SQLite grammar returns an empty string, which is the silent no-op from above.'],
        path: 'Illuminate/Database/Query/Grammars/MySqlGrammar.php',
        fragment: true,
        code: String.raw`protected function compileLock(Builder $query, $value)
{
    if (! is_string($value)) {
        return $value ? 'for update' : 'lock in share mode';   // lockForUpdate() / sharedLock()
    }

    return $value;
}`,
      },
      {
        title: 'DB::transaction() retries deadlocks',
        text: ['With `attempts: 3`, a transaction that fails because of a deadlock (or another error the database reports as a concurrency conflict) is rolled back and run again from the start. Anything else is rolled back and rethrown at once, **including a lost connection**: if the connection drops during the commit, the commit may already have happened, and running the closure again could book the nights twice. That case is handled by the unique key and the idempotency of the caller, not by a retry.'],
        path: 'Illuminate/Database/Concerns/ManagesTransactions.php (simplified)',
        fragment: true,
        code: String.raw`public function transaction(Closure $callback, $attempts = 1)
{
    for ($currentAttempt = 1; $currentAttempt <= $attempts; $currentAttempt++) {
        $this->beginTransaction();

        try {
            $result = $callback($this);
        } catch (Throwable $e) {
            $this->handleTransactionException($e, $currentAttempt, $attempts);   // retries only concurrency errors
            continue;
        }

        $this->commit();

        return $result;
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'Two real processes book the same nights at the same moment',
    text: [
      'This test forks two child processes that start at the same instant and both try to book 10–13 July. With the lock, exactly one booking exists afterwards. Remove `lockForUpdate()` and it goes red on most runs; `->repeat(20)` runs it twenty times so a lucky timing can’t hide the bug.',
      'It can’t use `RefreshDatabase`: that wraps each test in a transaction the child processes can’t see. It uses `DatabaseTruncation`, which empties the tables between tests instead, so it lives in its own folder.',
    ],
    blocks: [
      {
        path: 'tests/Concurrency/CreateBookingRaceTest.php',
        code: String.raw`<?php

use App\Bookings\BookingConflict;
use App\Bookings\CreateBooking;
use App\Bookings\Stay;
use App\Models\Booking;
use App\Models\Property;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;

uses(Tests\TestCase::class, DatabaseTruncation::class);

it('lets only one of two simultaneous requests book the same nights', function () {
    $property = Property::factory()->create();
    $startAt = microtime(true) + 0.5;                       // both children start at this instant
    $children = [];

    DB::disconnect();                                       // no open connection to share: each process opens its own

    foreach (['Mona', 'Omar'] as $guest) {
        $pid = pcntl_fork();
        if ($pid === 0) {                                   // in the child process
            time_sleep_until($startAt);
            try {
                app(CreateBooking::class)->handle($property, Stay::fromDates('2027-07-10', '2027-07-13'), [
                    'guest_name' => $guest, 'guest_email' => strtolower($guest) . '@example.com', 'guests' => 2,
                ]);
            } catch (BookingConflict) {
                // the expected outcome for the slower child
            }
            posix_kill(getmypid(), SIGKILL);                // exit without running the test runner's shutdown
        }
        $children[] = $pid;
    }

    foreach ($children as $pid) {
        pcntl_waitpid($pid, $status);
    }

    expect(Booking::where('property_id', $property->id)->count())->toBe(1);
})->repeat(20);`,
      },
      {
        title: 'Include the folder in the full suite',
        text: ['`tests/Pest.php` applies `RefreshDatabase` to `Feature` and `Unit` only, so this folder sets up its own traits. Add it to `phpunit.xml` so `./vendor/bin/pest` runs it with everything else. It needs the `pcntl` and `posix` extensions from the [PHP image](F#dockerfile).'],
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
        <testsuite name="Concurrency">
            <directory>tests/Concurrency</directory>
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
    ],
  },
  next: 'Bookings are safe. Friday morning, finance finds 312 payments in the live Stripe account, made by our own test suite.',
};
