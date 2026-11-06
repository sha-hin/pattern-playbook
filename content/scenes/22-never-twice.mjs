// Scene 22 · Never send twice; Observer and the Event Dispatcher for cancellations.

export default {
  description: 'A guest got her door code twice, and a guest who had cancelled still got arrival instructions. Fix it in Laravel with an atomic pending → sent update that only one worker can win, and a BookingCancelled event with independent listeners: the Observer pattern through Laravel’s event dispatcher.',
  incident: {
    channel: '#support',
    when: 'Thursday 15:02',
    messages: [
      ['Mona · support', 'The Nyhavn guest got “Your door code is 4711” **twice**, at 15:00:58 and 15:01:02.'],
      ['Mona · support', 'And a guest who **cancelled last week** just got arrival instructions for the Lake Cabin, with the key box code. The host is not happy.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Jobs/SendScheduledMessage.php (from scene 21)',
          broken: true, fragment: true,
          code: String.raw`public function handle(): void
{
    Notification::route('mail', $booking->guest_email)->notifyNow(new GuestMessage($this->message));   // 1. send

    $this->message->forceFill(['status' => ScheduledMessageStatus::Sent, 'sent_at' => now()])->save();  // 2. then mark
}`,
          after: [
            'At 15:00 the scheduler queued the message. The workers were busy, so at 15:01 it was **still pending**, and the scheduler queued it again. Two jobs, two workers, both sent before either marked it. The same happens when a job sends the email and then crashes before step 2: the retry sends it again.',
            'And nothing connects cancelling a booking (scene 10) to its messages. They stay pending, and go out on time, to a guest who isn’t coming.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: claim the message before sending it',
      text: [
        'The status check and the status change have to be **one** step, or two workers can both see "pending". A conditional `UPDATE ... WHERE status = \'pending\'` is exactly that: the database runs it atomically, so for one message only one worker can ever change the row. `update()` returns how many rows changed: **1** means "it’s yours, send it", **0** means someone else already did, or it was cancelled.',
      ],
      blocks: [
        {
          path: 'app/Jobs/SendScheduledMessage.php (after)',
          code: String.raw`<?php

namespace App\Jobs;

use App\Enums\ScheduledMessageStatus;
use App\Models\ScheduledMessage;
use App\Notifications\GuestMessage;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Notification;
use Throwable;

class SendScheduledMessage implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public ScheduledMessage $message)
    {
    }

    public function handle(): void
    {
        $claimed = ScheduledMessage::query()
            ->whereKey($this->message->id)
            ->where('status', ScheduledMessageStatus::Pending)                       // only if nobody got here first
            ->update(['status' => ScheduledMessageStatus::Sent, 'sent_at' => now()]);

        if ($claimed === 0) {
            return;                                                                   // already sent, or cancelled
        }

        try {
            Notification::route('mail', $this->message->booking->guest_email)->notifyNow(new GuestMessage($this->message));
        } catch (Throwable $e) {
            ScheduledMessage::query()->whereKey($this->message->id)->update(['status' => ScheduledMessageStatus::Pending, 'sent_at' => null]);
            throw $e;                                                                 // give it back, so the retry can claim it
        }
    }
}`,
          after: [
            'The order is a deliberate choice. Marking **before** sending means a crash between the two can lose a message (at most once). Marking **after** means a crash can send it twice (at least once). For a door code, a missing message is noticed and resent by support; a duplicate can’t be taken back. The `catch` covers the common failure, a mail server error, by giving the message back.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 2: a cancellation announces itself',
      text: [
        'Cancelling a booking now needs to cancel its messages, email the guest a confirmation, and soon more (Day 5 cancels the cleaning task). Putting each of those calls into `CancelBooking` makes it know about messaging, email and cleaning. Instead, it announces **one fact**, "this booking was cancelled", and every part of the app that cares **listens**.',
      ],
      blocks: [
        {
          title: 'The event',
          text: ['`ShouldDispatchAfterCommit`: the event is held until the transaction in `CancelBooking` commits. If the cancellation rolls back, nobody hears about it.'],
          path: 'app/Events/BookingCancelled.php',
          code: String.raw`<?php

namespace App\Events;

use App\Models\Booking;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class BookingCancelled implements ShouldDispatchAfterCommit
{
    use Dispatchable, SerializesModels;

    public function __construct(public Booking $booking)
    {
    }
}`,
        },
        {
          path: 'app/Bookings/CancelBooking.php (one line added, after the state changed)',
          fragment: true,
          code: String.raw`BookingCancelled::dispatch($booking);`,
          after: ['Channel bookings cancelled by an import (scene 15) dispatch the same event, so their messages stop too.'],
        },
        {
          title: 'Listener 1: stop the messages',
          text: ['Only pending rows change; a message already sent stays in the history as sent.'],
          path: 'app/Listeners/CancelScheduledMessages.php',
          code: String.raw`<?php

namespace App\Listeners;

use App\Enums\ScheduledMessageStatus;
use App\Events\BookingCancelled;

class CancelScheduledMessages
{
    public function handle(BookingCancelled $event): void
    {
        $event->booking->scheduledMessages()
            ->where('status', ScheduledMessageStatus::Pending)
            ->update(['status' => ScheduledMessageStatus::Cancelled]);
    }
}`,
          after: ['It runs right away, not on a queue: a message due in the next minute must be stopped before the scheduler finds it. And because scene 22’s claim only takes **pending** rows, a send job already queued for it now finds nothing to claim.'],
        },
        {
          title: 'Listener 2: tell the guest',
          text: ['`ShouldQueue`: email is slow and can fail, so this one runs on the queue, with its own retries, and never delays the cancellation.'],
          path: 'app/Listeners/SendCancellationConfirmation.php',
          code: String.raw`<?php

namespace App\Listeners;

use App\Events\BookingCancelled;
use App\Notifications\BookingCancelledNotice;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Notification;

class SendCancellationConfirmation implements ShouldQueue
{
    public int $tries = 3;

    public function handle(BookingCancelled $event): void
    {
        Notification::route('mail', $event->booking->guest_email)->notify(new BookingCancelledNotice($event->booking));
    }
}`,
          after: ['Nothing registers these listeners: Laravel discovers every class in `app/Listeners` and reads the event from the type of `handle()`’s parameter. `php artisan event:list` shows the result.'],
        },
        {
          path: 'app/Notifications/BookingCancelledNotice.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Models\Booking;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class BookingCancelledNotice extends Notification
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
        return (new MailMessage())
            ->subject("Your stay at {$this->booking->property->name} is cancelled")
            ->line("Your booking from {$this->booking->stay->checkIn->toFormattedDateString()} has been cancelled.");
    }
}`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Observer', 'Event Dispatcher'],
    rules: [
      ['Observer', 'An object announces that something happened, and any number of other objects react, without the announcer knowing who they are.'],
      ['Event Dispatcher', 'One central object that carries events from whoever dispatches them to every listener registered for them. Laravel’s Event facade.'],
    ],
    points: [
      '`CancelBooking` knows one thing: a booking was cancelled. Adding a reaction (cancel the cleaning task, update a report) is a new listener, and `CancelBooking` never changes.',
      'Each listener chooses how it runs: right away (stop the messages before the next minute) or queued (the email).',
      'Compare scene 18’s mediator: the calendar needs **one place that decides the order** (find clashes, then push), so it stays a mediator. Reactions that are independent of each other are better as listeners.',
    ],
    whenNot: [
      'When the caller needs the result, or the steps must happen in a fixed order, call them directly. Events hide the flow: reading `CancelBooking` no longer tells you everything that happens.',
      'Don’t use events to pass data back to the dispatcher. A listener that must succeed for the action to make sense is a step, not a listener.',
    ],
  },
  laravel: {
    title: 'Laravel inside: dispatching an event',
    text: ['The dispatcher looks up the listeners for the event’s class and calls each in turn. A listener that implements `ShouldQueue` isn’t called: it is wrapped in a `CallQueuedListener` job and pushed to the queue instead.'],
    blocks: [
      {
        path: 'Illuminate/Events/Dispatcher.php (simplified)',
        fragment: true,
        code: String.raw`public function dispatch($event, $payload = [], $halt = false)
{
    if ($event instanceof ShouldDispatchAfterCommit && $this->transactionManager?->getPendingTransactions()->isNotEmpty()) {
        $this->transactionManager->addCallback(fn () => $this->invokeListeners($event, $payload, $halt));   // after COMMIT
        return null;
    }

    return $this->invokeListeners($event, $payload, $halt);
}

protected function invokeListeners($event, $payload, $halt = false)
{
    foreach ($this->getListeners(get_class($event)) as $listener) {   // queued listeners are wrapped here: CallQueuedListener
        $response = $listener($event, $payload);

        if ($response === false) {
            break;                                                    // a listener can stop the rest by returning false
        }
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'Two jobs send once, a failed send can be retried, and a cancellation stops what is pending',
    blocks: [
      {
        path: 'tests/Feature/NeverTwiceTest.php',
        code: String.raw`<?php

use App\Bookings\CancelBooking;
use App\Enums\ScheduledMessageStatus;
use App\Events\BookingCancelled;
use App\Jobs\SendScheduledMessage;
use App\Models\Booking;
use App\Models\MessageTemplate;
use App\Models\ScheduledMessage;
use App\Notifications\GuestMessage;
use Illuminate\Contracts\Notifications\Dispatcher;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;

function scheduled(Booking $booking, string $name, ScheduledMessageStatus $status = ScheduledMessageStatus::Pending): ScheduledMessage
{
    $template = MessageTemplate::forceCreate(['account_id' => $booking->property->account_id, 'name' => $name, 'trigger' => 'before_check_in', 'days_offset' => -1, 'send_time' => '15:00', 'subject' => $name, 'body' => 'Door code: {door_code}']);

    return ScheduledMessage::forceCreate(['booking_id' => $booking->id, 'message_template_id' => $template->id, 'send_at' => now()->subMinute(), 'status' => $status]);
}

it('sends once when two jobs run for the same message', function () {
    Notification::fake();
    $message = scheduled(Booking::factory()->create(), 'Arrival');

    app()->call([new SendScheduledMessage($message), 'handle']);
    app()->call([new SendScheduledMessage($message), 'handle']);          // the scheduler queued it again

    Notification::assertSentOnDemandTimes(GuestMessage::class, 1);
});

it('gives the message back when sending fails, so the retry can send it', function () {
    $this->mock(Dispatcher::class)->shouldReceive('sendNow')->once()->andThrow(new RuntimeException('SMTP timeout'));
    $message = scheduled(Booking::factory()->create(), 'Arrival');

    expect(fn () => app()->call([new SendScheduledMessage($message), 'handle']))->toThrow(RuntimeException::class)
        ->and($message->fresh()->status)->toBe(ScheduledMessageStatus::Pending);
});

it('cancels pending messages when the booking is cancelled, and keeps the sent ones', function () {
    $booking = Booking::factory()->create();
    $pending = scheduled($booking, 'Arrival');
    $sent = scheduled($booking, 'Thanks', ScheduledMessageStatus::Sent);

    app(CancelBooking::class)->handle($booking);

    expect($pending->fresh()->status)->toBe(ScheduledMessageStatus::Cancelled)
        ->and($sent->fresh()->status)->toBe(ScheduledMessageStatus::Sent);
});

it('announces the cancellation once', function () {
    Event::fake([BookingCancelled::class]);
    $booking = Booking::factory()->create();

    app(CancelBooking::class)->handle($booking);
    app(CancelBooking::class)->handle($booking);                           // already cancelled: no second event

    Event::assertDispatchedTimes(BookingCancelled::class, 1);
});`,
      },
    ],
  },
  next: 'Messages go out once, and stop when a booking does. Friday: a guest extends her stay by two nights, the extra charge fails, and the booking is left half changed.',
};
