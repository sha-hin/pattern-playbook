// Scene 10 · Strategy and Null Object: cancellation policies.

export default {
  description: 'A guest cancelled a strict, non-refundable stay and got everything back, because the refund rules were an if-chain that fell through. Fix it with the Strategy pattern in Laravel, one class per cancellation policy, and a Null Object for bookings made before policies existed.',
  incident: {
    channel: '#finance',
    when: 'Thursday 11:40',
    messages: [
      ['Lina · finance', 'A guest cancelled the Lake Cabin **three days** before arrival. The cabin is on the **strict** policy: 50% back until 14 days before, nothing after. We refunded **€1,105.50, the full amount**.'],
      ['Ahmed · host', 'I turned down two other guests for those dates. Who pays me?'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/CancelBookingController.php (before)',
          broken: true, fragment: true,
          code: String.raw`$days = now()->diffInDays($booking->check_in);

if ($property->cancellation_policy === 'flexible' && $days >= 1) {
    $refund = $paid;
} elseif ($property->cancellation_policy === 'moderate') {
    $refund = $days >= 5 ? $paid : $paid * 0.5;
} elseif ($property->cancelation_policy === 'strict' && $days >= 14) {    // typo: always null
    $refund = $paid * 0.5;
} else {
    $refund = $paid;                                                       // "when in doubt, refund"
}`,
          after: [
            'One typo in a property name makes the strict branch unreachable, and the `else` turns "I don’t know" into "refund everything". Nothing failed; the money just left.',
            'There are more problems hiding in the same lines. The policy is read from the **property**, so a host who changes the policy changes the terms of bookings already made. `diffInDays` counts from the server’s midnight, not from the guest’s check-in time in the property’s timezone (scene 2). And `$paid * 0.5` is a float again (scene 1).',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: the policy is part of the booking',
      text: ['The guest agreed to the policy that was shown when they booked, so the booking keeps a **copy**. Bookings made before policies existed have none: `null`, on purpose.'],
      blocks: [
        {
          path: 'database/migrations/2026_02_05_000001_add_cancellation_policy.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->string('cancellation_policy')->default('moderate');
        });

        Schema::table('bookings', function (Blueprint $table) {
            $table->string('cancellation_policy')->nullable();   // copied at booking time; null on older bookings
        });
    }
};`,
        },
        {
          path: 'app/Bookings/CreateBooking.php (one line added)',
          fragment: true,
          code: String.raw`$booking->cancellation_policy = $property->cancellation_policy;   // the terms the guest agreed to, frozen`,
          after: ['Both models cast the column to the `CancellationPolicy` enum below.'],
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
        },
        {
          path: 'app/Models/Booking.php (added)',
          fragment: true,
          code: String.raw`public function refundPolicy(): RefundPolicy
{
    return $this->cancellation_policy?->refundPolicy() ?? new NoAutomaticRefund();   // never null
}`,
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
    Queue::assertNothingPushed();
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
