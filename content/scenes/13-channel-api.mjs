// Scene 13 · Adapter and Manager: one interface for every channel's API.

export default {
  description: 'The first Airbnb and Booking.com API integration was if/else per channel in every caller, and every push failed with 401 an hour after launch because the OAuth token expired. Fix it in Laravel with one ChannelApi interface, an Adapter per channel, a Manager to pick the driver, and a token refresh guarded by a lock.',
  incident: {
    channel: '#incidents',
    when: 'Tuesday 11:00',
    messages: [
      ['Sara · tech lead', 'The API integration went live at 10:00. Since 11:00, **every** Airbnb call returns **401 Unauthorized**. Nothing has reached Airbnb for an hour, and the logs only say "Airbnb push failed".'],
      ['Karim · developer', 'The access token expires after an hour, and refreshing it is on my list. Also, I need to add the same push to cancellations, and it’s the third copy of the if/else.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Bookings/BookingConfirmation.php (before) · copied into CancelBooking and ExpireHolds',
          broken: true, fragment: true,
          code: String.raw`foreach ($booking->property->channelListings as $listing) {
    if ($listing->channel === Channel::Airbnb) {
        Http::withToken($connection->access_token)                     // expires after an hour, never refreshed
            ->post("https://api.airbnb.com/v2/calendars/{$listing->external_listing_id}", [/* JSON */]);
    } elseif ($listing->channel === Channel::BookingCom) {
        Http::withBasicAuth(config('services.booking_com.username'), config('services.booking_com.password'))
            ->withBody($xml, 'text/xml')->post('https://supply-xml.booking.com/hotels/xml/availability');
    }
}`,
          after: [
            'Every place that changes the calendar has to know **both** APIs: Airbnb speaks JSON with OAuth tokens, Booking.com speaks XML with a username and password. Each new channel adds an `elseif` to every copy. And the errors are swallowed: nothing checks the response, so a 401 looks like success.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: say what we need, in our words',
      text: [
        'Nordic Stays doesn’t care how each channel works. It needs two things from any of them: **close these nights** and **open these nights** on a listing. That’s the interface. Every channel’s API is wrapped in a class that translates those two calls into what that channel expects.',
        'First the data: which of our properties is which listing on each channel, and the OAuth tokens per account. The tokens are encrypted at rest, so a database dump contains no usable token.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_03_03_000001_create_channel_tables.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('channel_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('channel');
            $table->text('access_token');                           // encrypted by the model
            $table->text('refresh_token');
            $table->timestamp('expires_at');
            $table->timestamps();
            $table->unique(['account_id', 'channel']);
        });

        Schema::create('channel_listings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->string('channel');
            $table->string('external_listing_id');                  // the listing's id on that channel
            $table->timestamps();
            $table->unique(['property_id', 'channel']);              // one listing per channel per property
            $table->unique(['channel', 'external_listing_id']);
        });
    }
};`,
        },
        {
          path: 'app/Models/ChannelConnection.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\Channel;
use Illuminate\Database\Eloquent\Model;

class ChannelConnection extends Model
{
    protected $fillable = ['channel', 'access_token', 'refresh_token', 'expires_at'];

    protected $hidden = ['access_token', 'refresh_token'];

    protected function casts(): array
    {
        return [
            'channel' => Channel::class,
            'access_token' => 'encrypted',                          // Laravel encrypts with APP_KEY on write
            'refresh_token' => 'encrypted',
            'expires_at' => 'datetime',
        ];
    }
}`,
        },
        {
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
        return ['channel' => Channel::class];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
          after: ['`Property` gets `channelListings()`, and `Account` gets `channelConnections()`.'],
        },
        {
          title: 'The interface',
          path: 'app/Channels/ChannelApi.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\ChannelListing;

interface ChannelApi
{
    /** Make these nights unbookable on the channel. Throws ChannelRequestFailed when the channel refuses. */
    public function closeDates(ChannelListing $listing, Stay $nights): void;

    public function openDates(ChannelListing $listing, Stay $nights): void;
}`,
        },
        {
          path: 'app/Channels/ChannelRequestFailed.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\Channel;
use Illuminate\Http\Client\Response;
use RuntimeException;

final class ChannelRequestFailed extends RuntimeException
{
    public static function from(Channel $channel, Response $response): self
    {
        return new self("{$channel->value} answered {$response->status()}: " . mb_substr($response->body(), 0, 500));
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: an adapter per channel',
      text: [
        'Each adapter implements the interface and translates. The request shapes below are simplified versions of each partner API: the real field names come from the partner documentation you get when you are approved, but the structure of the code is the same.',
      ],
      blocks: [
        {
          title: 'Airbnb: JSON, with an OAuth token',
          path: 'app/Channels/Airbnb/AirbnbApi.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelListing;
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
}`,
        },
        {
          title: 'Booking.com: XML, with a username and password',
          path: 'app/Channels/BookingCom/BookingComApi.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelListing;
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
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: refreshing the token, once',
      text: [
        'Airbnb’s access token lasts an hour; the refresh token gets a new one. Two details make this harder than it looks. Many workers push at once, and if two of them refresh at the same moment, the second refresh can be rejected, because each refresh token works only once. So the refresh runs under a **Redis lock**, and the second worker re-reads the token the first one saved. And the token is refreshed a minute **before** it expires, not after a 401.',
      ],
      blocks: [
        {
          path: 'app/Channels/Airbnb/AirbnbTokens.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Enums\Channel;
use App\Models\ChannelConnection;
use App\Models\ChannelListing;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

final readonly class AirbnbTokens
{
    public function __construct(
        private string $tokenUrl,
        private string $clientId,
        private string $clientSecret,
    ) {
    }

    public function for(ChannelListing $listing): string
    {
        $connection = $this->connection($listing);

        if ($connection->expires_at->isAfter(now()->addMinute())) {
            return $connection->access_token;                               // still valid for over a minute
        }

        return Cache::lock("airbnb-token-{$connection->id}", 15)->block(10, function () use ($listing): string {
            $connection = $this->connection($listing);                      // re-read: another worker may have refreshed

            if ($connection->expires_at->isAfter(now()->addMinute())) {
                return $connection->access_token;
            }

            $response = Http::asForm()->timeout(10)->post($this->tokenUrl, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $connection->refresh_token,
                'client_id' => $this->clientId,
                'client_secret' => $this->clientSecret,
            ]);

            if ($response->failed()) {
                throw new RuntimeException("Airbnb token refresh failed for connection {$connection->id}: {$response->status()}. The host must reconnect.");
            }

            $connection->update([
                'access_token' => $response->json('access_token'),
                'refresh_token' => $response->json('refresh_token'),     // the old one stops working now
                'expires_at' => now()->addSeconds($response->json('expires_in')),
            ]);

            return $connection->access_token;
        });
    }

    private function connection(ChannelListing $listing): ChannelConnection
    {
        return ChannelConnection::query()
            ->where('account_id', $listing->property->account_id)
            ->where('channel', Channel::Airbnb)
            ->firstOrFail();
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 4: one place that builds the right adapter',
      text: [
        'Laravel has a base class for exactly this: `Manager`. You ask for a driver by name, it calls `create{Name}Driver()` the first time, and keeps the instance. Mail, cache, queue, session and filesystem all work this way; now channels do too.',
      ],
      blocks: [
        {
          path: 'app/Channels/ChannelManager.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Channels\Airbnb\AirbnbApi;
use App\Channels\Airbnb\AirbnbTokens;
use App\Channels\BookingCom\BookingComApi;
use App\Enums\Channel;
use Illuminate\Support\Manager;
use InvalidArgumentException;

/** @method ChannelApi driver(string|null $driver = null) */
final class ChannelManager extends Manager
{
    public function for(Channel $channel): ChannelApi
    {
        return $this->driver($channel->value);               // "booking_com" → createBookingComDriver()
    }

    public function getDefaultDriver(): string
    {
        throw new InvalidArgumentException('There is no default channel: name one.');
    }

    protected function createAirbnbDriver(): ChannelApi
    {
        $config = $this->config->get('services.airbnb');

        return new AirbnbApi(
            new AirbnbTokens($config['token_url'], $config['client_id'], $config['client_secret']),
            $config['base_url'],
        );
    }

    protected function createBookingComDriver(): ChannelApi
    {
        $config = $this->config->get('services.booking_com');

        return new BookingComApi($config['base_url'], $config['username'], $config['password']);
    }
}`,
        },
        {
          path: 'config/services.php · .env · AppServiceProvider::register()',
          lang: 'shell',
          code: String.raw`# config/services.php
'airbnb' => [
    'base_url' => env('AIRBNB_BASE_URL'), 'token_url' => env('AIRBNB_TOKEN_URL'),
    'client_id' => env('AIRBNB_CLIENT_ID'), 'client_secret' => env('AIRBNB_CLIENT_SECRET'),
],
'booking_com' => [
    'base_url' => env('BOOKING_COM_BASE_URL'),
    'username' => env('BOOKING_COM_USERNAME'), 'password' => env('BOOKING_COM_PASSWORD'),
],

# AppServiceProvider::register(): one manager, so each driver is built once per process
$this->app->singleton(ChannelManager::class);`,
        },
        {
          title: 'The callers, now',
          text: ['The push becomes a queued job, dispatched after the commit by the confirmation facade (scene 6), `CancelBooking` (scene 10) and `ExpireHolds` (scene 9). None of them knows a channel exists; scene 17 makes the job itself smarter.'],
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
        $api = $channels->for($this->listing->channel);

        $this->close ? $api->closeDates($this->listing, $this->nights) : $api->openDates($this->listing, $this->nights);
    }
}`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Adapter', 'Manager / Driver'],
    rules: [
      ['Adapter', 'A class that makes an existing API fit the interface your code expects, by translating every call.'],
      ['Manager / Driver', 'One object that builds the right implementation of an interface by name, from configuration, and keeps it for reuse. Laravel’s own pattern, used by mail, cache, queue and more.'],
    ],
    points: [
      'The interface is written in **our** words (`closeDates`, `Stay`), not Airbnb’s or Booking.com’s. Their quirks (inclusive end dates, XML, errors inside a 200) stay inside their adapters.',
      'Adding Vrbo is one adapter and one `createVrboDriver()` method. No caller changes.',
      'Testing callers is easy: bind a fake `ChannelApi`, or fake the HTTP calls, as below.',
    ],
    whenNot: [
      'One integration that will stay the only one: call it through one class, but skip the interface and the manager until a second one is real.',
      'Don’t let the interface grow every feature of every channel. If only Airbnb has "smart pricing", that is an Airbnb class, not a `ChannelApi` method.',
    ],
  },
  laravel: {
    title: 'Laravel inside: how Manager::driver() works',
    text: ['The driver name becomes a method name. A custom driver registered with `extend()` wins over a built-in one, which is how packages add their own cache stores or mail transports.'],
    blocks: [
      {
        path: 'Illuminate/Support/Manager.php (simplified)',
        fragment: true,
        code: String.raw`public function driver($driver = null)
{
    $driver = $driver ?: $this->getDefaultDriver();

    return $this->drivers[$driver] ??= $this->createDriver($driver);     // built once, then reused
}

protected function createDriver($driver)
{
    if (isset($this->customCreators[$driver])) {
        return $this->callCustomCreator($driver);                       // registered with extend()
    }

    $method = 'create' . Str::studly($driver) . 'Driver';               // "booking_com" → createBookingComDriver

    if (method_exists($this, $method)) {
        return $this->$method();
    }

    throw new InvalidArgumentException("Driver [$driver] not supported.");
}`,
      },
    ],
  },
  tests: {
    summary: 'What each adapter sends, failures that throw, and the token refreshed once',
    blocks: [
      {
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

    app(ChannelManager::class)->for(Channel::Airbnb)->closeDates($this->airbnb, $this->nights);

    Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT'
        && $request->url() === 'https://airbnb.test/v2/calendars/41793625'
        && $request->hasHeader('Authorization', 'Bearer old-access')
        && $request['end_date'] === '2027-07-12'
        && $request['availability'] === 'unavailable');
});

it('closes nights on Booking.com as XML, and treats an error inside a 200 as a failure', function () {
    Http::fake(['booking.test/*' => Http::response('<response><error code="401">Bad credentials</error></response>', 200)]);

    expect(fn () => app(ChannelManager::class)->for(Channel::BookingCom)->closeDates($this->bookingCom, $this->nights))
        ->toThrow(ChannelRequestFailed::class, 'booking_com answered 200');
});

it('refreshes an expiring token before calling, and stores the new pair', function () {
    $this->connection->update(['expires_at' => now()->addSeconds(30)]);
    Http::fake([
        'airbnb.test/oauth/token' => Http::response(['access_token' => 'new-access', 'refresh_token' => 'new-refresh', 'expires_in' => 3600]),
        'airbnb.test/v2/*' => Http::response(['ok' => true]),
    ]);

    app(ChannelManager::class)->for(Channel::Airbnb)->closeDates($this->airbnb, $this->nights);

    expect($this->connection->fresh())
        ->access_token->toBe('new-access')
        ->refresh_token->toBe('new-refresh');
    Http::assertSent(fn (Request $request): bool => $request->hasHeader('Authorization', 'Bearer new-access'));
});

it('stores tokens encrypted', function () {
    expect($this->connection->getRawOriginal('access_token'))->not->toContain('old-access');
});`,
      },
    ],
  },
  next: 'Pushing out works. Wednesday, the first reservation webhooks come in from the channels, and a Booking.com cancellation lands on an Airbnb booking.',
};
