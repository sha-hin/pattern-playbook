// Scene 14 · Abstract Factory: one matching set of objects per channel.

export default {
  description: 'A Booking.com cancellation cancelled an Airbnb booking, because the webhook code chose its verifier, its mapper and its booking lookup in three different ways. Fix it in Laravel with an Abstract Factory: one kit per channel that creates a matching API client, signature verifier and payload mapper.',
  incident: {
    channel: '#incidents',
    when: 'Wednesday 16:45',
    messages: [
      ['Ahmed · host', 'My Airbnb guest arriving Friday was just **cancelled** in Nordic Stays, and the dates opened up on every channel. She never cancelled. Airbnb still shows her booking.'],
      ['Karim · developer', 'The cancellation came from **Booking.com**, for their reservation 4471202. Our Airbnb booking has the code 4471202 too. And Booking.com’s new payload has a `reservation` key, so our code read it with the Airbnb mapper.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/ChannelWebhookController.php (before)',
          broken: true, fragment: true,
          code: String.raw`// One endpoint for every channel
$verifier = $this->verifiers[$request->header('X-Channel')];                 // chosen by a header
if (! $verifier->verify($request)) {
    abort(401);
}

$payload = $request->json()->all();
$mapper = isset($payload['reservation']) ? new AirbnbMapper() : new BookingComMapper();   // chosen by the payload's shape
$reservation = $mapper->map($payload);

Booking::where('external_id', $reservation->externalId)->update([...]);       // no channel in the lookup`,
          after: [
            'Three parts that must belong to **the same channel** are picked in three unrelated ways: the verifier by a header, the mapper by guessing from the payload, the booking by an id without its channel. Nothing stops a Booking.com request being verified as Booking.com, read as Airbnb, and applied to an Airbnb booking.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one kit per channel',
      text: [
        'Each channel needs a **family** of objects that only work together: its API client (scene 13), the verifier for its webhook signatures, and the mapper for its payloads. Instead of choosing each one separately, each channel gets a **kit** that creates all three. Pick the kit once, from the URL, and every part you get from it matches.',
        'The signing schemes and payloads below are simplified versions of each partner’s; the real ones are in the partner documentation.',
      ],
      blocks: [
        {
          title: 'The kit interface',
          path: 'app/Channels/ChannelKit.php',
          code: String.raw`<?php

namespace App\Channels;

interface ChannelKit
{
    public function api(): ChannelApi;

    public function verifier(): WebhookVerifier;

    public function mapper(): ReservationMapper;
}`,
        },
        {
          title: 'The two other products',
          path: 'app/Channels/WebhookVerifier.php',
          code: String.raw`<?php

namespace App\Channels;

use Illuminate\Http\Request;

interface WebhookVerifier
{
    /** True only when the request is signed by this channel. */
    public function verify(Request $request): bool;
}`,
        },
        {
          path: 'app/Channels/ReservationMapper.php',
          code: String.raw`<?php

namespace App\Channels;

interface ReservationMapper
{
    /** @param array<string, mixed> $payload */
    public function eventId(array $payload): string;

    /** @param array<string, mixed> $payload */
    public function reservation(array $payload): ChannelReservation;
}`,
        },
        {
          title: 'A reservation, in our words',
          text: ['Whatever the channel sends becomes this. `version` is the channel’s own "last modified" time, in milliseconds; scene 15 needs it.'],
          path: 'app/Channels/ChannelReservation.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Money\Money;

final readonly class ChannelReservation
{
    public function __construct(
        public Channel $channel,
        public string $externalId,
        public string $externalListingId,
        public BookingStatus $status,                         // Confirmed or Cancelled
        public Stay $stay,
        public string $guestName,
        public string $guestEmail,
        public int $guests,
        public Money $total,
        public int $version,
    ) {
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: the Airbnb kit',
      blocks: [
        {
          path: 'app/Channels/Airbnb/AirbnbKit.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Channels\ChannelApi;
use App\Channels\ChannelKit;
use App\Channels\ReservationMapper;
use App\Channels\WebhookVerifier;

final readonly class AirbnbKit implements ChannelKit
{
    /** @param array{base_url: string, token_url: string, client_id: string, client_secret: string, webhook_secret: string} $config */
    public function __construct(private array $config)
    {
    }

    public function api(): ChannelApi
    {
        return new AirbnbApi(
            new AirbnbTokens($this->config['token_url'], $this->config['client_id'], $this->config['client_secret']),
            $this->config['base_url'],
        );
    }

    public function verifier(): WebhookVerifier
    {
        return new AirbnbSignature($this->config['webhook_secret']);
    }

    public function mapper(): ReservationMapper
    {
        return new AirbnbReservationMapper();
    }
}`,
        },
        {
          title: 'Airbnb’s signature: a hex HMAC of the body',
          path: 'app/Channels/Airbnb/AirbnbSignature.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Channels\WebhookVerifier;
use Illuminate\Http\Request;

final readonly class AirbnbSignature implements WebhookVerifier
{
    public function __construct(private string $secret)
    {
    }

    public function verify(Request $request): bool
    {
        $expected = hash_hmac('sha256', $request->getContent(), $this->secret);

        return hash_equals($expected, (string) $request->header('X-Airbnb-Signature'));   // constant time: no timing leaks
    }
}`,
        },
        {
          path: 'app/Channels/Airbnb/AirbnbReservationMapper.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Bookings\Stay;
use App\Channels\ChannelReservation;
use App\Channels\ReservationMapper;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Money\Money;
use Carbon\CarbonImmutable;

final class AirbnbReservationMapper implements ReservationMapper
{
    public function eventId(array $payload): string
    {
        return (string) $payload['event_id'];
    }

    public function reservation(array $payload): ChannelReservation
    {
        $r = $payload['reservation'];

        return new ChannelReservation(
            channel: Channel::Airbnb,
            externalId: (string) $r['confirmation_code'],
            externalListingId: (string) $r['listing_id'],
            status: $r['status'] === 'cancelled' ? BookingStatus::Cancelled : BookingStatus::Confirmed,
            stay: Stay::fromDates($r['start_date'], $r['end_date']),             // end_date is the check-out day
            guestName: trim("{$r['guest']['first_name']} {$r['guest']['last_name']}"),
            guestEmail: $r['guest']['email'],                                    // an Airbnb relay address
            guests: (int) $r['number_of_guests'],
            total: Money::of((int) $r['total_paid']['amount'], $r['total_paid']['currency']),   // already in minor units
            version: (int) CarbonImmutable::parse($r['updated_at'])->getTimestampMs(),
        );
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: the Booking.com kit',
      text: ['The same three products, built for Booking.com. Its signature is base64 instead of hex, in another header; its price is a decimal string.'],
      blocks: [
        {
          path: 'app/Channels/BookingCom/BookingComKit.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Channels\ChannelApi;
use App\Channels\ChannelKit;
use App\Channels\ReservationMapper;
use App\Channels\WebhookVerifier;

final readonly class BookingComKit implements ChannelKit
{
    /** @param array{base_url: string, username: string, password: string, webhook_secret: string} $config */
    public function __construct(private array $config)
    {
    }

    public function api(): ChannelApi
    {
        return new BookingComApi($this->config['base_url'], $this->config['username'], $this->config['password']);
    }

    public function verifier(): WebhookVerifier
    {
        return new BookingComSignature($this->config['webhook_secret']);
    }

    public function mapper(): ReservationMapper
    {
        return new BookingComReservationMapper();
    }
}`,
        },
        {
          path: 'app/Channels/BookingCom/BookingComSignature.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Channels\WebhookVerifier;
use Illuminate\Http\Request;

final readonly class BookingComSignature implements WebhookVerifier
{
    public function __construct(private string $secret)
    {
    }

    public function verify(Request $request): bool
    {
        $expected = base64_encode(hash_hmac('sha256', $request->getContent(), $this->secret, binary: true));

        return hash_equals($expected, (string) $request->header('X-Booking-Signature'));
    }
}`,
        },
        {
          title: 'A decimal price, without a float',
          text: ['"1105.50" must become `110550` cents exactly. `bcmul()` multiplies decimal strings without ever making a float (scene 1), and the currency’s own minor units decide the factor, so "15010" yen stays 15010.'],
          path: 'app/Channels/BookingCom/BookingComReservationMapper.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Bookings\Stay;
use App\Channels\ChannelReservation;
use App\Channels\ReservationMapper;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Money\Currency;
use App\Money\Money;
use Carbon\CarbonImmutable;

final class BookingComReservationMapper implements ReservationMapper
{
    public function eventId(array $payload): string
    {
        return (string) $payload['id'];
    }

    public function reservation(array $payload): ChannelReservation
    {
        $r = $payload['reservation'];
        $currency = Currency::from($r['currency']);

        return new ChannelReservation(
            channel: Channel::BookingCom,
            externalId: (string) $r['id'],
            externalListingId: (string) $r['hotel_id'],
            status: $r['status'] === 'cancelled' ? BookingStatus::Cancelled : BookingStatus::Confirmed,
            stay: Stay::fromDates($r['checkin'], $r['checkout']),
            guestName: $r['booker']['name'],
            guestEmail: $r['booker']['email'],
            guests: (int) $r['guests'],
            total: Money::of((int) bcmul($r['price'], (string) 10 ** $currency->minorUnits(), 0), $currency),
            version: (int) CarbonImmutable::parse($r['last_modified'])->getTimestampMs(),
        );
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 4: pick the kit once, from the URL',
      blocks: [
        {
          title: 'The manager builds kits now',
          text: ['Scene 13’s manager returns a kit per channel instead of only the API. Code that only pushes calendars asks for `->api()`.'],
          path: 'app/Channels/ChannelManager.php (after)',
          fragment: true,
          code: String.raw`public function for(Channel $channel): ChannelKit
{
    return $this->driver($channel->value);
}

protected function createAirbnbDriver(): ChannelKit
{
    return new AirbnbKit($this->config->get('services.airbnb'));            // + 'webhook_secret' => env('AIRBNB_WEBHOOK_SECRET')
}

protected function createBookingComDriver(): ChannelKit
{
    return new BookingComKit($this->config->get('services.booking_com'));   // + 'webhook_secret' => env('BOOKING_COM_WEBHOOK_SECRET')
}

// CloseChannelDates (scene 13): $channels->for($this->listing->channel)->api()`,
          after: ['Scene 13’s tests change the same way: `->for(Channel::Airbnb)->api()->closeDates(...)`.'],
        },
        {
          title: 'Bookings know their channel',
          text: ['A reservation id is only unique **within** its channel, so the pair is the key. `channel` is null for direct bookings, and MySQL allows any number of nulls in a unique index.'],
          path: 'database/migrations/2026_03_04_000001_add_channel_to_bookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('channel')->nullable();                    // null = booked on Nordic Stays
            $table->string('external_id')->nullable();
            $table->unique(['channel', 'external_id']);               // 4471202 on Airbnb ≠ 4471202 on Booking.com
        });
    }
};`,
          after: ['`Booking` casts `channel` to the `Channel` enum.'],
        },
        {
          title: 'One route per channel',
          text: ['The channel comes from the URL, bound to the enum, so an unknown channel is a 404. From then on, every object comes from that one kit.'],
          path: 'app/Http/Controllers/ChannelWebhookController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Jobs\ProcessChannelWebhook;
use App\Models\WebhookEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChannelWebhookController extends Controller
{
    // Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);
    public function __invoke(Request $request, Channel $channel, ChannelManager $channels): JsonResponse
    {
        $kit = $channels->for($channel);

        if (! $kit->verifier()->verify($request)) {
            return response()->json(['message' => 'Invalid signature.'], 401);
        }

        $payload = json_decode($request->getContent(), true, flags: JSON_THROW_ON_ERROR);

        $webhook = WebhookEvent::createOrFirst(                            // scene 8's inbox
            ['provider' => $channel->value, 'event_id' => $kit->mapper()->eventId($payload)],
            ['type' => 'reservation', 'payload' => $payload],
        );

        if ($webhook->wasRecentlyCreated) {
            ProcessChannelWebhook::dispatch($webhook);
        }

        return response()->json(['received' => true]);
    }
}`,
        },
        {
          title: 'The job maps with the same kit',
          text: ['`provider` on the stored event **is** the channel, so the job gets the same kit the controller used. Saving the reservation is the simple version for now; the next scene shows why it isn’t enough.'],
          path: 'app/Jobs/ProcessChannelWebhook.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Models\Booking;
use App\Models\ChannelListing;
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

        $listing = ChannelListing::query()
            ->where('channel', $reservation->channel)
            ->where('external_listing_id', $reservation->externalListingId)
            ->firstOrFail();                                               // an unknown listing is an error, not a skip

        $booking = Booking::query()
            ->where('channel', $reservation->channel)                      // the pair, never the id alone
            ->where('external_id', $reservation->externalId)
            ->first() ?? new Booking();

        $booking->forceFill([
            'property_id' => $listing->property_id,
            'channel' => $reservation->channel,
            'external_id' => $reservation->externalId,
            'status' => $reservation->status,
            'guest_name' => $reservation->guestName,
            'guest_email' => $reservation->guestEmail,
            'guests' => $reservation->guests,
            'stay' => $reservation->stay,
            'total' => $reservation->total,
            'confirmed_at' => $booking->confirmed_at ?? now(),
        ])->save();

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
  ],
  reveal: {
    names: ['Abstract Factory'],
    rules: [['Abstract Factory', 'An interface for creating a family of related objects that must be used together. Each concrete factory creates one matching family.']],
    points: [
      'The kit is chosen **once**, and every object comes from it: an Airbnb verifier can never be paired with a Booking.com mapper.',
      'Each kit is a concrete factory; the verifier, the mapper and the API client are its products, each behind its own interface.',
      'A new channel is a new kit with its three products. Forgetting one is a missing method: PHP refuses the class before it ever runs.',
    ],
    whenNot: [
      'When the objects don’t depend on each other, separate factories (or the container) are simpler. A kit earns its place only because mixing families is a real bug.',
      'Don’t add products "for later". The kit has exactly the three things every channel needs today.',
    ],
  },
  laravel: {
    title: 'Laravel does the same: database connections',
    text: [
      'Scene 4 showed `MySqlGrammar` turning `lockForUpdate()` into `for update`. It never meets a PostgreSQL connection by mistake, because each connection class is a concrete factory for its own family: query grammar, schema grammar and result processor. Configure `mysql` and every part you get speaks MySQL.',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/MySqlConnection.php (simplified)',
        fragment: true,
        code: String.raw`class MySqlConnection extends Connection
{
    protected function getDefaultQueryGrammar()
    {
        return new MySqlGrammar($this);                   // SQL for queries, in MySQL's dialect
    }

    protected function getDefaultSchemaGrammar()
    {
        return new MySqlSchemaGrammar($this);             // SQL for migrations
    }

    protected function getDefaultPostProcessor()
    {
        return new MySqlProcessor();                      // reads MySQL's results, e.g. the last insert id
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'Each channel’s signature, no crossing between channels, and exact prices',
    blocks: [
      {
        path: 'tests/Feature/ChannelWebhookTest.php',
        code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;
use App\Models\WebhookEvent;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    config(['services.airbnb.webhook_secret' => 'airbnb-secret', 'services.booking_com.webhook_secret' => 'booking-secret']);
    $this->property = Property::factory()->create();
    ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
    ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::BookingCom, 'external_listing_id' => '1290031']);
});

function bookingComCancellation(string $id): array
{
    return ['id' => "evt-{$id}", 'reservation' => [
        'id' => $id, 'hotel_id' => '1290031', 'status' => 'cancelled', 'checkin' => '2027-08-01', 'checkout' => '2027-08-04',
        'booker' => ['name' => 'Omar Said', 'email' => 'omar@example.com'], 'guests' => 2,
        'price' => '1105.50', 'currency' => 'EUR', 'last_modified' => '2027-06-01T09:00:00Z',
    ]];
}

function postChannel(Channel $channel, array $payload, string $header, string $signature): TestResponse
{
    return test()->call('POST', "/api/webhooks/channels/{$channel->value}", server: [
        'HTTP_' . strtoupper(str_replace('-', '_', $header)) => $signature, 'CONTENT_TYPE' => 'application/json',
    ], content: json_encode($payload, JSON_THROW_ON_ERROR));
}

function bookingComSignature(array $payload, string $secret = 'booking-secret'): string
{
    return base64_encode(hash_hmac('sha256', json_encode($payload, JSON_THROW_ON_ERROR), $secret, true));
}

it('never applies a Booking.com cancellation to an Airbnb booking with the same id', function () {
    $airbnb = Booking::factory()->for($this->property)->create(['channel' => Channel::Airbnb, 'external_id' => '4471202']);
    $payload = bookingComCancellation('4471202');

    postChannel(Channel::BookingCom, $payload, 'X-Booking-Signature', bookingComSignature($payload))->assertOk();

    expect($airbnb->fresh()->status)->toBe(BookingStatus::Confirmed)                     // the incident
        ->and(Booking::where('channel', Channel::BookingCom)->sole()->status)->toBe(BookingStatus::Cancelled);
});

it('refuses a request signed for another channel', function () {
    $payload = bookingComCancellation('1');
    $airbnbStyle = hash_hmac('sha256', json_encode($payload, JSON_THROW_ON_ERROR), 'airbnb-secret');

    postChannel(Channel::BookingCom, $payload, 'X-Booking-Signature', $airbnbStyle)->assertUnauthorized();

    expect(WebhookEvent::count())->toBe(0);
});

it('turns a decimal price into exact minor units', function () {
    $payload = bookingComCancellation('1');

    postChannel(Channel::BookingCom, $payload, 'X-Booking-Signature', bookingComSignature($payload));

    expect(Booking::sole()->total_cents)->toBe(110_550);
});`,
      },
    ],
  },
  next: 'Every message now reaches the right booking. Thursday, Booking.com delivers a cancellation and then, a minute later, the original booking it cancels.',
};
