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
          broken: true, fragment: true,
          code: String.raw`$booking->stay = $newStay;
$booking->total = $quoter->quote($booking->property, $newStay)->total();
$booking->save();                                                       // 1. the booking changes at once

$gateway->createPaymentIntent($difference, [...], "booking-{$booking->id}-change");   // 2. the guest pays... later

// 3. if the payment fails: a log line, and nothing else`,
          after: [
            'A date change is two steps that can’t happen at the same moment: the nights must be taken **now** (or someone else books them while the guest is paying), but the payment confirms **later**, through a webhook (scene 8). If it fails, the booking has to go back to **exactly** what it was: dates, total, every line of the bill.',
            'Nobody wrote down what "what it was" means, so there was nothing to go back to. And the scheduled messages (scene 21) were never told about the new dates at all.',
          ],
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
          path: 'app/Models/Booking.php (added)',
          fragment: true,
          code: String.raw`public function snapshot(): BookingSnapshot
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
          after: ['`BookingChange` casts `snapshot` to an array; `Payment` gets a `change()` relation.'],
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
          after: ['`booking_change_id` joins `Payment`’s `$fillable`.'],
        },
        {
          title: 'When the money doesn’t come',
          text: ['Called by scene 8’s webhook job when a change’s payment fails (and by a scheduled check when it isn’t paid within 30 minutes). The booking returns to the snapshot, and the messages are rescheduled from the restored dates.'],
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
          path: 'app/Jobs/ProcessStripeWebhook.php (added to both branches)',
          fragment: true,
          code: String.raw`// payment_intent.payment_failed
if ($payment->booking_change_id !== null) {
    app(RevertBookingChange::class)->handle($payment->change);
}

// payment_intent.succeeded: a change's payment settles the change instead of confirming the booking
if ($payment->booking_change_id !== null) {
    $payment->forceFill(['status' => PaymentStatus::Succeeded])->save();
    $payment->change->forceFill(['status' => 'settled'])->save();
}`,
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
