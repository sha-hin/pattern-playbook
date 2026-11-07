// Scene 16 · Decorator: a shared rate limit wrapped around any channel API; retries only for real blips.

export default {
  description: 'Airbnb blocked Nordic Stays for an hour after a burst of 429 responses was retried instantly, 25 times per change. Fix it in Laravel: the HTTP client retries only real blips, a Decorator around every channel API stays under the rate limit with Redis, and jobs wait for Retry-After.',
  incident: {
    channel: '#incidents',
    when: 'Friday 09:40',
    messages: [
      ['Alert · channels', 'Airbnb: **429 Too Many Requests** on 100% of calls since 09:12. 31,000 requests in the last 30 minutes.'],
      ['Sara · tech lead', 'Airbnb’s partner team says we sent 40 times our limit, and our app key is blocked until 10:15. Every booking made in that hour is a possible double booking.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['After the 401 outage in scene 13, retries were added in a hurry, in each adapter:'],
      blocks: [
        {
          path: 'app/Channels/Airbnb/AirbnbApi.php (before) · the same line in BookingComApi',
          broken: true, fragment: true,
          code: String.raw`$response = Http::withToken($this->tokens->for($listing))
    ->retry(5, 100)                                      // every error, 429 included, 100 ms apart
    ->put("{$this->baseUrl}/calendars/{$listing->external_listing_id}", [/* ... */]);

// CloseChannelDates: public int $tries = 5;  with no backoff, so a failed job runs again at once`,
          after: [
            'At 09:12 Airbnb got busy and answered a few calls with 429: "too many requests, slow down". Each call was retried 5 times within half a second, and each failed job ran 5 more times right away: up to **25 requests** for one calendar change, all arriving exactly when Airbnb asked us to stop. That turned a short slowdown into a one-hour block.',
            'Not every error deserves a retry. A **network blip or a 5xx** usually succeeds a moment later. A **429** means "wait as long as I tell you". A **4xx** like 400 or 401 will fail the same way every time.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: a 429 is its own error',
      text: ['The adapters already turn failures into `ChannelRequestFailed` (scene 13). A 429 now becomes a subclass that carries how long the channel asked us to wait.'],
      blocks: [
        {
          path: 'app/Channels/ChannelRateLimited.php',
          code: String.raw`<?php

namespace App\Channels;

use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;

final class ChannelRateLimited extends ChannelRequestFailed
{
    public const DEFAULT_SECONDS = 60;                     // when the channel doesn't say

    public int $retryAfter = self::DEFAULT_SECONDS;        // seconds

    public static function wait(string $channel, int $seconds): self
    {
        $exception = new self("{$channel} is rate limiting us; retry in {$seconds}s.");
        $exception->retryAfter = max(1, $seconds);         // a date in the past still waits a second

        return $exception;
    }

    /** Retry-After is either seconds ("120") or an HTTP date ("Wed, 02 Jun 2027 10:15:00 GMT"): RFC 9110 allows both. */
    public static function fromRetryAfter(string $channel, string $header): self
    {
        $header = trim($header);

        $seconds = match (true) {
            $header === '' => self::DEFAULT_SECONDS,
            ctype_digit($header) => (int) $header,
            default => self::secondsUntil($header),
        };

        return self::wait($channel, $seconds);
    }

    private static function secondsUntil(string $httpDate): int
    {
        try {
            $at = CarbonImmutable::createFromFormat(DATE_RFC7231, $httpDate, 'UTC');
        } catch (InvalidFormatException) {
            $at = null;
        }

        if ($at === null) {
            return self::DEFAULT_SECONDS;                  // unreadable: wait the default, never 0
        }

        return (int) ceil(now()->diffInSeconds($at, absolute: false));   // negative if the date has passed
    }
}`,
        },
        {
          path: 'app/Channels/ChannelRequestFailed.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\Channel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use RuntimeException;
use Throwable;

class ChannelRequestFailed extends RuntimeException                     // not final: ChannelRateLimited extends it
{
    public static function from(Channel $channel, Response $response): self
    {
        if ($response->status() === 429) {
            return ChannelRateLimited::fromRetryAfter($channel->value, $response->header('Retry-After'));   // seconds or a date
        }

        return new self("{$channel->value} answered {$response->status()}: " . mb_substr($response->body(), 0, 500));
    }

    /** Only a dropped connection or a 5xx is worth another attempt; a 429 or any other 4xx is not. */
    public static function worthRetrying(Throwable $e): bool
    {
        return $e instanceof ConnectionException
            || ($e instanceof RequestException && $e->response->serverError());
    }
}`,
          after: ['The class is no longer `final`, because `ChannelRateLimited` extends it. `worthRetrying()` is used in part 2.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: retry only real blips',
      text: [
        'Laravel’s HTTP client already retries, and its `retry()` takes a third argument the broken code never used: a `when` callback that decides, per failure, whether another attempt is worth it. One rule, written once, used by both adapters:',
      ],
      blocks: [
        {
          text: ['One rule, `ChannelRequestFailed::worthRetrying()` from part 1, used by both adapters. Airbnb:'],
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
            ->retry([200, 600], when: ChannelRequestFailed::worthRetrying(...), throw: false)   // two more tries, 200 and 600 ms apart
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
          text: ['Booking.com, the same line:'],
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
            ->retry([200, 600], when: ChannelRequestFailed::worthRetrying(...), throw: false)   // two more tries, 200 and 600 ms apart
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
          after: ['`throw: false` hands the last response back to the adapter, which turns it into our own exception as before. A dropped connection still throws `ConnectionException` after the last attempt. The polls keep their single attempt: a failed poll is retried by the next one.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: one rate limit around every channel',
      text: [
        'Waiting for a 429 is already too late: by then the channel is counting us. Each channel publishes a request limit, and every worker must stay under it **together**. That has nothing to do with how Airbnb or Booking.com work, so it doesn’t go **into** the adapters. It goes **around** them: a class that implements the same `ChannelApi` interface, holds another `ChannelApi`, adds one behaviour, and passes the call on.',
        'A Redis counter shared by every worker counts our calls per channel per minute. At the limit, the call isn’t made at all, and the caller is told how long to wait, exactly like a 429 from the channel. `RateLimiter::attempt()` is atomic in Redis, so twenty workers can’t all slip through at the same instant.',
      ],
      blocks: [
        {
          path: 'app/Channels/ThrottledChannelApi.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\RateLimiter;

final readonly class ThrottledChannelApi implements ChannelApi
{
    public function __construct(
        private ChannelApi $inner,
        private string $channel,
        private int $perMinute,
    ) {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->throttle(fn () => $this->inner->closeDates($listing, $nights));
    }

    public function openDates(ChannelListing $listing, Stay $nights): void
    {
        $this->throttle(fn () => $this->inner->openDates($listing, $nights));
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        $this->throttle(fn () => null);                                  // counts the first page; polls are rare
        return $this->inner->reservationsUpdatedSince($listing, $since);
    }

    private function throttle(Closure $call): void
    {
        $key = "channel-api:{$this->channel}";

        if (RateLimiter::attempt($key, $this->perMinute, $call, decaySeconds: 60) === false) {
            throw ChannelRateLimited::wait($this->channel, RateLimiter::availableIn($key));
        }
    }
}`,
        },
        {
          title: 'The kits wrap their API',
          text: ['Code that receives a `ChannelApi` can’t tell whether it got the plain adapter or the wrapped one, so nothing else changes. Airbnb’s kit:'],
          path: 'app/Channels/Airbnb/AirbnbKit.php',
          code: String.raw`<?php

namespace App\Channels\Airbnb;

use App\Channels\ChannelApi;
use App\Channels\ChannelKit;
use App\Channels\ReservationMapper;
use App\Channels\ThrottledChannelApi;
use App\Channels\WebhookVerifier;

final readonly class AirbnbKit implements ChannelKit
{
    /** @param array{base_url: string, token_url: string, client_id: string, client_secret: string, webhook_secret: string, requests_per_minute?: int} $config */
    public function __construct(private array $config)
    {
    }

    public function api(): ChannelApi
    {
        $airbnb = new AirbnbApi(
            new AirbnbTokens($this->config['token_url'], $this->config['client_id'], $this->config['client_secret']),
            $this->config['base_url'],
        );

        return new ThrottledChannelApi($airbnb, 'airbnb', perMinute: (int) ($this->config['requests_per_minute'] ?? 60));
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
          text: ['Booking.com’s:'],
          path: 'app/Channels/BookingCom/BookingComKit.php',
          code: String.raw`<?php

namespace App\Channels\BookingCom;

use App\Channels\ChannelApi;
use App\Channels\ChannelKit;
use App\Channels\ReservationMapper;
use App\Channels\ThrottledChannelApi;
use App\Channels\WebhookVerifier;

final readonly class BookingComKit implements ChannelKit
{
    /** @param array{base_url: string, username: string, password: string, webhook_secret: string, requests_per_minute?: int} $config */
    public function __construct(private array $config)
    {
    }

    public function api(): ChannelApi
    {
        $bookingCom = new BookingComApi($this->config['base_url'], $this->config['username'], $this->config['password']);

        return new ThrottledChannelApi($bookingCom, 'booking_com', perMinute: (int) ($this->config['requests_per_minute'] ?? 60));
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
          text: ['Each channel’s limit goes next to its credentials, with 60 when `.env` doesn’t set one:'],
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
        'requests_per_minute' => env('AIRBNB_REQUESTS_PER_MINUTE', 60),   // a little under the partner's published limit
    ],

    'booking_com' => [
        'base_url' => env('BOOKING_COM_BASE_URL'),
        'username' => env('BOOKING_COM_USERNAME'),
        'password' => env('BOOKING_COM_PASSWORD'),
        'webhook_secret' => env('BOOKING_COM_WEBHOOK_SECRET'),
        'requests_per_minute' => env('BOOKING_COM_REQUESTS_PER_MINUTE', 60),
    ],

];`,
          after: ['One slot covers one call **with its retries**: at most three requests, and only while the channel is answering 5xx. So the value is set a little under the partner’s published limit, not exactly on it.'],
        },
      ],
    },
    {
      title: 'The fix, part 4: jobs wait as long as they’re told',
      text: [
        'A rate-limited job doesn’t fail and doesn’t retry at once: it goes back on the queue for exactly `Retry-After` seconds with `release()`. Every other failure waits a growing backoff. `retryUntil()` replaces a fixed number of tries, so a long rate limit can’t burn all of a job’s attempts.',
      ],
      blocks: [
        {
          path: 'app/Jobs/CloseChannelDates.php (after)',
          code: String.raw`<?php

namespace App\Jobs;

use App\Bookings\Stay;
use App\Channels\ChannelManager;
use App\Channels\ChannelRateLimited;
use App\Models\ChannelListing;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class CloseChannelDates implements ShouldQueue
{
    use Queueable;

    public function __construct(public ChannelListing $listing, public Stay $nights, public bool $close = true)
    {
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addHours(2);                        // keep trying for two hours, however many releases that takes
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function handle(ChannelManager $channels): void
    {
        $api = $channels->for($this->listing->channel)->api();

        try {
            $this->close ? $api->closeDates($this->listing, $this->nights) : $api->openDates($this->listing, $this->nights);
        } catch (ChannelRateLimited $e) {
            $this->release($e->retryAfter);               // back on the queue, not a failure
        }
    }
}`,
          after: ['A limit of how many of these jobs may **start** per minute is also built in: the `RateLimited` job middleware with a `RateLimiter::for()` definition. The decorator is the stricter guard because it counts actual calls to the channel, from jobs, commands and requests alike.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Decorator'],
    rules: [['Decorator', 'A class that implements the same interface as the object it wraps, adds one behaviour, and passes every call on. Decorators can be stacked.']],
    points: [
      'The adapters only translate; the shared limit lives in one small class around all of them. Adding metrics for every channel would be one more decorator, and no adapter would change.',
      'Where the wrapping happens is a decision you can see, in one place: the kit.',
      'The decorator is tested on its own, around a fake `ChannelApi`.',
    ],
    whenNot: [
      'A behaviour the library already has. Retries were one argument away in `Http::retry()`; wrapping them in a decorator would rebuild Laravel.',
      'A behaviour only one class needs: put it in that class.',
    ],
  },
  laravel: {
    title: 'Laravel does the same: the logger',
    text: ['`Log::error()` reaches Laravel’s `Logger`, which implements the PSR `LoggerInterface`, wraps a Monolog logger implementing the same interface, and adds two behaviours: shared context and a `MessageLogged` event. Monolog does the writing.'],
    blocks: [
      {
        path: 'Illuminate/Log/Logger.php (simplified)',
        fragment: true,
        code: String.raw`class Logger implements LoggerInterface
{
    public function __construct(protected LoggerInterface $logger, protected ?Dispatcher $dispatcher = null)
    {
    }

    public function error($message, array $context = []): void
    {
        $this->writeLog(__FUNCTION__, $message, $context);
    }

    protected function writeLog($level, $message, $context): void
    {
        $context = array_merge($this->context, $context);           // added behaviour 1: shared context

        $this->logger->{$level}($message, $context);                // the wrapped logger does the real work

        $this->fireLogEvent($level, $message, $context);            // added behaviour 2: an event
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'What is retried and what isn’t, the shared limit, and a job that waits',
    blocks: [
      {
        path: 'tests/Feature/ChannelRetriesTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelManager;
use App\Channels\ChannelRateLimited;
use App\Channels\ChannelRequestFailed;
use App\Enums\Channel;
use App\Models\ChannelConnection;
use App\Models\ChannelListing;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    config(['services.airbnb' => ['base_url' => 'https://airbnb.test/v2', 'token_url' => 'https://airbnb.test/oauth/token', 'client_id' => 'id', 'client_secret' => 'secret', 'webhook_secret' => 's', 'requests_per_minute' => 300]]);
    $property = Property::factory()->create();
    ChannelConnection::forceCreate(['account_id' => $property->account_id, 'channel' => Channel::Airbnb, 'access_token' => 'a', 'refresh_token' => 'r', 'expires_at' => now()->addHour()]);
    $this->listing = ChannelListing::forceCreate(['property_id' => $property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
    $this->close = fn () => app(ChannelManager::class)->for(Channel::Airbnb)->api()->closeDates($this->listing, Stay::fromDates('2027-07-10', '2027-07-13'));
});

it('retries a 503 and succeeds on the third attempt', function () {
    Http::fake(['airbnb.test/v2/*' => Http::sequence()->push('Unavailable', 503)->push('Unavailable', 503)->push(['ok' => true])]);

    ($this->close)();

    Http::assertSentCount(3);
});

it('never retries a 429 or a 400', function (int $status, string $exception) {
    Http::fake(['airbnb.test/v2/*' => Http::response('No', $status, ['Retry-After' => '30'])]);

    expect($this->close)->toThrow($exception);
    Http::assertSentCount(1);                                              // the incident: no burst of retries
})->with([
    'rate limited' => [429, ChannelRateLimited::class],
    'bad request' => [400, ChannelRequestFailed::class],
]);

it('reads Retry-After as seconds or as an HTTP date', function (string $header, int $seconds) {
    $this->travelTo(CarbonImmutable::parse('2027-06-01 10:00:00', 'UTC'));

    expect(ChannelRateLimited::fromRetryAfter('airbnb', $header)->retryAfter)->toBe($seconds);
})->with([
    'seconds' => ['120', 120],
    'a date' => ['Tue, 01 Jun 2027 10:02:30 GMT', 150],                  // the form that used to become 0
    'a date in the past' => ['Tue, 01 Jun 2027 09:00:00 GMT', 1],
    'missing' => ['', 60],
    'unreadable' => ['soon', 60],
]);`,
      },
      {
        path: 'tests/Unit/ThrottledChannelApiTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRateLimited;
use App\Channels\ThrottledChannelApi;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;

it('stops calling at the limit and says how long to wait', function () {
    $inner = new class implements ChannelApi {
        public int $calls = 0;

        public function closeDates(ChannelListing $listing, Stay $nights): void
        {
            $this->calls++;
        }

        public function openDates(ChannelListing $listing, Stay $nights): void
        {
        }

        public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
        {
            return [];
        }
    };
    $api = new ThrottledChannelApi($inner, 'airbnb', perMinute: 2);
    $nights = Stay::fromDates('2027-07-10', '2027-07-13');

    $api->closeDates(new ChannelListing(), $nights);
    $api->closeDates(new ChannelListing(), $nights);

    expect(fn () => $api->closeDates(new ChannelListing(), $nights))->toThrow(ChannelRateLimited::class)
        ->and($inner->calls)->toBe(2);                                   // the third call never reached the channel
});`,
        after: ['`ChannelListing` and `Stay` are only passed through here, so an unsaved listing is enough. The limiter uses the test cache (`array`), which is fresh for every test.'],
      },
      {
        path: 'tests/Feature/CloseChannelDatesTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Jobs\CloseChannelDates;
use App\Models\ChannelConnection;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Support\Facades\Http;

it('puts itself back on the queue for exactly Retry-After seconds', function () {
    config(['services.airbnb' => ['base_url' => 'https://airbnb.test/v2', 'token_url' => 'https://airbnb.test/oauth/token', 'client_id' => 'id', 'client_secret' => 'secret', 'webhook_secret' => 's', 'requests_per_minute' => 300]]);
    $property = Property::factory()->create();
    ChannelConnection::forceCreate(['account_id' => $property->account_id, 'channel' => Channel::Airbnb, 'access_token' => 'a', 'refresh_token' => 'r', 'expires_at' => now()->addHour()]);
    $listing = ChannelListing::forceCreate(['property_id' => $property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
    Http::fake(['airbnb.test/v2/*' => Http::response('Too Many Requests', 429, ['Retry-After' => '120'])]);

    $job = (new CloseChannelDates($listing, Stay::fromDates('2027-07-10', '2027-07-13')))->withFakeQueueInteractions();
    $job->handle(app(ChannelManager::class));

    $job->assertReleased(delay: 120);
    Http::assertSentCount(1);                                             // no instant retries on a 429
});`,
      },
    ],
  },
  next: 'Channels now get exactly as many requests as they allow. Monday morning, after a Booking.com outage, Nordic Stays queues 642 pushes in one minute.',
};
