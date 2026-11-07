// Scene 15 · Out-of-order and missing channel events. No new pattern.

export default {
  description: 'A cancelled Booking.com reservation came back to life because its creation event arrived after the cancellation. Fix it in Laravel with versioned upserts under a lock, tombstones for early cancellations, a polling fallback for missed webhooks, and tests on recorded payloads.',
  incident: {
    channel: '#incidents',
    when: 'Thursday 10:15',
    messages: [
      ['Mona · support', 'Booking.com reservation 5530117 was **cancelled** yesterday. In Nordic Stays it shows as **confirmed**, and its nights are closed on Airbnb. The host lost two nights of sales.'],
      ['Karim · developer', 'Booking.com sent the cancellation at 17:02 and the original booking at 17:03, a retry from their side. Our job saved whatever came last.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Scene 14’s job ends with "find or create, then overwrite":'],
      blocks: [
        {
          path: 'app/Jobs/ProcessChannelWebhook.php (from scene 14)',
          broken: true, fragment: true,
          code: String.raw`$booking = Booking::query()->where('channel', $reservation->channel)->where('external_id', $reservation->externalId)->first()
    ?? new Booking();

$booking->forceFill([/* status, stay, total ... from this message */])->save();   // the last message to arrive wins`,
          after: [
            'Networks don’t deliver in order. Channels retry failed deliveries, our workers process jobs in parallel, and a slow job can finish after a faster, newer one. "Last to arrive wins" means an old message can undo a newer one.',
            'And sometimes a message never arrives at all: the channel had an outage, or our endpoint was down for a deploy longer than their retry window.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: newer always wins, whatever arrives last',
      text: [
        'Every reservation message carries the channel’s own "last modified" time, which scene 14’s mappers turn into `version`. We store the version we applied, and only apply a message whose version is **higher**. An older message is acknowledged and ignored.',
        'Two workers can process two messages for the same reservation at the same moment, so the read and the write happen under a row lock, like scene 4. A cancellation that arrives **before** its booking creates the booking already cancelled, a **tombstone**, so the late original finds a newer version and is ignored.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_03_05_000001_add_external_version_to_bookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->unsignedBigInteger('external_version')->nullable();   // the channel's last-modified time, in ms
        });

        Schema::table('channel_listings', function (Blueprint $table) {
            $table->timestamp('last_polled_at')->nullable();             // part 2
        });
    }
};`,
        },
        {
          path: 'app/Channels/ImportChannelReservation.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\BookingStatus;
use App\Jobs\CloseChannelDates;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

final class ImportChannelReservation
{
    /** @return bool true when the reservation was applied, false when it was older than what we have */
    public function handle(ChannelReservation $reservation): bool
    {
        $listing = ChannelListing::query()
            ->where('channel', $reservation->channel)
            ->where('external_listing_id', $reservation->externalListingId)
            ->firstOrFail();

        return DB::transaction(function () use ($reservation, $listing): bool {
            Property::whereKey($listing->property_id)->lockForUpdate()->firstOrFail();   // one change per property at a time

            $booking = Booking::query()
                ->where('channel', $reservation->channel)
                ->where('external_id', $reservation->externalId)
                ->lockForUpdate()
                ->first() ?? new Booking();

            if ($booking->exists && $booking->external_version >= $reservation->version) {
                return false;                                      // older or the same: already applied something newer
            }

            $booking->forceFill([
                'property_id' => $listing->property_id,
                'channel' => $reservation->channel,
                'external_id' => $reservation->externalId,
                'external_version' => $reservation->version,
                'status' => $reservation->status,                  // the channel decides; our own State rules (scene 9) guard our actions
                'guest_name' => $reservation->guestName,
                'guest_email' => $reservation->guestEmail,
                'guests' => $reservation->guests,
                'stay' => $reservation->stay,
                'total' => $reservation->total,
                'confirmed_at' => $booking->confirmed_at ?? now(),
                'cancelled_at' => $reservation->status === BookingStatus::Cancelled ? ($booking->cancelled_at ?? now()) : null,
            ])->save();

            foreach ($booking->property->channelListings as $other) {     // tell the other channels
                if ($other->channel !== $reservation->channel) {
                    CloseChannelDates::dispatch($other, $booking->stay, close: $booking->status !== BookingStatus::Cancelled)->afterCommit();
                }
            }

            return true;
        });
    }
}`,
        },
        {
          text: ['Scene 14’s job keeps mapping with the kit, and hands the saving to the import. Because the import is idempotent and ordered, it doesn’t matter how many times, or in which order, a message arrives:'],
          path: 'app/Jobs/ProcessChannelWebhook.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\ChannelManager;
use App\Channels\ImportChannelReservation;
use App\Enums\Channel;
use App\Models\WebhookEvent;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

class ProcessChannelWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public WebhookEvent $webhook)
    {
    }

    public function handle(ChannelManager $channels): void
    {
        $reservation = $channels->for(Channel::from($this->webhook->provider))->mapper()->reservation($this->webhook->payload);

        app(ImportChannelReservation::class)->handle($reservation);        // ordered and idempotent: any order, any number of times

        $this->webhook->markProcessed();
    }

    public function failed(Throwable $exception): void
    {
        $this->webhook->markFailed($exception->getMessage());
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: don’t rely on webhooks alone',
      text: [
        'Webhooks are the fast path. A **poll** is the safety net: every 10 minutes, ask each channel for the reservations that changed since the last poll, and import them through the same class. A reservation that already came by webhook has the same version and is ignored, so polling can never do harm.',
        'The API interface from scene 13 gains one method, and each adapter returns a generator (scene 11), so many pages of reservations never sit in memory at once.',
      ],
      blocks: [
        {
          path: 'app/Channels/ChannelApi.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;

interface ChannelApi
{
    /** Make these nights unbookable on the channel. Throws ChannelRequestFailed when the channel refuses. */
    public function closeDates(ChannelListing $listing, Stay $nights): void;

    public function openDates(ChannelListing $listing, Stay $nights): void;

    /** @return iterable<ChannelReservation> every reservation of the listing modified since $since */
    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable;
}`,
        },
        {
          title: 'Airbnb: pages until there is no next cursor',
          path: 'app/Channels/Airbnb/AirbnbApi.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;

final readonly class AirbnbApi implements ChannelApi
{
    public function __construct(
        private AirbnbTokens $tokens,
        private string $baseUrl,
    ) {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->setAvailability($listing, $nights, 'unavailable');
    }

    public function openDates(ChannelListing $listing, Stay $nights): void
    {
        $this->setAvailability($listing, $nights, 'available');
    }

    private function setAvailability(ChannelListing $listing, Stay $nights, string $availability): void
    {
        $response = Http::withToken($this->tokens->for($listing))
            ->timeout(10)
            ->acceptJson()
            ->put("{$this->baseUrl}/calendars/{$listing->external_listing_id}", [
                'start_date' => $nights->checkIn->toDateString(),
                'end_date' => $nights->checkOut->subDay()->toDateString(),   // Airbnb counts nights inclusively
                'availability' => $availability,
            ]);

        if ($response->failed()) {
            throw ChannelRequestFailed::from(Channel::Airbnb, $response);  // never a silent 401 again
        }
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        $mapper = new AirbnbReservationMapper();
        $cursor = null;

        do {
            $response = Http::withToken($this->tokens->for($listing))->timeout(10)->acceptJson()
                ->get("{$this->baseUrl}/reservations", array_filter([
                    'listing_id' => $listing->external_listing_id,
                    'updated_since' => $since->toIso8601String(),
                    'cursor' => $cursor,
                ]));

            if ($response->failed()) {
                throw ChannelRequestFailed::from(Channel::Airbnb, $response);
            }

            foreach ($response->json('reservations') as $reservation) {
                yield $mapper->reservation(['reservation' => $reservation]);   // the same mapper as the webhooks
            }

            $cursor = $response->json('next_cursor');
        } while ($cursor !== null);
    }
}`,
        },
        {
          title: 'Booking.com: numbered pages',
          text: ['Booking.com pages by number and says when there are more. Both adapters reuse the mapper from their kit, so a polled reservation is identical to the same reservation from a webhook:'],
          path: 'app/Channels/BookingCom/BookingComApi.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;

final readonly class BookingComApi implements ChannelApi
{
    public function __construct(
        private string $baseUrl,
        private string $username,
        private string $password,
    ) {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->send($listing, $nights, closed: true);
    }

    public function openDates(ChannelListing $listing, Stay $nights): void
    {
        $this->send($listing, $nights, closed: false);
    }

    private function send(ChannelListing $listing, Stay $nights, bool $closed): void
    {
        $xml = sprintf(
            '<request><hotel_id>%s</hotel_id><date from="%s" to="%s"><closed>%d</closed></date></request>',
            htmlspecialchars($listing->external_listing_id, ENT_XML1),            // never trust a value inside XML
            $nights->checkIn->toDateString(),
            $nights->checkOut->subDay()->toDateString(),
            $closed ? 1 : 0,
        );

        $response = Http::withBasicAuth($this->username, $this->password)
            ->timeout(10)
            ->withBody($xml, 'text/xml')
            ->post("{$this->baseUrl}/hotels/xml/availability");

        // Booking.com-style XML APIs can answer 200 with an error inside the body
        if ($response->failed() || str_contains($response->body(), '<error')) {
            throw ChannelRequestFailed::from(Channel::BookingCom, $response);
        }
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        $mapper = new BookingComReservationMapper();
        $page = 1;

        do {
            $response = Http::withBasicAuth($this->username, $this->password)->timeout(10)->acceptJson()
                ->get("{$this->baseUrl}/hotels/json/reservations", [
                    'hotel_id' => $listing->external_listing_id,
                    'last_change' => $since->utc()->format('Y-m-d H:i:s'),
                    'page' => $page,
                ]);

            if ($response->failed()) {
                throw ChannelRequestFailed::from(Channel::BookingCom, $response);
            }

            foreach ($response->json('reservations') as $reservation) {
                yield $mapper->reservation(['reservation' => $reservation]);   // the same mapper as the webhooks
            }

            $page++;
        } while ($response->json('has_more') === true);
    }
}`,
        },
        {
          text: ['Each listing remembers when it was last polled, as a date:'],
          path: 'app/Models/ChannelListing.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\Channel;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ChannelListing extends Model
{
    protected $fillable = ['channel', 'external_listing_id'];

    protected function casts(): array
    {
        return ['channel' => Channel::class, 'last_polled_at' => 'datetime'];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
        },
        {
          title: 'The poll',
          text: ['`$startedAt` is taken **before** the request: a reservation modified while we are fetching is picked up again next time, instead of falling between two polls.'],
          path: 'app/Console/Commands/PollChannelReservations.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Channels\ChannelManager;
use App\Channels\ImportChannelReservation;
use App\Models\ChannelListing;
use Illuminate\Console\Command;

class PollChannelReservations extends Command
{
    protected $signature = 'channels:poll';

    protected $description = 'Import reservations changed since the last poll, in case a webhook was missed';

    public function handle(ChannelManager $channels, ImportChannelReservation $import): int
    {
        ChannelListing::query()->with('property')->lazyById()->each(function (ChannelListing $listing) use ($channels, $import): void {
            $startedAt = now();
            $since = $listing->last_polled_at ?? now()->subDay();

            foreach ($channels->for($listing->channel)->api()->reservationsUpdatedSince($listing, $since) as $reservation) {
                $import->handle($reservation);
            }

            $listing->forceFill(['last_polled_at' => $startedAt])->save();     // only after every page succeeded
        });

        return self::SUCCESS;
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
})->everyFifteenMinutes()->name('sync-ical-feeds')->withoutOverlapping();
Schedule::command('channels:poll')->everyTenMinutes()->withoutOverlapping();`,
          after: ['One listing’s failure stops this run; the next run starts again from that listing’s own `last_polled_at`, so nothing is skipped. Scene 17 moves this into one queued job per listing.'],
        },
      ],
    },
  ],
  laravel: {
    title: 'Testing against real payloads',
    text: [
      'Hand-written test payloads drift from what channels really send. Save a real (anonymised) payload once, as a file, and let every test read it. `Http::fake()` serves recorded API responses the same way, and `Http::preventStrayRequests()` from the [foundation](F#pest-config) fails any test that tries a URL nobody faked.',
    ],
    blocks: [
      {
        text: ['One helper reads them, added to the foundation’s `tests/helpers.php`:'],
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
}

/** @return array<string, mixed> a recorded payload, e.g. fixture('booking_com/reservation-cancelled.json') */
function fixture(string $path): array
{
    return json_decode(file_get_contents(__DIR__ . "/Fixtures/{$path}"), true, flags: JSON_THROW_ON_ERROR);
}`,
      },
      {
        path: 'tests/Fixtures/booking_com/reservation-new.json',
        lang: 'json',
        code: String.raw`{
  "id": "evt-5530117-1",
  "reservation": {
    "id": "5530117", "hotel_id": "1290031", "status": "new",
    "checkin": "2027-08-01", "checkout": "2027-08-04",
    "booker": { "name": "Omar Said", "email": "omar.s@guest.booking.com" }, "guests": 2,
    "price": "1105.50", "currency": "EUR", "last_modified": "2027-05-31T17:00:00Z"
  }
}`,
      },
      {
        text: ['And the same reservation, cancelled two minutes later:'],
        path: 'tests/Fixtures/booking_com/reservation-cancelled.json',
        lang: 'json',
        code: String.raw`{
  "id": "evt-5530117-2",
  "reservation": {
    "id": "5530117", "hotel_id": "1290031", "status": "cancelled",
    "checkin": "2027-08-01", "checkout": "2027-08-04",
    "booker": { "name": "Omar Said", "email": "omar.s@guest.booking.com" }, "guests": 2,
    "price": "1105.50", "currency": "EUR", "last_modified": "2027-05-31T17:02:00Z"
  }
}`,
      },
    ],
  },
  tests: {
    summary: 'Messages in every order, a tombstone, duplicates, and polling with a recorded response',
    blocks: [
      {
        path: 'tests/Feature/ImportChannelReservationTest.php',
        code: String.raw`<?php

use App\Channels\BookingCom\BookingComReservationMapper;
use App\Channels\ImportChannelReservation;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;

beforeEach(function () {
    $property = Property::factory()->create();
    ChannelListing::forceCreate(['property_id' => $property->id, 'channel' => Channel::BookingCom, 'external_listing_id' => '1290031']);
});

function import(string $fixture): bool
{
    return app(ImportChannelReservation::class)->handle((new BookingComReservationMapper())->reservation(fixture("booking_com/{$fixture}.json")));
}

it('ends cancelled when the cancellation arrives first', function () {
    expect(import('reservation-cancelled'))->toBeTrue()                 // creates a tombstone
        ->and(import('reservation-new'))->toBeFalse();                  // the late original is older: ignored

    expect(Booking::sole()->status)->toBe(BookingStatus::Cancelled);   // the incident
});

it('ends cancelled when the messages arrive in order', function () {
    import('reservation-new');
    import('reservation-cancelled');

    expect(Booking::sole()->status)->toBe(BookingStatus::Cancelled);
});

it('applies the same message once, however often it arrives', function () {
    expect(import('reservation-new'))->toBeTrue()
        ->and(import('reservation-new'))->toBeFalse()
        ->and(Booking::count())->toBe(1);
});`,
      },
      {
        path: 'tests/Feature/PollChannelReservationsTest.php',
        code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Models\Booking;
use App\Models\ChannelConnection;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Support\Facades\Http;

it('imports a reservation whose webhook never arrived, and remembers where it stopped', function () {
    config(['services.airbnb' => ['base_url' => 'https://airbnb.test/v2', 'token_url' => 'https://airbnb.test/oauth/token', 'client_id' => 'id', 'client_secret' => 'secret', 'webhook_secret' => 's']]);
    $property = Property::factory()->create();
    ChannelConnection::forceCreate(['account_id' => $property->account_id, 'channel' => Channel::Airbnb, 'access_token' => 'a', 'refresh_token' => 'r', 'expires_at' => now()->addHour()]);
    $listing = ChannelListing::forceCreate(['property_id' => $property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);

    Http::fake(['airbnb.test/v2/reservations*' => Http::sequence()
        ->push(['reservations' => [fixture('airbnb/reservation-accepted.json')], 'next_cursor' => 'page-2'])
        ->push(['reservations' => [], 'next_cursor' => null])]);

    $this->artisan('channels:poll')->assertSuccessful();

    expect(Booking::sole())->channel->toBe(Channel::Airbnb)->status->toBe(BookingStatus::Confirmed)
        ->and($listing->fresh()->last_polled_at->equalTo(now()))->toBeTrue();
});`,
        after: ['`tests/Fixtures/airbnb/reservation-accepted.json` is one recorded reservation object in the shape scene 14’s mapper reads.'],
      },
    ],
  },
  next: 'Messages are now applied in the right order, and none get lost. Friday morning, Airbnb starts answering every request with 429, and keeps doing it for an hour.',
};
