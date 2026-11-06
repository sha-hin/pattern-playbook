// Scene 18 · Mediator: one coordinator decides what happens when the calendar changes.

export default {
  description: 'The same nights were sold on Airbnb and Booking.com 40 seconds apart, and nobody knew until both families arrived, because every class that changed the calendar told a different subset of the others. Fix it in Laravel with a Mediator: every change reports to one CalendarSync, which detects overbookings and updates every channel.',
  incident: {
    channel: '#incidents',
    when: 'Wednesday 15:10',
    messages: [
      ['Ahmed · host', 'Two families are booked into the Lake Cabin for 12–15 July: one from **Airbnb**, one from **Booking.com**, made 40 seconds apart last night. Nordic Stays showed both as confirmed and warned nobody.'],
      ['Karim · developer', 'The Airbnb import (scene 15) saves the booking, but never pushes to the other channels: only our own confirmations do. And the overlap check only runs for direct bookings.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Everything that changes the calendar has to remember what else must happen. Each one remembers a different part:'],
      blocks: [
        {
          path: 'four classes (before)',
          broken: true, fragment: true,
          code: String.raw`// BookingConfirmation (scene 6): pushes to the channels
PushAvailability::forProperty($booking->property);

// CancelBooking (scene 10): pushes, and frees the nights
PushAvailability::forProperty($booking->property);

// ExpireHolds (scene 9): forgot to push, so expired holds stay closed on Airbnb

// ImportChannelReservation (scene 15): saves the booking, pushes nothing, checks nothing`,
          after: [
            'Four colleagues, each wired to some of the others. When the team added overbooking detection, it went into one of the four. When it adds a fifth source of bookings (a Vrbo import, an admin tool), the list of "what to remember" has to be copied again.',
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
          text: ['Each one reports what happened, in one line, inside its own transaction; the pushes and emails it triggers wait for the commit. `CalendarSync` is injected by the container (scene 5).'],
          path: 'the same four classes (after)',
          fragment: true,
          code: String.raw`// BookingConfirmation, after the state changed (scene 9)
$this->calendar->bookingChanged($booking);

// CancelBooking, after the state changed (scene 10)
$this->calendar->bookingChanged($booking);

// ExpireHolds, after each expiry
$this->calendar->bookingChanged($booking);

// ImportChannelReservation, after saving (only when the reservation was applied)
$this->calendar->bookingChanged($booking);

// SyncIcalFeed, after the import
$this->calendar->blocksChanged($this->feed->property);`,
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
