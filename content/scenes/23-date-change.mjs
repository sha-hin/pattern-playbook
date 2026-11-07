// Scene 23 · Memento: change a booking's dates, and restore it exactly if the payment fails.

export default {
  description: 'A guest extended her stay, the extra charge failed, and the booking was left with the new dates, the old price and messages for the wrong days. Fix it in Laravel with the Memento pattern: snapshot the booking before the change, keep the snapshot until the payment settles, and restore it exactly if it fails.',
  incident: {
    channel: '#support',
    when: 'Friday 12:20',
    messages: [
      ['Mona · support', 'A guest extended the Lake Cabin from **3 to 5 nights**. Her card declined the extra **€300.00**. The booking now says 5 nights, shows the old total of €450.00, and her checkout reminder still says **13 July**.'],
      ['Ahmed · host', 'So is she staying 5 nights or 3? I turned down a booking for those two nights.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/ChangeDatesController.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Payments\PaymentGateway;
use App\Pricing\PriceQuoter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChangeDatesController extends Controller
{
    public function __invoke(Request $request, Booking $booking, PriceQuoter $quoter, PaymentGateway $gateway): JsonResponse
    {
        $data = $request->validate([
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
        ]);
        $newStay = Stay::fromDates($data['check_in'], $data['check_out']);
        $difference = $quoter->quote($booking->property, $newStay)->total()->add($booking->total->negate());

        $booking->stay = $newStay;                                      // 1. the nights change at once
        $booking->save();                                               //    (the total waits for the money)

        $intent = $gateway->createPaymentIntent($difference, ['booking_id' => (string) $booking->id], "booking-{$booking->id}-change");
        $booking->payments()->create([                                  // 2. the guest pays... later
            'amount_cents' => $difference->amount, 'currency' => $difference->currency->value,
            'status' => PaymentStatus::Pending, 'provider_payment_id' => $intent['id'],
        ]);

        // 3. if the payment fails, the webhook marks the payment failed, and nothing else

        return response()->json(['client_secret' => $intent['client_secret']]);
    }
}`,
          after: ['A date change is two steps that can’t happen at the same moment: the nights must be taken **now** (or someone else books them while the guest is paying), but the payment confirms **later**, through a webhook (scene 8). If it fails, the booking has to go back to **exactly** what it was: dates, total, every line of the bill.', 'Nobody wrote down what "what it was" means, so there was nothing to go back to. And the scheduled messages (scene 21) were never told about the new dates at all.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: the booking can photograph itself',
      text: [
        'Before anything changes, the booking produces a **snapshot** of its own state: the stay, the total and the line items. The snapshot is a plain value that can be stored and handed back later; only the booking knows how to make one and how to return to it.',
      ],
      blocks: [
        {
          path: 'app/Bookings/BookingSnapshot.php',
          code: String.raw`<?php

namespace App\Bookings;

final readonly class BookingSnapshot
{
    /** @param list<array{type: string, description: string, amount_cents: int, currency: string}> $lines */
    public function __construct(
        public string $checkIn,
        public string $checkOut,
        public int $totalCents,
        public string $currency,
        public array $lines,
    ) {
    }

    /** @return array<string, mixed> for a JSON column */
    public function toArray(): array
    {
        return get_object_vars($this);
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): self
    {
        return new self($data['checkIn'], $data['checkOut'], $data['totalCents'], $data['currency'], $data['lines']);
    }
}`,
        },
        {
          title: 'Making one, and going back to one',
          text: ['Both methods live on the booking, because only the booking knows which of its parts make up "its state". Messages aren’t in the snapshot: their send times are **derived** from the dates, so they are recalculated after a restore instead of being stored.'],
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
use App\Money\Money;
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
            'channel' => Channel::class,                           // null for bookings made on Nordic Stays
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
      ],
    },
    {
      title: 'The fix, part 2: keep the snapshot until the money settles',
      text: [
        'A date change gets its own row, holding the snapshot and the payment for the difference. It stays `pending` until the webhook says how the payment went. The row is what remembers; it never looks inside the snapshot.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_10_000001_create_booking_changes_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_changes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained();
            $table->json('snapshot');                                  // the booking before the change
            $table->string('status')->default('pending');              // pending, settled, reverted
            $table->timestamps();
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->foreignId('booking_change_id')->nullable()->constrained();   // a payment for a change, not a booking
        });
    }
};`,
        },
        {
          text: ['Its model keeps the snapshot as JSON:'],
          path: 'app/Models/BookingChange.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BookingChange extends Model
{
    protected function casts(): array
    {
        return ['snapshot' => 'array'];                                // the BookingSnapshot, as JSON
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}`,
        },
        {
          text: ['A payment for a change points to it:'],
          path: 'app/Models/Payment.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Payment extends Model
{
    use HasFactory;

    protected $fillable = ['amount_cents', 'currency', 'status', 'provider_payment_id', 'booking_change_id'];

    protected function casts(): array
    {
        return ['status' => PaymentStatus::class];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class);
    }

    /** Set when the payment is for a date change rather than the booking itself (scene 23). */
    public function change(): BelongsTo
    {
        return $this->belongsTo(BookingChange::class, 'booking_change_id');
    }
}`,
        },
        {
          title: 'Changing the dates',
          text: ['Under scene 4’s property lock: check the new nights (ignoring the booking’s own), photograph, apply, then ask for the difference. If the new stay costs the same or less, the change settles at once.'],
          path: 'app/Bookings/ChangeBookingDates.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\PaymentStatus;
use App\Messaging\RescheduleGuestMessages;
use App\Models\Booking;
use App\Models\BookingChange;
use App\Models\Property;
use App\Payments\PaymentGateway;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final readonly class ChangeBookingDates
{
    public function __construct(
        private PriceQuoter $quoter,
        private PaymentGateway $gateway,
        private RescheduleGuestMessages $reschedule,
    ) {
    }

    /** @return string|null the client secret for the extra payment, or null when nothing more is owed */
    public function handle(Booking $booking, Stay $newStay): ?string
    {
        return DB::transaction(function () use ($booking, $newStay): ?string {
            Property::whereKey($booking->property_id)->lockForUpdate()->firstOrFail();

            $taken = $booking->property->bookings()->overlapping($newStay)->whereKeyNot($booking->id)->exists()
                || $booking->property->externalBlocks()->overlapping($newStay)->exists();
            if ($taken) {
                throw BookingConflict::for($newStay);                   // 409, nothing changed
            }

            $change = BookingChange::forceCreate(['booking_id' => $booking->id, 'snapshot' => $booking->snapshot()->toArray()]);

            $quote = $this->quoter->quote($booking->property, $newStay);
            $difference = $quote->total()->add($booking->total->negate());

            $booking->stay = $newStay;                                  // the nights are ours from now on
            $booking->total = $quote->total();
            $booking->save();
            $booking->lineItems()->delete();
            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type, 'description' => $line->description, 'amount' => $line->amount,
            ], $quote->lines));

            $this->reschedule->handle($booking);                        // messages follow the new dates

            if ($difference->amount <= 0) {
                $change->forceFill(['status' => 'settled'])->save();    // a shorter stay: refunds go through scene 10's job
                return null;
            }

            $intent = $this->gateway->createPaymentIntent($difference, ['booking_id' => (string) $booking->id], "booking-change-{$change->id}");
            $booking->payments()->create([
                'amount_cents' => $difference->amount, 'currency' => $difference->currency->value,
                'status' => PaymentStatus::Pending, 'provider_payment_id' => $intent['id'], 'booking_change_id' => $change->id,
            ]);

            return $intent['client_secret'];
        });
    }
}`,
        },
        {
          text: ['The controller only validates and calls it:'],
          path: 'app/Http/Controllers/ChangeDatesController.php (after)',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\ChangeBookingDates;
use App\Bookings\Stay;
use App\Models\Booking;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChangeDatesController extends Controller
{
    public function __invoke(Request $request, Booking $booking, ChangeBookingDates $change): JsonResponse
    {
        $data = $request->validate([
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
        ]);

        $secret = $change->handle($booking, Stay::fromDates($data['check_in'], $data['check_out']));   // 409 when the nights are taken

        return response()->json(['client_secret' => $secret]);                // null: nothing more to pay
    }
}`,
        },
        {
          text: ['Its route, in scene 19’s group, so only the booking’s own hosts can change it:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices.
Route::get('/v1/properties/{property}/quote', QuoteController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
        },
        {
          title: 'When the money doesn’t come',
          text: ['Called by scene 8’s webhook job when a change’s payment fails, and by a scheduled check when it isn’t paid within 30 minutes (both below). The booking returns to the snapshot, and the messages are rescheduled from the restored dates.'],
          path: 'app/Bookings/RevertBookingChange.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Messaging\RescheduleGuestMessages;
use App\Models\Booking;
use App\Models\BookingChange;
use Illuminate\Support\Facades\DB;

final readonly class RevertBookingChange
{
    public function __construct(private RescheduleGuestMessages $reschedule)
    {
    }

    public function handle(BookingChange $change): void
    {
        DB::transaction(function () use ($change): void {
            $change = BookingChange::whereKey($change->id)->lockForUpdate()->firstOrFail();

            if ($change->status !== 'pending') {
                return;                                                 // already settled or reverted: a repeated webhook
            }

            $booking = Booking::whereKey($change->booking_id)->lockForUpdate()->firstOrFail();
            $booking->restore(BookingSnapshot::fromArray($change->snapshot));
            $this->reschedule->handle($booking);

            $change->forceFill(['status' => 'reverted'])->save();
        });
    }
}`,
        },
        {
          title: 'Messages follow the dates',
          text: ['Only pending messages move; one already sent stays sent.'],
          path: 'app/Messaging/RescheduleGuestMessages.php',
          code: String.raw`<?php

namespace App\Messaging;

use App\Enums\ScheduledMessageStatus;
use App\Models\Booking;
use App\Models\ScheduledMessage;

final readonly class RescheduleGuestMessages
{
    public function __construct(private SendTime $sendTime)
    {
    }

    public function handle(Booking $booking): void
    {
        $booking->scheduledMessages()
            ->where('status', ScheduledMessageStatus::Pending)
            ->with('template')
            ->get()
            ->each(fn (ScheduledMessage $message) => $message->forceFill(['send_at' => $this->sendTime->for($message->template, $booking)])->save());
    }
}`,
        },
        {
          title: 'The webhook job tells the two cases apart',
          text: ['A change’s payment settles the change instead of confirming the booking; a failed one reverts it. A payment that arrives after the change was already reverted is refunded, like scene 9’s late payment.'],
          path: 'app/Jobs/ProcessStripeWebhook.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Bookings\BookingConfirmation;
use App\Bookings\RevertBookingChange;
use App\Bookings\States\DatesNoLongerAvailable;
use App\Enums\PaymentStatus;
use App\Models\Payment;
use App\Models\WebhookEvent;
use App\Money\Money;
use App\Payments\Events\PaymentFailed;
use App\Payments\Events\PaymentSucceeded;
use App\Payments\Events\StripeEventFactory;
use App\Payments\PaymentGateway;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;
use UnexpectedValueException;

class ProcessStripeWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public WebhookEvent $webhook)
    {
    }

    /** @return list<int> seconds to wait before each retry */
    public function backoff(): array
    {
        return [10, 60, 300, 900];
    }

    public function handle(BookingConfirmation $confirmation, PaymentGateway $gateway, RevertBookingChange $revert): void
    {
        $event = StripeEventFactory::fromPayload($this->webhook->payload);

        if ($event instanceof PaymentSucceeded) {
            $payment = $this->payment($event->paymentIntentId);
            $expected = Money::of($payment->amount_cents, $payment->currency);

            if (! $event->amount->equals($expected)) {
                throw new UnexpectedValueException("Stripe received {$event->amount->format()} for payment {$payment->id}, expected {$expected->format()}.");
            }

            if ($payment->booking_change_id !== null) {                 // the extra payment for a date change (scene 23)
                $payment->status = PaymentStatus::Succeeded;
                $payment->save();

                if ($payment->change->status === 'reverted') {          // paid after the change was given up: give it back
                    $refundId = $gateway->refund($event->paymentIntentId, $event->amount, "payment-{$payment->id}-late-refund");
                    $payment->refunds()->createOrFirst(['provider_refund_id' => $refundId], [
                        'amount_cents' => $event->amount->amount,
                        'currency' => $event->amount->currency->value,
                        'reason' => 'Paid after the date change was reverted.',
                    ]);
                } else {
                    $payment->change->forceFill(['status' => 'settled'])->save();
                }
            } else {
                try {
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
            }
        }

        if ($event instanceof PaymentFailed) {
            $payment = $this->payment($event->paymentIntentId);
            $payment->status = PaymentStatus::Failed;
            $payment->save();

            if ($payment->booking_change_id !== null) {
                $revert->handle($payment->change);                       // the booking goes back exactly as it was
            }
        }

        $this->webhook->markProcessed();                       // also for types we don't act on
    }

    public function failed(Throwable $exception): void
    {
        $this->webhook->markFailed($exception->getMessage());
    }

    private function payment(string $paymentIntentId): Payment
    {
        return Payment::where('provider_payment_id', $paymentIntentId)->firstOrFail();
    }
}`,
        },
        {
          title: 'And when no webhook ever comes',
          text: ['A guest who closes the payment page sends no webhook at all. A command puts those bookings back after 30 minutes:'],
          path: 'app/Console/Commands/RevertUnpaidChanges.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Bookings\RevertBookingChange;
use App\Models\BookingChange;
use Illuminate\Console\Command;

class RevertUnpaidChanges extends Command
{
    protected $signature = 'bookings:revert-unpaid-changes';

    protected $description = 'Put a booking back when the extra payment for its date change never came';

    public function handle(RevertBookingChange $revert): int
    {
        BookingChange::query()
            ->where('status', 'pending')
            ->where('created_at', '<=', now()->subMinutes(30))          // an abandoned payment never sends a webhook
            ->lazyById()
            ->each(fn (BookingChange $change) => $revert->handle($change));

        return self::SUCCESS;
    }
}`,
        },
        {
          text: ['Every minute, next to the other schedules:'],
          path: 'routes/console.php',
          code: String.raw`<?php

use App\Jobs\SyncIcalFeed;
use App\Models\IcalFeed;
use Illuminate\Support\Facades\Schedule;

// The server runs the scheduler once a minute:  * * * * * php artisan schedule:run
// Locally:                                     php artisan schedule:work

Schedule::command('bookings:expire-holds')->everyMinute()->withoutOverlapping();
Schedule::command('payments:reconcile-refunds')->dailyAt('03:10')->withoutOverlapping();

Schedule::call(function (): void {
    IcalFeed::query()->lazyById()->each(fn (IcalFeed $feed) => SyncIcalFeed::dispatch($feed));
})->everyFifteenMinutes()->name('sync-ical-feeds')->withoutOverlapping();
Schedule::command('channels:poll')->everyTenMinutes()->withoutOverlapping();
Schedule::command('messages:send-due')->everyMinute()->withoutOverlapping()->onOneServer();
Schedule::command('bookings:revert-unpaid-changes')->everyMinute()->withoutOverlapping();`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Memento'],
    rules: [['Memento', 'An object captures its own state in a snapshot that others can store but not interpret, so it can later be returned to exactly that state.']],
    points: [
      '**The originator** (`Booking`) makes the snapshot and restores from it. It alone knows that its state is the stay, the total and the lines.',
      '**The memento** (`BookingSnapshot`) is a plain value: it can be stored as JSON and come back weeks later.',
      '**The caretaker** (`BookingChange`) keeps the snapshot and decides when to hand it back, without ever reading its fields.',
    ],
    whenNot: [
      'When the change can wait for the payment, don’t apply it early: hold the new dates as a separate pending booking and there is nothing to undo.',
      'Don’t snapshot what can be derived. Message times are recalculated from the restored dates; storing them would be one more thing that can disagree.',
      'For a full history of every change, an audit log (one row per change, with who and when) is the right tool; a memento is for going back to one point.',
    ],
  },
  tests: {
    summary: 'A failed extra payment restores everything; a paid one settles; taken nights change nothing',
    blocks: [
      {
        path: 'tests/Feature/ChangeBookingDatesTest.php',
        code: String.raw`<?php

use App\Bookings\BookingConflict;
use App\Bookings\ChangeBookingDates;
use App\Bookings\RevertBookingChange;
use App\Bookings\Stay;
use App\Models\Booking;
use App\Models\BookingChange;
use App\Models\Property;
use App\Payments\PaymentGateway;
use Tests\Fakes\FakePaymentGateway;

beforeEach(function () {
    $this->app->instance(PaymentGateway::class, new FakePaymentGateway());
    $this->property = Property::factory()->create(['nightly_rate_cents' => 15_000, 'cleaning_fee_cents' => null]);
    $this->booking = Booking::factory()->for($this->property)->forStay('2027-07-10', 3)->create(['total_cents' => 45_000]);
    $this->booking->lineItems()->create(['type' => 'nights', 'description' => '3 nights × €150.00', 'amount' => $this->booking->total]);
    $this->before = $this->booking->snapshot();
});

it('takes the new nights and asks for the difference', function () {
    $secret = app(ChangeBookingDates::class)->handle($this->booking, Stay::fromDates('2027-07-10', '2027-07-15'));

    expect($secret)->not->toBeNull()
        ->and($this->booking->fresh()->total_cents)->toBe(75_000)
        ->and($this->booking->payments()->sole()->amount_cents)->toBe(30_000);
});

it('restores the booking exactly when the extra payment fails', function () {
    app(ChangeBookingDates::class)->handle($this->booking, Stay::fromDates('2027-07-10', '2027-07-15'));

    app(RevertBookingChange::class)->handle(BookingChange::sole());
    app(RevertBookingChange::class)->handle(BookingChange::sole());           // a repeated webhook

    expect($this->booking->fresh()->snapshot())->toEqual($this->before)       // dates, total and every line
        ->and(BookingChange::sole()->status)->toBe('reverted');
});

it('changes nothing when the new nights are taken', function () {
    Booking::factory()->for($this->property)->forStay('2027-07-13', 2)->create();

    expect(fn () => app(ChangeBookingDates::class)->handle($this->booking, Stay::fromDates('2027-07-10', '2027-07-15')))
        ->toThrow(BookingConflict::class)
        ->and($this->booking->fresh()->snapshot())->toEqual($this->before)
        ->and(BookingChange::count())->toBe(0);
});`,
      },
    ],
  },
  next: 'Changes either finish or undo themselves. Monday: a guest’s welcome email starts with “Hi {guest_name},”.',
};
