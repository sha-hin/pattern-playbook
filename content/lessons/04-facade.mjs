// Lesson 4: Facade (GoF), and how Laravel's facades differ.

export default {
  description: 'Confirming a paid booking takes six steps, and every caller forgets a different one. Give callers one simple door with the GoF Facade pattern, then see how Laravel’s facades (static proxies), real-time facades and fakes work inside.',
  ticket: {
    from: 'Support',
    title: 'A booking marked as paid by hand was double-booked on Airbnb',
    body: 'When Stripe confirms a payment, our webhook confirms the booking, schedules the guest messages, creates the cleaning task, closes the dates on the channels and emails the guest. Last week an admin marked a bank-transfer booking as paid with the "Mark as paid" button. The button only changed the status: no messages, no cleaning task, and the dates stayed open on Airbnb, where someone booked them an hour later.',
  },
  pain: {
    text: ['Each caller repeats the steps it knows about:'],
    fragment: true,
    code: String.raw`// The Stripe webhook job
$booking->update(['status' => BookingStatus::Confirmed]);
app(ScheduleGuestMessages::class)->handle($booking);
app(CreateCleaningTask::class)->handle($booking);
PushAvailability::dispatch($booking->property_id);
$booking->notify(new BookingConfirmed($booking));

// The admin "Mark as paid" button
$booking->update(['status' => BookingStatus::Confirmed]);      // and nothing else`,
    after: [
      'Confirming a booking is one business operation, but its steps are spread over every caller. Each new caller (an import, a support tool) must know all six steps and their order, and any step added later has to be added everywhere.',
    ],
  },
  patterns: [
    {
      name: 'Facade',
      rule: 'A complex operation needs many classes → give callers one simple class that runs all the steps in the right order. The classes behind it stay usable on their own.',
      explain: [
        '`BookingConfirmation::confirm($booking)` is the only thing a caller needs to know. Behind it, the subsystems (messages, cleaning, channel sync, the guest email) do their own jobs; the facade only knows **which** of them to call and **in what order**, inside one transaction.',
        'The subsystems don’t know the facade exists, and code that needs only one of them can still call it directly.',
      ],
      drawing: {
        bad: [['b', 4, 20, 88, 30, 'Webhook', 'n'], ['b', 4, 116, 88, 30, 'Admin button', 'n'], ['a', 92, 30, 196, 18, '', 'x'], ['a', 92, 36, 196, 58, '', 'x'], ['a', 92, 42, 196, 98, '', 'x'], ['a', 92, 131, 196, 22, '', 'x'], ['b', 198, 6, 98, 26, 'status', 'n'], ['b', 198, 46, 98, 26, 'messages', 'n'], ['b', 198, 86, 98, 26, 'cleaning', 'n'], ['b', 198, 126, 98, 26, 'channels', 'x'], ['t', 52, 82, 'each knows some steps', 'kx', 'middle']],
        good: [['b', 4, 20, 80, 30, 'Webhook', 'n'], ['b', 4, 116, 80, 30, 'Admin button', 'n'], ['a', 84, 35, 104, 70, '', 'k'], ['a', 84, 131, 104, 96, '', 'k'], ['b', 106, 60, 86, 46, 'Confirmation', 'v'], ['a', 192, 72, 206, 19, ''], ['a', 192, 78, 206, 59, ''], ['a', 192, 88, 206, 99, ''], ['a', 192, 94, 206, 139, ''], ['b', 208, 6, 88, 26, 'status', 'n'], ['b', 208, 46, 88, 26, 'messages', 'n'], ['b', 208, 86, 88, 26, 'cleaning', 'n'], ['b', 208, 126, 88, 26, 'channels', 'n']],
        badCaption: 'Every caller runs the steps it remembers. The admin button forgot four.',
        goodCaption: 'Every caller makes one call; the facade knows every step and the order.',
      },
    },
  ],
  sections: [
    {
      title: 'Build it',
      blocks: [
        {
          title: 'The subsystems, each with one job',
          text: ['Each one is built in its own lesson; here only their entry points matter. None of them knows about the others.'],
          table: [
            ['Class', 'Job', 'Built in'],
            ['`ScheduleGuestMessages`', 'Creates the [`scheduled_messages`](F#table-scheduled-messages) rows for this booking', 'Lesson 15'],
            ['`CreateCleaningTask`', 'Creates the [turnover task](F#table-cleaning-tasks) with a copy of the [checklist](F#table-checklist-templates)', 'Lesson 8'],
            ['`PushAvailability` (job)', 'Closes the dates on every connected channel', 'Lessons 9 and 18'],
            ['`BookingConfirmed` (notification)', 'Emails the guest', 'Lesson 13'],
          ],
        },
        {
          title: 'The facade',
          text: [
            'One public method. The status change and the database rows happen in **one transaction**, so either all of them exist or none do. The channel push and the email are queued with `afterCommit()`: they only leave once the transaction has committed, so a guest never gets an email for a booking that rolled back.',
            'It is idempotent: confirming an already confirmed booking does nothing, because Stripe may deliver the same webhook twice.',
            '`$booking->notify()` works because `Booking` uses the `Notifiable` trait and routes mail to `guest_email` (lesson 13).',
          ],
          path: 'app/Bookings/BookingConfirmation.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\PushAvailability;
use App\Enums\BookingStatus;
use App\Messaging\ScheduleGuestMessages;
use App\Models\Booking;
use App\Notifications\BookingConfirmed;
use App\Operations\CreateCleaningTask;
use Illuminate\Support\Facades\DB;
use LogicException;

final readonly class BookingConfirmation
{
    public function __construct(
        private ScheduleGuestMessages $messages,
        private CreateCleaningTask $cleaning,
    ) {
    }

    public function confirm(Booking $booking): void
    {
        DB::transaction(function () use ($booking): void {
            $booking = Booking::whereKey($booking->id)->lockForUpdate()->firstOrFail();   // fresh, and locked

            if ($booking->status === BookingStatus::Confirmed) {
                return;                                               // a repeated webhook: nothing to do
            }
            if ($booking->status !== BookingStatus::Pending) {
                throw new LogicException("Booking {$booking->id} is {$booking->status->value} and can't be confirmed.");
            }

            $booking->status = BookingStatus::Confirmed;
            $booking->confirmed_at = now();
            $booking->expires_at = null;                              // no longer a hold
            $booking->save();

            $this->messages->handle($booking);                        // step 2
            $this->cleaning->handle($booking);                        // step 3

            PushAvailability::dispatch($booking->property_id)->afterCommit();      // step 4, after the commit
            $booking->notify((new BookingConfirmed($booking))->afterCommit());     // step 5, after the commit
        });
    }
}`,
        },
        {
          title: 'Every caller is now one line',
          path: 'app/Payments/ProcessStripeEvent.php · app/Http/Controllers/MarkAsPaidController.php', fragment: true,
          code: String.raw`// The Stripe webhook job (lesson 6)
app(BookingConfirmation::class)->confirm($booking);

// The admin "Mark as paid" button
public function __invoke(Booking $booking, BookingConfirmation $confirmation): BookingResource
{
    $confirmation->confirm($booking);

    return new BookingResource($booking->refresh());
}`,
        },
      ],
    },
  ],
  laravel: {
    text: [
      'Laravel uses the word "facade" for something different: `Cache::get()`, `Queue::push()` and `Http::get()` are **static proxies**. A Laravel facade has no logic of its own; it forwards every static call to one object in the container. That is why they can be faked: replace the object in the container, and every static call reaches the replacement.',
      'Laravel does have GoF facades too, just not under that name: `Illuminate\\Foundation\\Http\\Kernel::handle()` is one call that boots the app, runs the middleware, routes the request and reports errors.',
    ],
    blocks: [
      {
        title: 'A Laravel facade forwards every static call',
        path: 'Illuminate/Support/Facades/Facade.php (simplified)',
        code: String.raw`public static function __callStatic($method, $args)
{
    $instance = static::getFacadeRoot();                     // the real object behind the facade

    if (! $instance) {
        throw new RuntimeException('A facade root has not been set.');
    }

    return $instance->$method(...$args);                     // Cache::get('x') → $cacheManager->get('x')
}

public static function getFacadeRoot()
{
    return static::resolveFacadeInstance(static::getFacadeAccessor());   // e.g. 'cache'
}

protected static function resolveFacadeInstance($name)
{
    if (isset(static::$resolvedInstance[$name])) {
        return static::$resolvedInstance[$name];             // looked up once, then remembered
    }

    return static::$resolvedInstance[$name] = static::$app[$name];
}`,
      },
      {
        title: 'Fakes swap the object behind the facade',
        text: ['`Queue::fake()` builds a `QueueFake` and swaps it into both the facade cache and the container. From then on, every `dispatch()` in your code lands in the fake, which records instead of pushing to Redis.'],
        path: 'Illuminate/Support/Facades/Queue.php · Facade.php (simplified)',
        code: String.raw`// Queue facade
public static function fake($jobsToFake = [])
{
    $actualQueueManager = static::isFake() ? static::getFacadeRoot()->queue : static::getFacadeRoot();

    return tap(new QueueFake(static::getFacadeApplication(), $jobsToFake, $actualQueueManager), function ($fake) {
        static::swap($fake);
    });
}

// Facade base
public static function swap($instance)
{
    static::$resolvedInstance[static::getFacadeAccessor()] = $instance;

    if (isset(static::$app)) {
        static::$app->instance(static::getFacadeAccessor(), $instance);   // injected code gets the fake too
    }
}`,
      },
    ],
  },
  topics: {
    blocks: [
      {
        title: 'GoF Facade vs Laravel facades',
        table: [
          ['', 'GoF Facade', 'Laravel facade'],
          ['What it is', 'A class that runs many steps behind one method', 'A static shortcut to one object in the container'],
          ['Has logic?', 'Yes: which steps, in which order', 'No: it only forwards calls'],
          ['Example here', '`BookingConfirmation::confirm()`', '`Cache::get()`, `Queue::push()`'],
          ['Pattern name', 'Facade', 'Static proxy (lesson 11 covers Proxy)'],
        ],
      },
      {
        title: 'Real-time facades',
        text: ['Prefix any class’s namespace with `Facades\\` and Laravel generates a facade for it on the fly (cached in `storage/framework/cache`). Handy in views and tests; in business code, constructor injection keeps the dependency visible.'],
        path: 'Real-time facade',
        code: String.raw`use Facades\App\Payments\StripeGateway;

StripeGateway::refund($paymentIntentId, $amount, $key);      // resolves App\Payments\StripeGateway from the container

// in a test:
StripeGateway::shouldReceive('refund')->once();`,
      },
      {
        title: 'How Queue::fake(), Http::fake() and Event::fake() swap the real object',
        text: [
          'All three use `swap()` above. `Queue::fake()` swaps the queue manager for a `QueueFake`; `Event::fake()` swaps the dispatcher for an `EventFake` (and re-sets it on Eloquent models, so model events are faked too); `Http::fake()` keeps the same HTTP factory but registers stub responses, so every request returns a fake response instead of reaching the network.',
        ],
      },
    ],
  },
  whenNot: [
    'Don’t let a facade grow decisions of its own. It orders steps; each rule stays in its subsystem. If `confirm()` starts calculating prices, it is becoming a god class.',
    'Don’t build a facade over a single class. One step needs no front door.',
    'Don’t confuse the two: wrapping a class in a Laravel facade does not give you a GoF Facade, and the reverse.',
  ],
  tests: {
    summary: 'Every step runs once, after commit, and a repeated confirm is harmless',
    text: ['Fakes replace the queue and notifications through the container (the swap above), so the test checks that each step happened without sending anything.'],
    blocks: [
      {
        path: 'tests/Feature/BookingConfirmationTest.php',
        code: String.raw`<?php

use App\Bookings\BookingConfirmation;
use App\Channels\PushAvailability;
use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Notifications\BookingConfirmed;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    Queue::fake();
    Notification::fake();
});

it('runs every confirmation step', function () {
    $booking = Booking::factory()->pending()->create();

    app(BookingConfirmation::class)->confirm($booking);

    expect($booking->refresh()->status)->toBe(BookingStatus::Confirmed)
        ->and($booking->refresh()->expires_at)->toBeNull();
    $this->assertDatabaseHas('cleaning_tasks', ['booking_id' => $booking->id]);
    Queue::assertPushed(PushAvailability::class);
    Notification::assertSentTo($booking, BookingConfirmed::class);
});

it('does nothing the second time', function () {
    $booking = Booking::factory()->pending()->create();
    $confirmation = app(BookingConfirmation::class);

    $confirmation->confirm($booking);
    $confirmation->confirm($booking);                       // a duplicate webhook

    Queue::assertPushed(PushAvailability::class, 1);
    $this->assertDatabaseCount('cleaning_tasks', 1);
});

it('refuses to confirm a cancelled booking', function () {
    app(BookingConfirmation::class)->confirm(Booking::factory()->cancelled()->create());
})->throws(LogicException::class);`,
      },
    ],
  },
  next: 'Lesson 5: a quote has nights, fees, discounts, a deposit and a currency, and only some of them apply. Building it step by step is the Builder pattern, and so are Laravel’s query builder and model factories.',
};
