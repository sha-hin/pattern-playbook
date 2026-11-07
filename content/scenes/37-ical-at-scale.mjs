// Scene 37 · Unit of Work: the changes of a whole feed worked out in memory, then written in one short transaction.

export default {
  description: 'iCal calendars fell three hours behind and two nights were sold twice: every sync saved each of a feed’s events with its own updateOrCreate(), and at 3,100 feeds every 15 minutes the queue never caught up. Fix it in Laravel with a small Unit of Work: load the feed’s blocks once, work out what is new, changed and gone, and write only that, with one upsert() and one delete.',
  incident: {
    channel: '#ops',
    when: 'Friday 11:05',
    messages: [
      ['Karim · developer', 'Horizon: **9,400 SyncIcalFeed jobs** waiting on the `default` queue. The oldest was queued **three hours ago**, and guest emails are waiting behind them.'],
      ['Mona · support', 'Two overbookings this morning, both at Hygge Homes cottages: Airbnb sold the nights at 08:12, and our site sold them again at 09:30. Their Airbnb feed hadn’t been read since 07:50.'],
      ['Sara · tech lead', 'Hygge added 280 feeds on Monday. We now have 3,100 feeds, each synced every 15 minutes, and the workers can’t keep up.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Scene 12’s importer saves every event of the feed, one by one, every time:'],
      blocks: [
        {
          path: 'app/Channels/Ical/IcalImporter.php (the save step, before)',
          broken: true,
          fragment: true,
          code: String.raw`DB::transaction(function () use ($feed, $events): void {
    foreach ($events as $event) {                                       // the bug: 400 events = 400 selects + up to 400 writes
        ExternalBlock::updateOrCreate(
            ['property_id' => $feed->property_id, 'source' => $feed->source, 'uid' => $event->uid],
            ['kind' => $event->kind, 'starts_on' => $event->stay->checkIn->toDateString(), 'ends_on' => $event->stay->checkOut->toDateString()],
        );
    }
    // … delete what is gone, update last_synced_at …
});`,
          after: [
            'On Day 3 a feed had 20 events and this took milliseconds. A Booking.com feed of a busy cottage lists every closed night of the coming year: about **400 events**. Each `updateOrCreate()` is a `SELECT` and, if anything differs, an `UPDATE`; almost always nothing differs, because the calendar didn’t change in 15 minutes. So a sync is ~400 queries to learn that nothing changed, about 1.5 seconds of a worker’s time.',
            'The arithmetic: 3,100 feeds × 1.5 s ≈ **78 minutes** of work every 15 minutes, for 4 workers that have 60. Every 15 minutes the scheduler queues all 3,100 again, so about 700 jobs more arrive than leave, and many are the same feed queued two or three times.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: work out every change first, then write them together',
      text: [
        'The feed’s current blocks are loaded **once**. Each event in the new feed is compared in memory: unknown UID → **new**; known UID with other dates or kind → **changed**; identical → nothing. Blocks whose UID isn’t in the feed any more are **removed**. Only then does anything touch the database, in one short transaction: one `upsert()` for new and changed rows, one `delete()` for removed ones.',
        'A feed that didn’t change, which is nearly all of them, costs one `SELECT` and no writes at all.',
      ],
      blocks: [
        {
          path: 'app/Channels/Ical/BlockChanges.php',
          code: String.raw`<?php

namespace App\Channels\Ical;

use App\Models\ExternalBlock;
use App\Models\IcalFeed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/** Everything one sync changes in a feed's blocks, collected first and written in one go. */
final class BlockChanges
{
    /** @var list<array<string, string|int>> rows to insert or update */
    private array $upserts = [];

    /** @var array<string, true> the UIDs the feed still contains */
    private array $seen = [];

    /** @param Collection<string, ExternalBlock> $current the feed's blocks now, by UID */
    private function __construct(
        private readonly IcalFeed $feed,
        private readonly Collection $current,
    ) {
    }

    public static function for(IcalFeed $feed): self
    {
        $current = ExternalBlock::query()
            ->where('property_id', $feed->property_id)
            ->where('source', $feed->source)                            // only this channel's blocks (scene 12)
            ->get()
            ->keyBy('uid');                                             // one query for the whole feed

        return new self($feed, $current);
    }

    /** Register one event of the new feed: new, changed or the same. Nothing is written yet. */
    public function seen(IcalEvent $event): void
    {
        $this->seen[$event->uid] = true;
        $block = $this->current->get($event->uid);

        $startsOn = $event->stay->checkIn->toDateString();
        $endsOn = $event->stay->checkOut->toDateString();

        if ($block !== null && $block->kind === $event->kind
            && $block->starts_on->toDateString() === $startsOn && $block->ends_on->toDateString() === $endsOn) {
            return;                                                     // identical: nothing to write
        }

        $this->upserts[] = [
            'property_id' => $this->feed->property_id,
            'source' => $this->feed->source->value,                     // raw rows: the enum's value, not the enum
            'uid' => $event->uid,
            'kind' => $event->kind,
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
        ];
    }

    /** Write every registered change in one short transaction. @return int the number of rows inserted, updated or deleted */
    public function commit(): int
    {
        $removedIds = $this->current
            ->reject(fn (ExternalBlock $block): bool => isset($this->seen[$block->uid]))
            ->pluck('id')
            ->all();

        if ($this->upserts === [] && $removedIds === []) {
            return 0;                                                   // the usual case: no transaction at all
        }

        DB::transaction(function () use ($removedIds): void {
            foreach (array_chunk($this->upserts, 500) as $rows) {       // a year of new blocks: still a few statements
                ExternalBlock::upsert($rows, uniqueBy: ['property_id', 'source', 'uid'], update: ['kind', 'starts_on', 'ends_on']);
            }

            if ($removedIds !== []) {
                ExternalBlock::whereKey($removedIds)->delete();
            }
        });

        return count($this->upserts) + count($removedIds);
    }
}`,
          after: [
            '`upsert()` sends one `INSERT … ON DUPLICATE KEY UPDATE` for up to 500 rows. MySQL uses the unique index on `(property_id, source, uid)` from scene 12 to decide, row by row, whether it is an insert or an update. Eloquent’s `upsert()` also fills `created_at` and `updated_at`.',
            'Model events don’t fire for an `upsert()` or a mass `delete()`. Nothing listens to `ExternalBlock` events, and this is the trade a bulk write always makes: write bulk only where nothing listens.',
          ],
        },
        {
          title: 'The importer registers, then commits',
          path: 'app/Channels/Ical/IcalImporter.php',
          code: String.raw`<?php

namespace App\Channels\Ical;

use App\Bookings\Stay;
use App\Enums\Channel;
use App\Models\IcalFeed;
use Illuminate\Support\Facades\Http;
use UnexpectedValueException;

final class IcalImporter
{
    /** @return int the number of blocks that changed: 0 when the calendar is the same as last time */
    public function sync(IcalFeed $feed): int
    {
        $ics = Http::timeout(10)->retry(2, 500)->get($feed->url)->throw()->body();   // a timeout throws; it is not "empty"

        if (! str_contains($ics, 'BEGIN:VCALENDAR')) {
            throw new UnexpectedValueException("Feed {$feed->id} did not return a calendar.");
        }

        $changes = BlockChanges::for($feed);                            // the feed's blocks, loaded once

        foreach ($this->components($ics) as $component) {
            $event = $this->eventFrom($feed->source, $component);
            if ($event !== null) {
                $changes->seen($event);                                 // compared in memory, nothing written
            }
        }

        $changed = $changes->commit();                                  // only the differences, in one transaction

        $feed->forceFill(['last_synced_at' => now()])->save();

        return $changed;
    }

    /** @param array<string, string> $component e.g. ['UID' => '…', 'DTSTART' => '20270710', 'SUMMARY' => 'Reserved'] */
    private function eventFrom(Channel $source, array $component): ?IcalEvent
    {
        if (! isset($component['UID'], $component['DTSTART'], $component['DTEND'])) {
            return null;                                                             // not a usable event: skip it
        }

        $kind = match ($source) {
            Channel::Airbnb => ($component['SUMMARY'] ?? '') === 'Reserved' ? 'reservation' : 'blocked',
            Channel::BookingCom => 'blocked',                    // "CLOSED - Not available": the feed doesn't say which it is
        };

        return new IcalEvent(
            $component['UID'],
            Stay::fromDates($this->date($component['DTSTART']), $this->date($component['DTEND'])),
            $kind,
        );
    }

    /** "20270710" or "20270710T000000Z" → "2027-07-10" */
    private function date(string $value): string
    {
        return substr($value, 0, 4) . '-' . substr($value, 4, 2) . '-' . substr($value, 6, 2);
    }

    /** @return list<array<string, string>> one array per VEVENT, property name => value */
    private function components(string $ics): array
    {
        $ics = preg_replace('/\r?\n[ \t]/', '', $ics);                // unfold lines continued on the next line (RFC 5545)
        $events = [];
        $current = null;

        foreach (preg_split('/\r?\n/', $ics) as $line) {
            if ($line === 'BEGIN:VEVENT') {
                $current = [];
            } elseif ($line === 'END:VEVENT' && $current !== null) {
                $events[] = $current;
                $current = null;
            } elseif ($current !== null && str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $current[strtoupper(explode(';', $name)[0])] = $value;    // "DTSTART;VALUE=DATE" → "DTSTART"
            }
        }

        return $events;
    }
}`,
          after: ['Two events with the same UID in one feed (it happens) register twice; the second simply overwrites the first in `$seen` and both rows go to `upsert()`, where the later one wins, exactly as the old loop did.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: one queued sync per feed, and no push when nothing changed',
      text: [
        'The faster sync drains the queue; three more lines keep it drained. `ShouldBeUniqueUntilProcessing` (scene 17) stops the scheduler from queuing a feed that is already waiting. The job moves to the `channels` queue, so guest emails on `default` never wait behind a sync again (scene 17 did this for pushes and missed this job). And a sync that changed nothing no longer asks `CalendarSync` to push the calendar to every channel: the channels already have exactly this calendar.',
      ],
      blocks: [
        {
          path: 'app/Jobs/SyncIcalFeed.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\CalendarSync;
use App\Channels\Ical\IcalImporter;
use App\Models\IcalFeed;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

class SyncIcalFeed implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Queueable;

    public int $tries = 3;

    public int $uniqueFor = 1800;                                       // a lost lock frees itself after 30 minutes

    public function __construct(public IcalFeed $feed)
    {
        $this->onQueue('channels');
    }

    public function uniqueId(): string
    {
        return (string) $this->feed->id;                                // one waiting sync per feed
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [60, 300];
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping("ical-feed-{$this->feed->id}"))->expireAfter(120)];
    }

    public function handle(IcalImporter $importer, CalendarSync $calendar): void
    {
        if ($importer->sync($this->feed) > 0) {
            $calendar->blocksChanged($this->feed->property);           // only a real change goes to the channels and screens
        }
    }
}`,
          after: [
            'After the deploy: a sync is about 8 ms when nothing changed and rarely more than 40 ms when something did. 3,100 feeds take under two minutes of worker time per 15-minute cycle. The 9,400 queued jobs drain in a few minutes, and since each feed can only be queued once, the queue never holds more than 3,100.',
            'The two overbookings were recorded by scene 18’s overbooking check, which already told the owners; support moves the later guests the same day.',
          ],
        },
      ],
    },
  ],
  reveal: {
    names: ['Unit of Work'],
    rules: [['Unit of Work', 'Keep track of everything a business operation changes (new, changed and removed objects) and write all of it to the database at the end, in one go.']],
    points: [
      '`BlockChanges` is a small Unit of Work for one sync: `seen()` registers each event as new, changed or unchanged; `commit()` works out the removals and writes everything in one transaction.',
      'The win is not the transaction, which the old code also had. It is that **comparing happens in memory**, so writes happen only for real differences, and the writes that do happen are batched.',
      'Doctrine’s `EntityManager` is a full Unit of Work: it tracks every entity you load, and `flush()` writes all their changes at once. Eloquent has none: `save()` writes immediately. So in Laravel you write a small, specific one, where a loop of saves is the bottleneck, like this one.',
    ],
    whenNot: [
      'A handful of rows: a loop of `save()` calls is simpler, fires model events, and is fast enough. This sync was fine for months.',
      'When other code listens to the model’s events (observers, scene 33): bulk writes skip them.',
    ],
  },
  laravel: {
    title: 'Laravel inside: what upsert() sends to MySQL',
    text: ['One statement for many rows. `uniqueBy` matters on databases that need to be told the conflict target; MySQL always uses the table’s unique indexes.'],
    blocks: [
      {
        path: 'the SQL for two rows',
        lang: 'sql',
        code: String.raw`INSERT INTO external_blocks (property_id, source, uid, kind, starts_on, ends_on, created_at, updated_at)
VALUES
  (412, 'booking_com', 'bk-20270710', 'blocked', '2027-07-10', '2027-07-11', '2027-06-01 10:00:00', '2027-06-01 10:00:00'),
  (412, 'booking_com', 'bk-20270711', 'blocked', '2027-07-11', '2027-07-12', '2027-06-01 10:00:00', '2027-06-01 10:00:00')
ON DUPLICATE KEY UPDATE
  kind = VALUES(kind), starts_on = VALUES(starts_on), ends_on = VALUES(ends_on), updated_at = VALUES(updated_at)`,
        after: ['`created_at` is only set for rows that are really inserted: Laravel leaves it out of the `UPDATE` part, so an updated block keeps the day it first appeared.'],
      },
    ],
  },
  tests: {
    summary: 'No writes for an unchanged feed, every kind of change in one go, other channels untouched, one queued sync per feed',
    blocks: [
      {
        path: 'tests/Feature/IcalAtScaleTest.php',
        code: String.raw`<?php

use App\Channels\Ical\IcalImporter;
use App\Enums\Channel;
use App\Jobs\PushAvailability;
use App\Jobs\SyncIcalFeed;
use App\Models\ChannelListing;
use App\Models\ExternalBlock;
use App\Models\IcalFeed;
use App\Models\Property;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

function icsFeed(string ...$events): string
{
    return "BEGIN:VCALENDAR\r\n" . implode('', $events) . "END:VCALENDAR\r\n";
}

function icsEvent(string $uid, string $start, string $end): string
{
    return "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:{$start}\r\nDTEND;VALUE=DATE:{$end}\r\nUID:{$uid}\r\nSUMMARY:CLOSED - Not available\r\nEND:VEVENT\r\n";
}

/** @return list<string> every INSERT, UPDATE or DELETE on external_blocks while $run runs */
function blockWrites(Closure $run): array
{
    $writes = [];
    DB::listen(function (QueryExecuted $query) use (&$writes): void {
        if (preg_match('/^(insert|update|delete)\b.*external_blocks/i', $query->sql)) {
            $writes[] = $query->sql;
        }
    });
    $run();

    return $writes;
}

beforeEach(function () {
    $this->property = Property::factory()->create();
    $this->feed = IcalFeed::forceCreate(['property_id' => $this->property->id, 'source' => Channel::BookingCom, 'url' => 'https://booking.test/412.ics']);
});

it('writes nothing when the feed hasn’t changed', function () {
    $events = array_map(fn (int $day): string => icsEvent("bk-{$day}", sprintf('202707%02d', $day), sprintf('202707%02d', $day + 1)), range(1, 30));
    Http::fake(['booking.test/*' => Http::response(icsFeed(...$events))]);
    app(IcalImporter::class)->sync($this->feed);                              // the first sync saves all 30

    $writes = blockWrites(fn () => expect(app(IcalImporter::class)->sync($this->feed))->toBe(0));

    expect($writes)->toBe([]);                                               // the incident: 30 events, no writes at all
});

it('adds, changes and removes blocks in one go', function () {
    Http::fake(['booking.test/*' => Http::sequence()
        ->push(icsFeed(icsEvent('a', '20270701', '20270703'), icsEvent('b', '20270710', '20270712')))
        ->push(icsFeed(icsEvent('b', '20270710', '20270714'), icsEvent('c', '20270720', '20270721')))]);   // b longer, c new, a gone

    app(IcalImporter::class)->sync($this->feed);
    $writes = blockWrites(fn () => expect(app(IcalImporter::class)->sync($this->feed))->toBe(3));

    expect(ExternalBlock::orderBy('uid')->get()->map(fn (ExternalBlock $block): string => "{$block->uid}:{$block->ends_on->toDateString()}")->all())
        ->toBe(['b:2027-07-14', 'c:2027-07-21'])
        ->and($writes)->toHaveCount(2);                                      // one upsert, one delete
});

it('never touches another channel’s blocks', function () {
    ExternalBlock::create(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'uid' => 'airbnb-1', 'kind' => 'reservation', 'starts_on' => '2027-07-01', 'ends_on' => '2027-07-04']);
    Http::fake(['booking.test/*' => Http::response(icsFeed())]);              // an empty Booking.com calendar

    app(IcalImporter::class)->sync($this->feed);

    expect(ExternalBlock::pluck('uid')->all())->toBe(['airbnb-1']);
});

it('queues one sync per feed, however often the scheduler runs', function () {
    Queue::fake();

    SyncIcalFeed::dispatch($this->feed);
    SyncIcalFeed::dispatch($this->feed);                                       // the next 15-minute run, before the first was processed

    Queue::assertPushedTimes(SyncIcalFeed::class, 1);
});

it('pushes to the channels only when the feed changed something', function () {
    ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
    Http::fake(['booking.test/*' => Http::response(icsFeed(icsEvent('a', '20270701', '20270703')))]);
    app(IcalImporter::class)->sync($this->feed);
    Queue::fake();

    app()->call([new SyncIcalFeed($this->feed), 'handle']);                    // same feed as before

    Queue::assertNotPushed(PushAvailability::class);
});`,
        after: ['`blockWrites()` counts the statements that reach MySQL, so the first test fails if anyone brings back a write per event, even one that writes the same values.'],
      },
    ],
  },
  next: 'Calendars are minutes old again. Next, the busiest day of the year: search slows to eight seconds at the 99th percentile.',
};
