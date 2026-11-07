// Scene 31 · Live calendars with Reverb: broadcast after commit, from the one place every change goes through.

export default {
  description: 'A host watched her calendar while Airbnb sold a week of it, and her screen never changed: the live update was broadcast from our own booking code only, before the commit, with the whole booking in it. Fix it in Laravel with one queued broadcast from the calendar coordinator, sent after commit, carrying ids only, on a private channel scoped to the account.',
  incident: {
    channel: '#support',
    when: 'Wednesday 21:15',
    messages: [
      ['Ingrid · host, Skagen cottages', 'I had the calendar open for Cottage 2. Airbnb emailed me a booking for **2–9 August**. My calendar still showed those nights free until I reloaded the page. I almost sold them again by phone.'],
      ['Karim · developer', 'The live update fires when a booking is made on our site. Airbnb and Booking.com imports never send one.'],
      ['Sara · tech lead', 'Two more things while you’re in there. Our own bookings sometimes flash in and disappear until a reload. And the event carries the **whole booking**: I can read guest emails and phone numbers in the browser’s network tab.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature',
      text: [
        'The host’s calendar page updates live. Laravel’s broadcasting sends an event from the server to a WebSocket server, **Reverb**, and the browser, connected to Reverb through **Laravel Echo**, receives it. One command installs all of it:',
      ],
      blocks: [
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`php artisan install:broadcasting    # answer yes to installing Reverb and the Node packages
php artisan reverb:start            # the WebSocket server; in production it runs under Supervisor (scene 38)`,
          after: ['It creates `config/broadcasting.php`, `config/reverb.php`, `routes/channels.php` and `resources/js/echo.js`, installs `laravel/reverb` and `laravel-echo`, and adds the Reverb keys to `.env`:'],
        },
        {
          path: '.env',
          lang: 'env',
          code: String.raw`BROADCAST_CONNECTION=reverb

REVERB_APP_ID=nordic-stays
REVERB_APP_KEY=hn3k9w2x7q5m1p8r
REVERB_APP_SECRET=generated-by-install-broadcasting
REVERB_HOST=ws.nordicstays.com
REVERB_PORT=443
REVERB_SCHEME=https

VITE_REVERB_APP_KEY="${'$'}{REVERB_APP_KEY}"
VITE_REVERB_HOST="${'$'}{REVERB_HOST}"
VITE_REVERB_PORT="${'$'}{REVERB_PORT}"
VITE_REVERB_SCHEME="${'$'}{REVERB_SCHEME}"`,
          after: ['The key is public (the browser needs it); the secret never leaves the server: it signs every channel authorization.'],
        },
        {
          title: 'Who may listen',
          text: [
            'A **private** channel needs permission: before the browser may subscribe to `account.7`, Echo asks our app at `/api/broadcasting/auth`, and the callback below decides. Without it, anyone who guesses an account id could watch that host’s calendar: the IDOR of WebSockets. Owners and co-hosts see the calendar; cleaners see their tasks, not bookings (scene 20).',
          ],
          path: 'routes/channels.php',
          code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('account.{accountId}', function (User $user, int $accountId): bool {
    return in_array($user->roleIn($accountId), [MembershipRole::Owner, MembershipRole::CoHost], true);
});`,
        },
        {
          title: 'Authorization under /api, with the host’s Sanctum token',
          path: 'bootstrap/app.php',
          code: String.raw`<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        api: __DIR__ . '/../routes/api.php',
        commands: __DIR__ . '/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(
        __DIR__ . '/../routes/channels.php',
        ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum']],      // POST /api/broadcasting/auth
    )
    ->withMiddleware(function (Middleware $middleware): void {
        //
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();`,
          after: ['This is Laravel’s file as `install:api` (Foundation) and `install:broadcasting` leave it, with the broadcasting routes moved under `/api` so the host app’s token works for them.'],
        },
        {
          title: 'The calendar page listens',
          path: 'resources/js/calendar.js',
          lang: 'js',
          code: String.raw`import './echo';                                      // creates window.Echo, connected to Reverb

const accountId = document.querySelector('meta[name="account-id"]').content;

window.Echo.private(` + '`account.${accountId}`' + String.raw`)
    .listen('.booking.created', (event) => {
        window.calendar.show(event.booking);              // draw the booking straight from the event
    });`,
        },
      ],
    },
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Events/BookingCreated.php',
          broken: true,
          code: String.raw`<?php

namespace App\Events;

use App\Models\Booking;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class BookingCreated implements ShouldBroadcastNow                 // bug 2: sent at once, inside the transaction
{
    use Dispatchable;

    public function __construct(public Booking $booking)           // bug 3: every public property is the payload
    {
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [new PrivateChannel("account.{$this->booking->property->account_id}")];
    }

    public function broadcastAs(): string
    {
        return 'booking.created';
    }
}`,
        },
        {
          path: 'app/Bookings/CreateBooking.php',
          broken: true,
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Events\BookingCreated;
use App\Models\Booking;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    public function __construct(private PriceQuoter $quoter)
    {
    }

    /** @param array{guest_name: string, guest_email: string, guest_phone: ?string, guest_channel: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if (! Property::whereKey($property->id)->availableFor($stay)->exists()) {   // the one availability rule
                throw BookingConflict::for($stay);
            }

            $quote = $this->quoter->quote($property, $stay);              // the same price the page showed

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $quote->total();
            $booking->cancellation_policy = $property->cancellation_policy;   // the terms the guest agreed to, frozen
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type,
                'description' => $line->description,
                'amount' => $line->amount,
            ], $quote->lines));                                           // every line of the bill, kept

            BookingCreated::dispatch($booking);                           // bug 1: only bookings made through this class

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
          after: [
            '**Bug 1, the incident.** The event is sent from `CreateBooking`, so only bookings made on Nordic Stays are announced. Airbnb and Booking.com imports (scene 15), cancellations, expired holds, date changes and moves change the calendar silently.',
            '**Bug 2, the flash.** `ShouldBroadcastNow` sends during the transaction. If the transaction then rolls back (a deadlock, retried by `attempts: 3`), the screen has drawn a booking that doesn’t exist. Reloading shows the truth.',
            '**Bug 3, the leak.** With no `broadcastWith()`, Laravel sends every public property: the whole `Booking`, serialized with `toArray()`, guest email and phone included. Anyone with the account open in a browser can read them in the developer tools.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: an event that says what changed, not what it is',
      text: [
        'The screen needs one fact: **this property’s calendar changed**. It then reloads that property from the API, which applies every policy as usual (scene 19). So the payload is two ids, and nothing a guest typed.',
        '`ShouldBroadcast` puts the broadcast on the queue instead of sending it in the request. `ShouldDispatchAfterCommit` holds the event until the open transaction commits, and drops it if the transaction rolls back.',
      ],
      blocks: [
        {
          path: 'app/Events/CalendarChanged.php',
          code: String.raw`<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

final class CalendarChanged implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly int $accountId,
        public readonly int $propertyId,
    ) {
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [new PrivateChannel("account.{$this->accountId}")];      // only this account's owners and co-hosts
    }

    public function broadcastAs(): string
    {
        return 'calendar.changed';
    }

    /** @return array{property_id: int} exactly what the screen needs, and nothing more */
    public function broadcastWith(): array
    {
        return ['property_id' => $this->propertyId];
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: sent from the one place every change goes through',
      text: [
        'Every change to a calendar already reaches `CalendarSync`: our bookings, channel imports, cancellations, expired holds, date changes, moves and iCal syncs. The broadcast goes there, next to the channel push. The minimum-stay change sends none: it doesn’t change what the calendar shows.',
      ],
      blocks: [
        {
          path: 'app/Channels/CalendarSync.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\BookingStatus;
use App\Enums\MembershipRole;
use App\Events\CalendarChanged;
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

    /** A booking was created, confirmed, imported, cancelled, expired, moved to other dates or to this property. */
    public function bookingChanged(Booking $booking): void
    {
        if (in_array($booking->status, BookingStatus::blocking(), true)) {
            $this->recordClashes($booking);
        }

        $this->turnover->forBooking($booking);                          // the cleaning follows the booking

        PushAvailability::forProperty($booking->property);           // every channel learns the new state (scene 17)
        $this->tellScreens($booking->property);                         // and every open calendar
    }

    /** A booking moved away from this property: its nights are free here now. */
    public function bookingLeft(Property $property): void
    {
        PushAvailability::forProperty($property);
        $this->tellScreens($property);
    }

    /** An iCal sync changed the blocks of a property (scene 12). */
    public function blocksChanged(Property $property): void
    {
        PushAvailability::forProperty($property);
        $this->tellScreens($property);
    }

    /** The host changed a rule the channels enforce for us, like the minimum stay. */
    public function stayRulesChanged(Property $property): void
    {
        PushAvailability::forProperty($property);
    }

    private function tellScreens(Property $property): void
    {
        CalendarChanged::dispatch($property->account_id, $property->id);   // queued, and only after the commit
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
          title: 'CreateBooking stops broadcasting on its own',
          text: ['A new booking doesn’t call `CalendarSync` yet: it is a hold, and the calendar coordinator runs when it is confirmed. But a hold blocks the nights (scene 30), so the screen must hear about it. `CreateBooking` asks the coordinator, like every other change does:'],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Channels\CalendarSync;
use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    public function __construct(
        private PriceQuoter $quoter,
        private CalendarSync $calendar,
    ) {
    }

    /** @param array{guest_name: string, guest_email: string, guest_phone: ?string, guest_channel: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if (! Property::whereKey($property->id)->availableFor($stay)->exists()) {   // the one availability rule
                throw BookingConflict::for($stay);
            }

            $quote = $this->quoter->quote($property, $stay);              // the same price the page showed

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $quote->total();
            $booking->cancellation_policy = $property->cancellation_policy;   // the terms the guest agreed to, frozen
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type,
                'description' => $line->description,
                'amount' => $line->amount,
            ], $quote->lines));                                           // every line of the bill, kept

            $this->calendar->bookingChanged($booking);                    // the hold closes the nights everywhere, screens included

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
          after: [
            'A side effect, and the right one: since scene 17 a hold never reached the channels until it was paid, so Airbnb could sell the nights during those 30 minutes. Now a hold closes them on every channel too, and an expired hold (scene 9, through `CalendarSync`) opens them again.',
            'The old event goes:',
          ],
        },
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`rm app/Events/BookingCreated.php`,
        },
      ],
    },
    {
      title: 'The fix, part 3: the socket is a hint, the API is the truth',
      text: [
        'A WebSocket message can be missed: a laptop sleeps, the Wi-Fi drops, Reverb restarts during a deploy. So the page never draws from the event. On `calendar.changed` it reloads that property’s calendar from the API, and after every reconnect it reloads everything it shows, because it can’t know what it missed while it was away.',
      ],
      blocks: [
        {
          path: 'resources/js/calendar.js',
          lang: 'js',
          code: String.raw`import './echo';                                      // creates window.Echo, connected to Reverb

const accountId = document.querySelector('meta[name="account-id"]').content;

window.Echo.private(` + '`account.${accountId}`' + String.raw`)
    .listen('.calendar.changed', (event) => {
        window.calendar.reload(event.property_id);        // fetch the truth from the API; the event only says "look again"
    });

// After a dropped connection, events sent while we were away are gone: reload what is on screen.
window.Echo.connector.pusher.connection.bind('connected', () => {
    window.calendar.reloadAll();
});`,
          after: ['`window.calendar` is the calendar page’s own code: `reload(id)` fetches one property’s nights from the API and redraws them, `reloadAll()` does it for every property on screen. The leading dot in `.calendar.changed` tells Echo to use the name from `broadcastAs()` as it is.'],
        },
        {
          title: 'Running it',
          text: ['Broadcasts are queued now, so they are sent by the queue workers (Horizon, scene 17) to Reverb. Reverb keeps one connection per open browser tab: scene 38 runs it under Supervisor and raises the open-file limit, since each connection is a file descriptor.'],
          path: 'phpunit.xml',
          lang: 'xml',
          code: String.raw`<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
>
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>
    <source>
        <include>
            <directory>app</directory>
        </include>
    </source>
    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_DATABASE" value="pms_test"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="MAIL_MAILER" value="array"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
        <env name="BROADCAST_CONNECTION" value="null"/>
    </php>
</phpunit>`,
          after: ['In tests, broadcasts go to the `null` broadcaster: with the `sync` queue, every test that changes a calendar would otherwise try to reach a Reverb server. The channel authorization test below switches to Reverb for itself.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'The incident, the exact channel and payload, after-commit, and who may subscribe',
    blocks: [
      {
        path: 'tests/Feature/CalendarBroadcastTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Channels\ChannelReservation;
use App\Channels\ImportChannelReservation;
use App\Enums\BookingStatus;
use App\Enums\Channel;
use App\Enums\MembershipRole;
use App\Events\CalendarChanged;
use App\Models\ChannelListing;
use App\Models\Property;
use App\Money\Money;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->cottage = Property::factory()->create(['name' => 'Cottage 2']);
});

it('tells the host’s screen when Airbnb books', function () {
    Event::fake([CalendarChanged::class]);
    Queue::fake();                                                              // no channel pushes in this test
    ChannelListing::forceCreate(['property_id' => $this->cottage->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);

    app(ImportChannelReservation::class)->handle(new ChannelReservation(
        Channel::Airbnb, 'HMXK2W9', '41793625', BookingStatus::Confirmed, Stay::fromDates('2027-08-02', '2027-08-09'),
        'Lena Berg', 'lena@guest.airbnb.com', 2, Money::of(126_000, 'EUR'), version: 1,
    ));

    Event::assertDispatched(CalendarChanged::class, fn (CalendarChanged $event): bool => $event->propertyId === $this->cottage->id);
});

it('broadcasts on the account’s private channel, with the property id and nothing else', function () {
    $event = new CalendarChanged($this->cottage->account_id, $this->cottage->id);

    expect($event->broadcastOn())->toEqual([new PrivateChannel("account.{$this->cottage->account_id}")])
        ->and($event->broadcastAs())->toBe('calendar.changed')
        ->and($event->broadcastWith())->toBe(['property_id' => $this->cottage->id]);   // no guest data can leak
});

it('is held until the transaction commits', function () {
    expect(new CalendarChanged(1, 2))->toBeInstanceOf(ShouldDispatchAfterCommit::class);
});

it('lets only the account’s owners and co-hosts subscribe', function (MembershipRole|null $role, int $status) {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'test-key',
        'broadcasting.connections.reverb.secret' => 'test-secret',
        'broadcasting.connections.reverb.app_id' => 'test',
    ]);
    require base_path('routes/channels.php');                                   // register the channel on the Reverb broadcaster

    $user = $role === null ? memberOf(Property::factory()->create()->account) : hostOf($this->cottage, $role);

    $this->actingAs($user)
        ->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-account.{$this->cottage->account_id}"])
        ->assertStatus($status);
})->with([
    'owner' => [MembershipRole::Owner, 200],
    'co-host' => [MembershipRole::CoHost, 200],
    'cleaner' => [MembershipRole::Cleaner, 403],
    'another account’s owner' => [null, 403],
]);`,
        after: ['`Event::fake([CalendarChanged::class])` fakes only that event: every other event and listener still runs, so the import does everything it does in production.'],
      },
    ],
  },
  next: 'Day 5 is done: cleanings that follow the calendar, rate plans, copies with their own prices, minimum stays every door knows, one availability rule and live calendars. Day 6 starts with a property page that takes four seconds to load.',
};
