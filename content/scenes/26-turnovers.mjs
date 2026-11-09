// Scene 26 · Cleaning tasks that follow the calendar, in the property's time, and a cleaner who is told.

export default {
  description: 'A cleaner let herself in while the guests were still asleep: they had extended by a night, and the cleaning task was created once at confirmation and never moved. Fix it in Laravel by planning the cleaning from the calendar coordinator, sending the date change through that coordinator too, and telling the cleaner when her task moves.',
  incident: {
    channel: '#ops',
    when: 'Wednesday 11:10',
    messages: [
      ['Freja · cleaner', 'I let myself into the Nyhavn flat at 11:00, like the app said. The guests were **asleep**. They say they’re staying until tomorrow.'],
      ['Mona · support', 'They extended by one night on Monday and paid for it. Their booking says check-out **15 July**. Freja’s task still says **14 July, 11:00**.'],
      ['Karim · developer', 'Cleaning tasks are created once, when a booking is confirmed. Nothing moves them after that. And I just checked Airbnb: it still shows the 13th as free.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature',
      text: [
        'Last week Nordic Stays started planning cleanings. Every stay gets one task, starting at the property’s check-out time on the check-out day, and a host assigns it to one of the account’s cleaners (`assigned_to`, a member with the Cleaner role from scene 20).',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_16_000001_create_cleaning_tasks_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cleaning_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained();
            $table->foreignId('booking_id')->unique()->constrained();      // one cleaning after each stay
            $table->foreignId('assigned_to')->nullable()->constrained('users');
            $table->dateTime('starts_at');                                  // UTC, like every moment we store
            $table->string('status')->default('pending');
            $table->timestamps();

            $table->index(['assigned_to', 'starts_at']);                   // a cleaner's list, in order
        });
    }
};`,
        },
        {
          path: 'app/Enums/CleaningTaskStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum CleaningTaskStatus: string
{
    case Pending = 'pending';
    case Done = 'done';
}`,
        },
        {
          path: 'app/Models/CleaningTask.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\CleaningTaskStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CleaningTask extends Model
{
    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'status' => CleaningTaskStatus::class,
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function cleaner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }
}`,
          after: ['No `$fillable`: tasks are written by our own code with `forceCreate()` and `forceFill()`, never from a request.'],
        },
      ],
    },
    {
      title: 'The broken code',
      text: ['The task is created in `BookingConfirmation`, the one place a booking is confirmed (scene 6):'],
      blocks: [
        {
          path: 'app/Bookings/BookingConfirmation.php',
          broken: true,
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Enums\PaymentStatus;
use App\Messaging\ScheduleGuestMessages;
use App\Models\Booking;
use App\Models\CleaningTask;
use App\Models\Payment;
use App\Notifications\BookingConfirmed;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

final class BookingConfirmation
{
    public function __construct(
        private CalendarSync $calendar,
        private ScheduleGuestMessages $scheduleMessages,
    ) {
    }

    public function confirm(Booking $booking, Payment $payment): void
    {
        DB::transaction(function () use ($booking, $payment): void {
            $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();   // fresh, and locked

            if (! $booking->state()->confirm($booking)) {               // step 1: the state decides
                return;                                                // already confirmed: nothing else to do
            }

            $payment->status = PaymentStatus::Succeeded;               // step 2
            $payment->save();

            $this->scheduleMessages->handle($booking);                 // the guest's messages, at their local times

            CleaningTask::forceCreate([                                // the bug: created once, from the dates as they are today
                'property_id' => $booking->property_id,
                'booking_id' => $booking->id,
                'starts_at' => CarbonImmutable::parse(
                    "{$booking->stay->checkOut->toDateString()} {$booking->property->check_out_time}",
                    $booking->property->timezone,
                )->utc(),
            ]);

            Notification::route('mail', $booking->guest_email)         // step 3, after the commit
                ->notify((new BookingConfirmed($booking))->afterCommit());

            $this->calendar->bookingChanged($booking);                  // step 4: the coordinator decides what follows
        });
    }
}`,
          after: [
            'A task is a consequence of the calendar, but it was created from **one event**: the confirmation. A date change (scene 23), a cancellation (scene 10), an expired hold (scene 9) or a booking imported from a channel (scene 15) never touches it.',
            'And the date change has a second gap. Scene 18 built `CalendarSync` as the one place every calendar change goes through, so the channels learn about it. `ChangeBookingDates` never calls it, which is why Airbnb still shows the 13th as free.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one class keeps the cleaning in line with the booking',
      text: [
        'Instead of reacting to one event, the cleaning is **planned from the booking as it is now**, every time the booking changes. Called twice, it changes nothing the second time; called after any change, it fixes whatever the change made wrong.',
        'The start time is a calendar date plus a wall-clock time in the property’s timezone, turned into UTC once (the same rule as the guest messages in scene 21). A cancelled task stays in the table as `cancelled`, so the cleaner can be told about it.',
      ],
      blocks: [
        {
          path: 'app/Enums/CleaningTaskStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum CleaningTaskStatus: string
{
    case Pending = 'pending';
    case Done = 'done';
    case Cancelled = 'cancelled';                                   // the stay is gone; kept so the cleaner can be told
}`,
        },
        {
          path: 'app/Operations/PlanTurnover.php',
          code: String.raw`<?php

namespace App\Operations;

use App\Enums\BookingStatus;
use App\Enums\CleaningTaskStatus;
use App\Models\Booking;
use App\Models\CleaningTask;
use App\Notifications\TurnoverChanged;
use Carbon\CarbonImmutable;

final class PlanTurnover
{
    /** Make the cleaning after $booking match the booking as it is now. Safe to call any number of times. */
    public function forBooking(Booking $booking): void
    {
        $task = CleaningTask::firstWhere('booking_id', $booking->id);

        if ($task?->status === CleaningTaskStatus::Done) {
            return;                                                     // already cleaned: history, not a plan
        }

        if (! in_array($booking->status, BookingStatus::blocking(), true)) {   // cancelled or expired
            if ($task?->status === CleaningTaskStatus::Pending) {
                $task->forceFill(['status' => CleaningTaskStatus::Cancelled])->save();
                $this->tellCleaner($task);
            }

            return;
        }

        $startsAt = $this->checkOutMoment($booking);

        if ($task === null) {
            CleaningTask::forceCreate([
                'property_id' => $booking->property_id,
                'booking_id' => $booking->id,
                'starts_at' => $startsAt,
                'status' => CleaningTaskStatus::Pending,
            ]);

            return;                                                     // nobody is assigned yet: nobody to tell
        }

        if ($task->status === CleaningTaskStatus::Pending && $task->starts_at->equalTo($startsAt)) {
            return;                                                     // nothing moved: no message
        }

        $task->forceFill(['starts_at' => $startsAt, 'status' => CleaningTaskStatus::Pending])->save();
        $this->tellCleaner($task);
    }

    /** 14 July at 11:00 in Copenhagen → 2027-07-14 09:00 UTC. */
    private function checkOutMoment(Booking $booking): CarbonImmutable
    {
        $property = $booking->property;

        return CarbonImmutable::parse("{$booking->stay->checkOut->toDateString()} {$property->check_out_time}", $property->timezone)
            ->utc();
    }

    private function tellCleaner(CleaningTask $task): void
    {
        if ($task->cleaner !== null) {
            $task->cleaner->notify((new TurnoverChanged($task))->afterCommit());   // never about a change that rolled back
        }
    }
}`,
        },
        {
          title: 'The message the cleaner gets',
          text: ['Cleaners are users, so they choose email or SMS the same way hosts do (scene 25). The time is shown in the property’s timezone: the cleaner stands at the door in Copenhagen, not in UTC.'],
          path: 'app/Notifications/TurnoverChanged.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Enums\CleaningTaskStatus;
use App\Models\CleaningTask;
use App\Notifications\Channels\SmsChannel;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class TurnoverChanged extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public CleaningTask $task)
    {
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        $allowed = ['mail' => 'mail', 'sms' => SmsChannel::class];

        return array_values(array_intersect_key($allowed, array_flip($notifiable->notification_channels ?? ['mail'])));
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage())
            ->subject($this->cancelled() ? "Cleaning cancelled: {$this->task->property->name}" : "Cleaning moved: {$this->task->property->name}")
            ->line($this->summary());
    }

    public function toSms(object $notifiable): string
    {
        return "Nordic Stays: {$this->summary()}";
    }

    private function summary(): string
    {
        $property = $this->task->property;

        if ($this->cancelled()) {
            return "The cleaning at {$property->name} is cancelled. The guests’ stay was cancelled.";
        }

        $local = $this->task->starts_at->setTimezone($property->timezone)->format('l j F, H:i');   // Thursday 15 July, 11:00

        return "The cleaning at {$property->name} now starts {$local}. Please don’t go in before then.";
    }

    private function cancelled(): bool
    {
        return $this->task->status === CleaningTaskStatus::Cancelled;
    }
}`,
          after: ['The notification is queued, so it reloads the task when it is sent: the cleaner always reads the latest time.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: the coordinator plans the cleaning',
      text: [
        '`CalendarSync` already hears about every booking that is created, confirmed, imported, cancelled or expired. The cleaning becomes one more thing it decides, next to the overbooking check and the channel push.',
      ],
      blocks: [
        {
          path: 'app/Channels/CalendarSync.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\BookingStatus;
use App\Enums\MembershipRole;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\Overbooking;
use App\Models\Property;
use App\Notifications\OverbookingDetected;
use App\Operations\PlanTurnover;
use Illuminate\Support\Facades\Notification;

final class CalendarSync
{
    public function __construct(private PlanTurnover $turnover)
    {
    }

    /** A booking was created, confirmed, imported, cancelled, expired or moved to other dates. */
    public function bookingChanged(Booking $booking): void
    {
        if (in_array($booking->status, BookingStatus::blocking(), true)) {
            $this->recordClashes($booking);
        }

        $this->turnover->forBooking($booking);                          // the cleaning follows the booking

        PushAvailability::forProperty($booking->property);           // every channel learns the new state (scene 17)
    }

    /** An iCal sync changed the blocks of a property (scene 12). */
    public function blocksChanged(Property $property): void
    {
        PushAvailability::forProperty($property);
    }

    private function recordClashes(Booking $booking): void
    {
        $clashes = $booking->property->bookings()
            ->overlapping($booking->stay)
            ->whereKeyNot($booking->id)
            ->where('id', '<', $booking->id)                               // earlier bookings only: each clash is recorded once, on the later one
            ->get();

        foreach ($clashes as $earlier) {
            $overbooking = Overbooking::createOrFirst([
                'property_id' => $booking->property_id,
                'booking_id' => $booking->id,
                'conflicting_booking_id' => $earlier->id,
            ]);

            if ($overbooking->wasRecentlyCreated) {
                $owners = $booking->property->account->users()->wherePivot('role', MembershipRole::Owner->value)->get();
                Notification::send($owners, (new OverbookingDetected($overbooking))->afterCommit());
            }
        }
    }
}`,
        },
        {
          title: 'Confirmation stops creating the task itself',
          text: ['Step 4 already calls `CalendarSync`, which now plans the cleaning, so the code from last week goes.'],
          path: 'app/Bookings/BookingConfirmation.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Enums\PaymentStatus;
use App\Messaging\ScheduleGuestMessages;
use App\Models\Booking;
use App\Models\Payment;
use App\Notifications\BookingConfirmed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

final class BookingConfirmation
{
    public function __construct(
        private CalendarSync $calendar,
        private ScheduleGuestMessages $scheduleMessages,
    ) {
    }

    public function confirm(Booking $booking, Payment $payment): void
    {
        DB::transaction(function () use ($booking, $payment): void {
            $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();   // fresh, and locked

            if (! $booking->state()->confirm($booking)) {               // step 1: the state decides
                return;                                                // already confirmed: nothing else to do
            }

            $payment->status = PaymentStatus::Succeeded;               // step 2
            $payment->save();

            $this->scheduleMessages->handle($booking);                 // the guest's messages, at their local times

            Notification::route('mail', $booking->guest_email)         // step 3, after the commit
                ->notify((new BookingConfirmed($booking))->afterCommit());

            $this->calendar->bookingChanged($booking);                  // step 4: channels, overbookings and the cleaning
        });
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: a date change goes through the coordinator too',
      text: [
        'This is the line the incident needed. A date change, and the revert when its payment fails, now tell `CalendarSync`, so the cleaning moves and every channel gets the new nights.',
      ],
      blocks: [
        {
          path: 'app/Bookings/ChangeBookingDates.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
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
        private CalendarSync $calendar,
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
            $this->calendar->bookingChanged($booking);                  // the fix: channels and the cleaning follow too

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
          path: 'app/Bookings/RevertBookingChange.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Messaging\RescheduleGuestMessages;
use App\Models\Booking;
use App\Models\BookingChange;
use Illuminate\Support\Facades\DB;

final readonly class RevertBookingChange
{
    public function __construct(
        private RescheduleGuestMessages $reschedule,
        private CalendarSync $calendar,
    ) {
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
            $this->calendar->bookingChanged($booking);                  // the old dates go back to the channels and the cleaner

            $change->forceFill(['status' => 'reverted'])->save();
        });
    }
}`,
          after: ['Every other path that changes a booking already calls `CalendarSync`: confirmation, cancellation, expired holds and channel imports. Each of them now plans the cleaning without any change of its own.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'The incident, the property’s time, cancellations, reverts, and no message when nothing moved',
    blocks: [
      {
        path: 'tests/Feature/TurnoverTest.php',
        code: String.raw`<?php

use App\Bookings\CancelBooking;
use App\Bookings\ChangeBookingDates;
use App\Bookings\RevertBookingChange;
use App\Bookings\Stay;
use App\Channels\CalendarSync;
use App\Enums\CleaningTaskStatus;
use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\BookingChange;
use App\Models\CleaningTask;
use App\Models\Property;
use App\Notifications\TurnoverChanged;
use App\Payments\PaymentGateway;
use Illuminate\Support\Facades\Notification;
use Tests\Fakes\FakePaymentGateway;

beforeEach(function () {
    $this->app->instance(PaymentGateway::class, new FakePaymentGateway());
    Notification::fake();

    $this->property = Property::factory()->create(['name' => 'Nyhavn flat']);   // Copenhagen, check-out 11:00
    $this->booking = Booking::factory()->for($this->property)->forStay('2027-07-10', 3)->create();
    app(CalendarSync::class)->bookingChanged($this->booking);                  // as at confirmation

    $this->cleaner = hostOf($this->property, MembershipRole::Cleaner);
    CleaningTask::sole()->forceFill(['assigned_to' => $this->cleaner->id])->save();
});

it('moves the cleaning when the guests extend, and tells the cleaner', function () {
    app(ChangeBookingDates::class)->handle($this->booking, Stay::fromDates('2027-07-10', '2027-07-14'));

    expect(CleaningTask::sole()->starts_at->toDateTimeString())->toBe('2027-07-14 09:00:00');   // 11:00 in Copenhagen, summer
    Notification::assertSentTo($this->cleaner, TurnoverChanged::class);
});

it('starts at the check-out time of the property’s own timezone', function () {
    $queenstown = Property::factory()->in('Queenstown', 'NZ', 'Pacific/Auckland')->create(['check_out_time' => '10:00']);
    $booking = Booking::factory()->for($queenstown)->forStay('2027-07-10', 3)->create();

    app(CalendarSync::class)->bookingChanged($booking);

    expect(CleaningTask::where('booking_id', $booking->id)->sole()->starts_at->toDateTimeString())
        ->toBe('2027-07-12 22:00:00');                                          // 13 July 10:00 in New Zealand winter
});

it('cancels the cleaning with the stay, and tells the cleaner', function () {
    app(CancelBooking::class)->handle($this->booking);

    expect(CleaningTask::sole()->status)->toBe(CleaningTaskStatus::Cancelled);
    Notification::assertSentTo($this->cleaner, TurnoverChanged::class);
});

it('puts the cleaning back when the extra payment fails', function () {
    app(ChangeBookingDates::class)->handle($this->booking, Stay::fromDates('2027-07-10', '2027-07-14'));

    app(RevertBookingChange::class)->handle(BookingChange::sole());

    expect(CleaningTask::sole()->starts_at->toDateTimeString())->toBe('2027-07-13 09:00:00');
    Notification::assertSentToTimes($this->cleaner, TurnoverChanged::class, 2);   // moved, then moved back
});

it('says nothing when nothing moved', function () {
    app(CalendarSync::class)->bookingChanged($this->booking);
    app(CalendarSync::class)->bookingChanged($this->booking);

    expect(CleaningTask::count())->toBe(1);
    Notification::assertNotSentTo($this->cleaner, TurnoverChanged::class);
});`,
        after: ['`hostOf()` is the Foundation helper: it adds a member with the given role to the property’s account.'],
      },
    ],
  },
  next: 'The cleaning now follows the calendar. Next, the summer prices go live, and every Saturday in July gets cheaper than one in October.',
};
