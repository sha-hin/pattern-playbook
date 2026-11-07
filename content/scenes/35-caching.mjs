// Scene 35 · Proxy: a caching stand-in for the nightly rates, keys that change after commit, never the price a guest pays.

export default {
  description: 'A host raised her August prices at 09:00, and for an hour guests booked and paid the old ones: the nightly rates were cached inside the class every booking uses, and a price change never cleared the cache. Fix it in Laravel with a caching Proxy used only for quotes, a version in every key that changes after the price change commits, and bookings that always price from the database.',
  incident: {
    channel: '#finance',
    when: 'Thursday 10:40',
    messages: [
      ['Ingrid · host, Skagen cottages', 'I raised August from **€180 to €220** at 09:00. Since then I’ve had **23 bookings** for August, all at €180. The calendar shows €220 everywhere.'],
      ['Lina · finance', 'That is **€1,840** less than the prices she set, across those 23 bookings. Same pattern for two other hosts who changed prices this morning.'],
      ['Karim · developer', 'Last week we cached the nightly rates for an hour to speed up search and quotes. The bookings read the same cache. Nothing clears it when a price changes.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['After search (scene 31) went live, quotes became the busiest endpoint, and pricing every night through the rate plan was most of its time. So the result was cached, in the class that prices every night:'],
      blocks: [
        {
          path: 'app/Pricing/NightlyRates.php',
          broken: true,
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Models\RatePlan;
use App\Models\RatePlanSeason;
use App\Money\Money;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

final class NightlyRates
{
    /** @return list<Money> one price per night of the stay */
    public function for(Property $property, Stay $stay): array
    {
        $key = "nightly-rates:{$property->id}:{$stay->checkIn->toDateString()}:{$stay->checkOut->toDateString()}";

        return Cache::remember($key, now()->addHour(), function () use ($property, $stay): array {   // the bug: for quotes *and* bookings,
            $plan = $property->ratePlan;                                                               // and nothing clears it
            $prices = [];

            for ($night = $stay->checkIn; $night->lessThan($stay->checkOut); $night = $night->addDay()) {
                $prices[] = $plan === null ? $property->nightly_rate : $this->priceOf($plan, $night);
            }

            return $prices;
        });
    }

    private function priceOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        $price = $this->baseOf($plan, $night);                          // 1. what the night costs before adjustments

        if ($night->isFriday() || $night->isSaturday()) {                 // 2. adjustments, on whichever base step 1 chose
            $price = $price->add($price->percent($plan->weekend_uplift_bps));
        }

        return $price;
    }

    /** A season replaces the plan's base price for its nights. Only the base. */
    private function baseOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        $season = $plan->seasons->first(fn (RatePlanSeason $season): bool => $season->covers($night->toDateString()));

        return $season === null
            ? $plan->baseRate()
            : Money::of($season->nightly_rate_cents, $plan->currency);
    }
}`,
          after: [
            'Two mistakes, one line. **What** is cached: `PriceQuoter` uses `NightlyRates` for the quote page and for `CreateBooking` alike, so the price a guest **pays** came from a cache up to an hour old. And **when** it expires: only after the hour, because nothing in the app removes the entry when a price changes.',
            'A cached price on a page is a display problem: the guest sees €180 and is charged €220, and the booking flow shows the difference before payment. A cached price at checkout is a money problem, which is this incident.',
          ],
        },
      ],
    },
    {
      title: 'Two rules for caching prices',
      blocks: [
        {
          table: [
            ['Rule', 'Here'],
            ['1. Never cache the decision', 'A booking, a date change and a refund price from the database, every time. The cache only serves the quote page, where speed matters and the booking checks again anyway.'],
            ['2. Change the key, don’t hope for the TTL', 'Every key carries a **version** of the property’s prices. A price change bumps the version, so the old entries are never read again and simply expire. The hour becomes a safety net, not the plan.'],
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: the real class stops caching',
      text: ['`NightlyRates` goes back to what it was in scene 27: it prices every night from the database, with no cache. It now implements an interface, because something else is about to stand in for it.'],
      blocks: [
        {
          path: 'app/Pricing/NightlyPrices.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Money\Money;

interface NightlyPrices
{
    /** @return list<Money> one price per night of the stay */
    public function for(Property $property, Stay $stay): array;
}`,
        },
        {
          path: 'app/Pricing/NightlyRates.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Models\RatePlan;
use App\Models\RatePlanSeason;
use App\Money\Money;
use Carbon\CarbonImmutable;

final class NightlyRates implements NightlyPrices
{
    /** @return list<Money> one price per night of the stay, always from the database */
    public function for(Property $property, Stay $stay): array
    {
        $plan = $property->ratePlan;
        $prices = [];

        for ($night = $stay->checkIn; $night->lessThan($stay->checkOut); $night = $night->addDay()) {
            $prices[] = $plan === null ? $property->nightly_rate : $this->priceOf($plan, $night);
        }

        return $prices;
    }

    private function priceOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        $price = $this->baseOf($plan, $night);                          // 1. what the night costs before adjustments

        if ($night->isFriday() || $night->isSaturday()) {                 // 2. adjustments, on whichever base step 1 chose
            $price = $price->add($price->percent($plan->weekend_uplift_bps));
        }

        return $price;
    }

    /** A season replaces the plan's base price for its nights. Only the base. */
    private function baseOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        $season = $plan->seasons->first(fn (RatePlanSeason $season): bool => $season->covers($night->toDateString()));

        return $season === null
            ? $plan->baseRate()
            : Money::of($season->nightly_rate_cents, $plan->currency);
    }
}`,
        },
        {
          path: 'app/Pricing/PriceQuoter.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Money\Money;

final class PriceQuoter
{
    public const WEEKLY_NIGHTS = 7;

    public function __construct(private NightlyPrices $rates)
    {
    }

    public function quote(Property $property, Stay $stay): Quote
    {
        $quote = (new QuoteBuilder())->nightsAt($this->rates->for($property, $stay));   // each night at its own price

        if ($stay->nights() >= self::WEEKLY_NIGHTS && $property->weekly_discount_bps > 0) {
            $quote->discount('Weekly discount', $property->weekly_discount_bps);
        }

        if ($property->cleaning_fee_cents !== null) {
            $quote->cleaningFee(Money::of($property->cleaning_fee_cents, $property->currency));
        }

        if ($property->tax_rate_bps > 0) {
            $quote->tax('Accommodation tax', $property->tax_rate_bps);
        }

        return $quote->build();
    }

    /** The host's offer to one guest: their own nightly rate and discount. The tax rule is not theirs to change. */
    public function customOffer(Property $property, Stay $stay, Money $nightlyRate, int $discountBps): Quote
    {
        $quote = (new QuoteBuilder())->nights($stay, $nightlyRate);

        if ($discountBps > 0) {
            $quote->discount('Host discount', $discountBps);                  // instead of the weekly discount, never on top of it
        }

        if ($property->cleaning_fee_cents !== null) {
            $quote->cleaningFee(Money::of($property->cleaning_fee_cents, $property->currency));
        }

        if ($property->tax_rate_bps > 0) {
            $quote->tax('Accommodation tax', $property->tax_rate_bps);
        }

        return $quote->build();
    }
}`,
          after: ['`PriceQuoter` now asks for "something that gives nightly prices". Which one it gets is decided in one place, in part 3.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: a stand-in that caches',
      text: [
        '`CachedNightlyRates` implements the same interface and holds the real `NightlyRates`. Asked for prices, it looks in the cache first and only asks the real class on a miss. Code that receives a `NightlyPrices` can’t tell which one it has.',
        'The key includes the property’s **price version**. `PriceVersion` keeps one counter per property in Redis; bumping it makes every old key unreachable at once, without finding and deleting them one by one.',
      ],
      blocks: [
        {
          path: 'app/Pricing/PriceVersion.php',
          code: String.raw`<?php

namespace App\Pricing;

use Illuminate\Support\Facades\Cache;

final class PriceVersion
{
    public function of(int $propertyId): int
    {
        return (int) Cache::get($this->key($propertyId), 0);
    }

    /** Every cached price of this property becomes unreachable. Atomic in Redis: two bumps never become one. */
    public function bump(int $propertyId): void
    {
        Cache::increment($this->key($propertyId));
    }

    private function key(int $propertyId): string
    {
        return "price-version:{$propertyId}";
    }
}`,
        },
        {
          path: 'app/Pricing/CachedNightlyRates.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Money\Money;
use Illuminate\Support\Facades\Cache;

/** For pages only. Bookings, date changes and refunds use NightlyRates directly. */
final readonly class CachedNightlyRates implements NightlyPrices
{
    public function __construct(
        private NightlyRates $rates,
        private PriceVersion $version,
    ) {
    }

    /** @return list<Money> */
    public function for(Property $property, Stay $stay): array
    {
        $key = sprintf(
            'nightly-rates:%d:v%d:%s:%s',
            $property->id,
            $this->version->of($property->id),                         // a price change moves every key to a new version
            $stay->checkIn->toDateString(),
            $stay->checkOut->toDateString(),
        );

        $cents = Cache::remember($key, now()->addMinutes(30), fn (): array => array_map(
            fn (Money $price): int => $price->amount,                   // plain integers in Redis, not serialized objects
            $this->rates->for($property, $stay),
        ));

        return array_map(fn (int $amount): Money => Money::of($amount, $property->currency), $cents);
    }
}`,
          after: ['Integers, not `Money` objects, go into Redis: a serialized object breaks the day its class changes shape, and a deploy would then read cache entries written by the old code.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: only the quote page gets the stand-in',
      text: [
        'By default, anything that needs `NightlyPrices` gets the real class. The quote controller is the one exception, and the container says so in one line: when `QuoteController` asks for a `PriceQuoter`, build it with the cached rates.',
      ],
      blocks: [
        {
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
          after: ['`CreateBooking`, `ChangeBookingDates` and everything else keep getting a `PriceQuoter` with the real `NightlyRates`, so every price a guest pays is read from the database.'],
        },
      ],
    },
    {
      title: 'The fix, part 4: bump the version after the change commits',
      text: [
        'Three things change a property’s nightly prices: its own `nightly_rate_cents` or `rate_plan_id`, its plan, and the plan’s seasons. One observer watches all three.',
        'It runs **after the commit** (`ShouldHandleEventsAfterCommit`). Bumping inside the transaction leaves a race: a quote request arrives between the bump and the commit, misses the cache, reads the **old** prices (the new ones aren’t committed yet) and caches them under the **new** version, where they stay for 30 minutes.',
      ],
      blocks: [
        {
          path: 'app/Observers/PriceChangeObserver.php',
          code: String.raw`<?php

namespace App\Observers;

use App\Models\Property;
use App\Models\RatePlan;
use App\Models\RatePlanSeason;
use App\Pricing\PriceVersion;
use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;

final class PriceChangeObserver implements ShouldHandleEventsAfterCommit
{
    public function __construct(private PriceVersion $version)
    {
    }

    public function saved(Property|RatePlan|RatePlanSeason $model): void
    {
        if ($model instanceof Property && ! $model->wasChanged(['nightly_rate_cents', 'rate_plan_id', 'currency'])) {
            return;                                                     // a new name or check-in time: prices are the same
        }

        $this->bumpPropertiesOf($model);
    }

    public function deleted(RatePlanSeason $season): void
    {
        $this->bumpPropertiesOf($season);
    }

    private function bumpPropertiesOf(Property|RatePlan|RatePlanSeason $model): void
    {
        $propertyIds = match (true) {
            $model instanceof Property => [$model->id],
            $model instanceof RatePlan => Property::where('rate_plan_id', $model->id)->pluck('id')->all(),   // a shared plan: every listing on it
            $model instanceof RatePlanSeason => Property::where('rate_plan_id', $model->rate_plan_id)->pluck('id')->all(),
        };

        foreach ($propertyIds as $id) {
            $this->version->bump($id);
        }
    }
}`,
        },
        {
          title: 'The three models point at it',
          text: ['The `#[ObservedBy]` attribute registers an observer on the model itself, so nobody has to remember a line in a service provider.'],
          path: 'app/Models/RatePlan.php',
          code: String.raw`<?php

namespace App\Models;

use App\Money\Money;
use App\Observers\PriceChangeObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[ObservedBy([PriceChangeObserver::class])]                     // a price change moves the cache to a new version
class RatePlan extends Model
{
    protected $fillable = ['name', 'nightly_rate_cents', 'currency', 'weekend_uplift_bps'];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function seasons(): HasMany
    {
        return $this->hasMany(RatePlanSeason::class)->orderBy('starts_on');
    }

    public function baseRate(): Money
    {
        return Money::of($this->nightly_rate_cents, $this->currency);
    }
}`,
        },
        {
          path: 'app/Models/RatePlanSeason.php',
          code: String.raw`<?php

namespace App\Models;

use App\Observers\PriceChangeObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[ObservedBy([PriceChangeObserver::class])]                     // a price change moves the cache to a new version
class RatePlanSeason extends Model
{
    protected $fillable = ['name', 'starts_on', 'ends_on', 'nightly_rate_cents'];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date:Y-m-d',
            'ends_on' => 'date:Y-m-d',
        ];
    }

    public function ratePlan(): BelongsTo
    {
        return $this->belongsTo(RatePlan::class);
    }

    /** True for every night from starts_on to ends_on, both included. */
    public function covers(string $night): bool
    {
        return $night >= $this->starts_on->toDateString() && $night <= $this->ends_on->toDateString();   // Y-m-d compares as text
    }
}`,
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
use App\Observers\PriceChangeObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[ObservedBy([PriceChangeObserver::class])]                     // a price change moves the cache to a new version
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
          after: [
            'Model observers only see changes made through Eloquent. A bulk `RatePlanSeason::where(...)->update([...])` fires no events, so price changes always go through models, or bump the version themselves.',
            'For the 23 bookings: they were charged what the guests saw and accepted at checkout. Support offers each host the choice to keep them or ask the guest for the difference; the code never changes a confirmed booking’s price on its own.',
          ],
        },
      ],
    },
  ],
  reveal: {
    names: ['Proxy'],
    rules: [['Proxy', 'An object that stands in for another, with the same interface, and controls access to it: caching its answers, loading it late, or checking who may call it.']],
    points: [
      '`CachedNightlyRates` is a **caching proxy**: same interface as `NightlyRates`, holds the real one, answers from the cache when it can. Neither `PriceQuoter` nor the controller knows it is there.',
      'Who gets the proxy is one decision in the container, so the rule "never cache what a guest pays" is enforced in one place you can read.',
      'Proxy and Decorator (scene 16) are built the same way. The difference is intent: a decorator **adds** behaviour (the rate limit), a proxy **controls access** to the real object and answers in its place.',
    ],
    whenNot: [
      'When the real call is already fast: a cache adds a second source of truth to keep correct.',
      'For a value that must be exactly right at the moment it is used, like the price at checkout. Read it from the source.',
    ],
  },
  laravel: {
    title: 'Laravel does the same: Cache::remember() and contextual bindings',
    text: [
      '`Cache::remember()` is the whole cache-aside pattern in one call: read the key, and on a miss run the closure, store its result and return it. Two requests that miss at the same moment both run the closure; for a cheap closure like this one that is fine. For an expensive one, `Cache::flexible()` serves the old value while one request rebuilds it, and `Cache::lock()` (scene 4) lets only one process rebuild.',
    ],
    blocks: [
      {
        path: 'Illuminate/Cache/Repository.php (simplified)',
        fragment: true,
        code: String.raw`public function remember($key, $ttl, Closure $callback)
{
    $value = $this->get($key);

    if (! is_null($value)) {
        return $value;                                    // a hit: the closure never runs
    }

    $this->put($key, $value = $callback(), value($ttl, $value));

    return $value;
}`,
        after: ['A hit is a `null` check, so a closure that returns `null` is never cached: it runs on every call. Cache an empty array or `false`, never `null`, when "nothing" is a valid answer.'],
      },
    ],
  },
  tests: {
    summary: 'The incident, a cached quote until the price changes, the race-free bump, and a shared plan',
    blocks: [
      {
        path: 'tests/Feature/PriceCacheTest.php',
        code: String.raw`<?php

use App\Bookings\CreateBooking;
use App\Bookings\Stay;
use App\Models\Property;
use App\Models\RatePlan;
use App\Pricing\PriceVersion;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->cottage = Property::factory()->create(['cleaning_fee_cents' => null]);
    $this->plan = RatePlan::forceCreate(['account_id' => $this->cottage->account_id, 'name' => 'Skagen', 'nightly_rate_cents' => 18_000, 'currency' => 'EUR']);
    $this->cottage->forceFill(['rate_plan_id' => $this->plan->id])->save();
});

function quotedTotal(Property $property): int
{
    return test()->getJson("/api/v1/properties/{$property->id}/quote?check_in=2027-08-02&check_out=2027-08-04")
        ->assertOk()
        ->json('total.amount');
}

it('charges the new price the moment it changes, even right after a cached quote', function () {
    expect(quotedTotal($this->cottage))->toBe(36_000);                        // cached at €180

    $this->plan->update(['nightly_rate_cents' => 22_000]);
    $booking = app(CreateBooking::class)->handle($this->cottage->fresh(), Stay::fromDates('2027-08-02', '2027-08-04'), [
        'guest_name' => 'Søren', 'guest_email' => 'soren@example.com', 'guest_phone' => null, 'guest_channel' => 'email', 'guests' => 2,
    ]);

    expect($booking->total->amount)->toBe(44_000);                            // the incident: never the cached €180
});

it('serves the quote from the cache until the price changes, then the new price', function () {
    expect(quotedTotal($this->cottage))->toBe(36_000);

    $this->plan->forceFill(['nightly_rate_cents' => 22_000])->saveQuietly();  // a change the observer never sees
    expect(quotedTotal($this->cottage))->toBe(36_000);                        // proof the page reads the cache

    $this->plan->update(['nightly_rate_cents' => 22_000, 'name' => 'Skagen 2027']);   // a real change: the observer bumps
    expect(quotedTotal($this->cottage))->toBe(44_000);
});

it('bumps the version only after the change commits', function () {
    $versions = app(PriceVersion::class);

    DB::transaction(function () use ($versions): void {
        $this->plan->update(['nightly_rate_cents' => 22_000]);
        expect($versions->of($this->cottage->id))->toBe(0);                   // not yet: the old prices are still the committed ones
    });

    expect($versions->of($this->cottage->id))->toBe(1);
});

it('moves every listing on a shared plan to new prices', function () {
    $twin = Property::factory()->for($this->cottage->account)->create(['cleaning_fee_cents' => null]);
    $twin->forceFill(['rate_plan_id' => $this->plan->id])->save();
    quotedTotal($this->cottage);
    quotedTotal($twin);

    $this->plan->seasons()->create(['name' => 'August', 'starts_on' => '2027-08-01', 'ends_on' => '2027-08-31', 'nightly_rate_cents' => 22_000]);

    expect(quotedTotal($this->cottage))->toBe(44_000)
        ->and(quotedTotal($twin->fresh()))->toBe(44_000);
});`,
        after: ['The tests use the `array` cache store (phpunit.xml), which keeps entries for the whole test, so a second request really reads what the first one cached. `RefreshDatabase` lets after-commit observers run when the code’s own transaction commits, so the third test sees exactly what production sees.'],
      },
    ],
  },
  followups: [
    {
      id: 'eviction',
      title: 'Part 2, the same afternoon: Redis throws out what it must keep',
      text: ['The fix above shipped at 11:30. By the afternoon, the new cache had filled Redis, and Redis started choosing what to forget.'],
      incident: {
        channel: '#ops',
        when: 'Thursday 14:20',
        messages: [
          ['Mona · support', 'Since about 13:30 hosts are **logged out every few minutes**. Six tickets. And Ingrid says a quote showed **€180** again for ten minutes, an hour after she changed it.'],
          ['Jonas · developer', 'Redis is at its 2 GB `maxmemory`. `evicted_keys` went from 0 to **1.9 million** since 13:00. Horizon shows 212 delayed channel pushes that never ran.'],
          ['Karim · developer', 'Every quote now writes a key per property and date range, half a million of them. Cache, sessions, queues and locks all live in the **same Redis**, and it is set to `allkeys-lru`: when it’s full, it deletes whatever was used least recently. That includes sessions, delayed jobs, and our price-version counters.'],
        ],
      },
      sections: [
        {
          title: 'The broken code',
          text: ['Not a line of PHP. The one Redis everything uses was configured as a cache:'],
          blocks: [
            {
              path: '/etc/redis/redis.conf (production, the one Redis)',
              broken: true,
              fragment: true,
              lang: 'shell',
              code: String.raw`maxmemory 2gb
maxmemory-policy allkeys-lru     # the bug: right for a cache, wrong for the queue, sessions, locks and counters in the same instance`,
              after: [
                '`allkeys-lru` is the right policy for a cache: when memory is full, forget the oldest unused entry, and the app recomputes it. It is the wrong policy for anything that **is** data. A host’s session idle for 20 minutes looks exactly like an old quote. So do the `queues:channels:delayed` set of jobs waiting for a `Retry-After` (scene 16), and the unique-job and overlap locks (scene 17).',
                'And `price-version:{id}` from part 1. Evict Ingrid’s counter and it reads 0; her next price change bumps it to 1; and every `v1` quote cached **before** that change, still inside its 30 minutes, is reachable again. That was the €180.',
              ],
            },
          ],
        },
        {
          title: 'Why one Redis can’t do both',
          blocks: [
            {
              table: [
                ['Policy', 'When full', 'Fits'],
                ['`allkeys-lru`', 'Deletes the least recently used key, any key', 'A cache, and only a cache'],
                ['`volatile-lru`', 'Deletes the least recently used key **with a TTL**', 'Not a fix here: sessions and locks have TTLs too, so they still go'],
                ['`noeviction`', 'Refuses new writes with an error', 'Queues, sessions, locks, counters: a loud error beats losing a job in silence'],
              ],
              after: ['Laravel’s default `config/database.php` already gives the cache its own connection, `cache`, on database 1. That separates the keys, not the policy: the policy is per Redis **instance**, not per database number. So the fix is two instances: one that may forget, and one that may not. The one that may not is sized with headroom and watched, because when it fills up, writes start failing.'],
            },
          ],
        },
        {
          title: 'The fix, part 1: two Redis instances, two connections',
          blocks: [
            {
              path: '/etc/redis/cache.conf and /etc/redis/data.conf (production)',
              fragment: true,
              lang: 'shell',
              code: String.raw`# cache.conf — may forget anything: quotes, search results, computed pages
port 6380
maxmemory 2gb
maxmemory-policy allkeys-lru
save ""                          # no snapshots: a cache is rebuilt, not restored

# data.conf — must not forget: queues, sessions, locks, price versions
port 6379
maxmemory 4gb
maxmemory-policy noeviction
appendonly yes                   # a restart must not lose queued jobs`,
            },
            {
              path: 'config/database.php (the redis entry)',
              fragment: true,
              code: String.raw`'redis' => [
    'client' => env('REDIS_CLIENT', 'phpredis'),

    'default' => [                                       // queues, sessions, locks: the instance that never evicts
        'host' => env('REDIS_HOST', '127.0.0.1'),
        'password' => env('REDIS_PASSWORD'),
        'port' => env('REDIS_PORT', '6379'),
        'database' => env('REDIS_DB', '0'),
    ],

    'cache' => [                                         // the instance that may forget
        'host' => env('REDIS_CACHE_HOST', env('REDIS_HOST', '127.0.0.1')),
        'password' => env('REDIS_CACHE_PASSWORD', env('REDIS_PASSWORD')),
        'port' => env('REDIS_CACHE_PORT', '6380'),
        'database' => env('REDIS_CACHE_DB', '0'),
    ],
],`,
            },
            {
              path: 'config/cache.php (the stores entry)',
              fragment: true,
              code: String.raw`'stores' => [
    'redis' => [                                         // the default store: Cache::remember() and friends
        'driver' => 'redis',
        'connection' => 'cache',
        'lock_connection' => 'default',                  // Cache::lock() must never be evicted mid-lock
    ],

    'durable' => [                                       // small values the app can't recompute: price versions
        'driver' => env('CACHE_DURABLE_DRIVER', 'redis'),
        'connection' => 'default',
        'lock_connection' => 'default',
    ],

    'array' => ['driver' => 'array', 'serialize' => false],
],`,
              after: ['`.env` in production: `CACHE_STORE=redis`, `SESSION_DRIVER=redis` with `SESSION_CONNECTION=default`, `QUEUE_CONNECTION=redis`. The queue’s `redis` connection in `config/queue.php` already uses `default`; it is the cache that moves out.'],
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

volumes:
  mysql-data:`,
              after: ['Locally the same split, so a developer sees the same behaviour: `REDIS_CACHE_HOST=redis-cache` in `.env`.'],
            },
          ],
        },
        {
          title: 'The fix, part 2: the price version is data, not cache',
          text: ['A counter that decides which prices are current can’t live where it may be forgotten. `PriceVersion` moves to the `durable` store. The quotes themselves stay in the cache that may forget: losing one only costs a recomputation.'],
          blocks: [
            {
              path: 'app/Pricing/PriceVersion.php',
              code: String.raw`<?php

namespace App\Pricing;

use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Cache;

final class PriceVersion
{
    public function of(int $propertyId): int
    {
        return (int) $this->store()->get($this->key($propertyId), 0);
    }

    /** Every cached price of this property becomes unreachable. Atomic in Redis: two bumps never become one. */
    public function bump(int $propertyId): void
    {
        $this->store()->increment($this->key($propertyId));
    }

    /** The Redis that never evicts: an evicted counter would bring back prices that were already replaced. */
    private function store(): Repository
    {
        return Cache::store('durable');
    }

    private function key(int $propertyId): string
    {
        return "price-version:{$propertyId}";
    }
}`,
              after: ['A counter per property with no TTL: 50,000 properties are about 4 MB. That is the kind of data the `noeviction` instance is for: small, and not recomputable.'],
            },
            {
              title: 'Tests get the durable store in memory',
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
    </php>
</phpunit>`,
            },
            {
              title: 'And the alarm that would have rung at 13:05',
              text: [
                'Two alerts in the monitoring, both from Redis `INFO`: on the data instance, `used_memory` above 80% of `maxmemory` (it is about to refuse writes), and `evicted_keys` above zero, which must never happen there. On the cache instance evictions are normal; the alert is a falling hit rate (`keyspace_hits` against `keyspace_misses`), which says the cache is too small to help.',
              ],
            },
          ],
        },
      ],
      tests: {
        summary: 'Flushing the cache keeps the price versions, and a stale entry stays unreachable',
        blocks: [
          {
            path: 'tests/Feature/PriceVersionStoreTest.php',
            code: String.raw`<?php

use App\Pricing\PriceVersion;
use Illuminate\Support\Facades\Cache;

it('keeps the price versions when the cache forgets everything', function () {
    $versions = app(PriceVersion::class);
    $versions->bump(812);

    Cache::flush();                                                              // what allkeys-lru does, all at once

    expect($versions->of(812))->toBe(1)                                           // the incident: it read 0
        ->and(Cache::get('price-version:812'))->toBeNull();                      // and it was never in the evictable store
});

it('never makes an older cached price reachable again', function () {
    $versions = app(PriceVersion::class);
    $versions->bump(812);                                                        // version 1
    Cache::put('nightly-rates:812:v1:2027-08-02:2027-08-04', [18_000, 18_000], 1800);   // a quote cached at €180

    Cache::forget('price-version:812');                                          // the eviction that hit Ingrid: nothing to evict now
    $versions->bump(812);                                                        // she changes her price

    expect($versions->of(812))->toBe(2)                                          // never back to 1 …
        ->and(Cache::has('nightly-rates:812:v2:2027-08-02:2027-08-04'))->toBeFalse();   // … so the €180 entry is never read again
});`,
            after: ['Mutation: point `PriceVersion` back at the default store and the first test fails with 0, exactly the counter the eviction reset. The eviction itself is Redis behaviour, not ours, so it isn’t tested here; `redis-cli CONFIG GET maxmemory-policy` on each instance is part of the deploy checklist instead.'],
          },
        ],
      },
    },
  ],
  next: 'Prices are right the moment they change, and Redis only forgets what can be recomputed. Next, a partner system that should hear about every booking misses one, and nobody notices for a day.',
};
