// Scene 39 · Repository: one way to ask for properties, two stores that can answer, and a fallback when one is down.

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
        'Hygge Homes asked for search by words: “sea view”, “sauna”, and with typos, “sauana”. SQL is poor at that (scene 30 said when it stops being enough), so search moved to **Meilisearch**, through Laravel Scout. Hosts now write a description for each property, and Scout keeps a copy of every property in a Meilisearch index.',
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
    command: redis-server --appendonly yes     # a restart must not lose queued jobs
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
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
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use App\Observers\PriceChangeObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Laravel\Scout\Searchable;

#[ObservedBy([PriceChangeObserver::class])]                     // a price change moves the cache to a new version
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
        return $stay->nights() < $this->min_nights
            ? "This property takes stays of {$this->min_nights} nights or more."
            : null;
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
            ->query(fn (Builder $query) => $query->availableFor($stay))  // availability still from MySQL (scene 30)
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
            ->availableFor($criteria->stay)                            // the one availability rule (scene 30), from MySQL
            ->get(['id', 'name', 'city', 'max_guests'])
            ->sortBy(fn (Property $property): int => $rank[$property->id])
            ->take($criteria->limit)
            ->values();
    }
}`,
          after: ['The index never decides availability: it only knows what was true when a property was last indexed (seconds ago, or longer while Meilisearch is catching up). It narrows 21,000 properties to 200 good matches; MySQL decides which of them are free.'],
        },
        {
          title: 'Eloquent: the SQL search from scenes 30 and 38',
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
            ->where('city', $criteria->city)                            // the (city, name) index from scene 38
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
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Stripe\StripeClient;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
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
        after: ['The second test runs with the `null` Scout driver from `phpunit.xml`, so the endpoint searches MySQL, which is also what keeps scene 30’s search tests passing. The fallback itself is proven by the first test, with a store that fails the way Meilisearch does.'],
      },
    ],
  },
  next: 'Day 6 is done: queries that don’t grow with the data, a cache that knows when prices change, an outbox, safe retries, exports that can’t leak, syncs that write only what changed, a database that survives the busiest evening, and search that survives its engine. Day 7 starts with a one-line migration that locks the bookings table for 20 minutes.',
};
