// Scene 25 · Bridge: what a message says, separate from how it is delivered.

const rows = [18, 67, 116];
const messages = ['Arrival', 'Cancelled', 'Thank you'];
const channels = ['Mail', 'SMS', 'WhatsApp'];

export default {
  description: 'Guests who chose SMS or WhatsApp still got every message by email, because the booking form saved their choice and every message ignored it. Fix it with Laravel Notifications, which are a Bridge: messages on one side, delivery channels on the other. Mail is built in; SMS and WhatsApp are one small channel class each.',
  incident: {
    channel: '#support',
    when: 'Tuesday 18:30',
    messages: [
      ['Mona · support', 'Since last week the booking form asks guests **“Email, SMS or WhatsApp?”**. A guest at the Nyhavn flat chose **SMS**, because she doesn’t read email while travelling. Her arrival instructions came **by email**. She waited outside for an hour.'],
      ['Mona · support', 'The guests who chose WhatsApp got emails too.'],
      ['Karim · developer', 'The form saves the choice. Nothing reads it.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['The question was added to the booking form. The messages were written when email was the only option, and nobody changed them:'],
      blocks: [
        {
          path: 'app/Http/Requests/StoreBookingRequest.php · app/Notifications/GuestMessage.php (before)',
          broken: true, fragment: true,
          code: String.raw`// the booking form, last week: the choice is validated and saved
'contact_channel' => ['required', Rule::in(['email', 'sms', 'whatsapp'])],
$booking->guest_channel = $request->validated('contact_channel');           // 'sms'

// the message, from scene 21: written when email was the only way
public function via(object $notifiable): array
{
    return ['mail'];                                                         // the guest's choice is never read
}`,
          after: ['That is the whole bug: the choice is stored, and every message sends email anyway.'],
        },
      ],
    },
    {
      title: 'The fix',
      text: ['One line: `via()` stops hard-coding email and returns the channel the guest chose.'],
      blocks: [
        {
          path: 'app/Notifications/GuestMessage.php (via, before → after)',
          fragment: true,
          code: String.raw`// before: every guest gets email
return ['mail'];

// after: the guest's choice decides
return [$this->message->booking->guest_channel->notificationChannel()];`,
          after: [
            'For that line to work, three things must exist: the choice stored as an enum that knows Laravel’s name for each channel (part 1), the message written for every channel (part 2), and an SMS and a WhatsApp channel to deliver it (parts 4 and 5). First, the shortcut most teams try.',
          ],
        },
      ],
    },
    {
      title: 'The tempting fix, and why it’s wrong',
      text: ['The quick patch reads the choice inside the message, and sends from there:'],
      blocks: [
        {
          path: 'app/Notifications/GuestMessage.php (the quick patch, not used)',
          broken: true, fragment: true,
          code: String.raw`if ($booking->guest_channel === 'sms') {
    Http::withToken($smsToken)->post($smsUrl, ['to' => $booking->guest_phone, 'text' => $text]);   // sending code inside a message
} elseif ($booking->guest_channel === 'whatsapp') {
    Http::withToken($waToken)->post($waUrl, [/* another format */]);
} else {
    Mail::to($booking->guest_email)->send(new GuestMail($booking));
}`,
          after: [
            'It works for this one message. But the cancellation notice (scene 22) and the overbooking alert (scene 18) need the same three branches, so the sending code is copied into every message: **3 messages × 3 channels = 9 places** that send. A fourth channel means editing every message again, and a fix to how SMS is sent has to be made three times.',
            'Two things are mixed that change for different reasons: **what** a message says, and **how** it is delivered.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: the guest’s choice, with an address',
      blocks: [
        {
          path: 'database/migrations/2026_04_14_000001_add_contact_channel_to_bookings_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('guest_phone')->nullable();                 // E.164, e.g. +4512345678
            $table->string('guest_channel')->default('mail');          // mail, sms, whatsapp
        });
    }
};`,
        },
        {
          title: 'Our words in the database, Laravel’s names in the code',
          text: [
            'The database stores **our** words (`sms`), never class names: a class can be renamed or moved, a stored value can’t follow it. The enum translates our word into the name Laravel uses for that channel: `mail` is built in, and a custom channel is named by its class.',
          ],
          path: 'app/Enums/GuestChannel.php',
          code: String.raw`<?php

namespace App\Enums;

use App\Notifications\Channels\SmsChannel;
use App\Notifications\Channels\WhatsAppChannel;

enum GuestChannel: string
{
    case Mail = 'mail';
    case Sms = 'sms';
    case WhatsApp = 'whatsapp';

    public function notificationChannel(): string
    {
        return match ($this) {
            self::Mail => 'mail',                                       // Laravel's own mail channel
            self::Sms => SmsChannel::class,                             // ours, part 4
            self::WhatsApp => WhatsAppChannel::class,                   // ours, part 5
        };
    }
}`,
          after: ['`Booking` casts `guest_channel` to it; the booking form saves the guest’s choice and phone number.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: a message says what, never how',
      text: [
        'A notification answers two questions: **which channel** this recipient wants (`via()`), and **what the message looks like** on each channel (`toMail()`, `toSms()`, `toWhatsApp()`). It never sends anything.',
      ],
      blocks: [
        {
          path: 'app/Notifications/GuestMessage.php (after)',
          code: String.raw`<?php

namespace App\Notifications;

use App\Messaging\TemplateRenderer;
use App\Models\ScheduledMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class GuestMessage extends Notification
{
    use Queueable;

    public function __construct(public ScheduledMessage $message)
    {
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        return [$this->message->booking->guest_channel->notificationChannel()];   // the fix for the incident
    }

    public function toMail(object $notifiable): MailMessage
    {
        $renderer = app(TemplateRenderer::class);
        $booking = $this->message->booking;

        return (new MailMessage())
            ->subject($renderer->text($this->message->template->subject, $booking, now()))
            ->view('mail.guest', ['html' => $renderer->html($this->message->template->body, $booking, now())]);
    }

    public function toSms(object $notifiable): string
    {
        return $this->plainText();
    }

    public function toWhatsApp(object $notifiable): string
    {
        return $this->plainText();
    }

    private function plainText(): string
    {
        return app(TemplateRenderer::class)->text($this->message->template->body, $this->message->booking, now());   // scene 24
    }
}`,
        },
      ],
    },
    {
      title: 'Where the two sides meet',
      text: [
        'For each channel `via()` returns, Laravel asks its notification channel manager (a Manager, like scene 13’s) for that channel, and calls its `send()` with the recipient and the message. `mail` is a built-in driver; a class name is built from the container. **This one line is the bridge**: on its left, any message; on its right, any channel.',
      ],
      blocks: [
        {
          path: 'Illuminate/Notifications/NotificationSender.php · ChannelManager.php (simplified)',
          fragment: true,
          code: String.raw`// NotificationSender
protected function sendToNotifiable($notifiable, $id, $notification, $channel)
{
    $response = $this->manager->driver($channel)->send($notifiable, $notification);   // the bridge

    $this->events->dispatch(new NotificationSent($notifiable, $notification, $channel, $response));
}

// ChannelManager
protected function createDriver($driver)
{
    try {
        return parent::createDriver($driver);              // mail, database, broadcast…
    } catch (InvalidArgumentException $e) {
        if (class_exists($driver)) {
            return $this->container->make($driver);         // SmsChannel::class, WhatsAppChannel::class
        }

        throw $e;
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: the recipient carries every address',
      text: [
        'A guest isn’t a user, so the send job (scene 22) builds the recipient on the spot. It gives it an address for **every** channel, because the recipient knows *where* each channel can reach it, and the message decides *which* channel is used. Each channel then asks the recipient for its own address.',
      ],
      blocks: [
        {
          path: 'app/Jobs/SendScheduledMessage.php (the send line, after)',
          fragment: true,
          code: String.raw`$booking = $this->message->booking;

Notification::route('mail', $booking->guest_email)
    ->route(SmsChannel::class, $booking->guest_phone)
    ->route(WhatsAppChannel::class, $booking->guest_phone)
    ->notifyNow(new GuestMessage($this->message));`,
        },
      ],
    },
    {
      title: 'The fix, part 4: an SMS channel',
      text: [
        'A channel is any class with a `send($notifiable, $notification)` method. This one asks the message for its SMS text, asks the recipient for its number, and posts both to the SMS provider. Every SMS provider has an HTTP API of this shape: a token, a sender, a number and a text. Only the field names differ, so switching providers changes this one class.',
      ],
      blocks: [
        {
          path: 'app/Notifications/Channels/SmsChannel.php',
          code: String.raw`<?php

namespace App\Notifications\Channels;

use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Http;
use LogicException;

class SmsChannel
{
    public function send(object $notifiable, Notification $notification): void
    {
        $to = $notifiable->routeNotificationFor(self::class, $notification)
            ?? throw new LogicException('No phone number for this recipient.');   // loud: the guest asked for SMS

        Http::withToken(config('services.sms.token'))
            ->timeout(10)
            ->post(config('services.sms.url'), [
                'from' => config('services.sms.from'),                          // the sender name guests see
                'to' => $to,
                'text' => $notification->toSms($notifiable),
            ])
            ->throw();                                                         // a failed send fails the job, which retries
    }
}`,
          after: ['`config/services.php` gets an `sms` entry with `url`, `token` and `from`, read from `.env`.'],
        },
      ],
    },
    {
      title: 'The fix, part 5: WhatsApp, without touching a single message',
      text: [
        'WhatsApp needs one more class of the same shape, posting to Meta’s WhatsApp Cloud API. One rule of WhatsApp shapes the request:',
      ],
      blocks: [
        {
          table: [
            ['Step', 'What it means here'],
            ['1. A business may only **start** a conversation with a template Meta has approved', 'Our arrival message is sent before the guest ever writes to us, so it must be a template'],
            ['2. We register one template, `guest_message`, whose whole body is one placeholder', 'Meta approves it once, in the Meta business dashboard'],
            ['3. Each message’s text goes into that placeholder', 'The hosts’ own templates (scene 24) keep working unchanged'],
          ],
        },
        {
          path: 'app/Notifications/Channels/WhatsAppChannel.php',
          code: String.raw`<?php

namespace App\Notifications\Channels;

use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Http;
use LogicException;

class WhatsAppChannel
{
    public function send(object $notifiable, Notification $notification): void
    {
        $to = $notifiable->routeNotificationFor(self::class, $notification)
            ?? throw new LogicException('No WhatsApp number for this recipient.');

        $config = config('services.whatsapp');                                 // token, api_version, phone_number_id

        Http::withToken($config['token'])
            ->timeout(10)
            ->post("https://graph.facebook.com/{$config['api_version']}/{$config['phone_number_id']}/messages", [
                'messaging_product' => 'whatsapp',
                'to' => ltrim($to, '+'),                                       // WhatsApp wants the number without "+"
                'type' => 'template',
                'template' => [
                    'name' => 'guest_message',
                    'language' => ['code' => 'en'],
                    'components' => [[
                        'type' => 'body',
                        'parameters' => [['type' => 'text', 'text' => $notification->toWhatsApp($notifiable)]],
                    ]],
                ],
            ])
            ->throw();
    }
}`,
          after: ['Adding WhatsApp took this one class and the `toWhatsApp()` method on the messages that support it. No existing message, and no other channel, changed.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Bridge'],
    rules: [['Bridge', 'When something varies in two directions, keep each direction in its own set of classes and connect them through one interface, so either side can grow without the other.']],
    drawing: {
      bad: [
        ...messages.map((label, i) => ['b', 8, rows[i], 84, 32, label, 'n']),
        ...channels.map((label, i) => ['b', 208, rows[i], 84, 32, label, 'n']),
        ...rows.flatMap(from => rows.map(to => ['a', 92, from + 16, 206, to + 16, '', 'x'])),
      ],
      good: [
        ['b', 4, 8, 96, 150, '', 'i'],
        ['b', 200, 8, 96, 150, '', 'i'],
        ...messages.map((label, i) => ['b', 12, rows[i], 80, 32, label, 'n']),
        ...channels.map((label, i) => ['b', 208, rows[i], 80, 32, label, 'v2']),
        ['a', 100, 83, 198, 83, '', 'k'],
        ['t', 150, 75, 'send()', 'kv', 'middle'],
      ],
      badCaption: 'Every message carries code for every channel: 3 × 3 = 9 places that send.',
      goodCaption: 'Messages say what; channels deliver. They meet in one place, send(): 3 + 3 classes.',
    },
    points: [
      'One side is **what is said**: `GuestMessage`, `BookingCancelledNotice`, `OverbookingDetected`. The other is **how it’s delivered**: mail, SMS, WhatsApp.',
      'A new message works on every channel at once. A new channel (push notifications, say) is one class, plus one `toX()` method on the messages that should use it.',
      'Laravel built the bridge; your part is to keep the sides apart: no HTTP calls inside a message, no wording inside a channel.',
    ],
    whenNot: [
      'One message, one way of delivering it: a plain Mailable is simpler.',
      'Two sides that don’t really vary on their own. The test: can every item on one side work with every item on the other?',
    ],
  },
  afterReveal: [
    {
      title: 'Hosts choose too',
      text: ['Hosts are users, so their choice lives on their own row (a `notification_channels` JSON column and a `phone` column on `users`), and the overbooking alert from scene 18 reads it in `via()`. The same two channels deliver it; only the message is different.'],
      blocks: [
        {
          path: 'app/Notifications/OverbookingDetected.php (via, after) · app/Models/User.php (added)',
          fragment: true,
          code: String.raw`// OverbookingDetected
public function via(object $notifiable): array
{
    $allowed = ['mail' => 'mail', 'sms' => SmsChannel::class];

    return array_values(array_intersect_key($allowed, array_flip($notifiable->notification_channels ?? ['mail'])));
}

public function toSms(object $notifiable): string
{
    return "Overbooking at {$this->overbooking->booking->property->name}. Details in your email and the app.";
}

// User: casts 'notification_channels' => 'array'
public function routeNotificationForSmsChannel(Notification $notification): ?string
{
    return $this->phone;                                  // what SmsChannel gets from routeNotificationFor()
}`,
          after: ['For a user, Laravel turns `routeNotificationFor(SmsChannel::class)` into a call to `routeNotificationForSmsChannel()`, named after the class.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'The incident, each channel chosen, and what SMS and WhatsApp receive',
    blocks: [
      {
        path: 'tests/Feature/GuestChannelsTest.php',
        code: String.raw`<?php

use App\Enums\GuestChannel;
use App\Jobs\SendScheduledMessage;
use App\Models\Booking;
use App\Models\MessageTemplate;
use App\Models\ScheduledMessage;
use App\Notifications\Channels\SmsChannel;
use App\Notifications\Channels\WhatsAppChannel;
use App\Notifications\GuestMessage;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;

function messageFor(GuestChannel $channel): ScheduledMessage
{
    $booking = Booking::factory()->create(['guest_channel' => $channel, 'guest_phone' => '+4512345678', 'guest_name' => 'Søren']);
    $template = MessageTemplate::forceCreate(['account_id' => $booking->property->account_id, 'name' => 'Hi', 'trigger' => 'booking_confirmed', 'subject' => 'Hi', 'body' => 'Hi {guest_name}']);

    return ScheduledMessage::forceCreate(['booking_id' => $booking->id, 'message_template_id' => $template->id, 'send_at' => now()]);
}

it('sends an SMS, and no email, to a guest who chose SMS', function () {
    Notification::fake();

    app()->call([new SendScheduledMessage(messageFor(GuestChannel::Sms)), 'handle']);

    Notification::assertSentOnDemand(GuestMessage::class, fn (GuestMessage $n, array $channels): bool => $channels === [SmsChannel::class]);
});

it('delivers by the channel the guest chose', function (GuestChannel $choice, string $channel) {
    Notification::fake();

    app()->call([new SendScheduledMessage(messageFor($choice)), 'handle']);

    Notification::assertSentOnDemand(GuestMessage::class, fn (GuestMessage $n, array $channels): bool => $channels === [$channel]);
})->with([
    [GuestChannel::Mail, 'mail'],
    [GuestChannel::Sms, SmsChannel::class],
    [GuestChannel::WhatsApp, WhatsAppChannel::class],
]);

it('sends the rendered text to the guest’s number by SMS', function () {
    config(['services.sms' => ['url' => 'https://sms.test/messages', 'token' => 't', 'from' => 'NordicStays']]);
    Http::fake(['sms.test/*' => Http::response(['id' => 'm1'])]);

    app()->call([new SendScheduledMessage(messageFor(GuestChannel::Sms)), 'handle']);

    Http::assertSent(fn (Request $request): bool => $request['to'] === '+4512345678'
        && $request['from'] === 'NordicStays'
        && $request['text'] === 'Hi Søren');
});

it('sends WhatsApp through the approved template, with the rendered text in it', function () {
    config(['services.whatsapp' => ['token' => 't', 'api_version' => 'v21.0', 'phone_number_id' => '10987']]);
    Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.1']]])]);

    app()->call([new SendScheduledMessage(messageFor(GuestChannel::WhatsApp)), 'handle']);

    Http::assertSent(fn (Request $request): bool => $request['to'] === '4512345678'
        && $request['template']['name'] === 'guest_message'
        && $request['template']['components'][0]['parameters'][0]['text'] === 'Hi Søren');
});`,
      },
    ],
  },
  next: 'Day 4 is done: accounts and roles, send times, messages sent once and stopped on cancellation, date changes that undo themselves, safe variables and every channel. Day 5 starts on Wednesday, when a cleaner walks in while the guests are still asleep.',
};
