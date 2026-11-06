// Scene 16 · Decorator: retries and rate limits wrapped around any channel API.

export default {
  description: 'Airbnb blocked Nordic Stays for an hour after a burst of 429 responses was retried instantly, 25 times per change. Fix it in Laravel with Decorators around the channel API: one that retries only real blips, one that stays under the rate limit with Redis, and jobs that wait for Retry-After.',
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

final class ChannelRateLimited extends ChannelRequestFailed
{
    public int $retryAfter = 60;                           // seconds

    public static function wait(string $channel, int $seconds): self
    {
        $exception = new self("{$channel} is rate limiting us; retry in {$seconds}s.");
        $exception->retryAfter = max(1, $seconds);

        return $exception;
    }
}`,
        },
        {
          path: 'app/Channels/ChannelRequestFailed.php (from() changed)',
          fragment: true,
          code: String.raw`public static function from(Channel $channel, Response $response): self
{
    if ($response->status() === 429) {
        return ChannelRateLimited::wait($channel->value, (int) ($response->header('Retry-After') ?: 60));
    }

    $exception = new self("{$channel->value} answered {$response->status()}: " . mb_substr($response->body(), 0, 500));
    $exception->status = $response->status();                // the retry decorator reads it

    return $exception;
}

// The class is no longer final (ChannelRateLimited extends it), and gains: public ?int $status = null;`,
        },
      ],
    },
    {
      title: 'The fix, part 2: wrap the API instead of changing it',
      text: [
        'Retrying and rate limiting have nothing to do with how Airbnb or Booking.com work, and every channel needs them the same way. So they don’t go **into** the adapters. They go **around** them: a class that implements the same `ChannelApi` interface, holds another `ChannelApi`, adds one behaviour, and passes the call on.',
        'Code that receives a `ChannelApi` can’t tell whether it got the plain adapter or one wrapped twice. That is what lets the layers stack.',
      ],
      blocks: [
        {
          title: 'Retry real blips, nothing else',
          text: ['Two more attempts, 200 ms and 600 ms apart, only for connection errors and 5xx. Laravel’s `Sleep` is used instead of `usleep()` so tests can fake the waiting.'],
          path: 'app/Channels/RetryingChannelApi.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Sleep;

final readonly class RetryingChannelApi implements ChannelApi
{
    private const PAUSES_MS = [200, 600];

    public function __construct(private ChannelApi $inner)
    {
    }

    public function closeDates(ChannelListing $listing, Stay $nights): void
    {
        $this->retry(fn () => $this->inner->closeDates($listing, $nights));
    }

    public function openDates(ChannelListing $listing, Stay $nights): void
    {
        $this->retry(fn () => $this->inner->openDates($listing, $nights));
    }

    public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
    {
        return $this->inner->reservationsUpdatedSince($listing, $since);   // a half-read page sequence can't be replayed; the next poll retries
    }

    private function retry(Closure $call): void
    {
        foreach ([...self::PAUSES_MS, null] as $pause) {
            try {
                $call();

                return;
            } catch (ConnectionException|ChannelRequestFailed $e) {
                $transient = $e instanceof ConnectionException
                    || (! $e instanceof ChannelRateLimited && $e->status >= 500);

                if (! $transient || $pause === null) {
                    throw $e;                                              // 429, 4xx, or out of attempts
                }

                Sleep::for($pause)->milliseconds();
            }
        }
    }
}`,
        },
        {
          title: 'Stay under the limit before the channel has to say so',
          text: [
            'Each channel publishes a request limit. A Redis counter shared by **every worker** counts our calls per channel per minute; at the limit, the call isn’t made at all, and the caller is told how long to wait, exactly like a 429 from the channel. `RateLimiter::attempt()` is atomic in Redis, so twenty workers can’t all slip through at the same instant.',
          ],
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
          title: 'The kits put the layers together',
          text: [
            'The order matters. The throttle sits **inside** the retry, so every real HTTP call, retries included, takes a slot from the limit. If it sat outside, one slot would cover up to three calls.',
          ],
          path: 'app/Channels/Airbnb/AirbnbKit.php (api() changed) · the same in BookingComKit',
          fragment: true,
          code: String.raw`public function api(): ChannelApi
{
    $airbnb = new AirbnbApi(
        new AirbnbTokens($this->config['token_url'], $this->config['client_id'], $this->config['client_secret']),
        $this->config['base_url'],
    );

    return new RetryingChannelApi(                       // outer: retries blips
        new ThrottledChannelApi($airbnb, 'airbnb', perMinute: (int) ($this->config['requests_per_minute'] ?? 60)),   // inner: counts every call
    );
}`,
          after: ['`requests_per_minute` goes in `config/services.php` next to each channel’s credentials: the partner’s published limit, with 60 when it isn’t set. The plain adapters lose their `retry()` lines; they only translate again.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: jobs wait as long as they’re told',
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
          after: ['A limit of how many of these jobs may **start** per minute is also built in: the `RateLimited` job middleware with a `RateLimiter::for()` definition. The decorator is the stricter guard because it counts actual HTTP calls, wherever they come from.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Decorator'],
    rules: [['Decorator', 'A class that implements the same interface as the object it wraps, adds one behaviour, and passes every call on. Decorators can be stacked.']],
    points: [
      'The adapters only translate; retrying and throttling each live in one small class. Adding logging or metrics to every channel would be one more decorator, and no adapter would change.',
      'The order of the layers is a decision you can see, in one place: the kit.',
      'Each decorator is tested on its own, around a fake `ChannelApi`.',
    ],
    whenNot: [
      'A behaviour only one class needs: put it in that class.',
      'Many layers that depend on each other’s order in subtle ways are hard to follow. Two or three, built in one visible place, is the comfortable range.',
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
        path: 'tests/Unit/ChannelDecoratorsTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelApi;
use App\Channels\ChannelRateLimited;
use App\Channels\ChannelRequestFailed;
use App\Channels\RetryingChannelApi;
use App\Channels\ThrottledChannelApi;
use App\Models\ChannelListing;
use Carbon\CarbonImmutable;
use Illuminate\Support\Sleep;

/** A ChannelApi that fails with the given errors, in order, then succeeds. */
function flaky(Throwable ...$errors): ChannelApi
{
    return new class ($errors) implements ChannelApi {
        public int $calls = 0;

        /** @param list<Throwable> $errors */
        public function __construct(private array $errors)
        {
        }

        public function closeDates(ChannelListing $listing, Stay $nights): void
        {
            $this->calls++;
            if ($error = array_shift($this->errors)) {
                throw $error;
            }
        }

        public function openDates(ChannelListing $listing, Stay $nights): void
        {
        }

        public function reservationsUpdatedSince(ChannelListing $listing, CarbonImmutable $since): iterable
        {
            return [];
        }
    };
}

function failedWith(int $status): ChannelRequestFailed
{
    $e = new ChannelRequestFailed("answered {$status}");
    $e->status = $status;

    return $e;
}

beforeEach(function () {
    Sleep::fake();
    $this->listing = new ChannelListing();
    $this->nights = Stay::fromDates('2027-07-10', '2027-07-13');
});

it('retries a 503 and succeeds, pausing 200 then 600 ms', function () {
    $inner = flaky(failedWith(503), failedWith(503));

    (new RetryingChannelApi($inner))->closeDates($this->listing, $this->nights);

    expect($inner->calls)->toBe(3);
    Sleep::assertSequence([Sleep::for(200)->milliseconds(), Sleep::for(600)->milliseconds()]);
});

it('never retries a 429 or a 400', function (Throwable $error) {
    $inner = flaky($error);

    expect(fn () => (new RetryingChannelApi($inner))->closeDates($this->listing, $this->nights))->toThrow($error::class)
        ->and($inner->calls)->toBe(1);
})->with([
    'rate limited' => [ChannelRateLimited::wait('airbnb', 30)],
    'bad request' => [failedWith(400)],
]);

it('stops calling at the limit and says how long to wait', function () {
    $inner = flaky();
    $api = new ThrottledChannelApi($inner, 'airbnb', perMinute: 2);

    $api->closeDates($this->listing, $this->nights);
    $api->closeDates($this->listing, $this->nights);

    expect(fn () => $api->closeDates($this->listing, $this->nights))->toThrow(ChannelRateLimited::class)
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
