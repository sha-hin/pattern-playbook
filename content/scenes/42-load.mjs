// Scene 42 · Load: measure with k6, read the plan, add the index, move searches to a read replica.

export default {
  description: 'On the busiest booking evening of the year, search slowed to eight seconds at the 99th percentile and bookings timed out with it: every search scanned the whole properties table, on the same database server that takes the bookings. Reproduce it with k6, find it with EXPLAIN, fix it with one composite index, and move reads to a replica with Laravel’s read/write connections, keeping the booking decisions on the primary.',
  incident: {
    channel: '#incidents',
    when: 'Sunday 20:15',
    messages: [
      ['Monitoring', '**search p99 = 8.2 s** (normal: 180 ms) · **MySQL primary CPU 96%** · 412 searches/s'],
      ['Mona · support', 'It’s the Sunday before the school summer holidays, the evening families book their last-minute cottages. Guests say search hangs, and some payments time out at checkout.'],
      ['Karim · developer', 'The slow query log is full of the search query. Every one of them reads all 21,000 properties.'],
    ],
  },
  sections: [
    {
      title: 'Measure first: reproduce the load',
      text: [
        'Guessing at performance is how teams add the wrong index. The first step is to make the problem happen on purpose, somewhere safe: a staging server with a copy of production’s data (21,000 properties, 2.1 million bookings, guest names replaced). k6 sends searches at a fixed rate, like real traffic, and reports how long they took.',
      ],
      blocks: [
        {
          path: 'loadtests/search.js',
          lang: 'js',
          code: String.raw`import http from 'k6/http';
import { check } from 'k6';

export const options = {
    scenarios: {
        sunday_peak: {
            executor: 'constant-arrival-rate',    // 400 searches every second, however slow the answers get
            rate: 400,
            timeUnit: '1s',
            duration: '5m',
            preAllocatedVUs: 300,
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<300', 'p(99)<800'],   // the run fails if search is slower than this
    },
};

const cities = ['Copenhagen', 'Aarhus', 'Skagen', 'Rørvig', 'Odense', 'Bornholm'];

export default function () {
    const city = cities[Math.floor(Math.random() * cities.length)];
    const response = http.get(` + '`${__ENV.BASE_URL}/api/v1/search?city=${encodeURIComponent(city)}&check_in=2027-07-12&check_out=2027-07-19&guests=4`' + String.raw`);

    check(response, { 'status is 200': (r) => r.status === 200 });
}`,
          after: ['`constant-arrival-rate` matters: a test where each virtual user waits for its answer before the next request sends **fewer** requests as the server slows down, and hides the problem. Real guests don’t wait for each other.'],
        },
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`k6 run -e BASE_URL=https://staging.nordicstays.com loadtests/search.js`,
        },
        {
          table: [
            ['Run', 'p50', 'p95', 'p99', 'Primary CPU'],
            ['Before', '1.9 s', '6.4 s', '8.6 s', '97%'],
          ],
          after: [
            '**p50** is the median: half the searches were faster. **p95** and **p99**: 95% and 99% were faster than this. The averages of a slow system look fine; the 99th percentile is what one guest in a hundred lives through, and on Sunday that was four guests every second.',
          ],
        },
      ],
    },
    {
      title: 'The broken code',
      text: ['The slow query log and `EXPLAIN` point at the same line. The search from scene 31 filters by city first:'],
      blocks: [
        {
          path: 'mysql',
          lang: 'sql',
          code: String.raw`EXPLAIN SELECT id, name, city, max_guests FROM properties
WHERE city = 'Copenhagen' AND max_guests >= 4
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE bookings.property_id = properties.id AND status IN ('pending', 'confirmed') AND check_in < '2027-07-19' AND check_out > '2027-07-12')
  AND NOT EXISTS (SELECT 1 FROM external_blocks WHERE external_blocks.property_id = properties.id AND starts_on < '2027-07-19' AND ends_on > '2027-07-12')
ORDER BY name LIMIT 50;`,
        },
        {
          broken: true,
          table: [
            ['table', 'type', 'key', 'rows', 'Extra'],
            ['properties', '**ALL**', '(none)', '21,384', '**Using where; Using filesort**'],
            ['bookings', 'ref', 'bookings_property_id_status_check_in_check_out_index', '4', 'Using where; Using index'],
            ['external_blocks', 'ref', 'external_blocks_property_id_starts_on_ends_on_index', '2', 'Using where; Using index'],
          ],
          after: [
            '**type ALL** means MySQL reads every row of `properties` to find the ones in Copenhagen: the table has no index on `city` (the Foundation only indexed `account_id`). **Using filesort** means it then sorts the matches by name, by hand. The two subqueries are fine: they use their indexes (scene 31 and 34).',
            'At 400 searches a second that is 8.5 million rows read every second, on the server that also takes every booking, payment and iCal sync. Search didn’t just get slow; it took the CPU the bookings needed.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one index that answers the WHERE and the ORDER BY',
      text: [
        'An index on `(city, name)` lets MySQL jump to Copenhagen and read its properties **already sorted by name**, so the sort disappears and it can stop as soon as it has 50 rows that pass the other conditions. `max_guests` stays out of it: as a range condition (`>=`), it would stop the index from also delivering the order.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_05_03_000001_add_city_index_to_properties_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->index(['city', 'name']);                            // WHERE city = ? ORDER BY name, straight from the index
        });
    }

    public function down(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->dropIndex(['city', 'name']);
        });
    }
};`,
          after: ['MySQL 8 adds an index to a live InnoDB table **online**: reads and writes continue while it builds, a few seconds for 21,000 rows. Scene 44 covers the changes that are *not* online, which is where migrations go wrong.'],
        },
        {
          table: [
            ['table', 'type', 'key', 'rows', 'Extra'],
            ['properties', 'ref', 'properties_city_name_index', '1,210', 'Using where'],
          ],
          after: ['**ref** on the new index, no filesort, and MySQL stops reading after the first 50 matches. Per search: about 120 rows read instead of 21,384.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: reads go to a replica, decisions stay on the primary',
      text: [
        'Even fast searches are 400 queries a second that have nothing to do with taking bookings. A **read replica** is a second MySQL server that copies every change from the primary, usually within a second, and can answer `SELECT`s. Laravel sends reads there and writes to the primary when the connection has a `read` and a `write` host.',
        'In `config/database.php`, replace the `mysql` entry inside `connections` with this one. The other connections stay as they are:',
      ],
      blocks: [
        {
          path: 'config/database.php (the mysql entry under connections)',
          fragment: true,
          code: String.raw`'mysql' => [
    'driver' => 'mysql',
    'read' => [
        'host' => [env('DB_READ_HOST', env('DB_HOST', '127.0.0.1'))],  // the replica; locally the same server
    ],
    'write' => [
        'host' => [env('DB_HOST', '127.0.0.1')],                         // the primary
    ],
    'sticky' => true,                       // after a write, the same request keeps reading from the primary
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'laravel'),
    'username' => env('DB_USERNAME', 'root'),
    'password' => env('DB_PASSWORD', ''),
    'unix_socket' => env('DB_SOCKET', ''),
    'charset' => env('DB_CHARSET', 'utf8mb4'),
    'collation' => env('DB_COLLATION', 'utf8mb4_unicode_ci'),
    'prefix' => '',
    'prefix_indexes' => true,
    'strict' => true,
    'engine' => null,
    'options' => extension_loaded('pdo_mysql') ? array_filter([
        PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
    ]) : [],
],`,
        },
        {
          path: '.env (production)',
          lang: 'env',
          code: String.raw`DB_HOST=pms-primary.internal
DB_READ_HOST=pms-replica-1.internal`,
        },
        {
          title: 'Which queries must still read the primary',
          text: ['A replica is a little behind. That is fine for a search (a hint, scene 31) and wrong for anything that decides. Laravel already sends these to the primary, and the table says why each one is safe:'],
          table: [
            ['Query', 'Reads from', 'Why'],
            ['Search, quote page, properties page', 'replica', 'A second-old view is fine; the booking checks again'],
            ['The availability check in `CreateBooking`, `ChangeBookingDates`, `MoveBooking`', '**primary**', 'They run inside `DB::transaction()`: Laravel uses the write connection for every query of an open transaction'],
            ['`lockForUpdate()` reads', '**primary**', 'Always inside those transactions; a lock on a replica would lock nothing'],
            ['A read in the same request after a write', '**primary**', '`sticky: true`: the host who just saved a price sees it at once'],
            ['Queue jobs (webhooks, imports, sends)', '**primary**', 'A job runs seconds after another process wrote the row it needs: a Stripe webhook looks up the payment before any transaction (scene 8). On a lagging replica that row is missing or old. Workers read from the primary, set below'],
          ],
          after: ['For the rare read in a web request that must be fresh outside a transaction, ask for it: `Booking::query()->useWritePdo()->find($id)`.'],
        },
        {
          title: 'Queue workers read from the primary',
          text: ['`sticky` only helps the process that wrote. A worker is another process, so it gets no help from it. The workers’ reads are a small share of the load, so they simply skip the replica:'],
          path: 'app/Providers/AppServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use App\Channels\ChannelManager;
use App\Enums\MembershipRole;
use App\Http\Controllers\QuoteController;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;
use App\Payments\PaymentGateway;
use App\Payments\StripeGateway;
use App\Pricing\CachedNightlyRates;
use App\Pricing\NightlyPrices;
use App\Pricing\NightlyRates;
use App\Pricing\PriceQuoter;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Stripe\StripeClient;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Workers decide right after another process wrote (a payment, a reservation): a replica may not have that
        // row yet, so queue workers read from the primary. Web requests keep the replica (scene 42).
        if ($this->app->runningConsoleCommand('horizon:work', 'queue:work')) {
            config(['database.connections.mysql.read' => config('database.connections.mysql.write')]);
        }

        $this->app->singleton(StripeClient::class, fn (): StripeClient => new StripeClient([
            'api_key' => config('services.stripe.secret'),
            'stripe_version' => config('services.stripe.version'),    // pinned: a Stripe release can't change responses
            'max_network_retries' => 2,
        ]));

        $this->app->bind(PaymentGateway::class, StripeGateway::class);

        $this->app->singleton(ChannelManager::class);                  // one manager: each driver is built once per process

        $this->app->bind(NightlyPrices::class, NightlyRates::class);    // the truth, from the database: bookings, changes, refunds

        $this->app->when(QuoteController::class)                         // the one place that may show a cached price
            ->needs(PriceQuoter::class)
            ->give(fn (Application $app): PriceQuoter => new PriceQuoter($app->make(CachedNightlyRates::class)));
    }

    public function boot(): void
    {
        Date::use(CarbonImmutable::class);                        // every date Laravel creates is immutable (scene 1)
        Model::shouldBeStrict(! $this->app->isProduction());     // lazy loading, unknown and unfillable attributes throw

        if ($this->app->isProduction()) {
            Model::preventLazyLoading();                          // detect it in production too, but don't throw:
            Model::handleLazyLoadingViolationUsing(function (Model $model, string $relation): void {
                Log::warning('Lazy loading', ['model' => $model::class, 'relation' => $relation, 'url' => request()->fullUrl()]);
            });
        }

        // An account's owner may do everything in that account. null = "no opinion, ask the policy".
        Gate::before(function (User $user, string $ability, array $arguments): ?bool {
            $accountId = match (true) {
                ($arguments[0] ?? null) instanceof Booking => $arguments[0]->property->account_id,
                ($arguments[0] ?? null) instanceof Property => $arguments[0]->account_id,
                ($arguments[0] ?? null) instanceof Account => $arguments[0]->id,
                default => null,
            };

            return $accountId !== null && $user->roleIn($accountId) === MembershipRole::Owner ? true : null;
        });

        // throttle:api. An integration token has its own budget; our web and mobile apps share one per user.
        RateLimiter::for('api', function (Request $request): Limit {
            $token = $request->user()?->currentAccessToken();

            if ($token instanceof PersonalAccessToken && ! $token->can('*')) {
                return Limit::perMinute(60)->by("token:{$token->id}");
            }

            return Limit::perMinute(300)->by((string) ($request->user()?->id ?? $request->ip()));
        });
    }
}`,
          after: ['`register()` runs before the first query opens a connection, so the change applies to the whole worker process. With `config:cache` the `.env` can’t be overridden per process, which is why this lives in code. Horizon starts each worker as `horizon:work`; a plain `queue:work` is covered too.'],
        },
        {
          table: [
            ['Run', 'p50', 'p95', 'p99', 'Primary CPU'],
            ['Before', '1.9 s', '6.4 s', '8.6 s', '97%'],
            ['Index', '38 ms', '95 ms', '210 ms', '41%'],
            ['Index + replica', '31 ms', '70 ms', '140 ms', '12%'],
          ],
          after: ['The same k6 run, with both fixes, passes its thresholds with room to spare, and the primary has its CPU back for bookings. The k6 script runs again before every peak season, against staging, so the next missing index shows up in a test instead of on a busy Sunday.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'The search query uses the index and never sorts by hand',
    blocks: [
      {
        path: 'tests/Feature/SearchQueryPlanTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

it('finds the properties of a city through the index, already sorted', function () {
    Property::factory()->count(30)->create(['city' => 'Copenhagen']);
    Property::factory()->count(30)->create(['city' => 'Aarhus']);
    DB::statement('ANALYZE TABLE properties');                                  // fresh statistics, like a production table has

    $search = Property::query()
        ->where('city', 'Copenhagen')
        ->where('max_guests', '>=', 4)
        ->availableFor(Stay::fromDates('2027-07-12', '2027-07-19'))
        ->orderBy('name')
        ->limit(50);

    $plan = collect(DB::select('EXPLAIN ' . $search->toRawSql()))->firstWhere('table', 'properties');

    expect($plan->key)->toBe('properties_city_name_index')
        ->and($plan->Extra ?? '')->not->toContain('filesort');                 // the incident: no full scan, no sort by hand
});`,
        after: ['This test reads MySQL’s plan on purpose. With 60 rows MySQL could still choose a full scan; `ANALYZE TABLE` gives it real statistics so it picks what production picks. If someone drops the index or changes the query so the index can’t serve it, this test fails long before the next busy Sunday.'],
      },
    ],
  },
  followups: [
    {
      id: 'stampede',
      title: 'Follow-up, the same evening: a spike every five minutes',
      text: ['With the index and the replica in place, p99 fell to 140 ms. Then the graph grew teeth.'],
      incident: {
        channel: '#incidents',
        when: 'Sunday 21:10',
        messages: [
          ['Monitoring', '**p99 = 3.1 s at 20:55:00, 21:00:00 and 21:05:00**, for about 15 seconds each time. In between: 140 ms. Replica CPU 100% during each spike.'],
          ['Karim · developer', 'Exactly every five minutes, on the minute. That’s a TTL. The front page’s “Free this weekend” block is cached for 300 seconds.'],
        ],
      },
      sections: [
        {
          title: 'The broken code',
          text: ['The guest site’s front page shows the ten cities with the most free cottages next weekend. Counting them runs the availability rule (scene 31) over every property, about 2.5 seconds on the replica, so the answer is cached:'],
          blocks: [
            {
              path: 'app/Http/Controllers/PopularDestinationsController.php',
              broken: true,
              code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class PopularDestinationsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json(['data' => Cache::remember('popular-destinations', 300, fn (): array => $this->compute())]);   // the bug: every request that misses computes
    }

    /** @return list<array{city: string, free: int}> the ten cities with the most free properties next weekend */
    private function compute(): array
    {
        $friday = CarbonImmutable::now()->next(CarbonImmutable::FRIDAY);
        $weekend = Stay::fromDates($friday->toDateString(), $friday->addDays(2)->toDateString());

        return Property::query()
            ->availableFor($weekend)
            ->selectRaw('city, count(*) as free')
            ->groupBy('city')
            ->orderByDesc('free')
            ->limit(10)
            ->get()
            ->map(fn (Property $row): array => ['city' => $row->city, 'free' => (int) $row->free])
            ->all();
    }
}`,
              after: [
                'At 400 requests a second, the key expires at 21:00:00, and every request in the next 2.5 seconds misses, because the first one hasn’t finished computing yet. That is about **1,000 identical 2.5-second queries** started in the same few seconds, on a replica with 16 cores. The queries queue, take longer, and more requests miss while they do. That is a **cache stampede**: the cache protects the database until the moment it expires, and then it sends it everything at once.',
              ],
            },
          ],
        },
        {
          title: 'The options',
          blocks: [
            {
              table: [
                ['Technique', 'How', 'Fits when'],
                ['**Stale-while-revalidate**', 'After the fresh period, keep serving the old value; one request refreshes it in the background', 'A slightly old answer is fine: this block, a listing page'],
                ['A lock around the rebuild', 'The first miss computes under `Cache::lock()`; the others wait for it, or get a fallback', 'There is no old value to serve (a cold cache), or it must be fresh'],
                ['Probabilistic early expiry', 'Each request refreshes early with a small, rising chance as the TTL ends', 'Many keys, no lock service; Laravel has no helper for it'],
                ['Jittered TTLs', 'A random few seconds on each TTL', 'Many keys written at the same moment, so they don’t all expire together'],
              ],
              after: ['One hot key that may be a few minutes old: stale-while-revalidate. Laravel has it built in as `Cache::flexible()`.'],
            },
          ],
        },
        {
          title: 'The fix: Cache::flexible()',
          blocks: [
            {
              path: 'app/Http/Controllers/PopularDestinationsController.php',
              code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class PopularDestinationsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        // Fresh for 5 minutes. From 5 to 15 minutes old it is still served, and one refresh runs after the response.
        $destinations = Cache::flexible('popular-destinations', [300, 900], fn (): array => $this->compute());

        return response()->json(['data' => $destinations]);
    }

    /** @return list<array{city: string, free: int}> the ten cities with the most free properties next weekend */
    private function compute(): array
    {
        $friday = CarbonImmutable::now()->next(CarbonImmutable::FRIDAY);
        $weekend = Stay::fromDates($friday->toDateString(), $friday->addDays(2)->toDateString());

        return Property::query()
            ->availableFor($weekend)
            ->selectRaw('city, count(*) as free')
            ->groupBy('city')
            ->orderByDesc('free')
            ->limit(10)
            ->get()
            ->map(fn (Property $row): array => ['city' => $row->city, 'free' => (int) $row->free])
            ->all();
    }
}`,
              after: [
                'What `flexible()` does: it stores the value with the time it was computed. Younger than 300 seconds, it returns it. Between 300 and 900, it returns it **and** registers a deferred refresh, which runs after the response has been sent, under a cache lock, so a thousand stale hits start one refresh, not a thousand. Older than 900, or missing, it computes like `remember()`.',
                'That last case is the one `flexible()` can’t help with: a **cold** key. Ours lives on the cache Redis (scene 35), where LRU keeps hot keys, and deploys don’t clear the cache (scene 45). Clearing it by hand at peak would bring the stampede back for one round; `php artisan cache:clear` is not a deploy step.',
              ],
            },
          ],
        },
      ],
      tests: {
        summary: 'A stale value is served while one refresh runs',
        blocks: [
          {
            path: 'tests/Feature/PopularDestinationsTest.php',
            code: String.raw`<?php

use App\Models\Property;

it('serves the old answer while it refreshes, then the new one', function () {
    $this->withoutDefer();                                                      // run the after-response refresh right away
    Property::factory()->count(2)->create(['city' => 'Skagen']);

    $this->getJson('/api/v1/popular-destinations')->assertJsonPath('data.0.free', 2);

    Property::factory()->create(['city' => 'Skagen']);
    $this->travel(6)->minutes();                                                // stale, not expired

    $this->getJson('/api/v1/popular-destinations')->assertJsonPath('data.0.free', 2);   // the old answer, at once
    $this->getJson('/api/v1/popular-destinations')->assertJsonPath('data.0.free', 3);   // refreshed by the request before
});`,
            after: ['Mutation: back to `remember(…, 300, …)` and the second request computes in the request (3 instead of 2): correct here, and exactly the behaviour that made a thousand requests compute at once in production.'],
          },
        ],
      },
    },
    {
      id: 'cdn',
      title: 'Follow-up, from the postmortem: most of Sunday never needed PHP',
      text: ['Monday’s postmortem looked at what the 400 requests a second actually were.'],
      incident: {
        channel: '#postmortem',
        when: 'Monday 09:00',
        messages: [
          ['Sara · tech lead', 'Action 3 from Sunday. **71%** of requests were guests reading things that are the same for every guest: listing pages and the front page. Each one went through nginx, PHP and MySQL. Put them behind the CDN, and make sure a host’s edit shows up within a minute.'],
        ],
      },
      sections: [
        {
          title: 'HTTP caching in three headers',
          blocks: [
            {
              table: [
                ['Header', 'Says', 'Ours'],
                ['`Cache-Control: public, max-age=60`', 'Browsers may reuse it for 60 s', 'A guest clicking back and forth costs nothing'],
                ['`s-maxage=300, stale-while-revalidate=600`', 'Shared caches (the CDN) may keep it 5 min, and serve it 10 min longer while they refetch', 'The CDN’s version of the stampede fix: no stampede on the origin either'],
                ['`ETag: "5d41…"`', 'A fingerprint of the body', 'A client that has it sends `If-None-Match`; if nothing changed we answer **304** with no body'],
              ],
              after: ['Only for responses that are the same for everyone. A response that depends on who is asking (a host’s bookings, a quote with a logged-in discount) must never get `public`: the CDN would hand one person’s page to the next. Those routes keep Laravel’s default, `Cache-Control: no-cache, private`.'],
            },
          ],
        },
        {
          title: 'The fix, part 1: Laravel’s cache.headers middleware',
          text: ['Laravel ships the middleware: `cache.headers` sets `Cache-Control`, computes the `ETag` from the body, and answers 304 itself when the client’s `If-None-Match` matches. The listing endpoint the guest site calls, and the front-page block, get it as a group:'],
          blocks: [
            {
              path: 'app/Http/Controllers/ListingController.php',
              code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Property;
use Illuminate\Http\JsonResponse;

/** The public listing page's data: the same for every guest, so the CDN may keep it. */
class ListingController extends Controller
{
    public function __invoke(Property $property): JsonResponse
    {
        return response()->json(['data' => [
            'id' => $property->id,
            'name' => $property->name,
            'city' => $property->city,
            'max_guests' => $property->max_guests,
            'min_nights' => $property->min_nights,                   // the default; date rules come with the quote
            'check_in_time' => $property->check_in_time,
        ]]);                                                          // no prices: those come from the quote, never from the CDN
    }
}`,
              after: ['Until now the guest site read these fields from the search results; it calls this endpoint for the listing page from today.'],
            },
            {
              path: 'routes/api.php',
              code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\BookingChangesController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CalendarRulesController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\ExportController;
use App\Http\Controllers\ListingController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\PopularDestinationsController;
use App\Http\Controllers\PropertyController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Controllers\V2\BookingChangesController as BookingChangesV2Controller;
use App\Http\Middleware\Deprecated;
use App\Http\Middleware\Idempotent;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Public and the same for every guest: the CDN may keep a copy (scene 42). Never on a route that knows who is asking.
Route::middleware('cache.headers:public;max_age=60;s_maxage=300;stale_while_revalidate=600;etag')->group(function (): void {
    Route::get('/v1/listings/{property}', ListingController::class);         // purged when the host edits the listing
    Route::get('/v1/popular-destinations', PopularDestinationsController::class);
});

// Everything a host does: logged in, inside one current account, limited per token, every id checked by a policy,
// and each route names what an integration token must be allowed to do (scene 39). Retries are answered once.
Route::middleware(['auth:sanctum', 'throttle:api', SetCurrentAccount::class, Idempotent::class])->prefix('v1')->group(function (): void {
    Route::get('/properties', [PropertyController::class, 'index'])->middleware('token-can:properties:read');             // the current account's properties
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property')->middleware('token-can:bookings:write');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property')->middleware('token-can:properties:write');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property')->middleware('token-can:calendar:write');
    Route::put('/properties/{property}/calendar-rules', CalendarRulesController::class)->can('update', 'property')->middleware('token-can:calendar:write');

    Route::get('/bookings', [BookingController::class, 'index'])->middleware('token-can:bookings:read');
    Route::get('/bookings/changes', BookingChangesController::class)               // before {booking}: "changes" is not an id
        ->middleware(['token-can:bookings:read', Deprecated::class . ':2027-06-03,2027-12-01,/api/v2/bookings/changes']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking')->middleware('token-can:bookings:read');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::get('/bookings/{booking}/messages', [ConversationController::class, 'index'])->can('update', 'booking')->middleware('token-can:messages:read');   // owners and co-hosts: not cleaners
    Route::post('/bookings/{booking}/messages', [ConversationController::class, 'store'])->can('update', 'booking')->middleware('token-can:messages:write');

    Route::post('/members', [AccountMemberController::class, 'store'])->middleware('token-can:team:write');         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy'])->middleware('token-can:team:write');

    Route::post('/message-templates', [MessageTemplateController::class, 'store'])->middleware('token-can:templates:write');

    Route::get('/exports/{type}', ExportController::class)->middleware('token-can:reports:read');                    // payouts, occupancy, tax; owners only (the controller checks)

    Route::post('/api-tokens', [ApiTokenController::class, 'store'])->middleware('token-can:*');            // a limited token can't mint tokens
    Route::delete('/api-tokens/{tokenId}', [ApiTokenController::class, 'destroy'])->middleware('token-can:*');
});

// v2: only what changed in a breaking way. Everything else stays on v1, which is not going away.
Route::middleware(['auth:sanctum', 'throttle:api', SetCurrentAccount::class])->prefix('v2')->group(function (): void {
    Route::get('/bookings/changes', BookingChangesV2Controller::class)->middleware('token-can:bookings:read');
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
// No throttle here: a burst of webhooks after a channel outage must all be stored (scene 8).
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
            },
          ],
        },
        {
          title: 'The fix, part 2: a host’s edit purges the CDN’s copy',
          text: [
            'Five minutes of a stale description is fine; five minutes of an old check-in time is a support ticket. So when a property changes, after the transaction commits, a queued job tells the CDN to drop that one URL. The next guest’s request goes to the origin, and the CDN keeps the new version.',
          ],
          blocks: [
            {
              path: 'app/Observers/ListingCacheObserver.php',
              code: String.raw`<?php

namespace App\Observers;

use App\Jobs\PurgeCdn;
use App\Models\Property;
use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;

/** A listing changed: the CDN's copy of its page must go. After commit, so the CDN never refetches the old row. */
final class ListingCacheObserver implements ShouldHandleEventsAfterCommit
{
    public function saved(Property $property): void
    {
        PurgeCdn::dispatch(url("/api/v1/listings/{$property->id}"));
    }
}`,
            },
            {
              path: 'app/Jobs/PurgeCdn.php',
              code: String.raw`<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

/** Drops one URL from every CDN edge (Cloudflare's purge API; other CDNs have the same call). */
class PurgeCdn implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public string $url)
    {
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [10, 30, 60, 120];
    }

    public function handle(): void
    {
        Http::withToken(config('services.cdn.token'))
            ->timeout(10)
            ->post('https://api.cloudflare.com/client/v4/zones/' . config('services.cdn.zone') . '/purge_cache', [
                'files' => [$this->url],
            ])
            ->throw();                                                // a failed purge is retried, never ignored
    }
}`,
              after: ['If every try fails, the page is stale for at most `s-maxage` plus `stale-while-revalidate`: 15 minutes, never forever. That bound is why the TTLs are short even with purging.'],
            },
            {
              path: 'app/Models/Property.php',
              code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Enums\BookingStatus;
use App\Enums\CancellationPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use App\Observers\ListingCacheObserver;
use App\Observers\PriceChangeObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[ObservedBy([PriceChangeObserver::class, ListingCacheObserver::class])]   // new prices: a new cache version; any edit: purge the CDN copy
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

    /**
     * Properties where every night of $stay is free: no pending or confirmed booking, no block from a channel.
     * $ignoring: the booking being changed, which never blocks its own new dates.
     */
    public function scopeAvailableFor(Builder $query, Stay $stay, ?Booking $ignoring = null): void
    {
        $query
            ->whereDoesntHave('bookings', function (Builder $bookings) use ($stay, $ignoring): void {
                $bookings->overlapping($stay);
                if ($ignoring !== null) {
                    $bookings->whereKeyNot($ignoring->id);
                }
            })
            ->whereDoesntHave('externalBlocks', fn (Builder $blocks) => $blocks->overlapping($stay));
    }

    /** Null when the stay is long enough, or the message to show the guest. */
    public function stayTooShort(Stay $stay): ?string
    {
        $minNights = $this->minNightsOn($stay->checkIn);

        return $stay->nights() < $minNights
            ? "Stays arriving on {$stay->checkIn->toDateString()} must be {$minNights} nights or more."
            : null;
    }

    /** The minimum for stays that arrive on this date: the date's own rule, or the property's default. */
    public function minNightsOn(CarbonImmutable $arrival): int
    {
        $rule = $this->calendarDays()
            ->where('date', $arrival->toDateString())                     // a plain comparison: whereDate() would wrap the column in DATE() and skip the index
            ->value('min_nights');

        return $rule ?? $this->min_nights;
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function ratePlan(): BelongsTo
    {
        return $this->belongsTo(RatePlan::class);                      // shared: several listings can use one plan
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    /** The earliest upcoming pending or confirmed booking: one row per property, even when eager loaded. */
    public function nextStay(): HasOne
    {
        return $this->hasOne(Booking::class)->ofMany(
            ['check_in' => 'min'],                                     // the earliest check-in wins (ties: the lowest id)
            fn (Builder $query) => $query
                ->whereIn('status', BookingStatus::blocking())
                ->where('check_in', '>=', today()->toDateString()),
        );
    }

    public function cleaningTasks(): HasMany
    {
        return $this->hasMany(CleaningTask::class);
    }

    public function icalFeeds(): HasMany
    {
        return $this->hasMany(IcalFeed::class);
    }

    public function externalBlocks(): HasMany
    {
        return $this->hasMany(ExternalBlock::class);
    }

    public function channelListings(): HasMany
    {
        return $this->hasMany(ChannelListing::class);
    }

    public function calendarDays(): HasMany
    {
        return $this->hasMany(CalendarDay::class);
    }
}`,
            },
            {
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

    'sms' => [
        'url' => env('SMS_API_URL'),                          // your SMS provider's "send message" endpoint
        'token' => env('SMS_API_TOKEN'),
        'from' => env('SMS_FROM', 'NordicStays'),             // the sender name guests see
    ],

    'whatsapp' => [
        'token' => env('WHATSAPP_TOKEN'),
        'api_version' => env('WHATSAPP_API_VERSION', 'v21.0'),
        'phone_number_id' => env('WHATSAPP_PHONE_NUMBER_ID'),   // the business number, from Meta's dashboard
        'business_account_id' => env('WHATSAPP_BUSINESS_ACCOUNT_ID'),   // where templates are submitted and approved
    ],

    'cdn' => [
        'zone' => env('CDN_ZONE_ID'),                         // the zone in front of nordicstays.dk
        'token' => env('CDN_API_TOKEN'),                      // an API token allowed to purge that zone, nothing else
    ],

];`,
            },
          ],
        },
        {
          title: 'Monday evening, with the CDN in front',
          blocks: [
            {
              table: [
                ['', 'Before', 'After'],
                ['Requests reaching PHP', '400/s', '115/s'],
                ['CDN hit rate on listings', '—', '94%'],
                ['A host’s edit visible to guests', 'at once', 'within seconds (purge), at most 15 min if the purge fails'],
              ],
            },
          ],
        },
      ],
      tests: {
        summary: 'Public pages carry cache headers and answer 304, private ones don’t, and an edit purges the CDN',
        blocks: [
          {
            path: 'tests/Feature/CdnTest.php',
            code: String.raw`<?php

use App\Jobs\PurgeCdn;
use App\Models\Property;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

it('lets the CDN keep a listing, and answers 304 when it hasn’t changed', function () {
    $cottage = Property::factory()->create();

    $first = $this->getJson("/api/v1/listings/{$cottage->id}")
        ->assertOk()
        ->assertHeader('Cache-Control', 'max-age=60, public, s-maxage=300, stale-while-revalidate=600');

    $this->getJson("/api/v1/listings/{$cottage->id}", ['If-None-Match' => $first->headers->get('ETag')])
        ->assertStatus(304);
});

it('never marks a host’s own data as public', function () {
    $host = hostOf(Property::factory()->create());

    $cacheControl = $this->actingAs($host)->getJson('/api/v1/bookings')->headers->get('Cache-Control');

    expect($cacheControl)->not->toContain('public');
});

it('purges the listing from the CDN after an edit commits', function () {
    $cottage = Property::factory()->create();
    Queue::fake();                                                             // from here on: only what the edit dispatches

    $cottage->update(['name' => 'Skagen cottage, sea view']);

    Queue::assertPushed(PurgeCdn::class, fn (PurgeCdn $job): bool => $job->url === url("/api/v1/listings/{$cottage->id}"));
});

it('sends the URL to the CDN, and fails loudly when the CDN refuses', function () {
    config(['services.cdn' => ['zone' => 'z1', 'token' => 't']]);
    Http::fake(['api.cloudflare.com/*' => Http::sequence()->push(['success' => true])->push(['success' => false], 403)]);

    (new PurgeCdn('https://nordicstays.dk/api/v1/listings/7'))->handle();
    Http::assertSent(fn (Request $request): bool => $request['files'] === ['https://nordicstays.dk/api/v1/listings/7']);

    expect(fn () => (new PurgeCdn('https://nordicstays.dk/api/v1/listings/7'))->handle())->toThrow(Illuminate\Http\Client\RequestException::class);
});`,
            after: ['Mutations: remove `ShouldHandleEventsAfterCommit` and nothing here fails, because `RefreshDatabase` commits nothing; scene 35 explains why the after-commit rule holds anyway and how its test proves it. Remove `->throw()` and the last test fails: a refused purge would have been silent.'],
          },
        ],
      },
    },
  ],
  next: 'Search is fast again, the front page no longer stampedes, and most guests never reach PHP. Next, Hygge Homes asks for search by "sea view" and typos, search moves to Meilisearch, and one restart takes search down for ten minutes.',
};
