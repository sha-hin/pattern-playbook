// Scene 6 · Facade: one entry point for confirming a booking.

export default {
  description: 'A host marked a bank transfer as paid: the booking said confirmed, the payment stayed pending and the guest got no email, because every caller repeated the confirmation steps its own way. Fix it with the Facade pattern in Laravel, and see how Laravel facades and fakes work inside.',
  incident: {
    channel: '#support',
    when: 'Friday 15:20',
    messages: [
      ['Mona · support', 'A host got a bank transfer for the Lake Cabin and clicked **Mark as paid**. The booking says *confirmed*, but finance still sees the payment as **pending**, and the guest never got a confirmation email. She’s asking if her booking is real.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Confirming a booking is several steps. Each place that confirms one knows a different subset of them:'],
      blocks: [
        {
          path: 'app/Http/Controllers/PaymentReturnController.php (before)',
          broken: true, fragment: true,
          code: String.raw`// after a card payment: three steps
$booking->status = BookingStatus::Confirmed;
$booking->confirmed_at = now();
$booking->save();
$payment->update(['status' => PaymentStatus::Succeeded]);
Mail::to($booking->guest_email)->send(new BookingConfirmedMail($booking));`,
        },
        {
          path: 'app/Http/Controllers/MarkBookingPaidController.php (before)',
          broken: true, fragment: true,
          code: String.raw`// "Mark as paid" for a bank transfer: one step, written later by someone else
$booking->status = BookingStatus::Confirmed;
$booking->save();`,
          after: [
            'Nothing here is hard. The problem is that **"confirm a booking" has no home**, so every caller has to know all the steps, in the right order, inside a transaction. The next scenes add more steps (close the dates on Airbnb, schedule guest messages, plan the cleaning). Each one would have to be added to every caller, and one will always be forgotten.',
          ],
        },
      ],
    },
    {
      title: 'The fix: one front door',
      blocks: [
        {
          title: 'The guest’s email',
          text: ['A queued notification, so a slow mail server never slows down the request. Guests aren’t users, so it is sent "on demand" to an address, below.'],
          path: 'app/Notifications/BookingConfirmed.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Models\Booking;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class BookingConfirmed extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public Booking $booking)
    {
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $stay = $this->booking->stay;

        return (new MailMessage())
            ->subject("Your stay at {$this->booking->property->name} is confirmed")
            ->greeting("Hi {$this->booking->guest_name},")
            ->line("See you from {$stay->checkIn->toFormattedDateString()} to {$stay->checkOut->toFormattedDateString()}.")
            ->line("Total paid: {$this->booking->total->format()}");
    }
}`,
        },
        {
          title: 'The facade',
          text: [
            'One public method that runs every step, in the right order. The status and the payment change in **one transaction**, so either both happen or neither does. The email is queued with `afterCommit()`: it only leaves once the transaction has committed, so a guest never gets an email for a change that was rolled back.',
            'The booking row is locked (scene 4), so two confirmations at the same moment run one after the other, and the second one finds the booking already confirmed and does nothing.',
          ],
          path: 'app/Bookings/BookingConfirmation.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\Payment;
use App\Notifications\BookingConfirmed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use LogicException;

final class BookingConfirmation
{
    public function confirm(Booking $booking, Payment $payment): void
    {
        DB::transaction(function () use ($booking, $payment): void {
            $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();   // fresh, and locked

            if ($booking->status === BookingStatus::Confirmed) {
                return;                                                // confirmed already: nothing to do
            }
            if ($booking->status !== BookingStatus::Pending) {
                throw new LogicException("Booking {$booking->id} is {$booking->status->value} and can't be confirmed.");
            }

            $booking->status = BookingStatus::Confirmed;               // step 1
            $booking->confirmed_at = now();
            $booking->expires_at = null;                               // no longer a hold
            $booking->save();

            $payment->status = PaymentStatus::Succeeded;               // step 2
            $payment->save();

            Notification::route('mail', $booking->guest_email)         // step 3, after the commit
                ->notify((new BookingConfirmed($booking))->afterCommit());

            // Day 3 adds: close the dates on every channel. Day 4: schedule guest messages. Day 5: plan the cleaning.
        });
    }
}`,
        },
        {
          title: 'Every caller is now one line',
          text: ['The card payment and the bank transfer both go through the same door. When Day 3 adds "close the dates on Airbnb", it is added once, inside `confirm()`, and no caller changes.'],
          path: 'app/Http/Controllers/PaymentReturnController.php · MarkBookingPaidController.php (after)',
          fragment: true,
          code: String.raw`// after a card payment
$confirmation->confirm($booking, $payment);

// "Mark as paid" for a bank transfer: record the transfer, then the same door
$payment = $booking->payments()->create([
    'amount_cents' => $booking->total->amount,
    'currency' => $booking->total->currency->value,
    'status' => PaymentStatus::Pending,                             // no Stripe id: paid outside Stripe
]);
$confirmation->confirm($booking, $payment);`,
          after: ['Both controllers receive `BookingConfirmation $confirmation` as a parameter, filled in by the container (scene 5).'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Facade'],
    rules: [['Facade', 'One simple entry point in front of a group of steps or classes, so callers don’t have to know how they fit together.']],
    points: [
      'Callers know **one** method. The order of the steps, the transaction and the lock are the facade’s business.',
      'Each step stays in its own place: the facade only **coordinates**. The email is in the notification; scene 9 moves the status rules into the booking’s states.',
      'New steps are added in one place, and no caller changes.',
    ],
    whenNot: [
      'Don’t let a facade grow rules of its own. It orders steps; if `confirm()` starts calculating refunds, it’s turning into a god class.',
      'Don’t put a facade in front of a single step. One call needs no front door.',
    ],
  },
  laravel: {
    title: 'Laravel facades are something else',
    text: [
      '`Notification::route()`, `DB::transaction()` and `Cache::get()` are called "facades" in Laravel, but they aren’t the Facade pattern from this scene. A Laravel facade has no logic: it forwards every static call to **one object in the container**. That’s also why fakes work: put a different object in the container, and every static call reaches it.',
    ],
    blocks: [
      {
        title: 'Every static call is forwarded',
        path: 'Illuminate/Support/Facades/Facade.php (simplified)',
        fragment: true,
        code: String.raw`public static function __callStatic($method, $args)
{
    $instance = static::getFacadeRoot();                     // the real object behind the facade

    if (! $instance) {
        throw new RuntimeException('A facade root has not been set.');
    }

    return $instance->$method(...$args);                     // Notification::route() → $channelManager->route()
}

protected static function resolveFacadeInstance($name)
{
    if (isset(static::$resolvedInstance[$name])) {
        return static::$resolvedInstance[$name];             // looked up once, then remembered
    }

    return static::$resolvedInstance[$name] = static::$app[$name];   // from the container
}`,
      },
      {
        title: 'A fake is a swap',
        text: ['`Notification::fake()` builds a `NotificationFake` and swaps it in, both in the facade’s memory and in the container. From then on every notification lands in the fake, which records it instead of sending it.'],
        path: 'Illuminate/Support/Facades/Facade.php (simplified)',
        fragment: true,
        code: String.raw`public static function swap($instance)
{
    static::$resolvedInstance[static::getFacadeAccessor()] = $instance;

    if (isset(static::$app)) {
        static::$app->instance(static::getFacadeAccessor(), $instance);   // injected code gets the fake too
    }
}`,
      },
      {
        table: [
          ['', 'The Facade pattern', 'Laravel facade'],
          ['What it is', 'A class that runs many steps behind one method', 'A static shortcut to one object in the container'],
          ['Has logic?', 'Yes: which steps, in which order', 'No: it only forwards calls'],
          ['Here', '`BookingConfirmation::confirm()`', '`Notification::route()`, `DB::transaction()`'],
        ],
      },
    ],
  },
  tests: {
    summary: 'Every step happens, once, and only for a pending booking',
    blocks: [
      {
        path: 'tests/Feature/BookingConfirmationTest.php',
        code: String.raw`<?php

use App\Bookings\BookingConfirmation;
use App\Enums\BookingStatus;
use App\Enums\PaymentStatus;
use App\Models\Booking;
use App\Models\Payment;
use App\Notifications\BookingConfirmed;
use Illuminate\Support\Facades\Notification;

beforeEach(fn () => Notification::fake());

it('confirms the booking, marks the payment paid and emails the guest', function () {
    $booking = Booking::factory()->pending()->create(['guest_email' => 'mona@example.com']);
    $payment = Payment::factory()->for($booking)->create();

    app(BookingConfirmation::class)->confirm($booking, $payment);

    expect($booking->fresh())
        ->status->toBe(BookingStatus::Confirmed)
        ->confirmed_at->not->toBeNull()
        ->expires_at->toBeNull()
        ->and($payment->fresh()->status)->toBe(PaymentStatus::Succeeded);

    Notification::assertSentOnDemand(
        BookingConfirmed::class,
        fn (BookingConfirmed $notification, array $channels, object $notifiable): bool => $notifiable->routes['mail'] === 'mona@example.com',
    );
});

it('does nothing the second time', function () {
    $booking = Booking::factory()->pending()->create();
    $payment = Payment::factory()->for($booking)->create();

    app(BookingConfirmation::class)->confirm($booking, $payment);
    app(BookingConfirmation::class)->confirm($booking, $payment);

    Notification::assertSentOnDemandTimes(BookingConfirmed::class, 1);
});

it('refuses to confirm a cancelled booking', function () {
    $booking = Booking::factory()->cancelled()->create();

    app(BookingConfirmation::class)->confirm($booking, Payment::factory()->for($booking)->create());
})->throws(LogicException::class, 'cancelled');`,
      },
    ],
  },
  next: 'Day 1 is done: money, dates, the endpoint, double bookings, payments and confirmation all have one home. Day 2 starts on Monday, when a guest’s quote and invoice disagree by €14.',
};
