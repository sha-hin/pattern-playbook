// Scene 32 · N+1 queries: a resource that queries once per row, and why strict mode didn't catch it.

export default {
  description: 'An agency with 140 properties waited four seconds for its properties page: the resource ran four queries for every property, 561 in all. Fix it in Laravel with eager loading, a constrained withCount() and a has-one-of-many relation, prove it with a test that counts queries, and see why lazy-loading protection never fired.',
  incident: {
    channel: '#support',
    when: 'Thursday 09:10',
    messages: [
      ['Mona · support', 'Hygge Homes joined on Monday with **140 properties**. Their Properties page takes **4 seconds** to load, and sometimes times out on their office Wi-Fi.'],
      ['Karim · developer', 'Telescope shows **561 queries** for one load of that page. For an account with three properties it’s 13.'],
      ['Sara · tech lead', '561 is 1 + 4 × 140. Something runs four queries per property.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Last week’s properties page: one row per property, with its rate plan, its channels and whether they are in sync, the next check-in, and the cleanings still to do.'],
      blocks: [
        {
          path: 'app/Http/Controllers/PropertyController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Http\Resources\PropertyResource;
use App\Models\Account;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PropertyController extends Controller
{
    public function index(Account $account): AnonymousResourceCollection
    {
        return PropertyResource::collection($account->properties()->orderBy('name')->get());   // 1 query
    }
}`,
        },
        {
          path: 'app/Http/Resources/PropertyResource.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Resources;

use App\Enums\BookingStatus;
use App\Enums\CleaningTaskStatus;
use App\Models\ChannelListing;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Property */
class PropertyResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'city' => $this->city,
            'rate_plan' => $this->ratePlan?->name,                                  // +1 query per property
            'channels' => $this->channelListings->map(fn (ChannelListing $listing): array => [   // +1
                'channel' => $listing->channel->value,
                'in_sync' => $listing->last_push_error === null,
            ]),
            'next_check_in' => $this->bookings()                                    // +1
                ->whereIn('status', BookingStatus::blocking())
                ->where('check_in', '>=', today()->toDateString())
                ->orderBy('check_in')
                ->value('check_in'),
            'open_cleanings' => $this->cleaningTasks()->where('status', CleaningTaskStatus::Pending)->count(),   // +1
        ];
    }
}`,
          after: [
            'A resource runs once **per item**. Every relation it touches without the data already loaded is a query, so 140 properties × 4 = 560 queries, plus the one that loaded the properties. That is the **N+1 problem**: one query for the list, then N more for the rows.',
          ],
        },
        {
          title: 'Why strict mode didn’t catch it',
          text: [
            '`AppServiceProvider` turns on `Model::shouldBeStrict()` outside production (scene 5), which makes lazy loading throw. It missed all four, for two reasons:',
          ],
          table: [
            ['Line', 'Why nothing was thrown'],
            ['`$this->ratePlan`, `$this->channelListings`', 'Laravel only flags a lazy load when the model came from a query that returned **more than one** model. Karim’s local account and the feature test both had one property.'],
            ['`$this->bookings()->…->value()`, `$this->cleaningTasks()->…->count()`', 'These aren’t lazy loads at all: calling the relation **method** builds a new query, on purpose. Strict mode never looks at them, with one property or a thousand.'],
          ],
          after: ['So the test that proves the fix counts queries with many rows, and fails if the number grows with the rows.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: relations the page can load in one go',
      text: [
        'Two of the four values need a relation that can be eager loaded. **Open cleanings** is a count: `withCount()` adds it to the properties query as a subquery. **The next check-in** is one booking per property, the earliest upcoming one: a *has-one-of-many* relation picks exactly that row for every property in one query.',
      ],
      blocks: [
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
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

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
          after: ['Without `ofMany()`, eager loading "the next booking" would mean loading **every** upcoming booking of every property and keeping the first: correct, but thousands of rows to show 140 dates.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: load everything before the resource runs',
      text: ['The controller loads what the page shows; the resource only reads what is already there.'],
      blocks: [
        {
          path: 'app/Http/Controllers/PropertyController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\CleaningTaskStatus;
use App\Http\Resources\PropertyResource;
use App\Models\Account;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PropertyController extends Controller
{
    public function index(Account $account): AnonymousResourceCollection
    {
        $properties = $account->properties()
            ->with(['ratePlan:id,name', 'channelListings', 'nextStay'])          // one query each, for all properties
            ->withCount(['cleaningTasks as open_cleanings_count' => fn (Builder $tasks) => $tasks->where('status', CleaningTaskStatus::Pending)])
            ->orderBy('name')
            ->get();

        return PropertyResource::collection($properties);
    }
}`,
          after: ['`ratePlan:id,name` loads only the two columns the page uses. The `id` must be there: Laravel matches each plan to its properties by it.'],
        },
        {
          path: 'app/Http/Resources/PropertyResource.php',
          code: String.raw`<?php

namespace App\Http\Resources;

use App\Models\ChannelListing;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Property */
class PropertyResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'city' => $this->city,
            'rate_plan' => $this->ratePlan?->name,                                  // loaded by the controller
            'channels' => $this->channelListings->map(fn (ChannelListing $listing): array => [
                'channel' => $listing->channel->value,
                'in_sync' => $listing->last_push_error === null,
            ]),
            'next_check_in' => $this->nextStay?->check_in->toDateString(),
            'open_cleanings' => $this->open_cleanings_count,                       // from withCount(): no query here
        ];
    }
}`,
          after: ['If a later change reads a relation the controller didn’t load, strict mode now throws in development and tests, because the test below loads many properties.'],
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\PropertyController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::get('/properties', [PropertyController::class, 'index']);             // the current account's properties
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);

    Route::post('/message-templates', [MessageTemplateController::class, 'store']);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
          after: ['The route has existed since last week; it is shown here because this is the first scene that needs it.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: check the queries that are left',
      text: [
        'The page now runs four queries, whatever the number of properties: the properties with their cleaning count, then the rate plans, the channel listings and the next stays. (Every request also loads the user and the account, as before.) The heaviest is the next stay. Its inner query finds the earliest check-in per property; `EXPLAIN` shows how MySQL runs it:',
      ],
      blocks: [
        {
          path: 'mysql',
          lang: 'sql',
          code: String.raw`EXPLAIN SELECT property_id, MIN(check_in)
FROM bookings
WHERE property_id IN (1, 2, 3)
  AND status IN ('pending', 'confirmed')
  AND check_in >= '2027-06-01'
GROUP BY property_id;`,
        },
        {
          table: [
            ['type', 'key', 'rows', 'Extra'],
            ['range', 'bookings_property_id_status_check_in_check_out_index', '9', 'Using where; Using index'],
          ],
          after: [
            '**key** is the index the Foundation created on `(property_id, status, check_in, check_out)`. **range** means MySQL reads only the matching slice of it. **Using index** means it never touches the table rows at all: every column it needs is in the index. Had **key** been empty and **type** been `ALL`, it would read every booking ever made, and adding the index would be the next fix.',
          ],
        },
        {
          title: 'In production, log lazy loading instead of throwing',
          text: ['Strict mode stays off in production, so a guest never sees an error for a slow page. But a lazy load there is still a bug worth knowing about, so it is logged with the model and relation:'],
          path: 'app/Providers/AppServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use App\Channels\ChannelManager;
use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;
use App\Payments\PaymentGateway;
use App\Payments\StripeGateway;
use Carbon\CarbonImmutable;
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
          after: ['A log search for "Lazy loading" then shows every page that still loads row by row, with the relation to add to its `with()`.'],
        },
      ],
    },
  ],
  laravel: {
    title: 'Laravel does it differently: no proxies',
    text: [
      'Doctrine, the Data Mapper ORM most Symfony apps use, makes lazy loading work with **proxy objects**: `$booking->getProperty()` returns a generated subclass of `Property` that looks real and runs its query on the first method call. That object is a Proxy, the pattern the next scene builds.',
      'Eloquent has no proxy objects. `$property->ratePlan` goes through PHP’s magic `__get()`, which loads the relation the first time it is read and keeps it in the model’s `$relations` array:',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/Eloquent/Concerns/HasAttributes.php (simplified)',
        fragment: true,
        code: String.raw`public function getRelationValue($key)
{
    if ($this->relationLoaded($key)) {
        return $this->relations[$key];                    // eager loaded, or read before: no query
    }

    if (! $this->isRelation($key)) {
        return;
    }

    if ($this->preventsLazyLoading) {                      // set on models that came from a multi-row query
        $this->handleLazyLoadingViolation($key);           // throws, or calls your handler
    }

    return $this->getRelationshipFromMethod($key);        // runs the query and stores the result
}`,
        after: ['`preventsLazyLoading` is set by the query that returned the models, and only when it returned more than one. That is the line that let the one-property test pass.'],
      },
    ],
  },
  tests: {
    summary: 'The same number of queries for 2 properties and for 30, and the right values on the page',
    blocks: [
      {
        path: 'tests/Feature/PropertiesPageTest.php',
        code: String.raw`<?php

use App\Enums\CleaningTaskStatus;
use App\Models\Account;
use App\Models\Booking;
use App\Models\CleaningTask;
use App\Models\Property;
use App\Models\RatePlan;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** A property with a rate plan, a channel listing, a booking and a pending cleaning: every relation the page reads. */
function fullProperty(Account $account): Property
{
    $property = Property::factory()->for($account)->create();
    $plan = RatePlan::forceCreate(['account_id' => $account->id, 'name' => "Plan {$property->id}", 'nightly_rate_cents' => 16_000, 'currency' => 'EUR']);
    $property->forceFill(['rate_plan_id' => $plan->id])->save();
    $property->channelListings()->forceCreate(['channel' => 'airbnb', 'external_listing_id' => "ab-{$property->id}"]);
    $booking = Booking::factory()->for($property)->forStay('2027-07-10', 3)->create();
    CleaningTask::forceCreate(['property_id' => $property->id, 'booking_id' => $booking->id, 'starts_at' => '2027-07-13 09:00:00', 'status' => CleaningTaskStatus::Pending]);

    return $property;
}

function queriesForPropertiesPage(User $host): int
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    test()->actingAs($host)->getJson('/api/v1/properties')->assertOk();

    return count(DB::getQueryLog());
}

it('runs the same number of queries for 2 properties and for 30', function () {
    $account = Account::factory()->create();
    $host = memberOf($account);
    fullProperty($account);
    fullProperty($account);
    $few = queriesForPropertiesPage($host);

    foreach (range(1, 28) as $more) {
        fullProperty($account);
    }

    expect(queriesForPropertiesPage($host))->toBe($few);                    // 561 queries for 140 is impossible now
});

it('shows the plan, the channels, the next check-in and the open cleanings', function () {
    $account = Account::factory()->create();
    $property = fullProperty($account);
    Booking::factory()->for($property)->forStay('2027-06-20', 2)->create();            // earlier: this is the next one
    Booking::factory()->for($property)->forStay('2027-06-10', 2)->cancelled()->create();  // cancelled: never the next one

    $this->actingAs(memberOf($account))->getJson('/api/v1/properties')
        ->assertOk()
        ->assertJsonPath('data.0.rate_plan', "Plan {$property->id}")
        ->assertJsonPath('data.0.channels.0', ['channel' => 'airbnb', 'in_sync' => true])
        ->assertJsonPath('data.0.next_check_in', '2027-06-20')
        ->assertJsonPath('data.0.open_cleanings', 1);
});`,
        after: [
          'The first test is the one that would have caught the incident: it compares two counts instead of hard-coding one, so it keeps working when the page shows one more thing, and fails the day someone adds a query per row.',
          'With 30 properties, strict mode is also active in this test: any relation the controller forgot to load throws here, long before production.',
        ],
      },
    ],
  },
  next: 'The page loads in 80 milliseconds. Next: a host raises her prices at 09:00, and for an hour guests keep paying the old ones.',
};
