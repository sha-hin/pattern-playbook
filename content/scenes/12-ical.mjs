// Scene 12 · iCal sync from Airbnb and Booking.com: match by UID, deletes scoped to the source, one transaction.

export default {
  description: 'Two families arrived for the same night because the iCal import wiped and rebuilt every block, for every channel, in copy-pasted code. Fix it in Laravel: one importer that saves events by UID, deletes only its own channel’s blocks, and does it all in one transaction',
  incident: {
    channel: '#incidents',
    when: 'Monday 08:20',
    messages: [
      ['Ahmed · host', 'A family is standing outside the Lake Cabin with an **Airbnb** booking for tonight. Another family is inside with a **Nordic Stays** booking for the same nights. The nights were blocked on Airbnb two weeks ago.'],
      ['Karim · developer', 'The iCal import deletes every block for the cabin **first**, then downloads the feed. At 03:00 the download hung until the server killed the process, so the cabin had no blocks until the next run 15 minutes later. That’s when the direct booking came in.'],
    ],
  },
  sections: [
    {
      title: 'Where this comes from',
      text: [
        'Hosts list the same property on several channels. Every channel publishes an **iCal feed** per listing: a text file of the dates that are taken. Nordic Stays reads each feed every 15 minutes and blocks those dates, so they can’t be sold twice. Each event in a feed has a `UID` that stays the same for as long as the booking or block exists.',
      ],
      blocks: [
        {
          title: 'What a feed looks like',
          path: 'https://www.airbnb.com/calendar/ical/41793625.ics?s=… (shortened)',
          lang: 'ics',
          code: String.raw`BEGIN:VCALENDAR
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20270710
DTEND;VALUE=DATE:20270713
UID:1418fb94e984-0b4bb7b4c1b3b9b4b1a1a5d7@airbnb.com
SUMMARY:Reserved
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20270801
DTEND;VALUE=DATE:20270804
UID:7f1c2a10b3d4-9e8f7a6b5c4d3e2f1a0b9c8d@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR`,
          after: ['`DTEND` is exclusive, like our `check_out` (scene 2): this guest leaves on 13 July. "Reserved" is a guest’s booking; "Not available" is a block the host set by hand.'],
        },
      ],
    },
    {
      title: 'The broken code',
      text: ['One class per channel, written by copying the first one and changing it:'],
      blocks: [
        {
          path: 'app/Channels/AirbnbIcalSync.php (before) · BookingComIcalSync.php is a copy',
          broken: true, fragment: true,
          code: String.raw`public function sync(Property $property, string $url): void
{
    DB::table('external_blocks')->where('property_id', $property->id)->delete();   // every source, not just Airbnb

    $ics = file_get_contents($url);                                                // no timeout; a failure returns false

    foreach ($this->parse($ics) as $event) {                                       // if it throws, the blocks are gone
        DB::table('external_blocks')->insert([/* ... */]);
    }
}`,
          after: [
            '"Delete everything, then insert again" has three bugs. It deletes **every** channel’s blocks, so the Airbnb sync also wipes the Booking.com blocks until that sync runs. It isn’t in a transaction, so a failure halfway leaves the calendar empty. And a timeout is treated like an empty calendar.',
            'The Booking.com copy has the same bugs, plus one fixed only in the Airbnb copy. Two classes that do the same steps drift apart.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: feeds and blocks as tables',
      text: ['`unique(property_id, source, uid)` makes "one row per channel event" a database rule. Updating a block finds it by its UID instead of deleting and re-inserting it.'],
      blocks: [
        {
          path: 'database/migrations/2026_03_02_000001_create_ical_tables.php',
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
            $table->string('source');                                 // airbnb, booking_com
            $table->text('url');                                      // contains a secret token: never log it
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();
            $table->unique(['property_id', 'source']);
        });

        Schema::create('external_blocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->string('source');
            $table->string('uid');                                    // the event's UID in the feed
            $table->string('kind');                                   // reservation, blocked
            $table->date('starts_on');
            $table->date('ends_on');                                  // exclusive, like check_out
            $table->timestamps();
            $table->unique(['property_id', 'source', 'uid']);
            $table->index(['property_id', 'starts_on', 'ends_on']);
        });
    }
};`,
        },
        {
          path: 'app/Enums/Channel.php',
          code: String.raw`<?php

namespace App\Enums;

enum Channel: string
{
    case Airbnb = 'airbnb';
    case BookingCom = 'booking_com';
}`,
        },
        {
          path: 'app/Models/IcalFeed.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\Channel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IcalFeed extends Model
{
    protected $fillable = ['source', 'url'];

    protected $hidden = ['url'];

    protected function casts(): array
    {
        return ['source' => Channel::class, 'last_synced_at' => 'datetime'];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
        },
        {
          text: ['A block occupies nights exactly like a booking does, so it gets the same overlap scope as scene 3.'],
          path: 'app/Models/ExternalBlock.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Enums\Channel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class ExternalBlock extends Model
{
    protected $fillable = ['property_id', 'source', 'uid', 'kind', 'starts_on', 'ends_on'];

    protected function casts(): array
    {
        return ['source' => Channel::class, 'starts_on' => 'date:Y-m-d', 'ends_on' => 'date:Y-m-d'];
    }

    public function scopeOverlapping(Builder $query, Stay $stay): void
    {
        $query->where('starts_on', '<', $stay->checkOut->toDateString())
            ->where('ends_on', '>', $stay->checkIn->toDateString());
    }
}`,
        },
        {
          title: 'Booking checks the blocks too',
          text: ['Inside scene 4’s lock, one more check before saving:'],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    public function __construct(private PriceQuoter $quoter)
    {
    }

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            $taken = $property->bookings()->overlapping($stay)->exists()
                || $property->externalBlocks()->overlapping($stay)->exists();   // nights sold on Airbnb or Booking.com
            if ($taken) {
                throw BookingConflict::for($stay);
            }

            $quote = $this->quoter->quote($property, $stay);              // the same price the page showed

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $quote->total();
            $booking->cancellation_policy = $property->cancellation_policy;   // the terms the guest agreed to, frozen
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type,
                'description' => $line->description,
                'amount' => $line->amount,
            ], $quote->lines));                                           // every line of the bill, kept

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
        },
        {
          text: ['`Property` gets the two relations it uses:'],
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use App\Casts\MoneyCast;
use App\Enums\CancellationPolicy;
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

    protected function casts(): array
    {
        return [
            'nightly_rate' => MoneyCast::class . ':nightly_rate_cents',   // Money from nightly_rate_cents + currency
            'cancellation_policy' => CancellationPolicy::class,          // the terms for new bookings
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function icalFeeds(): HasMany
    {
        return $this->hasMany(IcalFeed::class);
    }

    public function externalBlocks(): HasMany
    {
        return $this->hasMany(ExternalBlock::class);
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: one sync, written once',
      text: [
        'The steps are the same for every channel: fetch the feed, read its events, save each one by UID, delete **this source’s** blocks that are no longer in the feed, all in one transaction. So there is one class, not a copy per channel.',
        'Only one line differs between channels: what an event *is*. Airbnb says "Reserved" for a guest and "Airbnb (Not available)" for the host’s own block; Booking.com says "CLOSED - Not available" for everything. A `match` on the source covers that.',
      ],
      blocks: [
        {
          title: 'One event, in our words',
          path: 'app/Channels/Ical/IcalEvent.php',
          code: String.raw`<?php

namespace App\Channels\Ical;

use App\Bookings\Stay;

final readonly class IcalEvent
{
    public function __construct(
        public string $uid,
        public Stay $stay,                                       // scene 2: DTEND is exclusive, like check_out
        public string $kind,                                     // reservation, blocked
    ) {
    }
}`,
        },
        {
          title: 'The importer',
          path: 'app/Channels/Ical/IcalImporter.php',
          code: String.raw`<?php

namespace App\Channels\Ical;

use App\Bookings\Stay;
use App\Channels\Ical\IcalImporter;
use App\Enums\Channel;
use App\Models\ExternalBlock;
use App\Models\IcalFeed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use UnexpectedValueException;

final class IcalImporter
{
    /** @return int the number of events in the feed */
    public function sync(IcalFeed $feed): int
    {
        $ics = Http::timeout(10)->retry(2, 500)->get($feed->url)->throw()->body();   // a timeout throws; it is not "empty"

        if (! str_contains($ics, 'BEGIN:VCALENDAR')) {
            throw new UnexpectedValueException("Feed {$feed->id} did not return a calendar.");
        }

        $events = [];
        foreach ($this->components($ics) as $component) {
            $event = $this->eventFrom($feed->source, $component);
            if ($event !== null) {
                $events[$event->uid] = $event;
            }
        }

        DB::transaction(function () use ($feed, $events): void {                    // all of it, or none of it
            foreach ($events as $event) {
                ExternalBlock::updateOrCreate(
                    ['property_id' => $feed->property_id, 'source' => $feed->source, 'uid' => $event->uid],
                    ['kind' => $event->kind, 'starts_on' => $event->stay->checkIn->toDateString(), 'ends_on' => $event->stay->checkOut->toDateString()],
                );
            }

            ExternalBlock::query()
                ->where('property_id', $feed->property_id)
                ->where('source', $feed->source)                                     // only this channel's blocks
                ->whereNotIn('uid', array_keys($events))
                ->delete();

            $feed->forceFill(['last_synced_at' => now()])->save();
        });

        return count($events);
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
          after: ['Adding Vrbo is one `case` in the enum and one arm in the `match`. Forget the arm and the `match` throws `UnhandledMatchError` on Vrbo’s first event, loudly, instead of guessing.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: every feed, every 15 minutes',
      text: ['One job per feed, so one slow channel can’t hold up the others. `WithoutOverlapping` makes sure two syncs of the same feed never run at once.'],
      blocks: [
        {
          path: 'app/Jobs/SyncIcalFeed.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\Ical\IcalImporter;
use App\Models\IcalFeed;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

class SyncIcalFeed implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public IcalFeed $feed)
    {
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

    public function handle(IcalImporter $importer): void
    {
        $importer->sync($this->feed);
    }
}`,
        },
        {
          path: 'routes/console.php',
          code: String.raw`<?php

use App\Jobs\SyncIcalFeed;
use App\Models\IcalFeed;
use Illuminate\Support\Facades\Schedule;

// The server runs the scheduler once a minute:  * * * * * php artisan schedule:run
// Locally:                                     php artisan schedule:work

Schedule::command('bookings:expire-holds')->everyMinute()->withoutOverlapping();
Schedule::command('payments:reconcile-refunds')->dailyAt('03:10')->withoutOverlapping();

Schedule::call(function (): void {
    IcalFeed::query()->lazyById()->each(fn (IcalFeed $feed) => SyncIcalFeed::dispatch($feed));
})->everyFifteenMinutes()->name('sync-ical-feeds')->withoutOverlapping();`,
          after: ['Fifteen minutes is the honest limit of iCal: a booking on Airbnb can sit unseen here for that long. That’s why the next scene connects to the real APIs.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'Saving by UID, deleting only this channel, failures that change nothing, and bookings refused over blocks',
    text: ['`Http::fake()` answers the feed URLs with recorded feeds; the foundation’s `Http::preventStrayRequests()` makes any other URL fail the test.'],
    blocks: [
      {
        path: 'tests/Feature/IcalSyncTest.php',
        code: String.raw`<?php

use App\Channels\Ical\IcalImporter;
use App\Enums\Channel;
use App\Models\ExternalBlock;
use App\Models\IcalFeed;
use App\Models\Property;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;

function ics(string ...$events): string
{
    return "BEGIN:VCALENDAR\r\n" . implode('', $events) . "END:VCALENDAR\r\n";
}

function vevent(string $uid, string $start, string $end, string $summary = 'Reserved'): string
{
    return "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:{$start}\r\nDTEND;VALUE=DATE:{$end}\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\nEND:VEVENT\r\n";
}

beforeEach(function () {
    $this->property = Property::factory()->create();
    $this->airbnb = IcalFeed::forceCreate(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'url' => 'https://airbnb.test/1.ics']);
    $this->bookingCom = IcalFeed::forceCreate(['property_id' => $this->property->id, 'source' => Channel::BookingCom, 'url' => 'https://booking.test/1.ics']);
});

it('saves each event once, by UID, however often it syncs', function () {
    Http::fake(['airbnb.test/*' => Http::response(ics(vevent('a1', '20270710', '20270713'), vevent('a2', '20270801', '20270804', 'Airbnb (Not available)')))]);

    app(IcalImporter::class)->sync($this->airbnb);
    app(IcalImporter::class)->sync($this->airbnb);

    expect(ExternalBlock::orderBy('uid')->pluck('kind', 'uid')->all())->toBe(['a1' => 'reservation', 'a2' => 'blocked']);
});

it('removes a cancelled event, and never touches another channel’s blocks', function () {
    Http::fake([
        'booking.test/*' => Http::response(ics(vevent('b1', '20270720', '20270722', 'CLOSED - Not available'))),
        'airbnb.test/*' => Http::sequence()
            ->push(ics(vevent('a1', '20270710', '20270713'), vevent('a2', '20270801', '20270804')))
            ->push(ics(vevent('a1', '20270710', '20270713'))),                   // a2 was cancelled on Airbnb
    ]);

    app(IcalImporter::class)->sync($this->bookingCom);
    app(IcalImporter::class)->sync($this->airbnb);
    app(IcalImporter::class)->sync($this->airbnb);

    expect(ExternalBlock::orderBy('uid')->pluck('uid')->all())->toBe(['a1', 'b1']);
});

it('keeps every block when the channel fails', function () {
    ExternalBlock::create(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'uid' => 'a1', 'kind' => 'reservation', 'starts_on' => '2027-07-10', 'ends_on' => '2027-07-13']);
    Http::fake(['airbnb.test/*' => Http::response('Service Unavailable', 503)]);

    expect(fn () => app(IcalImporter::class)->sync($this->airbnb))->toThrow(RequestException::class)
        ->and(ExternalBlock::count())->toBe(1);                                  // the incident: nothing deleted
});

it('refuses a direct booking over a channel block', function () {
    ExternalBlock::create(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'uid' => 'a1', 'kind' => 'reservation', 'starts_on' => '2027-07-10', 'ends_on' => '2027-07-13']);

    $this->actingAs(hostOf($this->property))->postJson("/api/v1/properties/{$this->property->id}/bookings", [
        'check_in' => '2027-07-12', 'check_out' => '2027-07-15', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com',
    ])->assertConflict();
});`,
      },
    ],
  },
  next: 'Blocks now survive failures. But a booking made on Airbnb still takes up to 15 minutes to reach us, and Airbnb never hears about ours. Tuesday: the real APIs.',
};
