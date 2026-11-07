// Scene 10 · Strategy and Null Object: cancellation policies.

export default {
  description: 'A guest who booked under a strict policy got a full refund, because the host had switched the property to flexible since, and the refund code read today’s setting. Fix it in Laravel with the policy copied onto the booking, one Strategy class per policy, and a Null Object for bookings made before policies existed.',
  incident: {
    channel: '#finance',
    when: 'Thursday 11:40',
    messages: [
      ['Lina · finance', 'A guest cancelled the Lake Cabin **three days** before arrival and got **€1,105.50 back, everything**. She booked in August, under the **strict** policy: nothing back in the last 14 days.'],
      ['Ahmed · host', 'I switched the cabin to **flexible** last week, for new winter bookings. Not for the bookings I already had. I turned down other guests for her dates.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/CancelBookingController.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\PaymentStatus;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Money\Money;
use App\Payments\PaymentGateway;

class CancelBookingController extends Controller
{
    public function __invoke(Booking $booking, PaymentGateway $gateway): BookingResource
    {
        $booking->state()->cancel($booking);                              // scene 9

        $payment = $booking->payments()->where('status', PaymentStatus::Succeeded)->latest('id')->first();
        $paid = $payment?->amount_cents ?? 0;

        $hours = now()->diffInHours($booking->check_in);              // to midnight UTC, not the guest's check-in time

        $refund = match ($booking->property->cancellation_policy) {   // the property's policy TODAY
            'flexible' => $hours >= 24 ? $paid : 0,
            'moderate' => $hours >= 120 ? $paid : $paid * 0.5,
            'strict' => $hours >= 336 ? $paid * 0.5 : 0,
        };

        if ($refund > 0) {
            $gateway->refund($payment->provider_payment_id, Money::of((int) $refund, $payment->currency), "payment-{$payment->id}-cancel");
        }

        return new BookingResource($booking);
    }
}`,
          after: ['The rules themselves are right. The input is wrong: the policy comes from the **property**, read at the moment of cancelling. The guest agreed to *strict* in August; the property says *flexible* today, so she gets flexible terms. Any host who changes a policy silently rewrites every booking already made.', 'Two smaller bugs ride along: the hours are counted to midnight UTC instead of the guest’s real check-in moment in the property’s timezone (scene 2), and `$paid * 0.5` is a float again (scene 1). And the rules are a `match` inside a controller, so they can’t be tested without an HTTP request.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: the policy is part of the booking',
      text: ['The guest agreed to the policy that was shown when they booked, so the booking keeps a **copy**, made once, at booking time. The property’s setting only decides the terms of **new** bookings. Bookings made before policies existed get `null`, on purpose.'],
      blocks: [
        {
          text: ['The property’s column was added last month with the first refund code. If your app doesn’t have it yet, this is it:'],
          path: 'database/migrations/2026_01_20_000001_add_cancellation_policy_to_properties_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->string('cancellation_policy')->default('moderate');   // flexible, moderate, strict: for new bookings
        });
    }
};`,
        },
        {
          text: ['The booking’s copy:'],
          path: 'database/migrations/2026_02_05_000001_add_cancellation_policy_to_bookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('cancellation_policy')->nullable();   // copied at booking time; null on older bookings
        });
    }
};`,
        },
        {
          text: ['The copy is made when the booking is created:'],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    public function __construct(private PriceQuoter $quoter)
    {
    }

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if ($property->bookings()->overlapping($stay)->exists()) {
                throw BookingConflict::for($stay);
            }

            $quote = $this->quoter->quote($property, $stay);              // the same price the page showed

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $quote->total();
            $booking->cancellation_policy = $property->cancellation_policy;   // the terms the guest agreed to, frozen
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type,
                'description' => $line->description,
                'amount' => $line->amount,
            ], $quote->lines));                                           // every line of the bill, kept

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
        },
        {
          text: ['Both models cast the column to the `CancellationPolicy` enum below. The property:'],
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use App\Casts\MoneyCast;
use App\Enums\CancellationPolicy;
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

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }
}`,
        },
        {
          text: ['The booking, which also gets `refundPolicy()`, explained in part 3:'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

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
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'check_in', 'check_out', 'guests'];

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

    public function lineItems(): HasMany
    {
        return $this->hasMany(BookingLineItem::class);
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
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: one class per policy',
      text: [
        'Every policy answers the same question: **given what the guest paid and how long before check-in they cancel, how much goes back?** Each answer is its own small class behind one interface. The code that cancels a booking only knows the interface.',
      ],
      blocks: [
        {
          path: 'app/Bookings/Refunds/RefundPolicy.php',
          code: String.raw`<?php

namespace App\Bookings\Refunds;

use App\Money\Money;

interface RefundPolicy
{
    /** @param int $hoursBeforeCheckIn negative once check-in time has passed */
    public function refundFor(Money $paid, int $hoursBeforeCheckIn): Money;
}`,
        },
        {
          path: 'app/Bookings/Refunds/FlexiblePolicy.php',
          code: String.raw`<?php

namespace App\Bookings\Refunds;

use App\Money\Money;

/** Full refund until 24 hours before check-in. */
final class FlexiblePolicy implements RefundPolicy
{
    public function refundFor(Money $paid, int $hoursBeforeCheckIn): Money
    {
        return $hoursBeforeCheckIn >= 24 ? $paid : Money::zero($paid->currency);
    }
}`,
        },
        {
          path: 'app/Bookings/Refunds/ModeratePolicy.php',
          code: String.raw`<?php

namespace App\Bookings\Refunds;

use App\Money\Money;

/** Full refund until 5 days before check-in, half after. */
final class ModeratePolicy implements RefundPolicy
{
    public function refundFor(Money $paid, int $hoursBeforeCheckIn): Money
    {
        return $hoursBeforeCheckIn >= 5 * 24 ? $paid : $paid->percent(5_000);
    }
}`,
        },
        {
          path: 'app/Bookings/Refunds/StrictPolicy.php',
          code: String.raw`<?php

namespace App\Bookings\Refunds;

use App\Money\Money;

/** Half back until 14 days before check-in, nothing after. */
final class StrictPolicy implements RefundPolicy
{
    public function refundFor(Money $paid, int $hoursBeforeCheckIn): Money
    {
        return $hoursBeforeCheckIn >= 14 * 24 ? $paid->percent(5_000) : Money::zero($paid->currency);
    }
}`,
        },
        {
          title: 'The enum picks the class',
          text: ['`match` without a `default`: a new policy added to the enum without a class is a fatal error in the first test, not a full refund in production.'],
          path: 'app/Enums/CancellationPolicy.php',
          code: String.raw`<?php

namespace App\Enums;

use App\Bookings\Refunds\FlexiblePolicy;
use App\Bookings\Refunds\ModeratePolicy;
use App\Bookings\Refunds\RefundPolicy;
use App\Bookings\Refunds\StrictPolicy;

enum CancellationPolicy: string
{
    case Flexible = 'flexible';
    case Moderate = 'moderate';
    case Strict = 'strict';

    public function refundPolicy(): RefundPolicy
    {
        return match ($this) {
            self::Flexible => new FlexiblePolicy(),
            self::Moderate => new ModeratePolicy(),
            self::Strict => new StrictPolicy(),
        };
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: a policy that means "no policy"',
      text: [
        'About 300 bookings from before launch week have no policy. Finance’s rule for them: refund nothing automatically; support decides by hand. The naive way puts `if ($booking->cancellation_policy === null)` in front of every use, and the first place that forgets it crashes or, worse, falls into an `else` like the one above.',
        'Instead, "no policy" becomes a policy of its own: an object with the same interface that **does nothing**. Callers never check for null, because there is no null to check.',
      ],
      blocks: [
        {
          path: 'app/Bookings/Refunds/NoAutomaticRefund.php',
          code: String.raw`<?php

namespace App\Bookings\Refunds;

use App\Money\Money;

/** For bookings made before cancellation policies existed: support refunds them by hand. */
final class NoAutomaticRefund implements RefundPolicy
{
    public function refundFor(Money $paid, int $hoursBeforeCheckIn): Money
    {
        return Money::zero($paid->currency);
    }
}`,
          after: ['This is what the booking’s `refundPolicy()` (part 1) returns when `cancellation_policy` is null. No caller ever sees the null.'],
        },
      ],
    },
    {
      title: 'The fix, part 4: cancelling uses whichever policy it gets',
      text: [
        'The status change and the refund amount are decided in one transaction. The refund itself is sent **after** the commit, by a queued job, so the booking row isn’t locked while Stripe answers, and a slow or failing Stripe call retries without cancelling twice.',
        'Hours are counted to the guest’s real check-in moment, built from the property’s timezone (scene 2).',
      ],
      blocks: [
        {
          path: 'app/Bookings/CancelBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\PaymentStatus;
use App\Jobs\RefundCancelledBooking;
use App\Models\Booking;
use App\Money\Money;
use Illuminate\Support\Facades\DB;

final class CancelBooking
{
    /** @return Money the amount that will be refunded */
    public function handle(Booking $booking): Money
    {
        return DB::transaction(function () use ($booking): Money {
            $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();
            $nothing = Money::zero($booking->total->currency);

            if (! $booking->state()->cancel($booking)) {          // scene 9: already cancelled
                return $nothing;
            }

            $payment = $booking->payments()
                ->where('status', PaymentStatus::Succeeded)
                ->whereNotNull('provider_payment_id')            // card payments; bank transfers go back by hand
                ->latest('id')
                ->first();

            if ($payment === null) {
                return $nothing;
            }

            $hours = (int) floor(now()->diffInHours($booking->stay->checkInAt($booking->property), false));
            $refund = $booking->refundPolicy()->refundFor(Money::of($payment->amount_cents, $payment->currency), $hours);

            if ($refund->amount > 0) {
                RefundCancelledBooking::dispatch($payment, $refund)->afterCommit();
            }

            return $refund;
        });
    }
}`,
        },
        {
          title: 'The refund job',
          text: ['The same idempotency rules as scene 9: a key built from our own data, and `createOrFirst()` on Stripe’s refund id.'],
          path: 'app/Jobs/RefundCancelledBooking.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Models\Payment;
use App\Money\Money;
use App\Payments\PaymentGateway;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class RefundCancelledBooking implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public Payment $payment, public Money $amount)
    {
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [30, 120, 600, 1800];
    }

    public function handle(PaymentGateway $gateway): void
    {
        $refundId = $gateway->refund(
            $this->payment->provider_payment_id,
            $this->amount,
            "payment-{$this->payment->id}-cancellation-refund",
        );

        $this->payment->refunds()->createOrFirst(['provider_refund_id' => $refundId], [
            'amount_cents' => $this->amount->amount,
            'currency' => $this->amount->currency->value,
            'reason' => 'Cancelled by the guest',
        ]);
    }
}`,
          after: ['`Money` is a readonly value object, so the queue serializes it and gets the same value back in the worker.'],
        },
        {
          title: 'The controller only asks',
          text: ['The rules left the controller. It calls the action and returns the booking with the refund amount:'],
          path: 'app/Http/Controllers/CancelBookingController.php (after)',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\CancelBooking;
use App\Http\Resources\BookingResource;
use App\Models\Booking;

class CancelBookingController extends Controller
{
    public function __invoke(Booking $booking, CancelBooking $cancel): BookingResource
    {
        $refund = $cancel->handle($booking);                              // the rules live in the action and the policies

        return (new BookingResource($booking->refresh()))
            ->additional(['refund' => ['amount' => $refund->amount, 'currency' => $refund->currency->value]]);
    }
}`,
        },
        {
          text: ['Its route has existed since launch; here it is with the others:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\StripeWebhookController;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api: the full URL is /api/v1/properties/{property}/bookings.
Route::get('/v1/properties/{property}/quote', QuoteController::class);   // public: guests aren't logged in

Route::post('/v1/properties/{property}/bookings', [BookingController::class, 'store'])
    ->middleware('auth:sanctum')
    ->can('createBooking', 'property');

Route::post('/v1/bookings/{booking}/payment', BookingPaymentController::class)
    ->middleware('auth:sanctum');

Route::post('/v1/bookings/{booking}/cancel', CancelBookingController::class)
    ->middleware('auth:sanctum');                                       // who may: scenes 19 and 20

Route::post('/v1/bookings/{booking}/mark-paid', MarkBookingPaidController::class)
    ->middleware('auth:sanctum');                                       // who may: scenes 19 and 20

// Stripe calls this, not a browser. API routes have no CSRF check, which Stripe couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Strategy', 'Null Object'],
    rules: [
      ['Strategy', 'Several interchangeable ways of doing one job, each in its own class behind one interface. The code that uses them picks one and doesn’t care which.'],
      ['Null Object', 'An object that stands for "nothing" with the same interface as the real ones, and safely does nothing, so callers never check for null.'],
    ],
    points: [
      '`CancelBooking` has no `if` about policies at all. Adding a "super strict" policy is one class and one `match` arm; `CancelBooking` doesn’t change.',
      'Each policy is tiny and tested alone, with plain numbers, no database.',
      '`NoAutomaticRefund` turns a missing value into a decision finance actually made, instead of a crash or a silent default.',
    ],
    whenNot: [
      'Two variants that will never grow: an `if` is fine. Strategy pays off when variants are many, change separately, or come from data (like this enum).',
      'Don’t use a Null Object where "nothing" is an error. A booking with no **property** is a bug that must throw, not a "null property" that quietly does nothing.',
    ],
  },
  laravel: {
    title: 'Laravel does the same',
    text: [
      'Laravel’s cache has a `null` store: set `CACHE_STORE=null` and every `Cache::put()` and `Cache::get()` keeps working, while nothing is stored. It’s a Null Object for the whole cache, and it implements the same `Store` interface as Redis and the database store, which are the cache’s strategies.',
    ],
    blocks: [
      {
        path: 'Illuminate/Cache/NullStore.php (simplified)',
        fragment: true,
        code: String.raw`class NullStore extends TaggableStore implements LockProvider
{
    public function get($key)
    {
        return null;                                        // always a miss
    }

    public function put($key, $value, $seconds)
    {
        return false;                                       // accepted, not stored
    }

    public function forget($key)
    {
        return true;
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'Every policy at its boundaries, the null policy, and cancellation end to end',
    blocks: [
      {
        path: 'tests/Unit/RefundPolicyTest.php',
        code: String.raw`<?php

use App\Bookings\Refunds\NoAutomaticRefund;
use App\Enums\CancellationPolicy;
use App\Money\Money;

it('refunds what each policy promises', function (CancellationPolicy $policy, int $hoursBefore, int $refund) {
    expect($policy->refundPolicy()->refundFor(Money::of(110_550, 'EUR'), $hoursBefore)->amount)->toBe($refund);
})->with([
    'flexible, 2 days before' => [CancellationPolicy::Flexible, 48, 110_550],
    'flexible, 23 hours before' => [CancellationPolicy::Flexible, 23, 0],
    'moderate, exactly 5 days' => [CancellationPolicy::Moderate, 120, 110_550],
    'moderate, 4 days' => [CancellationPolicy::Moderate, 96, 55_275],
    'strict, 14 days' => [CancellationPolicy::Strict, 336, 55_275],
    'strict, 3 days (the incident)' => [CancellationPolicy::Strict, 72, 0],
    'strict, after check-in' => [CancellationPolicy::Strict, -5, 0],
]);

it('refunds nothing automatically without a policy', function () {
    expect((new NoAutomaticRefund())->refundFor(Money::of(110_550, 'EUR'), 1_000)->amount)->toBe(0);
});`,
      },
      {
        path: 'tests/Feature/CancelBookingTest.php',
        code: String.raw`<?php

use App\Bookings\CancelBooking;
use App\Enums\BookingStatus;
use App\Enums\CancellationPolicy;
use App\Enums\PaymentStatus;
use App\Jobs\RefundCancelledBooking;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\Refund;
use App\Payments\PaymentGateway;
use Illuminate\Support\Facades\Queue;
use Tests\Fakes\FakePaymentGateway;

function paidBooking(?CancellationPolicy $policy): Booking
{
    // The clock is frozen at 2027-06-01 10:00 UTC; check-in 2027-06-04 15:00 in Copenhagen is 75 hours away.
    $booking = Booking::factory()->forStay('2027-06-04', 7)->create(['cancellation_policy' => $policy]);
    Payment::factory()->for($booking)->succeeded()->create(['amount_cents' => 110_550, 'currency' => 'EUR']);

    return $booking;
}

it('cancels a strict booking 3 days out with no refund', function () {
    Queue::fake();
    $booking = paidBooking(CancellationPolicy::Strict);

    $refund = app(CancelBooking::class)->handle($booking);

    expect($refund->amount)->toBe(0)
        ->and($booking->fresh()->status)->toBe(BookingStatus::Cancelled);
    Queue::assertNotPushed(RefundCancelledBooking::class);
});

it('refunds half on a moderate booking 3 days out, once', function () {
    $gateway = new FakePaymentGateway();
    $this->app->instance(PaymentGateway::class, $gateway);
    $booking = paidBooking(CancellationPolicy::Moderate);

    app(CancelBooking::class)->handle($booking);
    app(CancelBooking::class)->handle($booking);                         // a double click

    expect(Refund::sole()->amount_cents)->toBe(55_275)
        ->and($gateway->refunded)->toHaveCount(1);
});

it('keeps the policy the guest booked under, even after the host changes it', function () {
    Queue::fake();
    $booking = paidBooking(CancellationPolicy::Strict);
    $booking->property->forceFill(['cancellation_policy' => CancellationPolicy::Flexible])->save();   // the incident

    expect(app(CancelBooking::class)->handle($booking)->amount)->toBe(0);
    Queue::assertNotPushed(RefundCancelledBooking::class);
});

it('treats a booking without a policy as no automatic refund', function () {
    Queue::fake();

    app(CancelBooking::class)->handle(paidBooking(null));

    Queue::assertNotPushed(RefundCancelledBooking::class);
});`,
        after: ['The second `handle()` returns early because `CancelledState::cancel()` reports no change, so no second job is even queued; the idempotency key is the safety net under that.'],
      },
    ],
  },
  next: 'Refunds follow the rules now. Friday morning, finance compares Stripe with our books for the month and finds €40 nobody can explain.',
};
