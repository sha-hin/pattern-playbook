// Scene 21 · Scheduled guest messages: send times from the property's timezone. No new pattern.

export default {
  description: 'A guest in New Zealand got her arrival instructions at 3 a.m. because "the day before check-in at 15:00" was calculated in UTC. Build automatic guest messages in Laravel: templates with a trigger and an offset, send_at calculated in the property’s timezone and stored in UTC, tested across daylight-saving changes, and a scheduler that finds due messages every minute.',
  incident: {
    channel: '#support',
    when: 'Wednesday 07:10',
    messages: [
      ['Guest email, Queenstown chalet', 'Your “see you tomorrow” message with the key box code woke me up at **3:04 in the morning**. Is that really necessary?'],
      ['Mona · support', 'The template says “1 day before check-in, at 15:00”. Our first host outside Europe, first complaint.'],
    ],
  },
  sections: [
    {
      title: 'What hosts asked for',
      text: [
        'Hosts send the same messages to every guest: a thank-you when the booking is confirmed, arrival instructions the day before, a goodbye after check-out. Automatic messages are the feature hosts pay a PMS for. Each **template** has a trigger, a number of days before or after it, and a local time to send.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_07_000001_create_messaging_tables.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('trigger');                                // booking_confirmed, before_check_in, after_check_out
            $table->smallInteger('days_offset')->default(0);          // -1 = the day before
            $table->time('send_time')->nullable();                    // local time at the property; null = right away
            $table->string('subject');
            $table->text('body');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('scheduled_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained()->cascadeOnDelete();
            $table->foreignId('message_template_id')->constrained()->cascadeOnDelete();
            $table->timestamp('send_at');                             // UTC, like every timestamp
            $table->string('status')->default('pending');             // pending, sent, cancelled
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->unique(['booking_id', 'message_template_id']);    // one of each template per booking (scene 22)
            $table->index(['status', 'send_at']);                     // "what is due?" every minute
        });
    }
};`,
        },
        {
          path: 'app/Enums/MessageTrigger.php · ScheduledMessageStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum MessageTrigger: string
{
    case BookingConfirmed = 'booking_confirmed';
    case BeforeCheckIn = 'before_check_in';
    case AfterCheckOut = 'after_check_out';
}`,
        },
        {
          path: 'app/Enums/ScheduledMessageStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum ScheduledMessageStatus: string
{
    case Pending = 'pending';
    case Sent = 'sent';
    case Cancelled = 'cancelled';
}`,
          after: ['`MessageTemplate` casts `trigger` and `active`; `ScheduledMessage` casts `status`, `send_at` and `sent_at`, and has a `due()` scope: pending and `send_at <= now()`. Both belong to the models you’d expect (`Account::messageTemplates()`, `Booking::scheduledMessages()`).'],
        },
      ],
    },
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Messaging/ScheduleGuestMessages.php (before)',
          broken: true, fragment: true,
          code: String.raw`$sendAt = $booking->check_in->subDay()->setTimeFromTimeString($template->send_time);   // 15:00... in UTC`,
          after: [
            '`check_in` is a date at midnight UTC (scene 2), so this builds **15:00 UTC**. In Copenhagen that’s 17:00 in summer, close enough that nobody noticed. In Queenstown, New Zealand, UTC+12 in July, it is **03:00**.',
            'A local time only means something together with a place. "15:00" for this property means 15:00 on the clock in Queenstown, whatever that is in UTC on that particular date, daylight saving included.',
          ],
        },
      ],
    },
    {
      title: 'The fix: build the moment in the property’s timezone',
      text: [
        'The rule is the same as scene 2’s `checkInAt()`: take the **date**, add the **local time**, interpret both in the **property’s timezone**, and convert the result to UTC for storage. The database never stores local times; the property’s timezone is applied once, here.',
      ],
      blocks: [
        {
          path: 'app/Messaging/SendTime.php',
          code: String.raw`<?php

namespace App\Messaging;

use App\Enums\MessageTrigger;
use App\Models\Booking;
use App\Models\MessageTemplate;
use Carbon\CarbonImmutable;

final class SendTime
{
    public function for(MessageTemplate $template, Booking $booking): CarbonImmutable
    {
        if ($template->trigger === MessageTrigger::BookingConfirmed || $template->send_time === null) {
            return now();
        }

        $anchor = $template->trigger === MessageTrigger::BeforeCheckIn ? $booking->stay->checkIn : $booking->stay->checkOut;
        $date = $anchor->addDays($template->days_offset)->toDateString();          // a calendar date: no timezone yet

        return CarbonImmutable::parse("{$date} {$template->send_time}", $booking->property->timezone)   // 15:00 in Queenstown
            ->utc();                                                                                    // stored as 03:00 UTC
    }
}`,
          after: ['One edge: on the night clocks jump forward, a local time like 02:30 doesn’t exist. Carbon moves it forward by the gap (to 03:30), which is what a guest would expect. That’s also why templates should send at daytime hours.'],
        },
        {
          title: 'Scheduling when a booking is confirmed',
          text: ['One row per active template. `insertOrIgnore()` and the unique index mean that confirming twice (scene 9) can’t schedule anything twice.'],
          path: 'app/Messaging/ScheduleGuestMessages.php',
          code: String.raw`<?php

namespace App\Messaging;

use App\Models\Booking;
use App\Models\MessageTemplate;
use Illuminate\Support\Facades\DB;

final readonly class ScheduleGuestMessages
{
    public function __construct(private SendTime $sendTime)
    {
    }

    public function handle(Booking $booking): void
    {
        $templates = MessageTemplate::query()
            ->where('account_id', $booking->property->account_id)
            ->where('active', true)
            ->get();

        DB::table('scheduled_messages')->insertOrIgnore($templates->map(fn (MessageTemplate $template): array => [
            'booking_id' => $booking->id,
            'message_template_id' => $template->id,
            'send_at' => $this->sendTime->for($template, $booking),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ])->all());
    }
}`,
          after: ['Called from the confirmation facade (scene 6), right after the state change, inside its transaction.'],
        },
      ],
    },
    {
      title: 'Sending: a scheduler that looks every minute',
      text: [
        'Every minute, one command finds the messages that are due and queues one job each. `chunkById()` reads them 500 at a time, so a backlog after an outage doesn’t load ten thousand models at once.',
      ],
      blocks: [
        {
          path: 'app/Console/Commands/SendDueMessages.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Jobs\SendScheduledMessage;
use App\Models\ScheduledMessage;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Collection;

class SendDueMessages extends Command
{
    protected $signature = 'messages:send-due';

    protected $description = 'Queue every scheduled guest message whose time has come';

    public function handle(): int
    {
        ScheduledMessage::query()->due()->chunkById(500, function (Collection $messages): void {
            $messages->each(fn (ScheduledMessage $message) => SendScheduledMessage::dispatch($message));
        });

        return self::SUCCESS;
    }
}`,
        },
        {
          path: 'routes/console.php (added)',
          fragment: true,
          code: String.raw`Schedule::command('messages:send-due')->everyMinute()->withoutOverlapping()->onOneServer();`,
        },
        {
          path: 'app/Jobs/SendScheduledMessage.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Enums\ScheduledMessageStatus;
use App\Models\ScheduledMessage;
use App\Notifications\GuestMessage;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Notification;

class SendScheduledMessage implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public ScheduledMessage $message)
    {
    }

    public function handle(): void
    {
        $booking = $this->message->booking;

        Notification::route('mail', $booking->guest_email)->notifyNow(new GuestMessage($this->message));

        $this->message->forceFill(['status' => ScheduledMessageStatus::Sent, 'sent_at' => now()])->save();
    }
}`,
          after: ['`GuestMessage` is a mail notification built from the template’s subject and body. Scene 24 fills in its `{guest_name}` placeholders; scene 25 lets it go by SMS and WhatsApp too.'],
        },
      ],
    },
    {
      title: 'Why a table and a scheduler, not delayed jobs',
      text: [
        'Laravel can dispatch a job with `->delay($sendAt)`, so why not queue every message at confirmation time? Because messages change after they’re planned. A cancellation must cancel them, new dates must move them (scene 23), and a host editing a template expects future messages to follow. A delayed job can’t be found and changed once it’s in the queue; a row in a table can, with one `UPDATE`. The table is also what support looks at when a guest asks "did you send it?".',
      ],
      blocks: [],
    },
  ],
  laravel: {
    title: 'Laravel inside: chunkById()',
    text: ['Like scene 11’s `lazyById()`, but it hands your closure one batch at a time instead of one row. Paging by id (`WHERE id > ?`) instead of by offset matters here: the job may update rows while the loop runs, and an offset would skip some.'],
    blocks: [
      {
        path: 'Illuminate/Database/Concerns/BuildsQueries.php (simplified)',
        fragment: true,
        code: String.raw`public function chunkById($count, callable $callback, $column = null, $alias = null)
{
    $lastId = null;

    do {
        $clone = clone $this;
        $results = $clone->forPageAfterId($count, $lastId, $column)->get();     // WHERE id > $lastId ORDER BY id LIMIT 500
        $countResults = $results->count();

        if ($countResults === 0) {
            break;
        }

        if ($callback($results) === false) {                                    // return false to stop early
            return false;
        }

        $lastId = $results->last()->{$alias ?? 'id'};
    } while ($countResults === $count);

    return true;
}`,
      },
    ],
  },
  tests: {
    summary: 'Send times in two timezones across daylight saving, and only due messages queued',
    blocks: [
      {
        path: 'tests/Feature/SendTimeTest.php',
        code: String.raw`<?php

use App\Enums\MessageTrigger;
use App\Messaging\SendTime;
use App\Models\Booking;
use App\Models\MessageTemplate;
use App\Models\Property;

it('sends "the day before at 15:00" at 15:00 on the property’s clock', function (string $timezone, string $checkIn, string $utc) {
    $property = Property::factory()->create(['timezone' => $timezone]);
    $booking = Booking::factory()->for($property)->forStay($checkIn, 3)->create();
    $template = MessageTemplate::forceCreate([
        'account_id' => $property->account_id, 'name' => 'Arrival', 'trigger' => MessageTrigger::BeforeCheckIn,
        'days_offset' => -1, 'send_time' => '15:00', 'subject' => 'Tomorrow', 'body' => 'See you tomorrow',
    ]);

    expect(app(SendTime::class)->for($template, $booking)->toDateTimeString())->toBe($utc);
})->with([
    'Copenhagen, winter (UTC+1)' => ['Europe/Copenhagen', '2027-03-28', '2027-03-27 14:00:00'],
    'Copenhagen, summer (UTC+2)' => ['Europe/Copenhagen', '2027-03-29', '2027-03-28 13:00:00'],   // clocks moved that night
    'Queenstown, winter (UTC+12)' => ['Pacific/Auckland', '2027-07-10', '2027-07-09 03:00:00'],  // the incident
    'Queenstown, summer (UTC+13)' => ['Pacific/Auckland', '2027-09-28', '2027-09-27 02:00:00'],
]);`,
      },
      {
        path: 'tests/Feature/SendDueMessagesTest.php',
        code: String.raw`<?php

use App\Jobs\SendScheduledMessage;
use App\Models\Booking;
use App\Models\MessageTemplate;
use App\Models\ScheduledMessage;
use Illuminate\Support\Facades\Queue;

it('queues the due messages and nothing else', function () {
    Queue::fake();
    $booking = Booking::factory()->create();
    $template = MessageTemplate::forceCreate(['account_id' => $booking->property->account_id, 'name' => 'Hi', 'trigger' => 'booking_confirmed', 'subject' => 'Hi', 'body' => 'Hi']);
    $due = ScheduledMessage::forceCreate(['booking_id' => $booking->id, 'message_template_id' => $template->id, 'send_at' => now()->subMinute()]);
    $later = MessageTemplate::forceCreate(['account_id' => $booking->property->account_id, 'name' => 'Bye', 'trigger' => 'after_check_out', 'subject' => 'Bye', 'body' => 'Bye']);
    ScheduledMessage::forceCreate(['booking_id' => $booking->id, 'message_template_id' => $later->id, 'send_at' => now()->addDay()]);

    $this->artisan('messages:send-due')->assertSuccessful();

    Queue::assertPushedTimes(SendScheduledMessage::class, 1);
    Queue::assertPushed(SendScheduledMessage::class, fn (SendScheduledMessage $job): bool => $job->message->is($due));
});`,
      },
    ],
  },
  next: 'Messages leave at the right local time. Thursday, a guest gets her door code twice, four seconds apart.',
};
