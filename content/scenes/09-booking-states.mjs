// Scene 9 · State: what a booking may do depends on where it is in its life.

export default {
  description: 'A guest paid two minutes after her hold expired, and the code had no answer: confirm, refund, or crash. Fix it with the State pattern in Laravel: one class per booking status with its allowed transitions, holds that expire on a schedule, and refunds made safe to retry with Stripe idempotency keys.',
  incident: {
    channel: '#support',
    when: 'Wednesday 14:31',
    messages: [
      ['Mona · support', 'A guest paid at 14:29. Her hold had expired at 14:27. Stripe took **€1,105.50**, the booking says **expired**, and the webhook job has failed five times with "Booking 812 is expired and can’t be confirmed".'],
      ['Sara · tech lead', 'Also: who expires holds? Half of them never expire at all; the code only checks when someone opens the booking.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['The rules about what can happen to a booking are spread over every class that touches it, as `if` checks on the status:'],
      blocks: [
        {
          path: 'scattered across the app (before)',
          broken: true, fragment: true,
          code: String.raw`// BookingConfirmation (scene 6)
if ($booking->status !== BookingStatus::Pending) {
    throw new LogicException("Booking {$booking->id} is {$booking->status->value} and can't be confirmed.");
}

// BookingController@show: the only place a hold "expires"
if ($booking->status === BookingStatus::Pending && $booking->expires_at->isPast()) {
    $booking->update(['status' => BookingStatus::Expired]);
}

// CancelBookingController
if (in_array($booking->status, [BookingStatus::Pending, BookingStatus::Confirmed])) { /* ... */ }`,
          after: [
            'Nobody wrote down what an **expired** booking may do when a late payment arrives, so the answer was "throw". The guest’s money is now held with no booking and no refund.',
            'The real rule, once the team agreed on it: a late payment **re-confirms the booking if its nights are still free**, and is **refunded in full** if someone else has booked them since.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one class per state',
      text: [
        'Every status gets a class that answers the same three questions: what happens if you **confirm**, **cancel** or **expire** a booking in this state? A base class makes every transition invalid by default, so each state only writes down what it allows.',
      ],
      blocks: [
        {
          path: 'app/Bookings/States/BookingState.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Models\Booking;

abstract class BookingState
{
    /** @return bool true when the booking changed, false when it was already in the target state */
    public function confirm(Booking $booking): bool
    {
        throw InvalidTransition::from($booking, 'confirm');
    }

    public function cancel(Booking $booking): bool
    {
        throw InvalidTransition::from($booking, 'cancel');
    }

    public function expire(Booking $booking): bool
    {
        throw InvalidTransition::from($booking, 'expire');
    }
}`,
        },
        {
          path: 'app/Bookings/States/InvalidTransition.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Models\Booking;
use LogicException;

final class InvalidTransition extends LogicException
{
    public static function from(Booking $booking, string $action): self
    {
        return new self("A {$booking->status->value} booking can't {$action} (booking {$booking->id}).");
    }
}`,
        },
        {
          title: 'Pending: the hold',
          path: 'app/Bookings/States/PendingState.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Enums\BookingStatus;
use App\Models\Booking;

final class PendingState extends BookingState
{
    public function confirm(Booking $booking): bool
    {
        $booking->status = BookingStatus::Confirmed;
        $booking->confirmed_at = now();
        $booking->expires_at = null;
        $booking->save();

        return true;
    }

    public function cancel(Booking $booking): bool
    {
        $booking->status = BookingStatus::Cancelled;
        $booking->cancelled_at = now();
        $booking->save();

        return true;
    }

    public function expire(Booking $booking): bool
    {
        if ($booking->expires_at->isFuture()) {
            throw InvalidTransition::from($booking, 'expire before its hold ends');
        }

        $booking->status = BookingStatus::Expired;
        $booking->save();

        return true;
    }
}`,
        },
        {
          title: 'Confirmed',
          text: ['Confirming again changes nothing: that’s what makes a repeated webhook harmless. Expiring is not allowed (inherited).'],
          path: 'app/Bookings/States/ConfirmedState.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Enums\BookingStatus;
use App\Models\Booking;

final class ConfirmedState extends BookingState
{
    public function confirm(Booking $booking): bool
    {
        return false;                                         // already confirmed
    }

    public function cancel(Booking $booking): bool
    {
        $booking->status = BookingStatus::Cancelled;
        $booking->cancelled_at = now();
        $booking->save();                                     // scene 10 adds the refund

        return true;
    }
}`,
        },
        {
          title: 'Expired: the rule nobody had written',
          text: ['The late payment case lives here and nowhere else. It checks the nights under the same property lock as scene 4, so a new booking can’t take them in between.'],
          path: 'app/Bookings/States/ExpiredState.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;

final class ExpiredState extends BookingState
{
    /** A late payment: re-confirm only if nobody has taken the nights since. */
    public function confirm(Booking $booking): bool
    {
        Property::whereKey($booking->property_id)->lockForUpdate()->firstOrFail();   // inside the caller's transaction

        $taken = $booking->property->bookings()
            ->overlapping($booking->stay)
            ->whereKeyNot($booking->id)
            ->exists();

        if ($taken) {
            throw DatesNoLongerAvailable::for($booking);
        }

        $booking->status = BookingStatus::Confirmed;
        $booking->confirmed_at = now();
        $booking->expires_at = null;
        $booking->save();

        return true;
    }

    public function expire(Booking $booking): bool
    {
        return false;                                         // already expired
    }
}`,
        },
        {
          path: 'app/Bookings/States/CancelledState.php · DatesNoLongerAvailable.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Models\Booking;

final class CancelledState extends BookingState
{
    public function cancel(Booking $booking): bool
    {
        return false;                                         // already cancelled; nothing else is allowed
    }
}`,
        },
        {
          path: 'app/Bookings/States/DatesNoLongerAvailable.php',
          code: String.raw`<?php

namespace App\Bookings\States;

use App\Models\Booking;
use RuntimeException;

final class DatesNoLongerAvailable extends RuntimeException
{
    public static function for(Booking $booking): self
    {
        return new self("The nights of booking {$booking->id} were booked by someone else after its hold expired.");
    }
}`,
        },
        {
          title: 'The booking hands out its state',
          text: ['The status column stays the single source of truth; the state object is built from it on demand.'],
          path: 'app/Models/Booking.php (added)',
          fragment: true,
          code: String.raw`public function state(): BookingState
{
    return match ($this->status) {
        BookingStatus::Pending => new PendingState(),
        BookingStatus::Confirmed => new ConfirmedState(),
        BookingStatus::Expired => new ExpiredState(),
        BookingStatus::Cancelled => new CancelledState(),
    };                                                        // a new status without a state class fails here, loudly
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: callers ask the state',
      blocks: [
        {
          title: 'The facade from scene 6',
          text: ['No status checks left in it: it asks the state, and only runs the other steps when the booking actually changed.'],
          path: 'app/Bookings/BookingConfirmation.php (inside the transaction)',
          fragment: true,
          code: String.raw`$booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

if (! $booking->state()->confirm($booking)) {
    return;                                                   // already confirmed: nothing else to do
}

$payment->status = PaymentStatus::Succeeded;
$payment->save();

Notification::route('mail', $booking->guest_email)
    ->notify((new BookingConfirmed($booking))->afterCommit());`,
        },
        {
          title: 'Holds expire on a schedule',
          text: [
            'Every minute, a command expires the holds whose time is up. Each booking is locked first, so a payment confirming the same booking at that moment waits, and the loser of the race sees the winner’s result.',
            '`withoutOverlapping()` stops a slow run from overlapping the next one. `lazyById()` walks the rows in batches without loading them all (scene 11 looks inside it).',
          ],
          path: 'app/Console/Commands/ExpireHolds.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Enums\BookingStatus;
use App\Models\Booking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ExpireHolds extends Command
{
    protected $signature = 'bookings:expire-holds';

    protected $description = 'Expire pending bookings whose hold has ended';

    public function handle(): void
    {
        Booking::query()
            ->where('status', BookingStatus::Pending)
            ->where('expires_at', '<=', now())
            ->lazyById()
            ->each(function (Booking $booking): void {
                DB::transaction(function () use ($booking): void {
                    $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

                    if ($booking->status === BookingStatus::Pending) {   // a payment may have won the race
                        $booking->state()->expire($booking);
                    }
                });
            });
    }
}`,
        },
        {
          path: 'routes/console.php',
          fragment: true,
          code: String.raw`Schedule::command('bookings:expire-holds')->everyMinute()->withoutOverlapping();

// The server runs the scheduler once a minute:  * * * * * php artisan schedule:run
// Locally:                                     php artisan schedule:work`,
        },
      ],
    },
    {
      title: 'The fix, part 3: refunding a late payment, safely',
      text: [
        'When the nights are gone, the money goes back. A refund is money leaving the company, so it must happen **exactly once**, even though the job that sends it can retry.',
        'The danger: the job calls Stripe, Stripe refunds, and then the job crashes before saving anything. The retry would refund **again**. Stripe’s answer is the **Idempotency-Key**: send the same key with the same request, and Stripe returns the first result instead of acting twice (keys are kept for 24 hours). The key must be built from our own data, so every retry produces the same one.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_02_04_000001_create_refunds_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('refunds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payment_id')->constrained();
            $table->unsignedInteger('amount_cents');
            $table->char('currency', 3);
            $table->string('provider_refund_id')->unique();         // one Stripe refund, one row
            $table->string('reason');
            $table->timestamps();
        });
    }
};`,
        },
        {
          path: 'app/Models/Refund.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Refund extends Model
{
    protected $fillable = ['amount_cents', 'currency', 'provider_refund_id', 'reason'];

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }
}`,
        },
        {
          title: 'Every Stripe POST gets a key',
          text: ['The gateway from scene 5 takes an idempotency key on both of its calls, and gains `refund()`. Starting a payment now passes `"booking-{$booking->id}-payment"`, so a double click on "Pay" can’t create two PaymentIntents either.'],
          path: 'app/Payments/PaymentGateway.php',
          code: String.raw`<?php

namespace App\Payments;

use App\Money\Money;

interface PaymentGateway
{
    /**
     * @param array<string, string> $metadata
     * @return array{id: string, client_secret: string}
     */
    public function createPaymentIntent(Money $amount, array $metadata, string $idempotencyKey): array;

    /** @return string the provider's refund id */
    public function refund(string $paymentIntentId, Money $amount, string $idempotencyKey): string;
}`,
        },
        {
          path: 'app/Payments/StripeGateway.php (refund added)',
          fragment: true,
          code: String.raw`public function refund(string $paymentIntentId, Money $amount, string $idempotencyKey): string
{
    $refund = $this->stripe->refunds->create(
        ['payment_intent' => $paymentIntentId, 'amount' => $amount->amount],
        ['idempotency_key' => $idempotencyKey],                     // same key, same refund: never a second one
    );

    return $refund->id;
}

// createPaymentIntent() passes ['idempotency_key' => $idempotencyKey] the same way`,
        },
        {
          title: 'The webhook job handles the late payment',
          text: ['`createOrFirst()` on the unique refund id (scene 8) means a retry that gets the same refund back from Stripe doesn’t record it twice either.'],
          path: 'app/Jobs/ProcessStripeWebhook.php (the succeeded branch)',
          fragment: true,
          code: String.raw`try {
    $confirmation->confirm($payment->booking, $payment);
} catch (DatesNoLongerAvailable) {
    $payment->status = PaymentStatus::Succeeded;               // the money did arrive
    $payment->save();

    $refundId = $gateway->refund($event->paymentIntentId, $event->amount, "payment-{$payment->id}-late-refund");

    $payment->refunds()->createOrFirst(['provider_refund_id' => $refundId], [
        'amount_cents' => $event->amount->amount,
        'currency' => $event->amount->currency->value,
        'reason' => 'Paid after the hold expired; the nights were already booked.',
    ]);
}

// handle() now receives PaymentGateway $gateway next to BookingConfirmation $confirmation,
// and Payment has: public function refunds(): HasMany { return $this->hasMany(Refund::class); }`,
        },
      ],
    },
  ],
  reveal: {
    names: ['State'],
    rules: [['State', 'An object’s behaviour depends on its state, so each state is its own class, and the object hands each request to its current state.']],
    points: [
      'Every rule about a status lives in that status’s class. "What can an expired booking do?" has one answer, in `ExpiredState`.',
      'Forbidden transitions fail loudly with `InvalidTransition`, instead of silently writing an impossible status.',
      'A new status is a new class and one `match` arm, not a hunt through every `if`.',
    ],
    whenNot: [
      'Two statuses with no rules between them (active/inactive): an enum and one `if` is clearer.',
      'Don’t let state classes do the work around a transition (emails, payments, channel pushes). They change the status; the facade in scene 6 runs the rest.',
    ],
    table: [
      ['From ↓ / action →', 'confirm', 'cancel', 'expire'],
      ['Pending', '→ Confirmed', '→ Cancelled', '→ Expired (only after the hold ends)'],
      ['Confirmed', 'no change', '→ Cancelled', 'not allowed'],
      ['Expired', '→ Confirmed if the nights are free, else refund', 'not allowed', 'no change'],
      ['Cancelled', 'not allowed', 'no change', 'not allowed'],
    ],
  },
  laravel: {
    title: 'Laravel inside: how the scheduler runs every minute',
    text: [
      'Laravel has no daemon for schedules. The server’s cron runs `schedule:run` once a minute; it asks each scheduled event "are you due now?" and runs the ones that are. `withoutOverlapping()` takes a cache lock for the event and skips the run if the lock is still held by the previous one.',
    ],
    blocks: [
      {
        path: 'Illuminate/Console/Scheduling/ScheduleRunCommand.php (simplified)',
        fragment: true,
        code: String.raw`public function handle(Schedule $schedule)
{
    foreach ($schedule->dueEvents($this->laravel) as $event) {      // cron expression matches this minute
        if (! $event->filtersPass($this->laravel)) {
            continue;
        }

        $this->runEvent($event);    // withoutOverlapping(): Cache::lock('framework/schedule-...')->get() or skip
    }
}`,
        after: ['Running the app on two servers? Add `->onOneServer()` too, or both servers expire the same holds (scene 38).'],
      },
    ],
  },
  tests: {
    summary: 'Every transition, expiring holds, and the late payment both ways',
    blocks: [
      {
        path: 'tests/Feature/BookingStateTest.php',
        code: String.raw`<?php

use App\Bookings\States\InvalidTransition;
use App\Enums\BookingStatus;
use App\Models\Booking;

it('allows only the transitions in the table', function (BookingStatus $from, string $action, BookingStatus|string $result) {
    $booking = Booking::factory()->create(['status' => $from, 'expires_at' => now()->subMinute()]);   // the hold has ended

    if ($result === 'invalid') {
        expect(fn () => $booking->state()->{$action}($booking))->toThrow(InvalidTransition::class);

        return;
    }

    $booking->state()->{$action}($booking);
    expect($booking->fresh()->status)->toBe($result);
})->with([
    [BookingStatus::Pending, 'confirm', BookingStatus::Confirmed],
    [BookingStatus::Pending, 'cancel', BookingStatus::Cancelled],
    [BookingStatus::Pending, 'expire', BookingStatus::Expired],
    [BookingStatus::Confirmed, 'confirm', BookingStatus::Confirmed],
    [BookingStatus::Confirmed, 'expire', 'invalid'],
    [BookingStatus::Expired, 'cancel', 'invalid'],
    [BookingStatus::Cancelled, 'confirm', 'invalid'],
]);

it('expires only holds whose time is up', function () {
    $due = Booking::factory()->pending()->create(['expires_at' => now()->subMinute()]);
    $notYet = Booking::factory()->pending()->create(['expires_at' => now()->addMinutes(5)]);

    $this->artisan('bookings:expire-holds')->assertSuccessful();

    expect($due->fresh()->status)->toBe(BookingStatus::Expired)
        ->and($notYet->fresh()->status)->toBe(BookingStatus::Pending);
});`,
        after: ['Scene 6’s last test still passes: confirming a cancelled booking now throws `InvalidTransition`, which is a `LogicException` whose message names the "cancelled" status.'],
      },
      {
        path: 'tests/Feature/LatePaymentTest.php',
        code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Jobs\ProcessStripeWebhook;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\WebhookEvent;
use App\Payments\PaymentGateway;
use Illuminate\Support\Facades\Notification;
use Tests\Fakes\FakePaymentGateway;

beforeEach(function () {
    Notification::fake();
    $this->gateway = new FakePaymentGateway();
    $this->app->instance(PaymentGateway::class, $this->gateway);

    $this->booking = Booking::factory()->forStay('2027-07-10', 3)->create(['status' => BookingStatus::Expired]);
    $this->payment = Payment::factory()->for($this->booking)->create(['provider_payment_id' => 'pi_late', 'amount_cents' => 110_550, 'currency' => 'EUR']);
    $this->webhook = WebhookEvent::create(['provider' => 'stripe', 'event_id' => 'evt_late', 'type' => 'payment_intent.succeeded', 'payload' => [
        'type' => 'payment_intent.succeeded', 'data' => ['object' => ['id' => 'pi_late', 'amount_received' => 110_550, 'currency' => 'eur']],
    ]]);
});

it('re-confirms a late payment when the nights are still free', function () {
    app()->call([new ProcessStripeWebhook($this->webhook), 'handle']);

    expect($this->booking->fresh()->status)->toBe(BookingStatus::Confirmed)
        ->and($this->gateway->refunded)->toBe([]);
});

it('refunds a late payment exactly once when the nights are taken, even if the job runs twice', function () {
    Booking::factory()->for($this->booking->property)->forStay('2027-07-11', 2)->create();   // someone else took them

    app()->call([new ProcessStripeWebhook($this->webhook), 'handle']);
    app()->call([new ProcessStripeWebhook($this->webhook), 'handle']);                   // a retry

    expect($this->booking->fresh()->status)->toBe(BookingStatus::Expired)
        ->and(array_unique(array_column($this->gateway->refunded, 'key')))->toBe(["payment-{$this->payment->id}-late-refund"])
        ->and(Refund::count())->toBe(1);
});`,
      },
      {
        title: 'The fake behaves like Stripe',
        text: ['The fake from scene 5 now records idempotency keys and, like Stripe, returns the same refund for the same key.'],
        path: 'tests/Fakes/FakePaymentGateway.php',
        code: String.raw`<?php

namespace Tests\Fakes;

use App\Money\Money;
use App\Payments\PaymentGateway;

final class FakePaymentGateway implements PaymentGateway
{
    /** @var list<Money> */
    public array $charged = [];

    /** @var list<array{key: string, amount: Money}> */
    public array $refunded = [];

    public function createPaymentIntent(Money $amount, array $metadata, string $idempotencyKey): array
    {
        $this->charged[] = $amount;
        $id = 'pi_fake_' . md5($idempotencyKey);

        return ['id' => $id, 'client_secret' => "{$id}_secret"];
    }

    public function refund(string $paymentIntentId, Money $amount, string $idempotencyKey): string
    {
        $this->refunded[] = ['key' => $idempotencyKey, 'amount' => $amount];

        return 're_fake_' . md5($idempotencyKey);                  // same key, same refund id
    }
}`,
        after: ['Scene 5’s test asserted `pi_fake_1`; with keys it becomes `\'pi_fake_\' . md5("booking-{$booking->id}-payment")`.'],
      },
    ],
  },
  next: 'Late payments are handled. Thursday: a guest cancels a strict booking three days out and gets every cent back.',
};
