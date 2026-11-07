// Scene 40 · Schema changes on a live table: metadata locks, instant DDL, a migration that gives up, batched backfills.

export default {
  description: 'A migration that only added a nullable column froze every booking for 20 minutes: MySQL’s ALTER waited behind a 25-minute report query for the table’s metadata lock, and every booking query queued behind the ALTER. Fix it with migrations that wait seconds, not minutes, that refuse to copy a live table, reports that never run on the primary, and backfills done in small batches by a command instead of in a migration.',
  incident: {
    channel: '#incidents',
    when: 'Tuesday 14:02',
    messages: [
      ['Monitoring', '**POST /bookings p50 = 30 s** · 502s from the load balancer · DB connections 1,400 / 1,500'],
      ['Karim · developer', 'The 14:00 deploy ran one migration: add a nullable `cancel_reason` column to `bookings`. `SHOW PROCESSLIST` has **1,400 queries** in “Waiting for table metadata lock”. The ALTER is one of them.'],
      ['Sara · tech lead', 'The oldest query on `bookings` started at **13:41**: Lina’s revenue report from Metabase, on the primary. I’m killing it.'],
      ['Karim · developer', '14:19: report killed. The ALTER finished in 0.04 s, and the 1,400 queries ran right after.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'database/migrations/2026_05_12_000001_add_cancel_reason_to_bookings_table.php',
          broken: true,
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('cancel_reason', 64)->nullable();            // the bug: waits as long as it takes, and blocks everyone meanwhile
        });
    }
};`,
          after: [
            'In MySQL 8 this change is **instant**: it only updates the table’s definition, whatever the number of rows. The 0.04 seconds prove it. The 20 minutes came from what happens **before** any `ALTER` runs.',
          ],
        },
        {
          title: 'What happened: a queue behind the ALTER',
          table: [
            ['Time', 'What', 'The metadata lock on `bookings`'],
            ['13:41', 'Metabase starts a 25-minute report reading `bookings`', 'shared, held until the query ends'],
            ['14:00', 'The migration’s `ALTER TABLE bookings`', '**waits** for an exclusive lock: the report still has its shared one'],
            ['14:00–14:19', 'Every new query on `bookings`: searches, bookings, webhooks', '**waits behind the ALTER**, which is first in line'],
            ['14:19', 'The report is killed', 'the ALTER runs (0.04 s), then everyone else'],
          ],
          after: [
            'Every query holds a **metadata lock** on each table it reads, so the table can’t be altered under it. An `ALTER` needs that lock exclusively, and MySQL queues lock requests in order: once the `ALTER` waits, new queries wait behind it, even ones that only read. `lock_wait_timeout` decides how long the `ALTER` waits, and its default is **one year**.',
            'Two things were wrong. The migration was willing to wait forever, taking the whole site with it. And a 25-minute query was running on the primary, where every booking is written.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: a migration on a live table gives up fast',
      text: [
        'Waiting five seconds and failing is far better than waiting twenty minutes and blocking everything. If the lock isn’t free in time, the migration fails, the deploy stops before the new code goes live (scene 41), and it is run again a few minutes later.',
        'The other half: say **how** the change must be made. `ALGORITHM=INSTANT` tells MySQL to change only the definition, and to **refuse** if it can’t, instead of quietly copying a 2-million-row table while blocking writes. Laravel’s schema builder can’t express it, so the statement is written in SQL:',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_05_12_000001_add_cancel_reason_to_bookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('SET SESSION lock_wait_timeout = 5');            // wait 5 s for the table, then fail: never queue the site behind us

        DB::statement('ALTER TABLE bookings ADD COLUMN cancel_reason VARCHAR(64) NULL, ALGORITHM=INSTANT');   // or refuse, never copy
    }

    public function down(): void
    {
        DB::statement('SET SESSION lock_wait_timeout = 5');
        DB::statement('ALTER TABLE bookings DROP COLUMN cancel_reason, ALGORITHM=INSTANT');
    }
};`,
          after: ['The same two lines go into every migration on a table that takes live traffic: `bookings`, `properties`, `external_blocks`, `scheduled_messages`, `outbox_messages`. Code review asks for them; a migration on a new, empty table doesn’t need them.'],
        },
        {
          title: 'Which changes are instant',
          table: [
            ['Change (MySQL 8.0.29+)', 'How', 'While it runs'],
            ['Add or drop a column, rename one, change a default', '**INSTANT**', 'a moment; only the definition changes'],
            ['Add an index', 'INPLACE', 'reads and writes continue; seconds to minutes'],
            ['Make a column wider within its size class (`VARCHAR(64)` → `VARCHAR(200)`)', 'INPLACE', 'reads and writes continue'],
            ['Change a column’s type (`INT` → `BIGINT`), `NULL` → `NOT NULL`, change a charset', '**COPY**', 'the table is rebuilt row by row; **writes are blocked** the whole time'],
          ],
          after: [
            'For a COPY change on a large live table, use a tool that never blocks writes: **gh-ost** or **pt-online-schema-change** build a copy of the table with the change, keep it in sync while they copy, and swap the two in a moment at the end. Or avoid the type change: add a new column (instant), fill it in batches (part 3), move the code to it, and drop the old one in a later deploy.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 2: long reports never run on the primary',
      text: [
        'Metabase reads from the read replica from scene 38 instead, with its own MySQL user that can only read, and a time limit so no dashboard query runs for half an hour. Run on the **replica** server:',
      ],
      blocks: [
        {
          path: 'mysql (on the replica)',
          lang: 'sql',
          code: String.raw`CREATE USER 'metabase'@'10.0.%' IDENTIFIED BY 'a-long-random-password';
GRANT SELECT ON pms.* TO 'metabase'@'10.0.%';            -- read only

SET PERSIST max_execution_time = 120000;                 -- any SELECT on this server stops after 2 minutes (in ms)`,
          after: [
            'A long query on the replica still holds metadata locks, but on the **replica’s** copy of the tables. The migration runs on the primary, and the replica applies it afterwards, where a two-minute limit means it waits two minutes at most.',
            'Then the Metabase connection is switched to the replica’s host, and Lina’s report runs as before, a few seconds behind the primary.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 3: filling a column is a command, run in small batches',
      text: [
        'Support wants old cancellations to show a reason too. For the 31,000 bookings that were cancelled on a channel, the reason is known: `cancelled_on_channel`. An `UPDATE` of all of them at once would lock 31,000 rows for the whole statement and make the replica fall behind. So it doesn’t go in a migration: it is a command that updates 500 rows at a time, rests between batches, and can be stopped and run again.',
      ],
      blocks: [
        {
          path: 'app/Console/Commands/BackfillCancelReason.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Enums\BookingStatus;
use App\Models\Booking;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

class BackfillCancelReason extends Command
{
    protected $signature = 'bookings:backfill-cancel-reason {--pause=100 : milliseconds between batches}';

    protected $description = 'Set cancel_reason on old channel cancellations, 500 rows at a time';

    public function handle(): int
    {
        $updated = 0;

        Booking::query()
            ->where('status', BookingStatus::Cancelled)
            ->whereNotNull('channel')
            ->whereNull('cancel_reason')                                // only rows not done yet: safe to stop and run again
            ->select('id')
            ->chunkById(500, function (Collection $bookings) use (&$updated): void {
                $updated += Booking::whereKey($bookings->modelKeys())
                    ->whereNull('cancel_reason')                        // a row changed since the chunk was read stays as it is
                    ->update(['cancel_reason' => 'cancelled_on_channel']);   // one short statement per 500 rows

                usleep((int) $this->option('pause') * 1_000);         // let the replica catch up between batches
            });

        $this->info("{$updated} bookings updated.");

        return self::SUCCESS;
    }
}`,
          after: [
            '`chunkById()` pages by `id`, not by `OFFSET`: rows that the update takes out of the `whereNull` don’t shift the pages and make it skip rows, and each page is an index lookup no matter how far in it is.',
            'It runs once, by hand, after the deploy: `php artisan bookings:backfill-cancel-reason`. 31,000 rows in 62 batches, about 15 seconds, and nobody notices.',
            '`cancel_reason` is a plain nullable string, so `Booking` needs no new cast; the model reads it like any other column.',
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'The backfill changes only what it should, and can run again',
    blocks: [
      {
        path: 'tests/Feature/BackfillCancelReasonTest.php',
        code: String.raw`<?php

use App\Enums\Channel;
use App\Models\Booking;

it('marks old channel cancellations, in batches, and leaves everything else', function () {
    $onChannel = Booking::factory()->count(3)->cancelled()->create(['channel' => Channel::Airbnb]);
    $ours = Booking::factory()->cancelled()->create();                          // cancelled on Nordic Stays: reason unknown
    $confirmed = Booking::factory()->create(['channel' => Channel::Airbnb]);
    $alreadySet = Booking::factory()->cancelled()->create(['channel' => Channel::BookingCom]);
    $alreadySet->forceFill(['cancel_reason' => 'cancelled_by_guest'])->save();

    $this->artisan('bookings:backfill-cancel-reason', ['--pause' => 0])->expectsOutput('3 bookings updated.')->assertSuccessful();

    expect($onChannel->map(fn (Booking $booking): ?string => $booking->fresh()->cancel_reason)->unique()->all())->toBe(['cancelled_on_channel'])
        ->and($ours->fresh()->cancel_reason)->toBeNull()
        ->and($confirmed->fresh()->cancel_reason)->toBeNull()
        ->and($alreadySet->fresh()->cancel_reason)->toBe('cancelled_by_guest');      // never overwritten
});

it('does nothing the second time', function () {
    Booking::factory()->count(2)->cancelled()->create(['channel' => Channel::Airbnb]);
    $this->artisan('bookings:backfill-cancel-reason', ['--pause' => 0]);

    $this->artisan('bookings:backfill-cancel-reason', ['--pause' => 0])->expectsOutput('0 bookings updated.');
});`,
        after: ['The migration itself isn’t tested here: what makes it safe is how MySQL locks, which a test can’t reproduce on a quiet test database. It is checked the honest way: the migration runs on staging while the k6 load test from scene 38 runs, and the p99 must not move.'],
      },
    ],
  },
  next: 'Schema changes are safe on live tables now. Next: a deploy at 14:00, and the queue workers keep running the old code until 16:00.',
};
