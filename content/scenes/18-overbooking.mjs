// Scene 18 · Mediator: one coordinator decides what happens when the calendar changes.

export default {
  description: 'The same nights were sold on Airbnb and Booking.com 40 seconds apart, and nobody knew until both families arrived, because every class that changed the calendar told a different subset of the others. Fix it in Laravel with a Mediator: every change reports to one CalendarSync, which detects overbookings and updates every channel.',
  incident: {
    channel: '#incidents',
    when: 'Wednesday 15:10',
    messages: [
      ['Ahmed · host', 'Two families are booked into the Lake Cabin for 12–15 July: one from **Airbnb**, one from **Booking.com**, made 40 seconds apart last night. Nordic Stays showed both as confirmed and warned nobody.'],
      ['Karim · developer', 'Our push closed the nights on Booking.com 40 seconds after the Airbnb booking arrived, and Booking.com had sold them in between. Two channels can always sell the same night inside that window. What hurts is that nothing looks for a clash when a channel booking arrives, so nobody was warned.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Everything that changes the calendar has to remember what else must happen. Each one remembers a different part:'],
      blocks: [
        {
          path: 'five classes (before)',
          broken: true, fragment: true,
          code: String.raw`// BookingConfirmation, CancelBooking, ExpireHolds (scene 17): push
PushAvailability::forProperty($booking->property);

// ImportChannelReservation (scene 17): pushes too, but never looks for a clash
PushAvailability::forProperty($booking->property);

// SyncIcalFeed (scene 12): changes the blocks and pushes nothing,
// so a block from Airbnb's feed never reaches Booking.com`,
          after: [
            'Five colleagues, each remembering its own part of what must follow a calendar change. One forgot to push; none checks for a clash. Adding overbooking detection would mean adding it to all five, and the next source of bookings (a Vrbo import, an admin tool) would have to copy the whole list again.',
            'A channel booking can’t be refused the way a direct one can (scene 3 answers 409): the guest has already paid the channel. The best Nordic Stays can do is **notice instantly**, tell the host, and close the nights everywhere else.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: overbookings are recorded, not lost',
      text: ['An overbooking is a fact the host has to act on, so it gets a table. The unique pair means detecting the same clash twice records it once.'],
      blocks: [
        {
          path: 'database/migrations/2026_03_10_000001_create_overbookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('overbookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained();
            $table->foreignId('booking_id')->constrained();                 // the booking that arrived later
            $table->foreignId('conflicting_booking_id')->constrained('bookings');
            $table->timestamp('resolved_at')->nullable();                   // the host moved a guest, or one cancelled
            $table->timestamps();
            $table->unique(['booking_id', 'conflicting_booking_id']);
        });
    }
};`,
        },
        {
          path: 'app/Models/Overbooking.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Overbooking extends Model
{
    protected $fillable = ['property_id', 'booking_id', 'conflicting_booking_id'];

    protected function casts(): array
    {
        return ['resolved_at' => 'datetime'];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function conflictingBooking(): BelongsTo
    {
        return $this->belongsTo(Booking::class, 'conflicting_booking_id');
    }
}`,
        },
        {
          title: 'The host hears about it at once',
          path: 'app/Notifications/OverbookingDetected.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Models\Overbooking;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class OverbookingDetected extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public Overbooking $overbooking)
    {
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $later = $this->overbooking->booking;
        $earlier = $this->overbooking->conflictingBooking;

        return (new MailMessage())
            ->error()
            ->subject("Overbooking at {$later->property->name}")
            ->line("{$later->guest_name} ({$later->channel?->value}) and {$earlier->guest_name} ({$earlier->channel?->value}) are both booked for nights between {$later->check_in->toDateString()} and {$later->check_out->toDateString()}.")
            ->line('The earlier booking keeps the property. Please contact the later guest about another property or a cancellation through their channel.');
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: one coordinator',
      text: [
        'Every class that changes the calendar tells **one** object what happened, and nothing else. That object knows who else has to react, and in which order: first find any clash, then close or open the nights on every channel. The colleagues no longer know about each other, the channels, or overbookings.',
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
use Illuminate\Support\Facades\Notification;

final class CalendarSync
{
    /** A booking was created, confirmed, imported, cancelled or expired. */
    public function bookingChanged(Booking $booking): void
    {
        if (in_array($booking->status, BookingStatus::blocking(), true)) {
            $this->recordClashes($booking);
        }

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
          after: ['Direct bookings can’t clash, because scene 4 refuses them under a lock. Clashes can only come from the channels, which is exactly where this catches them.'],
        },
        {
          title: 'The colleagues, now',
          text: ['Each one reports what happened, in one line, inside its own transaction; the pushes and emails it triggers wait for the commit. The container injects `CalendarSync` (scene 5). Confirming:'],
          path: 'app/Bookings/BookingConfirmation.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\Payment;
use App\Notifications\BookingConfirmed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

final class BookingConfirmation
{
    public function __construct(private CalendarSync $calendar)
    {
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

            Notification::route('mail', $booking->guest_email)         // step 3, after the commit
                ->notify((new BookingConfirmed($booking))->afterCommit());

            $this->calendar->bookingChanged($booking);                  // step 4: the coordinator decides what follows
        });
    }
}`,
        },
        {
          text: ['Cancelling:'],
          path: 'app/Bookings/CancelBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Enums\PaymentStatus;
use App\Jobs\RefundCancelledBooking;
use App\Models\Booking;
use App\Money\Money;
use Illuminate\Support\Facades\DB;

final class CancelBooking
{
    public function __construct(private CalendarSync $calendar)
    {
    }

    /** @return Money the amount that will be refunded */
    public function handle(Booking $booking): Money
    {
        return DB::transaction(function () use ($booking): Money {
            $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();
            $nothing = Money::zero($booking->total->currency);

            if (! $booking->state()->cancel($booking)) {          // scene 9: already cancelled
                return $nothing;
            }

            $this->calendar->bookingChanged($booking);                  // the nights are free again

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
          text: ['An expired hold. A command receives the coordinator in `handle()`:'],
          path: 'app/Console/Commands/ExpireHolds.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Channels\CalendarSync;
use App\Enums\BookingStatus;
use App\Models\Booking;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ExpireHolds extends Command
{
    protected $signature = 'bookings:expire-holds';

    protected $description = 'Expire pending bookings whose hold has ended';

    public function handle(CalendarSync $calendar): void
    {
        Booking::query()
            ->where('status', BookingStatus::Pending)
            ->where('expires_at', '<=', now())
            ->lazyById()
            ->each(function (Booking $booking) use ($calendar): void {
                DB::transaction(function () use ($booking, $calendar): void {
                    $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();

                    if ($booking->status !== BookingStatus::Pending) {   // a payment may have won the race
                        return;
                    }

                    $booking->state()->expire($booking);

                    $calendar->bookingChanged($booking);
                });
            });
    }
}`,
        },
        {
          text: ['The channel import, only when the reservation was applied:'],
          path: 'app/Channels/ImportChannelReservation.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

final class ImportChannelReservation
{
    public function __construct(private CalendarSync $calendar)
    {
    }

    /** @return bool true when the reservation was applied, false when it was older than what we have */
    public function handle(ChannelReservation $reservation): bool
    {
        $listing = ChannelListing::query()
            ->where('channel', $reservation->channel)
            ->where('external_listing_id', $reservation->externalListingId)
            ->firstOrFail();

        return DB::transaction(function () use ($reservation, $listing): bool {
            Property::whereKey($listing->property_id)->lockForUpdate()->firstOrFail();   // one change per property at a time

            $booking = Booking::query()
                ->where('channel', $reservation->channel)
                ->where('external_id', $reservation->externalId)
                ->lockForUpdate()
                ->first() ?? new Booking();

            if ($booking->exists && $booking->external_version >= $reservation->version) {
                return false;                                      // older or the same: already applied something newer
            }

            $booking->forceFill([
                'property_id' => $listing->property_id,
                'channel' => $reservation->channel,
                'external_id' => $reservation->externalId,
                'external_version' => $reservation->version,
                'status' => $reservation->status,                  // the channel decides; our own State rules (scene 9) guard our actions
                'guest_name' => $reservation->guestName,
                'guest_email' => $reservation->guestEmail,
                'guests' => $reservation->guests,
                'stay' => $reservation->stay,
                'total' => $reservation->total,
                'confirmed_at' => $booking->confirmed_at ?? now(),
                'cancelled_at' => $reservation->status === BookingStatus::Cancelled ? ($booking->cancelled_at ?? now()) : null,
            ])->save();

            $this->calendar->bookingChanged($booking);                  // clashes are found here, and the channels told

            return true;
        });
    }
}`,
        },
        {
          text: ['And the iCal sync, which changes blocks rather than bookings:'],
          path: 'app/Jobs/SyncIcalFeed.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Channels\CalendarSync;
use App\Channels\Ical\IcalImporter;
use App\Models\IcalFeed;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

class SyncIcalFeed implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public IcalFeed $feed)
    {
    }

    /** @return list<int> */
    public function backoff(): array
    {
        return [60, 300];
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping("ical-feed-{$this->feed->id}"))->expireAfter(120)];
    }

    public function handle(IcalImporter $importer, CalendarSync $calendar): void
    {
        $importer->sync($this->feed);

        $calendar->blocksChanged($this->feed->property);               // blocks from Airbnb's feed close Booking.com too
    }
}`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Mediator'],
    rules: [['Mediator', 'One object that coordinates how a group of objects interact, so they talk to it instead of to each other.']],
    points: [
      'Five colleagues and three reactions used to mean up to fifteen connections, each a chance to forget one. Now there are five lines into the mediator and three out of it.',
      'The rules about **order** live in one place: detect clashes before pushing, record once, notify once.',
      'A new source of bookings is one line: `bookingChanged($booking)`.',
    ],
    whenNot: [
      'When reactions are independent and their order doesn’t matter, events fit better: anyone can listen without the sender knowing (scene 22).',
      'Don’t let the mediator absorb the colleagues’ own work. It decides who reacts; the push is still `PushAvailability`, the email is still a notification.',
    ],
  },
  tests: {
    summary: 'A channel clash is recorded and reported once, and every change reaches the channels',
    blocks: [
      {
        path: 'tests/Feature/CalendarSyncTest.php',
        code: String.raw`<?php

use App\Channels\CalendarSync;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Overbooking;
use App\Models\Property;
use App\Notifications\OverbookingDetected;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    Queue::fake();
    Notification::fake();
    $this->property = Property::factory()->create();
    $this->owner = hostOf($this->property);
    ChannelListing::forceCreate(['property_id' => $this->property->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);
});

it('records a cross-channel clash once and tells the owner once', function () {
    $airbnb = Booking::factory()->for($this->property)->forStay('2027-07-12', 3)->create(['channel' => Channel::Airbnb, 'external_id' => 'HM1']);
    $bookingCom = Booking::factory()->for($this->property)->forStay('2027-07-12', 3)->create(['channel' => Channel::BookingCom, 'external_id' => '553']);

    app(CalendarSync::class)->bookingChanged($bookingCom);
    app(CalendarSync::class)->bookingChanged($bookingCom);              // a duplicate webhook
    app(CalendarSync::class)->bookingChanged($airbnb);                  // the earlier one: nothing to record

    expect(Overbooking::sole())
        ->booking_id->toBe($bookingCom->id)
        ->conflicting_booking_id->toBe($airbnb->id);
    Notification::assertSentToTimes($this->owner, OverbookingDetected::class, 1);
});

it('pushes the new state to the channels on every change, cancellations included', function () {
    $booking = Booking::factory()->for($this->property)->create(['status' => BookingStatus::Cancelled]);

    app(CalendarSync::class)->bookingChanged($booking);

    Queue::assertPushed(PushAvailability::class);
    expect(Overbooking::count())->toBe(0);
});`,
      },
    ],
  },
  next: 'Day 3 is done: iCal, the real APIs, matching kits, ordered imports, rate limits, coalesced pushes and one coordinator for the calendar. Day 4 starts on Monday, when a host logs in and sees another host’s bookings.',
};
