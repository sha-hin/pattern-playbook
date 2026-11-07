// Scene 30 · Rules for dates, not for the whole property: a calendar_days table read by bookings and the channel push.

export default {
  description: 'A host set a 5-night minimum for Christmas week, and every channel refused short summer stays: the minimum was one number per property, and scene 29 had just started pushing it to every channel for the whole year. Fix it in Laravel with a calendar_days table, a rule that belongs to the arrival date, upsert() for a range of dates, and a channel push that sends each night its own minimum.',
  incident: {
    channel: '#support',
    when: 'Wednesday 18:30',
    messages: [
      ['Hanne · host, Bornholm cottages', 'I wanted **5 nights minimum over Christmas**, so I set the minimum to 5. Since then not one 2- or 3-night booking, on any channel, and it’s **July**. Airbnb says “minimum 5 nights” on every date of the summer.'],
      ['Mona · support', 'Four more hosts did the same for Christmas or Easter: **31 listings** have taken no short stays since about 17:40. Hanne normally gets six or seven a week in July.'],
      ['Karim · developer', 'The minimum is one number on the property, and since 17:40 (scene 29) we push that number to every channel for all 365 days. A host can’t say “5 nights, but only for these dates”.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Scene 29 did exactly what it said: every open run of nights carries the property’s minimum. The minimum just has nowhere to live except the property, so every night of the year gets the same number:'],
      blocks: [
        {
          path: 'app/Jobs/PushAvailability.php (the push, as scene 29 left it)',
          broken: true,
          fragment: true,
          code: String.raw`foreach ($runs->for($property, now()->startOfDay(), self::DAYS) as $run) {
    $run['open']
        ? $api->openDates($this->listing, $run['nights'], $property->min_nights)   // the bug: one number for all 365 nights
        : $api->closeDates($this->listing, $run['nights']);
}`,
          after: [
            'Before scene 29 the wrong number only stopped our own booking form. Now it reaches Airbnb and Booking.com, which enforce it for us. That was the point of scene 29, and it is why a setting meant for one week closed short stays all year.',
            'Hosts don’t think in "the property’s minimum". They think in dates: 2 nights in summer, 5 over Christmas, 7 in the school holidays. The data model has to say the same.',
          ],
        },
      ],
    },
    {
      title: 'The design: one row for a date that has its own rule',
      text: [
        'A `calendar_days` table holds a rule per property and date. A date **without** a row uses the property’s default `min_nights`, so a host who never sets a date rule changes nothing, and the table only holds the dates hosts actually set.',
        'A minimum belongs to the **arrival date**. A stay that arrives on 23 December needs 5 nights; a 3-night stay that arrives on 17 December and runs into the 20th is fine. That is also how both channels read it: Booking.com calls the field `min_stay_arrival`, and Airbnb applies a day’s `min_nights` to stays that check in that day.',
        'Why not a price column too? Seasons already price a range of dates (scene 27), and a column that no feature writes is code nobody can test. The table grows a column the day a feature needs one.',
      ],
    },
    {
      title: 'The fix, part 1: the table and the model',
      blocks: [
        {
          path: 'database/migrations/2026_04_22_000001_create_calendar_days_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calendar_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->date('date');                                         // the arrival date the rule applies to
            $table->unsignedTinyInteger('min_nights');                     // overrides properties.min_nights for this date
            $table->timestamps();

            $table->unique(['property_id', 'date']);                      // one rule per date; also the index every read uses
        });
    }
};`,
        },
        {
          path: 'app/Models/CalendarDay.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CalendarDay extends Model
{
    protected function casts(): array
    {
        return [
            'date' => 'immutable_date',
            'min_nights' => 'integer',
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }
}`,
          after: ['No `$fillable`: rows are only written by the `upsert()` in part 2, never from request input.'],
        },
        {
          title: 'The property answers for a date',
          text: ['`stayTooShort()` stays the one question every booking door asks (scene 29). Only its answer changes: the arrival date’s rule if there is one, the default if not.'],
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Enums\CancellationPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
          after: ['The booking form and the date change call `stayTooShort()` already, so both doors follow the dates without a change to either.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: the host sets a rule for a range of dates',
      text: [
        'Hosts pick a range on the calendar and a minimum: "19 December to 2 January, 5 nights". One `upsert()` writes a row per date in a single statement, creating the dates that have no rule yet and updating the ones that do. `null` removes the rule, and those dates fall back to the default.',
      ],
      blocks: [
        {
          path: 'app/Http/Controllers/CalendarRulesController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Channels\CalendarSync;
use App\Models\CalendarDay;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Carbon\CarbonPeriod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class CalendarRulesController extends Controller
{
    public const MAX_DAYS = 366;

    public function __invoke(Request $request, Property $property, CalendarSync $calendar): JsonResponse
    {
        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'min_nights' => ['present', 'nullable', 'integer', 'min:1', 'max:30'],   // null: back to the property's default
        ]);

        $from = CarbonImmutable::parse($data['from']);
        $to = CarbonImmutable::parse($data['to']);
        if ($from->diffInDays($to) >= self::MAX_DAYS) {
            throw ValidationException::withMessages(['to' => 'Set rules for up to a year at a time.']);   // bounds the upsert below
        }

        $dates = array_map(
            fn (CarbonInterface $day): string => $day->toDateString(),
            CarbonPeriod::create($from, $to)->toArray(),                    // both ends included
        );

        DB::transaction(function () use ($property, $dates, $data): void {
            if ($data['min_nights'] === null) {
                $property->calendarDays()->whereIn('date', $dates)->delete();
                return;
            }

            CalendarDay::upsert(                                                     // one INSERT … ON DUPLICATE KEY UPDATE
                array_map(fn (string $date): array => [
                    'property_id' => $property->id,
                    'date' => $date,
                    'min_nights' => $data['min_nights'],
                ], $dates),
                uniqueBy: ['property_id', 'date'],
                update: ['min_nights'],                                             // Eloquent adds the timestamps to both lists
            );
        });

        $calendar->stayRulesChanged($property);                                     // every channel gets the new minimums (scene 29)

        return response()->json(['from' => $data['from'], 'to' => $data['to'], 'min_nights' => $data['min_nights']]);
    }
}`,
          after: ['`stayRulesChanged()` dispatches the pushes with `afterCommit()` (scene 17), and the transaction has committed by the time it is called, so a push can never read the calendar before the new rules exist.'],
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CalendarRulesController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices.
Route::get('/v1/properties/{property}/quote', QuoteController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');
    Route::put('/properties/{property}/calendar-rules', CalendarRulesController::class)->can('update', 'property');

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
          after: ['`PUT`, because sending the same range twice leaves the same rules: the request is idempotent by design, and a retry is harmless.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: every night is pushed with its own minimum',
      text: [
        'The runs from scene 17 group nights that look the same to a channel. A night now looks different when its minimum differs, so a run ends when either the state **or** the minimum changes. Closed nights need no minimum, so they still group together.',
      ],
      blocks: [
        {
          path: 'app/Channels/AvailabilityRuns.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Bookings\Stay;
use App\Models\Property;
use Carbon\CarbonImmutable;

final class AvailabilityRuns
{
    /** @return list<array{nights: Stay, open: bool, minNights: int}> consecutive nights with the same state and minimum */
    public function for(Property $property, CarbonImmutable $from, int $days): array
    {
        $window = Stay::fromDates($from->toDateString(), $from->addDays($days)->toDateString());
        $closed = [];                                                   // 'Y-m-d' => true for every occupied night

        $occupy = function (CarbonImmutable $first, CarbonImmutable $end) use (&$closed): void {
            for ($night = $first; $night->lessThan($end); $night = $night->addDay()) {
                $closed[$night->toDateString()] = true;
            }
        };

        foreach ($property->bookings()->overlapping($window)->get(['check_in', 'check_out']) as $booking) {
            $occupy($booking->check_in, $booking->check_out);                // pending and confirmed only (scene 3)
        }
        foreach ($property->externalBlocks()->overlapping($window)->get(['starts_on', 'ends_on']) as $block) {
            $occupy($block->starts_on, $block->ends_on);                     // scene 12
        }

        $minimums = $property->calendarDays()                           // 'Y-m-d' => the date's own minimum (scene 30)
            ->whereBetween('date', [$window->checkIn->toDateString(), $window->checkOut->toDateString()])
            ->pluck('min_nights', 'date')
            ->all();

        /** @return array{0: bool, 1: int} whether the night is open, and its minimum (0 when closed: no minimum to send) */
        $stateOf = function (CarbonImmutable $night) use ($closed, $minimums, $property): array {
            $date = $night->toDateString();
            $open = ! isset($closed[$date]);

            return [$open, $open ? (int) ($minimums[$date] ?? $property->min_nights) : 0];
        };

        $runs = [];
        $start = $window->checkIn;
        for ($night = $window->checkIn; $night->lessThan($window->checkOut); $night = $night->addDay()) {
            $next = $night->addDay();
            [$isOpen, $minNights] = $stateOf($night);

            if ($next->equalTo($window->checkOut) || $stateOf($next) !== [$isOpen, $minNights]) {
                $runs[] = ['nights' => Stay::fromDates($start->toDateString(), $next->toDateString()), 'open' => $isOpen, 'minNights' => $minNights];
                $start = $next;                                         // the next run starts tomorrow
            }
        }

        return $runs;
    }
}`,
          after: ['One more indexed query per push, and one more API call per run where the minimum changes: Hanne’s year is now three open runs (before, during and after Christmas) instead of one.'],
        },
        {
          path: 'app/Jobs/PushAvailability.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Channels\ChannelRateLimited;
use App\Models\ChannelListing;
use App\Models\Property;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

class PushAvailability implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Queueable;

    public const DAYS = 365;

    public int $uniqueFor = 900;                                       // a stuck lock frees itself after 15 minutes

    public function __construct(public ChannelListing $listing)
    {
        $this->onQueue('channels');                                     // never in front of guest emails again
    }

    /** Dispatch one push per listing of the property, after the current transaction commits. */
    public static function forProperty(Property $property): void
    {
        foreach ($property->channelListings as $listing) {
            self::dispatch($listing)->afterCommit();
        }
    }

    public function uniqueId(): string
    {
        return (string) $this->listing->id;                             // one waiting push per listing
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping("push-listing-{$this->listing->id}"))->releaseAfter(30)->expireAfter(600)];
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addHours(2);
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 300, 900];
    }

    public function handle(ChannelManager $channels, AvailabilityRuns $runs): void
    {
        $api = $channels->for($this->listing->channel)->api();
        $property = $this->listing->property;                           // read when the job runs: the newest rules

        try {
            foreach ($runs->for($property, now()->startOfDay(), self::DAYS) as $run) {
                $run['open']
                    ? $api->openDates($this->listing, $run['nights'], $run['minNights'])   // each run's own minimum
                    : $api->closeDates($this->listing, $run['nights']);
            }
        } catch (ChannelRateLimited $e) {
            $this->release($e->retryAfter);                             // scene 16
            return;
        }

        $this->listing->forceFill(['last_pushed_at' => now(), 'last_push_error' => null])->save();
    }

    public function failed(Throwable $exception): void
    {
        $this->listing->forceFill(['last_push_error' => $exception->getMessage()])->save();
    }
}`,
          after: [
            'Support set Hanne’s default back to 2 and added the rule for 19 December to 2 January. The push went out within the minute; the other four hosts got the same fix the same evening, with a note in the settings page: "Minimum stay for all dates. For some dates only, set it on the calendar."',
          ],
        },
      ],
    },
  ],
  laravel: {
    title: 'Laravel inside: what upsert() sends',
    text: [
      '`upsert()` compiles to one statement per call. On MySQL it is `INSERT … ON DUPLICATE KEY UPDATE`, which relies on a **unique index** to decide what "duplicate" means: here `unique(property_id, date)`. Without that index every call would insert new rows, and the rule would exist twice. On SQLite and PostgreSQL the same call becomes `INSERT … ON CONFLICT (property_id, date) DO UPDATE`, which refuses to run at all without the index.',
      'Eloquent’s `upsert()` adds `created_at` and `updated_at` to the values and `updated_at` to the update list. It does **not** fire model events or run casts on the values: it is a query, not a loop of `save()` calls. That is why the dates go in as `Y-m-d` strings.',
    ],
    blocks: [
      {
        path: 'the statement for 19 December to 2 January (MySQL)',
        fragment: true,
        lang: 'sql',
        code: String.raw`insert into calendar_days (property_id, date, min_nights, created_at, updated_at)
values (812, '2027-12-19', 5, '2027-06-02 18:52:10', '2027-06-02 18:52:10'),
       (812, '2027-12-20', 5, '2027-06-02 18:52:10', '2027-06-02 18:52:10'),
       -- … 15 rows in one statement
on duplicate key update min_nights = values(min_nights), updated_at = values(updated_at)`,
      },
    ],
  },
  tests: {
    summary: 'A rule for some dates leaves the rest alone, on our site and on every channel',
    blocks: [
      {
        path: 'tests/Feature/CalendarRulesTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Jobs\PushAvailability;
use App\Models\ChannelListing;
use App\Models\Property;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->cottage = Property::factory()->create(['name' => 'Bornholm cottage']);
    $this->cottage->forceFill(['min_nights' => 2])->save();
    $this->host = hostOf($this->cottage);
});

function christmasRule(object $test, ?int $minNights): void
{
    $test->actingAs($test->host)
        ->putJson("/api/v1/properties/{$test->cottage->id}/calendar-rules", ['from' => '2027-12-19', 'to' => '2027-12-31', 'min_nights' => $minNights])
        ->assertOk();
}

it('applies a date rule to arrivals on those dates only', function () {
    christmasRule($this, 5);

    expect($this->cottage->stayTooShort(Stay::fromDates('2027-07-10', '2027-07-12')))->toBeNull()                 // the incident: July is untouched
        ->and($this->cottage->stayTooShort(Stay::fromDates('2027-12-23', '2027-12-26')))->toBe('Stays arriving on 2027-12-23 must be 5 nights or more.')
        ->and($this->cottage->stayTooShort(Stay::fromDates('2027-12-17', '2027-12-20')))->toBeNull();              // arrives before the rule starts
});

it('pushes each run with its own minimum', function () {
    config(['services.booking_com' => ['base_url' => 'https://booking.test', 'username' => 'u', 'password' => 'p', 'webhook_secret' => 's']]);
    $listing = ChannelListing::forceCreate(['property_id' => $this->cottage->id, 'channel' => Channel::BookingCom, 'external_listing_id' => '8812345']);
    Queue::fake();                                                                 // the job is run by hand below
    christmasRule($this, 5);
    Http::fake(['booking.test/*' => Http::response('<ok/>')]);

    (new PushAvailability($listing))->handle(app(ChannelManager::class), app(AvailabilityRuns::class));

    $sent = Http::recorded()->map(fn (array $pair): string => $pair[0]->body());
    expect($sent)->toHaveCount(3)                                                  // before, during and after Christmas
        ->and($sent->filter(fn (string $xml): bool => str_contains($xml, 'from="2027-12-19" to="2027-12-31"><closed>0</closed><min_stay_arrival>5<')))->toHaveCount(1)
        ->and($sent->filter(fn (string $xml): bool => str_contains($xml, '<min_stay_arrival>2<')))->toHaveCount(2);
});

it('removes the rule when the host sends null', function () {
    christmasRule($this, 5);
    christmasRule($this, null);

    expect($this->cottage->calendarDays()->count())->toBe(0)
        ->and($this->cottage->minNightsOn(CarbonImmutable::parse('2027-12-23')))->toBe(2);
});

it('writes one row per date, and a second save updates them', function () {
    christmasRule($this, 5);
    christmasRule($this, 7);

    expect($this->cottage->calendarDays()->count())->toBe(13)                          // 19–31 December, not 26 rows
        ->and($this->cottage->calendarDays()->distinct()->pluck('min_nights')->all())->toBe([7]);
});

it('refuses another account’s property', function () {
    $stranger = hostOf(Property::factory()->create());

    $this->actingAs($stranger)
        ->putJson("/api/v1/properties/{$this->cottage->id}/calendar-rules", ['from' => '2027-12-19', 'to' => '2027-12-31', 'min_nights' => 5])
        ->assertForbidden();                                                        // the policy, as for every property route (scene 28)
});`,
        after: [
          'Mutations: push `$property->min_nights` for every run again and the second test fails (one run instead of three). Use `whereDate()` and every test still passes, which is why the query plan matters and not only the result: `EXPLAIN` shows the unique index unused.',
        ],
      },
      {
        title: 'Scene 29’s test, with the new message',
        path: 'tests/Feature/MinimumStayTest.php',
        code: String.raw`<?php

use App\Channels\AvailabilityRuns;
use App\Channels\ChannelManager;
use App\Enums\Channel;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->cabin = Property::factory()->create(['name' => 'Rørvig cabin']);
    $this->cabin->forceFill(['min_nights' => 3])->save();
    $this->host = hostOf($this->cabin);
});

it('sends the minimum stay to Booking.com with every open run', function () {
    config(['services.booking_com' => ['base_url' => 'https://booking.test', 'username' => 'u', 'password' => 'p', 'webhook_secret' => 's']]);
    $listing = ChannelListing::forceCreate(['property_id' => $this->cabin->id, 'channel' => Channel::BookingCom, 'external_listing_id' => '8812345']);
    Http::fake(['booking.test/*' => Http::response('<ok/>')]);

    (new PushAvailability($listing))->handle(app(ChannelManager::class), app(AvailabilityRuns::class));

    Http::assertSent(fn (Request $request): bool => str_contains($request->body(), '<closed>0</closed><min_stay_arrival>3</min_stay_arrival>'));
});

it('pushes to the channels as soon as the host changes the minimum', function () {
    Queue::fake();
    ChannelListing::forceCreate(['property_id' => $this->cabin->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);

    $this->actingAs($this->host)
        ->patchJson("/api/v1/properties/{$this->cabin->id}/stay-rules", ['min_nights' => 4])
        ->assertOk();

    Queue::assertPushed(PushAvailability::class);
});

it('refuses a one-night booking on our own site', function () {
    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->cabin->id}/bookings", [
            'check_in' => '2027-07-10', 'check_out' => '2027-07-11', 'guests' => 2,
            'guest_name' => 'Søren', 'guest_email' => 'soren@example.com', 'contact_channel' => 'email',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['check_out' => 'Stays arriving on 2027-07-10 must be 3 nights or more.']);
});

it('refuses a date change that shortens a stay below the minimum', function () {
    $booking = Booking::factory()->for($this->cabin)->forStay('2027-07-09', 3)->create();

    $this->actingAs($this->host)
        ->patchJson("/api/v1/bookings/{$booking->id}/dates", ['check_in' => '2027-07-10', 'check_out' => '2027-07-11'])
        ->assertUnprocessable();

    expect($booking->fresh()->stay->nights())->toBe(3);                            // the incident’s second door
});`,
      },
    ],
  },
  next: 'Each date knows its own minimum now. Next, a guest searches for a free cabin, picks one, and is told at checkout that it is taken.',
};
