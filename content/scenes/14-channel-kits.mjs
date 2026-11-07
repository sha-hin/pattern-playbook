// Scene 14 · Abstract Factory: one matching set of objects per channel.

export default {
  description: 'For two days every Booking.com reservation webhook was rejected, because a refactor built the Booking.com signature checker with Airbnb’s secret. Fix it in Laravel with an Abstract Factory: one kit per channel that creates its API client, signature verifier and payload mapper from that channel’s own configuration, so the parts can’t be mixed.',
  incident: {
    channel: '#incidents',
    when: 'Wednesday 16:45',
    messages: [
      ['Ahmed · host', 'A family just arrived at the Nyhavn flat with a **Booking.com reservation made on Monday night**. Nordic Stays has never heard of it, and the flat is occupied by another guest.'],
      ['Karim · developer', 'Since Monday’s refactor, **every** Booking.com webhook got a 401 from us: the Booking.com verifier was built with **Airbnb’s secret**, one copied line. Booking.com retried for a day, then gave up. 14 reservations never reached us.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Providers/ChannelServiceProvider.php (before, after Monday’s refactor)',
          broken: true, fragment: true,
          code: String.raw`// three lists, kept in sync by hand
$this->app->singleton('channel.clients', fn () => [
    'airbnb' => new AirbnbApi(/* services.airbnb */),
    'booking_com' => new BookingComApi(/* services.booking_com */),
]);

$this->app->singleton('channel.verifiers', fn () => [
    'airbnb' => new HmacVerifier(config('services.airbnb.webhook_secret'), 'X-Airbnb-Signature', 'hex'),
    'booking_com' => new HmacVerifier(config('services.airbnb.webhook_secret'), 'X-Booking-Signature', 'base64'),   // copied, one word not changed
]);

$this->app->singleton('channel.mappers', fn () => [
    'airbnb' => new AirbnbReservationMapper(),
    'booking_com' => new BookingComReservationMapper(),
]);`,
          after: [
            'Every channel needs three parts that only work **together**: its API client, the verifier for its webhook signatures (with **its** secret), and the mapper for **its** payloads. Here they are three separate lists, and nothing connects the Booking.com entry in one list to the Booking.com entry in the next. A copied line put Airbnb’s secret into Booking.com’s verifier, every signature failed, and the tests passed, because each list was tested on its own.',
            'Rejecting a webhook looks like success from our side: nothing crashes, nothing is logged as an error. The polling fallback that would have caught the missed reservations is the next scene.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one kit per channel',
      text: [
        'Each channel needs a **family** of objects that only work together: its API client (scene 13), the verifier for its webhook signatures, and the mapper for its payloads. Instead of choosing each one separately, each channel gets a **kit** that creates all three. Pick the kit once, from the URL, and every part you get from it matches. Each kit receives **only its own channel’s configuration**, so the Booking.com kit has no way to reach Airbnb’s secret.',
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
          text: ['Scene 13’s manager returns a kit per channel instead of only the API.'],
          path: 'app/Channels/ChannelManager.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Channels\Airbnb\AirbnbKit;
use App\Channels\BookingCom\BookingComKit;
use App\Enums\Channel;
use Illuminate\Support\Manager;
use InvalidArgumentException;

/** @method ChannelKit driver(string|null $driver = null) */
final class ChannelManager extends Manager
{
    public function for(Channel $channel): ChannelKit
    {
        return $this->driver($channel->value);               // "booking_com" → createBookingComDriver()
    }

    public function getDefaultDriver(): string
    {
        throw new InvalidArgumentException('There is no default channel: name one.');
    }

    protected function createAirbnbDriver(): ChannelKit
    {
        return new AirbnbKit($this->config->get('services.airbnb'));            // only Airbnb's own settings
    }

    protected function createBookingComDriver(): ChannelKit
    {
        return new BookingComKit($this->config->get('services.booking_com'));   // only Booking.com's own settings
    }
}`,
        },
        {
          text: ['Each channel gets its own webhook secret, next to its other credentials:'],
          path: 'config/services.php',
          code: String.raw`<?php

// Credentials for the services Nordic Stays talks to. Values come from .env, never from code.
return [

    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'version' => env('STRIPE_API_VERSION'),              // the API version your Stripe account is pinned to
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),     // checks that a webhook really comes from Stripe
    ],

    'airbnb' => [
        'base_url' => env('AIRBNB_BASE_URL'),
        'token_url' => env('AIRBNB_TOKEN_URL'),
        'client_id' => env('AIRBNB_CLIENT_ID'),
        'client_secret' => env('AIRBNB_CLIENT_SECRET'),
        'webhook_secret' => env('AIRBNB_WEBHOOK_SECRET'),
    ],

    'booking_com' => [
        'base_url' => env('BOOKING_COM_BASE_URL'),
        'username' => env('BOOKING_COM_USERNAME'),
        'password' => env('BOOKING_COM_PASSWORD'),
        'webhook_secret' => env('BOOKING_COM_WEBHOOK_SECRET'),
    ],

];`,
        },
        {
          text: ['Each value comes from that channel’s partner dashboard:'],
          path: '.env (add these lines)',
          lang: 'env',
          fragment: true,
          code: String.raw`AIRBNB_WEBHOOK_SECRET=
BOOKING_COM_WEBHOOK_SECRET=`,
        },
        {
          text: ['Code that only pushes calendars asks the kit for its API:'],
          path: 'app/Jobs/CloseChannelDates.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Bookings\Stay;
use App\Channels\ChannelManager;
use App\Models\ChannelListing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class CloseChannelDates implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public ChannelListing $listing, public Stay $nights, public bool $close = true)
    {
    }

    public function handle(ChannelManager $channels): void
    {
        $api = $channels->for($this->listing->channel)->api();

        $this->close ? $api->closeDates($this->listing, $this->nights) : $api->openDates($this->listing, $this->nights);
    }
}`,
        },
        {
          title: 'Bookings know their channel',
          text: ['While webhooks now find their way in, the booking they belong to needs the same care: a reservation id is only unique **within** its channel (Airbnb and Booking.com both use plain numbers for some ids), so the pair is the key. `channel` is null for direct bookings, and MySQL allows any number of nulls in a unique index.'],
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
        },
        {
          text: ['`Booking` casts the new column to the `Channel` enum:'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Refunds\NoAutomaticRefund;
use App\Bookings\Refunds\RefundPolicy;
use App\Bookings\States\BookingState;
use App\Bookings\States\CancelledState;
use App\Bookings\States\ConfirmedState;
use App\Bookings\States\ExpiredState;
use App\Bookings\States\PendingState;
use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Casts\StayCast;
use App\Enums\BookingStatus;
use App\Enums\CancellationPolicy;
use App\Enums\Channel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'check_in', 'check_out', 'guests'];

    protected function casts(): array
    {
        return [
            'check_in' => 'date:Y-m-d',
            'check_out' => 'date:Y-m-d',
            'status' => BookingStatus::class,
            'expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'total' => MoneyCast::class . ':total_cents',          // Money from total_cents + currency
            'stay' => StayCast::class,                             // Stay from check_in + check_out
            'cancellation_policy' => CancellationPolicy::class,    // a copy of the property's policy, made at booking time
            'channel' => Channel::class,                           // null for bookings made on Nordic Stays
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(BookingLineItem::class);
    }

    /** Bookings that share at least one night with $stay: $property->bookings()->overlapping($stay). */
    public function scopeOverlapping(Builder $query, Stay $stay): void
    {
        $query->whereIn('status', BookingStatus::blocking())
            ->where('check_in', '<', $stay->checkOut->toDateString())     // starts before the new stay ends
            ->where('check_out', '>', $stay->checkIn->toDateString());    // ends after the new stay starts
    }

    /** What this booking may do now. The status column stays the single source of truth. */
    public function state(): BookingState
    {
        return match ($this->status) {
            BookingStatus::Pending => new PendingState(),
            BookingStatus::Confirmed => new ConfirmedState(),
            BookingStatus::Expired => new ExpiredState(),
            BookingStatus::Cancelled => new CancelledState(),
        };                                                        // a new status without a state class fails here, loudly
    }

    /** The rules this booking's guest agreed to. Never null: bookings without a policy refund nothing automatically. */
    public function refundPolicy(): RefundPolicy
    {
        return $this->cancellation_policy?->refundPolicy() ?? new NoAutomaticRefund();
    }
}`,
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
          text: ['Its route:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\StripeWebhookController;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api: the full URL is /api/v1/properties/{property}/bookings.
Route::get('/v1/properties/{property}/quote', QuoteController::class);   // public: guests aren't logged in

Route::post('/v1/properties/{property}/bookings', [BookingController::class, 'store'])
    ->middleware('auth:sanctum')
    ->can('createBooking', 'property');

Route::post('/v1/bookings/{booking}/payment', BookingPaymentController::class)
    ->middleware('auth:sanctum');

Route::post('/v1/bookings/{booking}/cancel', CancelBookingController::class)
    ->middleware('auth:sanctum');                                       // who may: scenes 19 and 20

Route::post('/v1/bookings/{booking}/mark-paid', MarkBookingPaidController::class)
    ->middleware('auth:sanctum');                                       // who may: scenes 19 and 20

// Stripe calls this, not a browser. API routes have no CSRF check, which Stripe couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);

// {channel} is bound to the Channel enum: /webhooks/channels/vrbo is a 404.
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);`,
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
        text: ['Scene 13’s tests ask the kit for its API now:'],
        path: 'tests/Feature/ChannelApiTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelManager;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelConnection;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    config([
        'services.airbnb' => ['base_url' => 'https://airbnb.test/v2', 'token_url' => 'https://airbnb.test/oauth/token', 'client_id' => 'id', 'client_secret' => 'secret'],
        'services.booking_com' => ['base_url' => 'https://booking.test', 'username' => 'user', 'password' => 'pass'],
    ]);
    $this->property = Property::factory()->create();
    $this->connection = ChannelConnection::forceCreate([
        'account_id' => $this->property->account_id, 'channel' => Channel::Airbnb,
        'access_token' => 'old-access', 'refresh_token' => 'old-refresh', 'expires_at' => now()->addHour(),
    ]);
    $this->airbnb = ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
    $this->bookingCom = ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::BookingCom, 'external_listing_id' => '1290031']);
    $this->nights = Stay::fromDates('2027-07-10', '2027-07-13');
});

it('closes nights on Airbnb as JSON, with the last night inclusive', function () {
    Http::fake(['airbnb.test/*' => Http::response(['ok' => true])]);

    app(ChannelManager::class)->for(Channel::Airbnb)->api()->closeDates($this->airbnb, $this->nights);

    Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT'
        && $request->url() === 'https://airbnb.test/v2/calendars/41793625'
        && $request->hasHeader('Authorization', 'Bearer old-access')
        && $request['end_date'] === '2027-07-12'
        && $request['availability'] === 'unavailable');
});

it('closes nights on Booking.com as XML, and treats an error inside a 200 as a failure', function () {
    Http::fake(['booking.test/*' => Http::response('<response><error code="401">Bad credentials</error></response>', 200)]);

    expect(fn () => app(ChannelManager::class)->for(Channel::BookingCom)->api()->closeDates($this->bookingCom, $this->nights))
        ->toThrow(ChannelRequestFailed::class, 'booking_com answered 200');
});

it('refreshes an expiring token before calling, and stores the new pair', function () {
    $this->connection->update(['expires_at' => now()->addSeconds(30)]);
    Http::fake([
        'airbnb.test/oauth/token' => Http::response(['access_token' => 'new-access', 'refresh_token' => 'new-refresh', 'expires_in' => 3600]),
        'airbnb.test/v2/*' => Http::response(['ok' => true]),
    ]);

    app(ChannelManager::class)->for(Channel::Airbnb)->api()->closeDates($this->airbnb, $this->nights);

    expect($this->connection->fresh())
        ->access_token->toBe('new-access')
        ->refresh_token->toBe('new-refresh');
    Http::assertSent(fn (Request $request): bool => $request->hasHeader('Authorization', 'Bearer new-access'));
});

it('stores tokens encrypted', function () {
    expect($this->connection->getRawOriginal('access_token'))->not->toContain('old-access');
});`,
      },
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

it('accepts a Booking.com webhook signed with Booking.com’s own secret', function () {
    $payload = bookingComCancellation('5530117');

    postChannel(Channel::BookingCom, $payload, 'X-Booking-Signature', bookingComSignature($payload))->assertOk();   // the incident: this was a 401

    expect(WebhookEvent::sole()->provider)->toBe('booking_com');
});

it('refuses a request signed with another channel’s secret', function () {
    $payload = bookingComCancellation('1');

    postChannel(Channel::BookingCom, $payload, 'X-Booking-Signature', bookingComSignature($payload, secret: 'airbnb-secret'))->assertUnauthorized();

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
