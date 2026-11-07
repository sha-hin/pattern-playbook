// Scene 36 · Transactional Outbox: the message to partners is saved in the same transaction as the booking.

export default {
  description: 'Six bookings were saved but never reached the agency’s own system: the partner message was queued after the commit, and Redis was failing over at that moment. Fix it in Laravel with a transactional outbox: the message is a row written in the same transaction as the booking, and a scheduled relay delivers it, at least once, signed, in order, with an id the partner uses to ignore repeats.',
  incident: {
    channel: '#partners',
    when: 'Thursday 15:30',
    messages: [
      ['Jonas · Hygge Homes (integration)', 'Booking **9134** (created 14:02) is in your app but never reached our system. Our cleaners and key handover weren’t scheduled. Are there others?'],
      ['Karim · developer', 'Redis failed over at **14:02:10**. For about 40 seconds every queue dispatch failed. Six bookings were committed in that window, and their partner messages were never queued.'],
      ['Mona · support', 'Two of those six guests also saw an error page, although their booking went through.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature',
      text: ['Agencies like Hygge Homes run their own systems for keys and staff, and asked to be told about every booking change. An account can now set a webhook URL; Nordic Stays posts every booking change to it, signed with the account’s secret.'],
      blocks: [
        {
          path: 'database/migrations/2026_04_23_000001_add_webhook_to_accounts_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            $table->string('webhook_url')->nullable();                  // the partner's system; null: nobody to tell
            $table->text('webhook_secret')->nullable();                 // encrypted: it signs every message
        });
    }
};`,
        },
        {
          path: 'app/Models/Account.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

class Account extends Model
{
    use HasFactory;

    protected $fillable = ['name'];

    protected $hidden = ['webhook_secret'];

    protected function casts(): array
    {
        return ['webhook_secret' => 'encrypted'];
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'memberships')
            ->using(Membership::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    public function properties(): HasMany
    {
        return $this->hasMany(Property::class);
    }

    public function channelConnections(): HasMany
    {
        return $this->hasMany(ChannelConnection::class);
    }

    /** Bookings of all this account's properties: bookings → properties.account_id */
    public function bookings(): HasManyThrough
    {
        return $this->hasManyThrough(Booking::class, Property::class);
    }

    public function messageTemplates(): HasMany
    {
        return $this->hasMany(MessageTemplate::class);
    }
}`,
        },
      ],
    },
    {
      title: 'The broken code',
      text: ['Every booking change already goes through `CalendarSync`, so that is where last week’s code tells the partner:'],
      blocks: [
        {
          path: 'app/Jobs/NotifyPartner.php',
          broken: true,
          code: String.raw`<?php

namespace App\Jobs;

use App\Models\Booking;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;

class NotifyPartner implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public Booking $booking)
    {
    }

    public function handle(): void
    {
        $account = $this->booking->property->account;
        $body = json_encode(['type' => 'booking.updated', 'booking' => ['id' => $this->booking->id, 'status' => $this->booking->status->value]], JSON_THROW_ON_ERROR);

        Http::timeout(5)
            ->withHeaders(['X-NordicStays-Signature' => hash_hmac('sha256', $body, $account->webhook_secret)])
            ->withBody($body, 'application/json')
            ->post($account->webhook_url)
            ->throw();
    }
}`,
        },
        {
          path: 'app/Channels/CalendarSync.php (bookingChanged, before)',
          broken: true,
          fragment: true,
          code: String.raw`public function bookingChanged(Booking $booking): void
{
    // … clashes, cleaning, channel push, screens …

    if ($booking->property->account->webhook_url !== null) {
        NotifyPartner::dispatch($booking)->afterCommit();       // the bug: pushed to Redis after the commit, as a second step
    }
}`,
          after: [
            '`afterCommit()` was the right instinct: never tell a partner about a booking that might still roll back. But it makes two steps that can’t succeed or fail together. **1.** MySQL commits the booking. **2.** Laravel pushes the job to Redis. If step 2 fails (Redis failing over, the network, a deploy killing the process between the two), the booking exists and the message doesn’t, and nothing will ever retry it: there is no job to retry.',
            'The exception from step 2 also reached the guest as an error page, for a booking that had in fact been made.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: the message is a row, saved with the booking',
      text: [
        'If the message is written to **MySQL**, in the **same transaction** as the booking change, there is only one step left: the commit. Both are saved, or neither is. Delivering it is a separate job that can fail and try again as often as it needs, because the row stays until it is delivered.',
        'That table is the **outbox**: messages waiting to go out.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_24_000001_create_outbox_messages_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outbox_messages', function (Blueprint $table) {
            $table->id();                                               // the delivery order
            $table->uuid('uuid')->unique();                             // the id the partner sees, and uses to ignore repeats
            $table->foreignId('account_id')->constrained();
            $table->string('type');                                     // booking.updated
            $table->unsignedSmallInteger('version');                    // the payload's shape: 1
            $table->json('payload');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->text('last_error')->nullable();
            $table->timestamp('published_at')->nullable();              // null: still to deliver
            $table->timestamps();

            $table->index(['published_at', 'id']);                     // "the oldest undelivered" without a full scan
        });
    }
};`,
        },
        {
          path: 'app/Models/OutboxMessage.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class OutboxMessage extends Model
{
    use MassPrunable;

    protected function casts(): array
    {
        return ['payload' => 'array', 'published_at' => 'datetime'];
    }

    /** Write a message for the account's partner, inside the caller's transaction. */
    public static function record(Account $account, string $type, int $version, array $payload): self
    {
        return self::forceCreate([
            'uuid' => (string) Str::uuid(),
            'account_id' => $account->id,
            'type' => $type,
            'version' => $version,
            'payload' => $payload,
        ]);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** Delivered messages older than a week: "php artisan model:prune" deletes them in batches. */
    public function prunable(): Builder
    {
        return static::query()->whereNotNull('published_at')->where('published_at', '<', now()->subWeek());
    }
}`,
        },
        {
          title: 'The coordinator records the message instead of queuing it',
          text: ['Every caller of `CalendarSync` already runs it inside its own transaction (`CreateBooking`, `BookingConfirmation`, `CancelBooking`, `ChangeBookingDates`, `MoveBooking`, `ImportChannelReservation`, `ExpireHolds`), so the row commits with the change, or rolls back with it.'],
          path: 'app/Channels/CalendarSync.php',
          code: String.raw`<?php

namespace App\Channels;

use App\Enums\BookingStatus;
use App\Enums\MembershipRole;
use App\Events\CalendarChanged;
use App\Jobs\PushAvailability;
use App\Models\Booking;
use App\Models\OutboxMessage;
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
        $this->tellPartner($booking);                                   // and the account's own system, through the outbox
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

    /** The booking as it is now, not what changed: a partner that missed one message still ends up right. */
    private function tellPartner(Booking $booking): void
    {
        $account = $booking->property->account;

        if ($account->webhook_url === null) {
            return;
        }

        OutboxMessage::record($account, 'booking.updated', version: 1, payload: [
            'id' => $booking->id,
            'property_id' => $booking->property_id,
            'status' => $booking->status->value,
            'check_in' => $booking->stay->checkIn->toDateString(),
            'check_out' => $booking->stay->checkOut->toDateString(),
            'guests' => $booking->guests,
            'guest_name' => $booking->guest_name,
        ]);
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
          after: ['The old job goes:'],
        },
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`rm app/Jobs/NotifyPartner.php`,
          after: ['The channel pushes and screen updates keep using `afterCommit()` dispatches. They can be lost the same way, but they heal themselves: the next change pushes the **whole** calendar (scene 17), and screens reload after a reconnect (scene 32). A partner’s message has no next time, so it goes through the outbox.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: a relay delivers what the outbox holds',
      text: [
        'Once a minute, the relay reads the oldest undelivered messages, posts each to its partner, and marks it delivered only after the partner answered 2xx. A message that fails stays undelivered and is tried again next minute.',
        'Two promises come with that, and the partner documentation states them: **at least once** (a crash between the partner’s 200 and our update sends it again, so partners ignore an `X-NordicStays-Event-Id` they have already handled), and **in order per account** (when one message to Hygge Homes fails, their later messages wait, so a cancellation never arrives before the booking it cancels).',
      ],
      blocks: [
        {
          path: 'app/Console/Commands/RelayOutbox.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Models\OutboxMessage;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Throwable;

class RelayOutbox extends Command
{
    protected $signature = 'outbox:relay';

    protected $description = 'Deliver undelivered outbox messages to partners, oldest first';

    public function handle(): int
    {
        $blocked = [];                                                  // accounts whose earlier message just failed

        OutboxMessage::query()
            ->whereNull('published_at')
            ->orderBy('id')
            ->with('account')
            ->limit(500)                                                // the rest next minute: a run never takes too long
            ->get()
            ->each(function (OutboxMessage $message) use (&$blocked): void {
                if (isset($blocked[$message->account_id])) {
                    return;                                             // keep this account's messages in order
                }

                try {
                    $this->deliver($message);
                    $message->forceFill(['published_at' => now(), 'last_error' => null])->save();
                } catch (Throwable $e) {
                    $blocked[$message->account_id] = true;
                    $message->forceFill(['attempts' => $message->attempts + 1, 'last_error' => mb_substr($e->getMessage(), 0, 1000)])->save();
                    report($e);                                         // visible in the error tracker, never silent
                }
            });

        return self::SUCCESS;
    }

    private function deliver(OutboxMessage $message): void
    {
        $account = $message->account;

        if ($account->webhook_url === null) {
            return;                                                     // the partner was removed since: nothing to send
        }

        $body = json_encode([
            'id' => $message->uuid,
            'type' => $message->type,
            'version' => $message->version,
            'created_at' => $message->created_at->toIso8601String(),
            'data' => $message->payload,
        ], JSON_THROW_ON_ERROR);

        Http::timeout(5)
            ->withHeaders([
                'X-NordicStays-Event-Id' => $message->uuid,
                'X-NordicStays-Signature' => hash_hmac('sha256', $body, $account->webhook_secret),   // scene 8, the other way round
            ])
            ->withBody($body, 'application/json')
            ->post($account->webhook_url)
            ->throw();                                                  // a 4xx or 5xx is a failure: try again next minute
    }
}`,
          after: ['`version` is the shape of `data`. When a field changes meaning, the next shape is `version: 2`, sent to partners who have said they read it, while the others keep getting version 1. Partners never have to guess what a message means.'],
        },
        {
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
Schedule::command('bookings:revert-unpaid-changes')->everyMinute()->withoutOverlapping();
Schedule::command('outbox:relay')->everyMinute()->withoutOverlapping()->onOneServer();   // one relay at a time keeps the order
Schedule::command('model:prune')->dailyAt('04:20');                                          // delivered outbox messages, after a week`,
        },
        {
          title: 'The six lost messages',
          text: ['The relay can only deliver what was written. For the six bookings from 14:02, a developer writes their messages once, from tinker, and the next relay run delivers them:'],
          path: 'terminal',
          lang: 'shell',
          code: String.raw`php artisan tinker
> App\Models\Booking::whereKey([9134, 9135, 9137, 9138, 9140, 9141])->with('property.account')->get()
    ->each(fn ($booking) => App\Models\OutboxMessage::record($booking->property->account, 'booking.updated', 1, [
        'id' => $booking->id, 'property_id' => $booking->property_id, 'status' => $booking->status->value,
        'check_in' => $booking->check_in->toDateString(), 'check_out' => $booking->check_out->toDateString(),
        'guests' => $booking->guests, 'guest_name' => $booking->guest_name,
    ]));`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Transactional Outbox'],
    rules: [['Transactional Outbox', 'Save a message for another system in the same database transaction as the change it describes, and let a separate relay deliver it. The change and its message can no longer be saved one without the other.']],
    points: [
      'The outbox turns "commit, then publish" (two systems, no shared transaction) into "commit" (one system), plus a delivery that can be retried for as long as it takes.',
      'It promises **at least once**, never exactly once. Exactly-once needs the receiver’s help: the event id in every message lets the partner skip what it has already handled. That receiver is an **idempotent consumer**: our own webhook inbox from scene 8 is one, for Stripe.',
      'The outbox and scene 8’s inbox are mirror images: the inbox stores what others send us before we act on it; the outbox stores what we must send before anyone acts on it.',
    ],
    whenNot: [
      'Messages that heal themselves, like a full calendar push the next change sends again anyway: `afterCommit()` is enough.',
      'When losing a message costs nothing, like a "someone is typing" signal.',
    ],
  },
  laravel: {
    title: 'With SQS or Kafka, the outbox stays',
    text: [
      'A bigger platform might publish booking events to Amazon SQS or Kafka instead of posting webhooks, and let many services read them. The relay then publishes to the broker instead of posting to a URL. Nothing else changes: the broker is a second system, and committing to MySQL and publishing to Kafka can still succeed one without the other. What changes is on the reading side: Kafka keeps messages for days and lets every consumer read at its own pace, and each consumer still has to ignore repeats by event id.',
      'Laravel’s `->afterCommit()` and `ShouldDispatchAfterCommit` only decide **when** a dispatch happens, never whether it survives: the queue push is still a separate step after the commit. That is the gap the outbox closes.',
    ],
    blocks: [],
  },
  tests: {
    summary: 'The message is saved with the booking, or not at all; delivered, retried, signed, and kept in order',
    blocks: [
      {
        path: 'tests/Feature/OutboxTest.php',
        code: String.raw`<?php

use App\Channels\CalendarSync;
use App\Models\Account;
use App\Models\Booking;
use App\Models\OutboxMessage;
use App\Models\Property;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    $this->account = Account::factory()->create();
    $this->account->forceFill(['webhook_url' => 'https://partner.test/hooks', 'webhook_secret' => 'partner-secret'])->save();
    $this->booking = Booking::factory()->for(Property::factory()->for($this->account))->forStay('2027-07-10', 3)->create();
});

it('saves the message in the same transaction as the change, or not at all', function () {
    try {
        DB::transaction(function (): void {
            app(CalendarSync::class)->bookingChanged($this->booking);
            throw new RuntimeException('the change fails');
        });
    } catch (RuntimeException) {
    }
    expect(OutboxMessage::count())->toBe(0);                                    // rolled back with the change

    DB::transaction(fn () => app(CalendarSync::class)->bookingChanged($this->booking));
    expect(OutboxMessage::sole()->payload['id'])->toBe($this->booking->id);    // committed with it: nothing can lose it now
});

it('marks a message delivered only after the partner accepted it', function () {
    app(CalendarSync::class)->bookingChanged($this->booking);
    Http::fake(['partner.test/*' => Http::sequence()->push('Unavailable', 503)->push('', 204)]);

    $this->artisan('outbox:relay')->assertSuccessful();
    expect(OutboxMessage::sole())->published_at->toBeNull()->attempts->toBe(1);   // kept for the next run

    $this->artisan('outbox:relay')->assertSuccessful();
    expect(OutboxMessage::sole()->published_at)->not->toBeNull();
});

it('signs the message and sends the id the partner uses to ignore repeats', function () {
    app(CalendarSync::class)->bookingChanged($this->booking);
    Http::fake(['partner.test/*' => Http::response('', 204)]);

    $this->artisan('outbox:relay');

    $message = OutboxMessage::sole();
    Http::assertSent(fn (Request $request): bool => $request->header('X-NordicStays-Event-Id')[0] === $message->uuid
        && $request->header('X-NordicStays-Signature')[0] === hash_hmac('sha256', $request->body(), 'partner-secret')
        && $request['version'] === 1);
});

it('holds an account’s later messages while an earlier one is failing', function () {
    app(CalendarSync::class)->bookingChanged($this->booking);
    $this->booking->forceFill(['status' => 'cancelled'])->save();
    app(CalendarSync::class)->bookingChanged($this->booking);
    Http::fake(['partner.test/*' => Http::response('Down', 500)]);

    $this->artisan('outbox:relay');

    Http::assertSentCount(1);                                                    // the cancellation waits for the booking
});`,
        after: ['The first test is the incident: whatever happens after the commit, the message is already in MySQL, so a Redis failover can no longer lose it.'],
      },
    ],
  },
  next: 'Partners hear about every booking now. Next, the mobile app’s Book button times out, the app tries again, and a guest is booked twice.',
};
