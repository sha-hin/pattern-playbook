// Scene 25 · Bridge: what a message says, separate from how it is delivered.

export default {
  description: 'Guests who asked for SMS got every message by email, because each notification hard-coded its delivery. Fix it with Laravel Notifications, which are a Bridge: the message on one side, the channel on the other. Pick channels per guest and per host, send SMS through Vonage, and add a WhatsApp channel without touching a single message.',
  incident: {
    channel: '#support',
    when: 'Tuesday 18:30',
    messages: [
      ['Mona · support', 'A guest at the Nyhavn flat asked for **SMS** when booking, because she doesn’t read email while travelling. She never saw her arrival instructions and waited outside for an hour.'],
      ['Ahmed · host', 'Same for me: I want overbooking alerts by text, not in an inbox I check once a day. And half our guests ask if we do WhatsApp.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Notifications/GuestMessage.php · OverbookingDetected.php (before)',
          broken: true, fragment: true,
          code: String.raw`public function via(object $notifiable): array
{
    return ['mail'];                                                  // in every notification class
}`,
          after: [
            'Every notification decides its own delivery, and they all decided "email". Supporting SMS the obvious way means editing every notification, and WhatsApp means editing all of them again: message types × delivery channels, every combination written by hand.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: the guest’s choice, stored',
      blocks: [
        {
          path: 'database/migrations/2026_04_14_000001_add_contact_preferences.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('guest_phone')->nullable();                 // E.164: +4512345678
            $table->string('guest_channel')->default('mail');          // mail, sms, whatsapp
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('phone')->nullable();
            $table->json('notification_channels')->nullable();         // a host's choice, e.g. ["mail","vonage"]
        });
    }
};`,
        },
        {
          title: 'Our names for the choices, Laravel’s names for the channels',
          text: ['`via()` returns channel names: `mail` and `vonage` are built in, and a custom channel is named by its class.'],
          path: 'app/Enums/GuestChannel.php',
          code: String.raw`<?php

namespace App\Enums;

use App\Notifications\Channels\WhatsAppChannel;

enum GuestChannel: string
{
    case Mail = 'mail';
    case Sms = 'sms';
    case WhatsApp = 'whatsapp';

    public function notificationChannel(): string
    {
        return match ($this) {
            self::Mail => 'mail',
            self::Sms => 'vonage',                                      // laravel/vonage-notification-channel
            self::WhatsApp => WhatsAppChannel::class,
        };
    }
}`,
          after: ['`Booking` casts `guest_channel` to it; the booking form and the channel mappers (scene 14) fill both fields.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: a message says what, the channel decides how',
      text: [
        'A notification class answers two questions: **who wants it, by which channels** (`via()`), and **what it looks like on each** (`toMail()`, `toVonage()`, `toWhatsApp()`). It never sends anything itself. Delivering it is the channel’s job.',
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
use Illuminate\Notifications\Messages\VonageMessage;
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
        return [$this->message->booking->guest_channel->notificationChannel()];       // the guest's choice
    }

    public function toMail(object $notifiable): MailMessage
    {
        $renderer = app(TemplateRenderer::class);

        return (new MailMessage())
            ->subject($renderer->text($this->message->template->subject, $this->message->booking, now()))
            ->view('mail.guest', ['html' => $renderer->html($this->message->template->body, $this->message->booking, now())]);
    }

    public function toVonage(object $notifiable): VonageMessage
    {
        return (new VonageMessage())->content($this->text())->unicode();                // names like "Søren" need unicode
    }

    public function toWhatsApp(object $notifiable): string
    {
        return $this->text();
    }

    private function text(): string
    {
        return app(TemplateRenderer::class)->text($this->message->template->body, $this->message->booking, now());   // scene 24
    }
}`,
        },
        {
          title: 'Where each channel delivers to',
          text: ['A guest isn’t a user, so the send job gives the on-demand notifiable an address for every channel. The notification picks one with `via()`; the matching channel reads its address.'],
          path: 'app/Jobs/SendScheduledMessage.php (the send line, after)',
          fragment: true,
          code: String.raw`$booking = $this->message->booking;

Notification::route('mail', $booking->guest_email)
    ->route('vonage', $booking->guest_phone)
    ->route(WhatsAppChannel::class, $booking->guest_phone)
    ->notifyNow(new GuestMessage($this->message));`,
        },
        {
          title: 'Hosts choose too',
          text: ['Hosts are users, so their choice is on their own row, and Laravel asks the user for each channel’s address.'],
          path: 'app/Notifications/OverbookingDetected.php (via, after) · app/Models/User.php (added)',
          fragment: true,
          code: String.raw`// OverbookingDetected (scene 18)
public function via(object $notifiable): array
{
    return array_values(array_intersect($notifiable->notification_channels ?? ['mail'], ['mail', 'vonage']));
}

public function toVonage(object $notifiable): VonageMessage
{
    return (new VonageMessage())->content("Overbooking at {$this->overbooking->booking->property->name}: check your email or the app.");
}

// User: casts 'notification_channels' => 'array'
public function routeNotificationForVonage(Notification $notification): ?string
{
    return $this->phone;
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: a new channel, no message touched',
      text: [
        'WhatsApp isn’t built in. A channel is any class with a `send($notifiable, $notification)` method. This one asks the notification for its WhatsApp text and posts it to Meta’s WhatsApp Cloud API. Messages a business starts must use a template approved by Meta, so the text goes in as the parameter of one approved template, `guest_message`, whose body is just `{{1}}`.',
      ],
      blocks: [
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
        if (! method_exists($notification, 'toWhatsApp')) {
            throw new LogicException($notification::class . ' has no WhatsApp version.');
        }

        $to = $notifiable->routeNotificationFor(self::class, $notification);
        if ($to === null) {
            throw new LogicException('No WhatsApp number for this recipient.');   // loud: the guest asked for WhatsApp
        }

        $config = config('services.whatsapp');

        Http::withToken($config['token'])
            ->timeout(10)
            ->post("https://graph.facebook.com/{$config['api_version']}/{$config['phone_number_id']}/messages", [
                'messaging_product' => 'whatsapp',
                'to' => ltrim($to, '+'),
                'type' => 'template',
                'template' => [
                    'name' => 'guest_message',
                    'language' => ['code' => 'en'],
                    'components' => [['type' => 'body', 'parameters' => [['type' => 'text', 'text' => $notification->toWhatsApp($notifiable)]]]],
                ],
            ])
            ->throw();                                                     // a failed send fails the job, which retries
    }
}`,
          after: ['Its settings go in `config/services.php` as `whatsapp` → `token`, `api_version` (the Graph API version your Meta app uses) and `phone_number_id`, read from `.env`. Adding WhatsApp took one channel class and one `toWhatsApp()` per message that supports it. Adding a new message type later takes one notification class, and every channel already works with it.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Bridge'],
    rules: [['Bridge', 'Split something that varies in two directions into two hierarchies, the abstraction and the implementation, connected by a reference, so each side can grow without the other.']],
    points: [
      'One side: **what** is said, the notifications (`GuestMessage`, `OverbookingDetected`, `BookingCancelledNotice`). The other: **how** it’s delivered, the channels (mail, Vonage, WhatsApp).',
      'Without the bridge, 3 messages × 3 channels is 9 combinations to write. With it, it’s 3 + 3, and the fourth channel is one class.',
      'Laravel built this side for you; your part is to keep the two sides apart: no HTTP calls in a notification, no wording in a channel.',
    ],
    whenNot: [
      'One way of delivering, forever: a plain mailable is simpler than a notification.',
      'Don’t create a bridge for two sides that don’t really vary independently. The test: can a new item on one side work with every item on the other?',
    ],
  },
  laravel: {
    title: 'Laravel inside: where the two sides meet',
    text: ['For every channel `via()` returns, the sender asks the notification channel manager (a Manager, scene 13) for that channel’s driver and hands it the notification. A class name that isn’t a built-in driver is resolved from the container, which is all a custom channel needs.'],
    blocks: [
      {
        path: 'Illuminate/Notifications/NotificationSender.php · ChannelManager.php (simplified)',
        fragment: true,
        code: String.raw`protected function sendToNotifiable($notifiable, $id, $notification, $channel)
{
    if (! $this->shouldSendNotification($notifiable, $notification, $channel)) {
        return;
    }

    $response = $this->manager->driver($channel)->send($notifiable, $notification);   // the bridge

    $this->events->dispatch(new NotificationSent($notifiable, $notification, $channel, $response));
}

// ChannelManager
protected function createDriver($driver)
{
    try {
        return parent::createDriver($driver);              // mail, database, broadcast, vonage...
    } catch (InvalidArgumentException $e) {
        if (class_exists($driver)) {
            return $this->container->make($driver);         // WhatsAppChannel::class
        }

        throw $e;
    }
}`,
      },
    ],
  },
  tests: {
    summary: 'Each guest’s channel, each host’s choice, and what WhatsApp receives',
    blocks: [
      {
        path: 'tests/Feature/GuestChannelsTest.php',
        code: String.raw`<?php

use App\Enums\GuestChannel;
use App\Jobs\SendScheduledMessage;
use App\Models\Booking;
use App\Models\MessageTemplate;
use App\Models\ScheduledMessage;
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

it('delivers by the channel the guest chose', function (GuestChannel $choice, string $channel) {
    Notification::fake();

    app()->call([new SendScheduledMessage(messageFor($choice)), 'handle']);

    Notification::assertSentOnDemand(GuestMessage::class, fn (GuestMessage $n, array $channels): bool => $channels === [$channel]);
})->with([
    [GuestChannel::Mail, 'mail'],
    [GuestChannel::Sms, 'vonage'],
    [GuestChannel::WhatsApp, WhatsAppChannel::class],
]);

it('sends WhatsApp through the approved template, with the rendered text', function () {
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
