// Scene 43 · Repository: one way to ask for properties, two stores that can answer, and a fallback when one is down.

export default {
  description: 'Search went down for ten minutes when Meilisearch restarted: the controller called Meilisearch directly, so its outage was search’s outage. Fix it in Laravel with a property repository: one interface, a Meilisearch and an Eloquent implementation that pass the same contract tests, and an action that falls back to the database while Meilisearch is unavailable.',
  incident: {
    channel: '#incidents',
    when: 'Monday 10:20',
    messages: [
      ['Monitoring', '**/api/v1/search: 100% errors** for 10 minutes · `Meilisearch\\Exceptions\\CommunicationException: Connection refused`'],
      ['Karim · developer', 'The Meilisearch server was restarted for its monthly update. It took ten minutes to load the index again, and every search on the site returned a 500 meanwhile.'],
      ['Sara · tech lead', 'The database had every property the whole time. Search had no way to use it.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature',
      text: [
        'Hygge Homes asked for search by words: “sea view”, “sauna”, and with typos, “sauana”. SQL is poor at that (scene 31 said when it stops being enough), so search moved to **Meilisearch**, through Laravel Scout. Hosts now write a description for each property, and Scout keeps a copy of every property in a Meilisearch index.',
      ],
      blocks: [
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`composer require laravel/scout meilisearch/meilisearch-php http-interop/http-factory-guzzle
php artisan vendor:publish --provider="Laravel\Scout\ScoutServiceProvider"   # creates config/scout.php`,
        },
        {
          path: 'compose.yaml',
          lang: 'yaml',
          code: String.raw`services:
  app:
    build: docker/app
    volumes: ['.:/var/www/html']
    ports: ['8000:8000']
    command: php artisan serve --host=0.0.0.0 --port=8000
    depends_on:
      mysql: { condition: service_healthy }
      redis: { condition: service_healthy }
      redis-cache: { condition: service_healthy }
      meilisearch: { condition: service_healthy }

  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: pms
    ports: ['3306:3306']
    volumes:
      - mysql-data:/var/lib/mysql
      - ./docker/mysql/create-test-db.sql:/docker-entrypoint-initdb.d/01-test-db.sql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-psecret']
      interval: 5s

  redis:
    image: redis:7.4
    command: redis-server --appendonly yes --maxmemory-policy noeviction     # queues, sessions, locks: never evicted
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s

  redis-cache:
    image: redis:7.4
    command: redis-server --port 6380 --maxmemory 256mb --maxmemory-policy allkeys-lru --save ''
    healthcheck:
      test: ['CMD', 'redis-cli', '-p', '6380', 'ping']
      interval: 5s

  meilisearch:
    image: getmeili/meilisearch:v1.11
    environment:
      MEILI_MASTER_KEY: change-me-to-a-long-random-key
      MEILI_NO_ANALYTICS: 'true'
    ports: ['7700:7700']
    volumes:
      - meili-data:/meili_data             # the index survives a restart; rebuilding it takes minutes
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:7700/health']
      interval: 5s

volumes:
  mysql-data:
  meili-data:`,
        },
        {
          path: '.env',
          lang: 'env',
          code: String.raw`SCOUT_DRIVER=meilisearch
SCOUT_QUEUE=true                     # index changes are queued jobs, never part of the request
MEILISEARCH_HOST=http://meilisearch:7700
MEILISEARCH_KEY=change-me-to-a-long-random-key`,
        },
        {
          text: ['In `config/scout.php`, set `after_commit` and the Meilisearch index settings. The rest of the file stays as published:'],
          path: 'config/scout.php (after_commit and the meilisearch entry)',
          fragment: true,
          code: String.raw`'after_commit' => true,                    // index a property only once its change has committed

'meilisearch' => [
    'host' => env('MEILISEARCH_HOST', 'http://localhost:7700'),
    'key' => env('MEILISEARCH_KEY'),
    'index-settings' => [
        App\Models\Property::class => [
            'filterableAttributes' => ['city', 'max_guests'],   // Meilisearch only filters on what it is told about
        ],
    ],
],`,
        },
        {
          path: 'database/migrations/2026_05_05_000001_add_description_to_properties_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->text('description')->nullable();                    // the host's own words: "sea view, sauna, 5 min to the beach"
        });
    }
};`,
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
use Laravel\Scout\Searchable;

#[ObservedBy([PriceChangeObserver::class, ListingCacheObserver::class])]   // new prices: a new cache version; any edit: purge the CDN copy
class Property extends Model
{
    use HasFactory, Searchable;

    protected $fillable = [
        'name', 'city', 'country', 'timezone', 'check_in_time', 'check_out_time',
        'max_guests', 'nightly_rate_cents', 'cleaning_fee_cents', 'currency', 'description',
    ];

    protected function casts(): array
    {
        return [
            'nightly_rate' => MoneyCast::class . ':nightly_rate_cents',   // Money from nightly_rate_cents + currency
            'cancellation_policy' => CancellationPolicy::class,          // the terms for new bookings
        ];
    }

    /** What Meilisearch stores for each property: only what search needs. @return array<string, string|int|null> */
    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'city' => $this->city,
            'max_guests' => $this->max_guests,
            'description' => $this->description,
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
          path: 'terminal',
          lang: 'shell',
          code: String.raw`php artisan scout:sync-index-settings          # send the filterable attributes to Meilisearch
php artisan scout:import "App\Models\Property"   # index every existing property, in chunks`,
        },
      ],
    },
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/SearchController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Models\Property;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Meilisearch\Endpoints\Indexes;

class SearchController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'city' => ['required', 'string', 'max:80'],
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', 'max:30'],
        ]);
        $stay = Stay::fromDates($data['check_in'], $data['check_out']);

        $properties = Property::search($data['q'] ?? '', function (Indexes $index, string $query, array $options) use ($data): array {
            $options['filter'] = sprintf('city = "%s" AND max_guests >= %d', addcslashes($data['city'], '"\\'), $data['guests']);
            $options['limit'] = 200;

            return $index->search($query, $options)->toArray();         // the bug: Meilisearch is the only way to search
        })
            ->query(fn (Builder $query) => $query->availableFor($stay))  // availability still from MySQL (scene 31)
            ->get()
            ->take(50);

        return response()->json(['data' => $properties->map->only(['id', 'name', 'city', 'max_guests'])->values()]);
    }
}`,
          after: [
            'Nothing here is wrong while Meilisearch answers. But the controller knows exactly one place properties can come from, so when Meilisearch is unreachable, `Property::search()` throws, the request fails, and every guest gets a 500.',
            'Meilisearch will be unreachable sometimes: updates, a restart after running out of memory, a full disk, a network blip. Ten minutes a month is 99.98% uptime, and still ten minutes of no search at all.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one question, asked the same way of any store',
      text: [
        'What the controller needs is "the properties matching these criteria". **Where** they come from is a separate decision. An interface says what can be asked; each store gets a class that answers it.',
      ],
      blocks: [
        {
          path: 'app/Properties/SearchCriteria.php',
          code: String.raw`<?php

namespace App\Properties;

use App\Bookings\Stay;

final readonly class SearchCriteria
{
    public function __construct(
        public string $city,
        public Stay $stay,
        public int $guests,
        public ?string $text = null,                                   // "sea view", optional
        public int $limit = 50,
    ) {
    }
}`,
        },
        {
          path: 'app/Properties/PropertyRepository.php',
          code: String.raw`<?php

namespace App\Properties;

use App\Models\Property;
use Illuminate\Support\Collection;

interface PropertyRepository
{
    /**
     * Properties in the city, for at least that many guests, free for every night of the stay,
     * best matches for the text first. Availability always comes from MySQL.
     *
     * @return Collection<int, Property>
     */
    public function search(SearchCriteria $criteria): Collection;
}`,
        },
        {
          title: 'Meilisearch: words and typos, then availability from MySQL',
          path: 'app/Properties/MeilisearchPropertyRepository.php',
          code: String.raw`<?php

namespace App\Properties;

use App\Models\Property;
use Illuminate\Support\Collection;
use Meilisearch\Endpoints\Indexes;

final class MeilisearchPropertyRepository implements PropertyRepository
{
    public function search(SearchCriteria $criteria): Collection
    {
        $ids = Property::search($criteria->text ?? '', function (Indexes $index, string $query, array $options) use ($criteria): array {
            $options['filter'] = sprintf('city = "%s" AND max_guests >= %d', addcslashes($criteria->city, '"\\'), $criteria->guests);
            $options['limit'] = 200;                                    // enough candidates after the taken ones drop out

            return $index->search($query, $options)->toArray();
        })->keys();                                                     // ids only, in Meilisearch's order: best match first

        $rank = $ids->flip();                                           // id => position

        return Property::query()
            ->whereKey($ids)
            ->availableFor($criteria->stay)                            // the one availability rule (scene 31), from MySQL
            ->get(['id', 'name', 'city', 'max_guests'])
            ->sortBy(fn (Property $property): int => $rank[$property->id])
            ->take($criteria->limit)
            ->values();
    }
}`,
          after: ['The index never decides availability: it only knows what was true when a property was last indexed (seconds ago, or longer while Meilisearch is catching up). It narrows 21,000 properties to 200 good matches; MySQL decides which of them are free.'],
        },
        {
          title: 'Eloquent: the SQL search from scenes 31 and 42',
          path: 'app/Properties/EloquentPropertyRepository.php',
          code: String.raw`<?php

namespace App\Properties;

use App\Models\Property;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

final class EloquentPropertyRepository implements PropertyRepository
{
    public function search(SearchCriteria $criteria): Collection
    {
        return Property::query()
            ->where('city', $criteria->city)                            // the (city, name) index from scene 42
            ->where('max_guests', '>=', $criteria->guests)
            ->when($criteria->text, fn (Builder $query, string $text) => $query->where(
                fn (Builder $words) => $words->where('name', 'like', "%{$text}%")->orWhere('description', 'like', "%{$text}%"),
            ))
            ->availableFor($criteria->stay)
            ->orderBy('name')
            ->limit($criteria->limit)
            ->get(['id', 'name', 'city', 'max_guests']);
    }
}`,
          after: ['It finds "sea view" but not "sea veiw", and sorts by name instead of relevance. That is the trade: fewer features, always there. `LIKE` with a leading `%` can’t use an index, but it only runs over one city’s properties, which the index has already narrowed.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: try Meilisearch, fall back to the database',
      text: [
        'The action asks the primary store and, if it can’t answer, the fallback. After a failure it stops asking Meilisearch for 30 seconds: otherwise every search during an outage would first wait for a failed connection.',
      ],
      blocks: [
        {
          path: 'app/Properties/SearchProperties.php',
          code: String.raw`<?php

namespace App\Properties;

use App\Models\Property;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Meilisearch\Exceptions\ApiException;
use Meilisearch\Exceptions\CommunicationException;

final readonly class SearchProperties
{
    public const PAUSE_SECONDS = 30;

    private const PAUSED_KEY = 'search:primary-paused';

    public function __construct(
        private PropertyRepository $primary,                            // Meilisearch
        private PropertyRepository $fallback,                           // MySQL
    ) {
    }

    /** @return Collection<int, Property> */
    public function handle(SearchCriteria $criteria): Collection
    {
        if (! Cache::has(self::PAUSED_KEY)) {
            try {
                return $this->primary->search($criteria);
            } catch (CommunicationException|ApiException $e) {          // unreachable, or answering 5xx while it loads
                Cache::put(self::PAUSED_KEY, true, self::PAUSE_SECONDS);
                report($e);                                             // the team hears about it; the guest doesn't
            }
        }

        return $this->fallback->search($criteria);
    }
}`,
        },
        {
          title: 'The container decides which store is which',
          text: ['Both arguments have the same type, so the container can’t guess. One binding in `AppServiceProvider` says it. Where no search engine is configured, MySQL answers alone: Scout’s `null` driver would otherwise “succeed” with no results.'],
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
use App\Properties\EloquentPropertyRepository;
use App\Properties\MeilisearchPropertyRepository;
use App\Properties\SearchProperties;
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

        $this->app->bind(SearchProperties::class, fn (Application $app): SearchProperties => new SearchProperties(
            primary: config('scout.driver') === 'meilisearch'                // no engine configured (tests, a laptop): MySQL only
                ? $app->make(MeilisearchPropertyRepository::class)
                : $app->make(EloquentPropertyRepository::class),
            fallback: $app->make(EloquentPropertyRepository::class),
        ));
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
        },
        {
          path: 'app/Http/Controllers/SearchController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Models\Property;
use App\Properties\SearchCriteria;
use App\Properties\SearchProperties;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SearchController extends Controller
{
    public function __invoke(Request $request, SearchProperties $search): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'city' => ['required', 'string', 'max:80'],
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', 'max:30'],
        ]);

        $properties = $search->handle(new SearchCriteria(
            city: $data['city'],
            stay: Stay::fromDates($data['check_in'], $data['check_out']),
            guests: (int) $data['guests'],
            text: $data['q'] ?? null,
        ));

        return response()->json(['data' => $properties->map(fn (Property $property): array => $property->only(['id', 'name', 'city', 'max_guests']))->values()]);
    }
}`,
          after: ['The controller doesn’t know Meilisearch exists. When it is restarted next month, search answers from MySQL for those minutes, a little less clever, and nobody gets a 500.'],
        },
        {
          title: 'Tests don’t index anything unless they ask',
          text: ['With Scout installed, every saved property would be sent to Meilisearch, in every test. The `null` driver turns that off; the contract test below switches to Meilisearch for itself.'],
          path: 'phpunit.xml',
          lang: 'xml',
          code: String.raw`<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
>
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_DATABASE" value="pms_test"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="CACHE_DURABLE_DRIVER" value="array"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="MAIL_MAILER" value="array"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
        <env name="BROADCAST_CONNECTION" value="null"/>
        <env name="SCOUT_DRIVER" value="null"/>
    </php>
</phpunit>`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Repository'],
    rules: [['Repository', 'An object that gives the rest of the app a collection-like way to ask for domain objects ("properties matching these criteria") and hides which store, query or engine answers.']],
    points: [
      'The controller and the action ask a `PropertyRepository`. Meilisearch and MySQL are two answers to the same question, and the same tests prove both answer it correctly.',
      'Because both are the same type, falling back is one `try`/`catch`, and a third store (a read replica only for search, an external API) is one more class.',
      '**The Laravel debate.** Many teams wrap every model in a repository: `BookingRepository::find()`, `save()`, each with a single Eloquent implementation. In Laravel that mostly re-types what Eloquent already gives you, and hides its features (scopes, eager loading) behind a thinner API. A repository earns its place where there really are two stores, like here, or where a team must keep the domain free of the ORM (Data Mapper, on the end page).',
    ],
    whenNot: [
      'One store that will stay the only one: query it with Eloquent directly, through scopes like `availableFor()`.',
      'As a rule for every model "in case we change the database": that day rarely comes, and when it does, the queries are the hard part, not the class names.',
    ],
  },
  laravel: {
    title: 'Laravel inside: how Scout keeps the index in sync',
    text: [
      'The `Searchable` trait registers a model observer. On every `saved` and `deleted` it queues a job that sends the model’s `toSearchableArray()` to the engine. With `after_commit`, the job is held until the transaction commits, so the index never shows a property whose change rolled back. The index is updated **after** the database, which is why it can lag, and why it never decides availability.',
    ],
    blocks: [
      {
        path: 'Laravel/Scout/Searchable.php (simplified)',
        fragment: true,
        code: String.raw`public function queueMakeSearchable($models)
{
    if (! config('scout.queue')) {
        return $models->first()->makeSearchableUsing($models)->first()->searchableUsing()->update($models);
    }

    dispatch((new Scout::$makeSearchableJob($models))
        ->onQueue($models->first()->syncWithSearchUsingQueue())
        ->onConnection($models->first()->syncWithSearchUsing()));   // a queued job per batch of changed models
}`,
      },
    ],
  },
  tests: {
    summary: 'The same contract for both stores, and a fallback that answers while Meilisearch is down',
    blocks: [
      {
        path: 'tests/Feature/PropertyRepositoryTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Booking;
use App\Models\Property;
use App\Properties\EloquentPropertyRepository;
use App\Properties\MeilisearchPropertyRepository;
use App\Properties\PropertyRepository;
use App\Properties\SearchCriteria;

beforeEach(function () {
    $this->seaView = Property::factory()->create(['name' => 'Harbour loft', 'city' => 'Copenhagen', 'max_guests' => 4, 'description' => 'Sea view and a sauna']);
    $this->taken = Property::factory()->create(['name' => 'Canal flat', 'city' => 'Copenhagen', 'max_guests' => 4, 'description' => 'Sea view']);
    $this->small = Property::factory()->create(['name' => 'Attic room', 'city' => 'Copenhagen', 'max_guests' => 2, 'description' => 'Sea view']);
    Booking::factory()->for($this->taken)->forStay('2027-07-13', 2)->pending()->create();
});

dataset('stores', [
    'MySQL' => fn (): PropertyRepository => app(EloquentPropertyRepository::class),
    'Meilisearch' => function (): PropertyRepository {
        config(['scout.driver' => 'meilisearch']);
        Property::all()->searchable();                                             // index the three properties
        retry(30, fn () => expect(Property::search('')->raw()['estimatedTotalHits'])->toBe(3), 100);   // indexing is asynchronous

        return app(MeilisearchPropertyRepository::class);
    },
]);

it('finds the free properties for the guests and the words', function (Closure $store) {
    $found = $store()->search(new SearchCriteria('Copenhagen', Stay::fromDates('2027-07-12', '2027-07-15'), guests: 4, text: 'sea view'));

    expect($found->pluck('id')->all())->toBe([$this->seaView->id]);                  // not the taken one, not the small one
})->with('stores')->group('meilisearch');`,
        after: [
          'The dataset is the **contract**: whatever store answers, the result is the same. The Meilisearch case needs a running Meilisearch, so the file is in the `meilisearch` group. CI runs it with the compose service; on a laptop without one, `php artisan test --exclude-group=meilisearch` skips it.',
        ],
      },
      {
        path: 'tests/Feature/SearchFallbackTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Property;
use App\Properties\EloquentPropertyRepository;
use App\Properties\PropertyRepository;
use App\Properties\SearchCriteria;
use App\Properties\SearchProperties;
use Illuminate\Support\Collection;
use Meilisearch\Exceptions\CommunicationException;

function meilisearchDown(): PropertyRepository
{
    return new class implements PropertyRepository {
        public int $calls = 0;

        public function search(SearchCriteria $criteria): Collection
        {
            $this->calls++;
            throw new CommunicationException('Connection refused');
        }
    };
}

it('answers from MySQL while Meilisearch is down, and stops asking it for a while', function () {
    $cottage = Property::factory()->create(['city' => 'Skagen', 'max_guests' => 4]);
    $primary = meilisearchDown();
    $search = new SearchProperties($primary, app(EloquentPropertyRepository::class));
    $criteria = new SearchCriteria('Skagen', Stay::fromDates('2027-07-12', '2027-07-15'), guests: 2);

    expect($search->handle($criteria)->pluck('id')->all())->toBe([$cottage->id])   // the incident: an answer, not a 500
        ->and($search->handle($criteria)->pluck('id')->all())->toBe([$cottage->id])
        ->and($primary->calls)->toBe(1);                                            // the second search skipped Meilisearch

    $this->travel(SearchProperties::PAUSE_SECONDS + 1)->seconds();
    $search->handle($criteria);
    expect($primary->calls)->toBe(2);                                               // and tries it again after the pause
});

it('searches through the endpoint without knowing which store answered', function () {
    Property::factory()->create(['city' => 'Skagen', 'max_guests' => 4]);

    $this->getJson('/api/v1/search?city=Skagen&check_in=2027-07-12&check_out=2027-07-15&guests=2')
        ->assertOk()
        ->assertJsonCount(1, 'data');
});`,
        after: ['The second test runs with the `null` Scout driver from `phpunit.xml`, so the endpoint searches MySQL, which is also what keeps scene 31’s search tests passing. The fallback itself is proven by the first test, with a store that fails the way Meilisearch does.'],
      },
    ],
  },
  followups: [
    {
      id: 'reindex',
      title: 'Follow-up, the same afternoon: an amenities filter, and search shows half the cottages',
      text: ['Hygge Homes’ next request arrived with the fix: “Let guests filter on sea view and sauna.” A new filterable field means every document must be sent again.'],
      incident: {
        channel: '#support',
        when: 'Monday 16:30',
        messages: [
          ['Mona · support', 'Since about 15:50 search shows **half** the cottages in Skagen, and a different half every few minutes. Hosts are calling: “my cottage disappeared”.'],
          ['Jonas · developer', 'That’s me. I shipped the amenities filter, then ran `scout:sync-index-settings`, `scout:flush` and `scout:import` on production. The import is at **11,000 of 21,000**.'],
          ['Karim · developer', 'And the fallback can’t help: Meilisearch is up and answering, just from an index that is being refilled.'],
        ],
      },
      sections: [
        {
          title: 'The feature: amenities guests can filter on',
          text: [
            'Hosts have listed amenities in their descriptions since launch (“sea view, sauna”), and text search finds them only when the words match. Hygge wants a real filter: tick **Sea view** and **Sauna**, get only cottages with both. That needs amenities as data, not words.',
          ],
          blocks: [
            {
              path: 'app/Enums/Amenity.php',
              code: String.raw`<?php

namespace App\Enums;

/** Every amenity a listing can have. One shared instance per case, for the whole process: PHP's own flyweights. */
enum Amenity: string
{
    case Sauna = 'sauna';
    case Wifi = 'wifi';
    case SeaView = 'sea_view';
    case Parking = 'parking';
    case PetsAllowed = 'pets';
    case Fireplace = 'fireplace';
    case HotTub = 'hot_tub';
    case EvCharger = 'ev_charger';
    case Kitchen = 'kitchen';
    case Washer = 'washer';
    case Barbecue = 'bbq';
    case AirConditioning = 'air_conditioning';
    case Crib = 'crib';
    case Bikes = 'bikes';
    case Garden = 'garden';

    public function label(): string
    {
        return match ($this) {
            self::Wifi => 'Wi-Fi',
            self::SeaView => 'Sea view',
            self::HotTub => 'Hot tub',
            self::EvCharger => 'EV charger',
            self::PetsAllowed => 'Pets allowed',
            self::Barbecue => 'Barbecue',
            self::AirConditioning => 'Air conditioning',
            default => ucfirst($this->value),                          // Sauna, Parking, Kitchen …
        };
    }
}`,
              after: [
                'The column stores codes like `sea_view`, and the model hands out enum cases. `Amenity::from(\'sauna\')` doesn’t create anything: it returns the one `Sauna` object that exists for the whole process. 20,000 properties that all have a sauna hold 20,000 references to **one** object. That is the **Flyweight** pattern: share immutable objects that many users need, instead of a copy each. PHP enums are flyweights by design, so nobody here writes one.',
                'Measured on PHP 8.3, 20,000 properties with 15 amenities each: **66.8 MB** with a new object per amenity per property, **7.7 MB** with the shared enum cases, almost all of it the arrays themselves. A flyweight must also be **immutable**, or one property changing “Sauna” would change it for all; enum cases can’t be changed at all, which is what makes sharing them safe.',
              ],
            },
            {
              path: 'database/migrations/2026_05_06_000001_add_amenities_to_properties_table.php',
              code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->json('amenities')->nullable();                      // ["sauna", "sea_view"]: codes, never labels
        });
    }
};`,
            },
            {
              path: 'app/Models/Property.php',
              code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Enums\BookingStatus;
use App\Enums\Amenity;
use App\Enums\CancellationPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\AsEnumCollection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use App\Observers\ListingCacheObserver;
use App\Observers\PriceChangeObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Laravel\Scout\Searchable;

#[ObservedBy([PriceChangeObserver::class, ListingCacheObserver::class])]   // new prices: a new cache version; any edit: purge the CDN copy
class Property extends Model
{
    use HasFactory, Searchable;

    protected $fillable = [
        'name', 'city', 'country', 'timezone', 'check_in_time', 'check_out_time',
        'max_guests', 'nightly_rate_cents', 'cleaning_fee_cents', 'currency', 'description',
    ];

    protected function casts(): array
    {
        return [
            'nightly_rate' => MoneyCast::class . ':nightly_rate_cents',   // Money from nightly_rate_cents + currency
            'cancellation_policy' => CancellationPolicy::class,          // the terms for new bookings
            'amenities' => AsEnumCollection::of(Amenity::class),         // ["sauna", "sea_view"] in the column, shared enum cases in PHP
        ];
    }

    /** What Meilisearch stores for each property: only what search needs. @return array<string, string|int|list<string>|null> */
    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'city' => $this->city,
            'max_guests' => $this->max_guests,
            'description' => $this->description,
            'amenities' => $this->amenities?->map(fn (Amenity $amenity): string => $amenity->value)->values()->all() ?? [],
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
              after: ['`AsEnumCollection` turns the JSON array into a collection of `Amenity` cases and back. An unknown code in the column throws when it is read, so a typo can’t become an amenity nobody can filter on.'],
            },
            {
              path: 'config/scout.php (the meilisearch index-settings)',
              fragment: true,
              code: String.raw`'index-settings' => [
    App\Models\Property::class => [
        'filterableAttributes' => ['city', 'max_guests', 'amenities'],   // amenities: an array; "amenities = sauna" matches if it contains sauna
        'searchableAttributes' => ['name', 'description'],             // words search words: "sea view" must not match the code sea_view
    ],
],`,
            },
            {
              title: 'The search asks for amenities, and both stores answer the same way',
              path: 'app/Properties/SearchCriteria.php',
              code: String.raw`<?php

namespace App\Properties;

use App\Bookings\Stay;
use App\Enums\Amenity;

final readonly class SearchCriteria
{
    /** @param list<Amenity> $amenities every one must be present */
    public function __construct(
        public string $city,
        public Stay $stay,
        public int $guests,
        public ?string $text = null,                                   // "sea view", optional
        public int $limit = 50,
        public array $amenities = [],
    ) {
    }
}`,
            },
            {
              path: 'app/Properties/MeilisearchPropertyRepository.php',
              code: String.raw`<?php

namespace App\Properties;

use App\Enums\Amenity;
use App\Models\Property;
use Illuminate\Support\Collection;
use Meilisearch\Endpoints\Indexes;

final class MeilisearchPropertyRepository implements PropertyRepository
{
    public function search(SearchCriteria $criteria): Collection
    {
        $ids = Property::search($criteria->text ?? '', function (Indexes $index, string $query, array $options) use ($criteria): array {
            $filters = [sprintf('city = "%s"', addcslashes($criteria->city, '"\\')), "max_guests >= {$criteria->guests}"];
            foreach ($criteria->amenities as $amenity) {
                $filters[] = "amenities = {$amenity->value}";              // an enum value: never user text inside the filter
            }
            $options['filter'] = implode(' AND ', $filters);
            $options['limit'] = 200;                                    // enough candidates after the taken ones drop out

            return $index->search($query, $options)->toArray();
        })->keys();                                                     // ids only, in Meilisearch's order: best match first

        $rank = $ids->flip();                                           // id => position

        return Property::query()
            ->whereKey($ids)
            ->availableFor($criteria->stay)                            // the one availability rule (scene 31), from MySQL
            ->get(['id', 'name', 'city', 'max_guests'])
            ->sortBy(fn (Property $property): int => $rank[$property->id])
            ->take($criteria->limit)
            ->values();
    }
}`,
            },
            {
              path: 'app/Properties/EloquentPropertyRepository.php',
              code: String.raw`<?php

namespace App\Properties;

use App\Models\Property;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

final class EloquentPropertyRepository implements PropertyRepository
{
    public function search(SearchCriteria $criteria): Collection
    {
        return Property::query()
            ->where('city', $criteria->city)                            // the (city, name) index from scene 42
            ->where('max_guests', '>=', $criteria->guests)
            ->when($criteria->text, fn (Builder $query, string $text) => $query->where(
                fn (Builder $words) => $words->where('name', 'like', "%{$text}%")->orWhere('description', 'like', "%{$text}%"),
            ))
            ->when($criteria->amenities, function (Builder $query, array $amenities): void {
                foreach ($amenities as $amenity) {
                    $query->whereJsonContains('amenities', $amenity->value);   // the same rule as Meilisearch's filter
                }
            })
            ->availableFor($criteria->stay)
            ->orderBy('name')
            ->limit($criteria->limit)
            ->get(['id', 'name', 'city', 'max_guests']);
    }
}`,
              after: ['The fallback must filter exactly like Meilisearch, or a guest who ticked Sauna gets cottages without one the day Meilisearch is down. The contract test below runs the same expectation against both.'],
            },
            {
              path: 'app/Http/Controllers/SearchController.php',
              code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Enums\Amenity;
use App\Models\Property;
use App\Properties\SearchCriteria;
use App\Properties\SearchProperties;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SearchController extends Controller
{
    public function __invoke(Request $request, SearchProperties $search): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'city' => ['required', 'string', 'max:80'],
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', 'max:30'],
            'amenities' => ['sometimes', 'array', 'max:15'],
            'amenities.*' => [Rule::enum(Amenity::class)],                    // only amenities that exist
        ]);

        $properties = $search->handle(new SearchCriteria(
            city: $data['city'],
            stay: Stay::fromDates($data['check_in'], $data['check_out']),
            guests: (int) $data['guests'],
            text: $data['q'] ?? null,
            amenities: array_map(fn (string $code): Amenity => Amenity::from($code), $data['amenities'] ?? []),
        ));

        return response()->json(['data' => $properties->map(fn (Property $property): array => $property->only(['id', 'name', 'city', 'max_guests']))->values()]);
    }
}`,
            },
            {
              text: ['The code was right. Then it was deployed.'],
            },
          ],
        },
        {
          title: 'The broken code',
          blocks: [
            {
              path: 'terminal (production, 15:50)',
              broken: true,
              fragment: true,
              lang: 'shell',
              code: String.raw`php artisan scout:sync-index-settings          # amenities becomes filterable on the live index
php artisan scout:flush "App\Models\Property"    # the bug: the live index is now empty, and every search reads it
php artisan scout:import "App\Models\Property"   # 40 minutes to fill it again, 500 at a time`,
              after: [
                '`scout:flush` deletes every document of the index that searches are reading. From that second until the import ends, search answers from whatever has been imported so far. Nothing fails, so nothing alerts: the results are just wrong.',
                'The same thing happens on any full reindex: a new field, a new filterable attribute, a Meilisearch upgrade that needs a fresh index. It is a routine task, so it needs a routine that can’t take search down.',
              ],
            },
          ],
        },
        {
          title: 'The fix: build the new index next to the live one, then swap them',
          text: [
            'Meilisearch can **swap** two indexes in one atomic step: every search before the swap reads the old documents, every search after it reads the new ones. So the new index is built under another name, `properties_next`, with the new settings, while searches keep reading `properties`. When it is complete, the two swap names, and the old documents, now called `properties_next`, are deleted.',
            'One gap remains. While the import runs, hosts keep editing properties, and Scout sends those changes to the **live** index, the one about to be swapped out. So after the swap, the command sends again every property changed since the rebuild started.',
          ],
          blocks: [
            {
              path: 'app/Console/Commands/ReindexProperties.php',
              code: String.raw`<?php

namespace App\Console\Commands;

use App\Models\Property;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Meilisearch\Client;
use RuntimeException;

final class ReindexProperties extends Command
{
    protected $signature = 'search:reindex-properties';

    protected $description = 'Rebuild the properties index next to the live one, then swap them in one step';

    public function handle(Client $meilisearch): int
    {
        $live = (new Property())->searchableAs();                        // "properties", with Scout's prefix
        $next = "{$live}_next";
        $startedAt = now();

        try {
            $this->wait($meilisearch, $meilisearch->deleteIndex($next), mustSucceed: false);   // a leftover from a failed run
            $this->wait($meilisearch, $meilisearch->createIndex($next, ['primaryKey' => 'id']));
            $this->wait($meilisearch, $meilisearch->index($next)->updateSettings(
                config('scout.meilisearch.index-settings.' . Property::class, []),   // the same settings as the live index will have
            ));

            Property::query()->chunkById(1000, function (Collection $properties) use ($meilisearch, $next): void {
                $documents = $properties->map(fn (Property $property): array => $property->toSearchableArray())->values()->all();
                $this->wait($meilisearch, $meilisearch->index($next)->addDocuments($documents, 'id'));
            });

            $this->wait($meilisearch, $meilisearch->swapIndexes([[$live, $next]]));   // atomic: old documents, then new ones
        } catch (RuntimeException $e) {
            $this->error("Reindex stopped, the live index is untouched: {$e->getMessage()}");

            return self::FAILURE;
        }

        // Edits made during the import went to the old index. Send them again, to the new live one (queued, chunked by Scout).
        Property::query()->where('updated_at', '>=', $startedAt)->searchable();

        $meilisearch->deleteIndex($next);                                // it holds the old documents now
        $this->info("Swapped {$live}. Changes since {$startedAt->toTimeString()} re-sent.");

        return self::SUCCESS;
    }

    /** @param array{taskUid: int} $task Meilisearch works asynchronously: every call returns a task to wait for */
    private function wait(Client $meilisearch, array $task, bool $mustSucceed = true): void
    {
        $result = $meilisearch->waitForTask($task['taskUid'], timeoutInMs: 600_000);

        if ($mustSucceed && $result['status'] !== 'succeeded') {
            throw new RuntimeException($result['error']['message'] ?? "Task {$task['taskUid']} ended as {$result['status']}");
        }
    }
}`,
              after: [
                'A property **deleted** during the import may still be in the new index after the swap. That is harmless here: Meilisearch only returns ids, and the repository loads them from MySQL with the availability rule (the fix above), so a deleted property can never be shown. The next run cleans it up.',
                'The runbook for any index change is now one line, run at a quiet hour: `php artisan search:reindex-properties`. It applies the settings from `config/scout.php` to the new index itself, so a new filterable attribute goes out the same way.',
              ],
            },
          ],
        },
      ],
      tests: {
        summary: 'Both stores filter on amenities alike, amenities are shared objects, and a failed rebuild never swaps',
        blocks: [
          {
            title: 'The contract test, with amenities',
            path: 'tests/Feature/PropertyRepositoryTest.php',
            code: String.raw`<?php

use App\Bookings\Stay;
use App\Enums\Amenity;
use App\Models\Booking;
use App\Models\Property;
use App\Properties\EloquentPropertyRepository;
use App\Properties\MeilisearchPropertyRepository;
use App\Properties\PropertyRepository;
use App\Properties\SearchCriteria;

beforeEach(function () {
    $this->seaView = Property::factory()->create(['name' => 'Harbour loft', 'city' => 'Copenhagen', 'max_guests' => 4, 'description' => 'Sea view and a sauna', 'amenities' => [Amenity::SeaView, Amenity::Sauna]]);
    $this->taken = Property::factory()->create(['name' => 'Canal flat', 'city' => 'Copenhagen', 'max_guests' => 4, 'description' => 'Sea view']);
    $this->small = Property::factory()->create(['name' => 'Attic room', 'city' => 'Copenhagen', 'max_guests' => 2, 'description' => 'Sea view']);
    Booking::factory()->for($this->taken)->forStay('2027-07-13', 2)->pending()->create();
});

dataset('stores', [
    'MySQL' => fn (): PropertyRepository => app(EloquentPropertyRepository::class),
    'Meilisearch' => function (): PropertyRepository {
        config(['scout.driver' => 'meilisearch']);
        Property::all()->searchable();                                             // index the three properties
        retry(30, fn () => expect(Property::search('')->raw()['estimatedTotalHits'])->toBe(Property::count()), 100);   // indexing is asynchronous

        return app(MeilisearchPropertyRepository::class);
    },
]);

it('finds the free properties for the guests and the words', function (Closure $store) {
    $found = $store()->search(new SearchCriteria('Copenhagen', Stay::fromDates('2027-07-12', '2027-07-15'), guests: 4, text: 'sea view'));

    expect($found->pluck('id')->all())->toBe([$this->seaView->id]);                  // not the taken one, not the small one
})->with('stores')->group('meilisearch');

it('filters on amenities the same way in both stores', function (Closure $store) {
    $plain = Property::factory()->create(['name' => 'Beach hut', 'city' => 'Copenhagen', 'max_guests' => 4, 'amenities' => [Amenity::SeaView]]);
    $repository = $store();
    $criteria = fn (array $amenities): SearchCriteria => new SearchCriteria('Copenhagen', Stay::fromDates('2027-07-12', '2027-07-15'), guests: 4, amenities: $amenities);

    expect($repository->search($criteria([Amenity::SeaView, Amenity::Sauna]))->pluck('id')->all())->toBe([$this->seaView->id])   // both, not one
        ->and($repository->search($criteria([Amenity::SeaView]))->pluck('id')->sort()->values()->all())->toBe([$this->seaView->id, $plain->id]);
})->with('stores')->group('meilisearch');

it('shares one object per amenity across every property', function () {
    $hut = Property::factory()->create(['amenities' => [Amenity::SeaView]]);

    expect($hut->fresh()->amenities->first())->toBe($this->seaView->fresh()->amenities->first())   // the very same instance
        ->and($hut->fresh()->amenities->first())->toBe(Amenity::SeaView);
});`,
            after: ['Mutation: drop the `whereJsonContains()` loop from the MySQL store and the second test fails for MySQL only: the fallback would show every cottage. The third test is the Flyweight, proven: two properties, one object.'],
          },
          {
            path: 'tests/Feature/ReindexPropertiesTest.php',
            code: String.raw`<?php

use App\Models\Property;
use Meilisearch\Client;
use Meilisearch\Endpoints\Indexes;

function meilisearchWithFailingImport(): Client
{
    $next = Mockery::mock(Indexes::class);
    $next->shouldReceive('updateSettings')->andReturn(['taskUid' => 2]);
    $next->shouldReceive('addDocuments')->andReturn(['taskUid' => 3]);

    $client = Mockery::mock(Client::class);
    $client->shouldReceive('deleteIndex')->andReturn(['taskUid' => 0]);
    $client->shouldReceive('createIndex')->andReturn(['taskUid' => 1]);
    $client->shouldReceive('index')->andReturn($next);
    $client->shouldReceive('waitForTask')->andReturnUsing(fn (int $uid): array => $uid === 3
        ? ['status' => 'failed', 'error' => ['message' => 'Document has an invalid id']]
        : ['status' => 'succeeded']);
    $client->shouldNotReceive('swapIndexes');                                   // the live index stays as it is

    return $client;
}

it('stops before the swap when the new index fails to build', function () {
    Property::factory()->count(3)->create();
    $this->app->instance(Client::class, meilisearchWithFailingImport());

    $this->artisan('search:reindex-properties')
        ->expectsOutputToContain('the live index is untouched')
        ->assertFailed();
});`,
            after: ['This one test uses a mock, because the interesting behaviour is the order of calls to a server we don’t run in tests: build, check, and only then swap. That the swap is atomic is Meilisearch’s promise, shown once on staging by searching in a loop during a reindex: no request saw fewer than 21,000 documents.'],
          },
        ],
      },
    },
  ],
  next: 'Search survives its engine and its reindexes. Next, a one-line migration locks the bookings table for 20 minutes.',
};
