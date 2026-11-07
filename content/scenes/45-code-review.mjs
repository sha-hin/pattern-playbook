// Scene 45 · Code review: an AI-written pull request with eight real bugs, found, explained and fixed.

export default {
  description: 'The last scene is a review: a pull request written with an AI coding tool adds a monthly payout statement for hosts. It looks finished and passes its own test. Read it first and find what is wrong; then the eight findings, each tied to the scene that taught it, and the version that can be merged.',
  incident: {
    channel: '#code-review',
    when: 'Friday 11:00',
    messages: [
      ['Henrik · staff engineer (interviewer)', 'Last part. One of our developers asked an AI tool for “a monthly payout statement endpoint for hosts” and opened this pull request. CI is green. Would you approve it?'],
      ['You', 'Give me ten minutes with it.'],
    ],
  },
  sections: [
    {
      title: 'The pull request',
      text: ['**“Add monthly payout statement for hosts.”** Two changes and one test. Read it as a reviewer before scrolling further: there are at least six problems a senior reviewer must not let through.'],
      blocks: [
        {
          path: 'routes/api.php (the line the pull request adds, inside the host group)',
          fragment: true,
          code: String.raw`Route::get('/properties/{property}/statement', PayoutStatementController::class);`,
        },
        {
          path: 'app/Http/Controllers/PayoutStatementController.php (as proposed)',
          fragment: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Property;
use App\Models\Refund;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

class PayoutStatementController extends Controller
{
    /**
     * Returns the monthly payout statement for a property.
     */
    public function __invoke(Request $request, Property $property): JsonResponse
    {
        $month = Carbon::parse($request->input('month'));

        $data = Cache::remember("statement:{$property->id}:{$month->format('Y-m')}", 86400, function () use ($property, $month) {
            $bookings = Booking::where('property_id', $property->id)
                ->where('status', 'confirmed')
                ->whereBetween('check_out', [$month->startOfMonth(), $month->endOfMonth()])
                ->get();

            $rows = [];
            $total = 0;

            foreach ($bookings as $booking) {
                $refunds = Refund::whereHas('payment', fn ($q) => $q->where('booking_id', $booking->id))->sum('amount_cents');
                $commission = $booking->total_cents * 0.15;
                $payout = ($booking->total_cents - $commission - $refunds) / 100;

                $rows[] = [
                    'booking' => $booking->id,
                    'guest' => $booking->guest_name,
                    'email' => $booking->guest_email,
                    'check_out' => $booking->check_out->toDateString(),
                    'payout' => round($payout, 2),
                ];
                $total += $payout;
            }

            return ['rows' => $rows, 'total' => round($total, 2), 'currency' => 'EUR'];
        });

        return response()->json($data);
    }
}`,
        },
        {
          path: 'tests/Feature/PayoutStatementTest.php (as proposed)',
          fragment: true,
          code: String.raw`<?php

use App\Models\Property;

it('returns the statement', function () {
    $property = Property::factory()->create();

    $this->actingAs(hostOf($property))
        ->getJson("/api/v1/properties/{$property->id}/statement?month=2027-07")
        ->assertOk()
        ->assertJsonStructure(['rows', 'total', 'currency']);
});`,
          after: ['The test is green, and it proves almost nothing: no bookings, so no money is ever calculated, and it only checks the **shape** of the answer. AI-written tests tend to test what the code does, not what it should do.'],
        },
      ],
    },
    {
      title: 'The review: eight findings',
      text: ['Each finding names the line, what goes wrong in production, and the scene where the course hit the same bug. The first three are blockers on their own.'],
      blocks: [
        {
          table: [
            ['#', 'The line', 'What goes wrong', 'Scene'],
            ['1', 'the route has no `->can()`', '**Any logged-in user of any account** reads any property’s payouts by changing the id: an IDOR. A cleaner of the right account sees money too.', '19, 20'],
            ['2', '`Carbon::parse($request->input(\'month\'))`', 'No `month` gives **this month** silently (`parse(null)` is now); `month=abc` is a 500. Input is never validated.', '3'],
            ['3', '`[$month->startOfMonth(), $month->endOfMonth()]`', '`Illuminate\\Support\\Carbon` is **mutable**: both calls change `$month` and return the same object, so both bounds are 31 July 23:59:59. The statement is **empty** for every month, and the shape-only test can’t tell.', '1'],
            ['4', '`$booking->total_cents * 0.15` … `/ 100` … `round()`', 'Money as floats, rounded per row and summed: the total drifts by cents from the sum of the rows. Finance reconciles to the cent.', '1, 11'],
            ['5', '`\'currency\' => \'EUR\'`', 'Danish hosts are paid in DKK. Their statement says EUR next to DKK amounts.', '1'],
            ['6', '`Refund::whereHas(...)->sum()` inside the loop', 'One query per booking: an agency’s month is 400 bookings, 401 queries (strict mode doesn’t flag it: it’s a query, not a lazy load).', '32'],
            ['7', '`\'email\' => $booking->guest_email`', 'A guest’s email in a payout document: not needed for the purpose, so not allowed (data minimisation, GDPR), and now stored in a cache for a day.', '31, 36'],
            ['8', '`Cache::remember(..., 86400, ...)`', 'A refund made today is missing from the statement until tomorrow, with nothing to clear it. A money document is computed, never cached, unless something invalidates it.', '33'],
          ],
          after: [
            'Smaller notes for the same review: `\'confirmed\'` should be `BookingStatus::Confirmed`; the closure parameter `$q` has no type; the docblock repeats the method name and says nothing. And the logic belongs in an action, so the controller only handles HTTP (scene 43’s architecture test would flag a query in a controller only if it used `DB`; the rule is wider than the test).',
            'The verdict: **request changes**. And the second review comment matters as much as the first: ask for tests with bookings, refunds, a DKK property and a month boundary, because those are the tests that would have failed.',
          ],
        },
      ],
    },
    {
      title: 'The version that can be merged',
      text: ['Owners only, a validated month, immutable dates with an exclusive end, integer money in the property’s currency through `Money`, refunds summed in the same query, no guest data, no cache, and the work in an action.'],
      blocks: [
        {
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\BookingSnapshot;
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
use App\Enums\GuestChannel;
use App\Money\Money;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'guest_phone', 'guest_channel', 'check_in', 'check_out', 'guests'];

    protected $hidden = ['door_code'];                             // never in JSON, logs or toArray()

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
            'door_code' => 'encrypted',                            // encrypted with APP_KEY in the database
            'guest_channel' => GuestChannel::class,                // how the guest wants to hear from us
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

    /** Refunds of this booking's payments: refunds → payments.booking_id */
    public function refunds(): HasManyThrough
    {
        return $this->hasManyThrough(Refund::class, Payment::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(BookingLineItem::class);
    }

    public function scheduledMessages(): HasMany
    {
        return $this->hasMany(ScheduledMessage::class);
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

    /** Everything a date change can alter, as a plain value that can be stored and handed back. */
    public function snapshot(): BookingSnapshot
    {
        return new BookingSnapshot(
            $this->stay->checkIn->toDateString(),
            $this->stay->checkOut->toDateString(),
            $this->total->amount,
            $this->total->currency->value,
            $this->lineItems()->orderBy('id')->get(['type', 'description', 'amount_cents', 'currency'])
                ->map(fn (BookingLineItem $line): array => [
                    'type' => $line->type->value, 'description' => $line->description,
                    'amount_cents' => $line->amount_cents, 'currency' => $line->currency,
                ])->all(),
        );
    }

    public function restore(BookingSnapshot $snapshot): void
    {
        $this->stay = Stay::fromDates($snapshot->checkIn, $snapshot->checkOut);
        $this->total = Money::of($snapshot->totalCents, $snapshot->currency);
        $this->save();

        $this->lineItems()->delete();                                          // the bill goes back line by line
        $this->lineItems()->createMany(array_map(fn (array $line): array => [
            'type' => $line['type'],
            'description' => $line['description'],
            'amount' => Money::of($line['amount_cents'], $line['currency']),
        ], $snapshot->lines));
    }
}`,
        },
        {
          path: 'app/Payments/BuildPayoutStatement.php',
          code: String.raw`<?php

namespace App\Payments;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Money\Currency;
use App\Money\Money;
use Carbon\CarbonImmutable;

final class BuildPayoutStatement
{
    public const COMMISSION_BPS = 1_500;                                // Nordic Stays' commission: 15% of the booking

    /**
     * @return array{month: string, currency: string, rows: list<array<string, int|string|null>>, totals: array<string, int>}
     *         every amount in minor units of the property's currency
     */
    public function for(Property $property, CarbonImmutable $month): array
    {
        $first = $month->startOfMonth();                                 // immutable: $month itself never changes
        $next = $first->addMonth();
        $currency = Currency::from($property->currency);

        $bookings = $property->bookings()
            ->where('status', BookingStatus::Confirmed)
            ->where('check_out', '>=', $first->toDateString())
            ->where('check_out', '<', $next->toDateString())               // every day of the month, nothing of the next
            ->withSum('refunds', 'amount_cents')                          // one query for all refunds, not one per booking
            ->orderBy('check_out')
            ->get();

        $totals = ['gross' => Money::zero($currency), 'commission' => Money::zero($currency), 'refunds' => Money::zero($currency), 'payout' => Money::zero($currency)];
        $rows = [];

        foreach ($bookings as $booking) {
            /** @var Booking $booking */
            $gross = $booking->total;
            $commission = $gross->percent(self::COMMISSION_BPS);              // integer cents, rounded once, half up (scene 1)
            $refunds = Money::of((int) $booking->refunds_sum_amount_cents, $currency);
            $payout = $gross->add($commission->negate())->add($refunds->negate());

            $rows[] = [
                'booking' => $booking->id,
                'check_in' => $booking->check_in->toDateString(),
                'check_out' => $booking->check_out->toDateString(),
                'channel' => $booking->channel?->value,
                'gross' => $gross->amount,
                'commission' => $commission->amount,
                'refunds' => $refunds->amount,
                'payout' => $payout->amount,
            ];

            foreach (['gross' => $gross, 'commission' => $commission, 'refunds' => $refunds, 'payout' => $payout] as $key => $amount) {
                $totals[$key] = $totals[$key]->add($amount);              // the totals are the sum of the rows, exactly
            }
        }

        return [
            'month' => $first->format('Y-m'),
            'currency' => $currency->value,
            'rows' => $rows,
            'totals' => array_map(fn (Money $amount): int => $amount->amount, $totals),
        ];
    }
}`,
          after: ['No guest name either: the booking id is enough for a host to find the stay, and the statement is a money document that gets emailed and printed.'],
        },
        {
          path: 'app/Http/Controllers/PayoutStatementController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Property;
use App\Payments\BuildPayoutStatement;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayoutStatementController extends Controller
{
    public function __invoke(Request $request, Property $property, BuildPayoutStatement $statement): JsonResponse
    {
        $data = $request->validate(['month' => ['required', 'date_format:Y-m']]);   // 422 for a missing or wrong month

        return response()->json($statement->for($property, CarbonImmutable::createFromFormat('!Y-m', $data['month'])));
    }
}`,
          after: ['`!Y-m` resets every field not in the format: without the `!`, `createFromFormat(\'Y-m\', \'2027-02\')` takes today’s day, and on the 30th that is “30 February”, which PHP turns into 2 March.'],
        },
        {
          path: 'app/Policies/PropertyPolicy.php',
          code: String.raw`<?php

namespace App\Policies;

use App\Enums\MembershipRole;
use App\Models\Property;
use App\Models\User;

class PropertyPolicy
{
    public function createBooking(User $user, Property $property): bool
    {
        $role = $user->roleIn($property->account_id);                    // null when not a member

        return in_array($role, [MembershipRole::Owner, MembershipRole::CoHost], true);
    }

    public function update(User $user, Property $property): bool
    {
        return in_array($user->roleIn($property->account_id), [MembershipRole::Owner, MembershipRole::CoHost], true);
    }

    /** Payouts: owners only, through Gate::before. Co-hosts run the calendar, not the money. */
    public function viewFinancials(User $user, Property $property): bool
    {
        return false;
    }
}`,
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
use App\Http\Controllers\ExportController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\PayoutStatementController;
use App\Http\Controllers\PropertyController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\Idempotent;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy, retries answered once.
Route::middleware(['auth:sanctum', SetCurrentAccount::class, Idempotent::class])->prefix('v1')->group(function (): void {
    Route::get('/properties', [PropertyController::class, 'index']);             // the current account's properties
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');
    Route::get('/properties/{property}/statement', PayoutStatementController::class)->can('viewFinancials', 'property');   // owners only

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

    Route::get('/exports/{type}', ExportController::class);                    // payouts, occupancy, tax; owners only (the controller checks)
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
        },
      ],
    },
  ],
  tests: {
    summary: 'The tests the pull request should have had: who may see it, the month’s edges, exact money, the currency, refunds, and the query count',
    blocks: [
      {
        path: 'tests/Feature/PayoutStatementTest.php',
        code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->property = Property::factory()->create(['currency' => 'DKK']);
    $this->owner = hostOf($this->property);
});

function statement(?string $month = '2027-07'): Illuminate\Testing\TestResponse
{
    return test()->actingAs(test()->owner)->getJson('/api/v1/properties/' . test()->property->id . '/statement' . ($month ? "?month={$month}" : ''));
}

it('counts every booking that checks out in the month, and none from the next', function () {
    Booking::factory()->for($this->property)->forStay('2027-06-29', 2)->create(['total_cents' => 100_00, 'currency' => 'DKK']);   // out 1 July
    Booking::factory()->for($this->property)->forStay('2027-07-28', 3)->create(['total_cents' => 200_00, 'currency' => 'DKK']);   // out 31 July
    Booking::factory()->for($this->property)->forStay('2027-07-30', 2)->create(['total_cents' => 300_00, 'currency' => 'DKK']);   // out 1 August

    expect(statement()->json('rows'))->toHaveCount(2);                          // finding 3: never empty, never the wrong month
});

it('pays out in integer minor units of the property’s currency, rows adding up to the total', function () {
    $booking = Booking::factory()->for($this->property)->forStay('2027-07-10', 3)->create(['total_cents' => 45_033, 'currency' => 'DKK']);
    $payment = Payment::factory()->for($booking)->create(['amount_cents' => 45_033, 'currency' => 'DKK']);
    $payment->refunds()->create(['amount_cents' => 5_000, 'currency' => 'DKK', 'provider_refund_id' => 're_1', 'reason' => 'requested_by_customer']);

    $response = statement();

    expect($response->json('currency'))->toBe('DKK')                             // finding 5
        ->and($response->json('rows.0'))->toMatchArray(['gross' => 45_033, 'commission' => 6_755, 'refunds' => 5_000, 'payout' => 33_278])   // findings 4 and 6
        ->and($response->json('totals.payout'))->toBe(33_278)
        ->and($response->json('rows.0'))->not->toHaveKeys(['guest', 'email']);    // finding 7
});

it('runs the same number of queries for 2 bookings and for 20', function () {
    $count = function (): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        statement();

        return count(DB::getQueryLog());
    };

    Booking::factory()->count(2)->for($this->property)->forStay('2027-07-10', 3)->create(['currency' => 'DKK']);
    $few = $count();
    Booking::factory()->count(18)->for($this->property)->forStay('2027-07-10', 3)->create(['currency' => 'DKK']);

    expect($count())->toBe($few);                                                // finding 6
});

it('is for the account’s owners only, and needs a real month', function () {
    $this->actingAs(hostOf($this->property, MembershipRole::CoHost))->getJson("/api/v1/properties/{$this->property->id}/statement?month=2027-07")->assertForbidden();
    $this->actingAs(memberOf(Property::factory()->create()->account))->getJson("/api/v1/properties/{$this->property->id}/statement?month=2027-07")->assertForbidden();   // finding 1

    statement(null)->assertUnprocessable();                                       // finding 2
    statement('July')->assertUnprocessable();
});`,
        after: [
          '45,033 × 15% = 6,754.95, which `Money::percent()` rounds once to **6,755**. The payout is 45,033 − 6,755 − 5,000 = **33,278**, the same in the row and in the total. The float version gives 332.78 per row and a total that drifts as rows are added.',
          'Each test names the finding it proves. In a real review, these are what you ask for, not only the fixes.',
        ],
      },
    ],
  },
  next: 'That is the course: one rental platform, from launch week to an interview, through 45 incidents a real team ships and fixes. The page after this one builds the five patterns that had no honest place in the story.',
};
