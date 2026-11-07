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
      text: ['Last week’s release added two columns for the form. They stay as they are:'],
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
            $table->string('guest_channel')->default('email');         // email, sms, whatsapp
        });
    }
};`,
        },
        {
          title: 'Our words in the database, Laravel’s names in the code',
          text: [
            'The database stores **our** words (`email`, `sms`, `whatsapp`), never class names: a class can be renamed or moved, a stored value can’t follow it. The enum translates our word into the name Laravel uses for that channel: `mail` is built in, and a custom channel is named by its class.',
          ],
          path: 'app/Enums/GuestChannel.php',
          code: String.raw`<?php

namespace App\Enums;

use App\Notifications\Channels\SmsChannel;
use App\Notifications\Channels\WhatsAppChannel;

enum GuestChannel: string
{
    case Mail = 'email';
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
        },
        {
          text: ['The booking casts the column to it:'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\BookingSnapshot;
use App\Bookings\Refunds\NoAutomaticRefund;
use App\Bookings\Refunds\RefundPolicy;
use App\Bookings\States\BookingState;
use App\Bookings\States\CancelledState;
use App\Bookings\States\ConfirmedState;
use App\Bookings\States\ExpiredState;
use App\Bookings\States\PendingState;
use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Casts\StayCast;
use App\Enums\BookingStatus;
use App\Enums\CancellationPolicy;
use App\Enums\Channel;
use App\Enums\GuestChannel;
use App\Money\Money;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'guest_phone', 'guest_channel', 'check_in', 'check_out', 'guests'];

    protected $hidden = ['door_code'];                             // never in JSON, logs or toArray()

    protected function casts(): array
    {
        return [
            'check_in' => 'date:Y-m-d',
            'check_out' => 'date:Y-m-d',
            'status' => BookingStatus::class,
            'expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'total' => MoneyCast::class . ':total_cents',          // Money from total_cents + currency
            'stay' => StayCast::class,                             // Stay from check_in + check_out
            'cancellation_policy' => CancellationPolicy::class,    // a copy of the property's policy, made at booking time
            'channel' => Channel::class,                           // null for bookings made on Nordic Stays
            'door_code' => 'encrypted',                            // encrypted with APP_KEY in the database
            'guest_channel' => GuestChannel::class,                // how the guest wants to hear from us
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(BookingLineItem::class);
    }

    public function scheduledMessages(): HasMany
    {
        return $this->hasMany(ScheduledMessage::class);
    }

    /** Bookings that share at least one night with $stay: $property->bookings()->overlapping($stay). */
    public function scopeOverlapping(Builder $query, Stay $stay): void
    {
        $query->whereIn('status', BookingStatus::blocking())
            ->where('check_in', '<', $stay->checkOut->toDateString())     // starts before the new stay ends
            ->where('check_out', '>', $stay->checkIn->toDateString());    // ends after the new stay starts
    }

    /** What this booking may do now. The status column stays the single source of truth. */
    public function state(): BookingState
    {
        return match ($this->status) {
            BookingStatus::Pending => new PendingState(),
            BookingStatus::Confirmed => new ConfirmedState(),
            BookingStatus::Expired => new ExpiredState(),
            BookingStatus::Cancelled => new CancelledState(),
        };                                                        // a new status without a state class fails here, loudly
    }

    /** The rules this booking's guest agreed to. Never null: bookings without a policy refund nothing automatically. */
    public function refundPolicy(): RefundPolicy
    {
        return $this->cancellation_policy?->refundPolicy() ?? new NoAutomaticRefund();
    }

    /** Everything a date change can alter, as a plain value that can be stored and handed back. */
    public function snapshot(): BookingSnapshot
    {
        return new BookingSnapshot(
            $this->stay->checkIn->toDateString(),
            $this->stay->checkOut->toDateString(),
            $this->total->amount,
            $this->total->currency->value,
            $this->lineItems()->orderBy('id')->get(['type', 'description', 'amount_cents', 'currency'])
                ->map(fn (BookingLineItem $line): array => [
                    'type' => $line->type->value, 'description' => $line->description,
                    'amount_cents' => $line->amount_cents, 'currency' => $line->currency,
                ])->all(),
        );
    }

    public function restore(BookingSnapshot $snapshot): void
    {
        $this->stay = Stay::fromDates($snapshot->checkIn, $snapshot->checkOut);
        $this->total = Money::of($snapshot->totalCents, $snapshot->currency);
        $this->save();

        $this->lineItems()->delete();                                          // the bill goes back line by line
        $this->lineItems()->createMany(array_map(fn (array $line): array => [
            'type' => $line['type'],
            'description' => $line['description'],
            'amount' => Money::of($line['amount_cents'], $line['currency']),
        ], $snapshot->lines));
    }
}`,
        },
        {
          text: ['The form validates the choice against the enum, and a phone number whenever the choice isn’t email:'],
          path: 'app/Http/Requests/StoreBookingRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Bookings\Stay;
use App\Enums\GuestChannel;
use App\Models\Property;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBookingRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        /** @var Property $property */
        $property = $this->route('property');

        return [
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
            'guests' => ['required', 'integer', 'min:1', "max:{$property->max_guests}"],
            'guest_name' => ['required', 'string', 'max:120'],
            'guest_email' => ['required', 'email:rfc', 'max:254'],
            'contact_channel' => ['required', Rule::enum(GuestChannel::class)],            // email, sms or whatsapp
            'guest_phone' => ['required_unless:contact_channel,email', 'nullable', 'regex:/^\+[1-9]\d{7,14}$/'],   // E.164: +4512345678
        ];
    }

    public function stay(): Stay
    {
        return Stay::fromDates($this->validated('check_in'), $this->validated('check_out'));
    }
}`,
        },
        {
          text: ['The controller passes both on with the guest’s other details:'],
          path: 'app/Http/Controllers/BookingController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\CreateBooking;
use App\Http\Requests\MoveBookingRequest;
use App\Http\Requests\StoreBookingRequest;
use App\Http\Resources\BookingResource;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class BookingController extends Controller
{
    public function store(StoreBookingRequest $request, Property $property, CreateBooking $createBooking): BookingResource
    {
        $booking = $createBooking->handle(
            $property,
            $request->stay(),
            $request->safe()->only(['guest_name', 'guest_email', 'guest_phone', 'guests'])
                + ['guest_channel' => $request->validated('contact_channel')],
        );

        return new BookingResource($booking);
    }

    public function index(Account $account): AnonymousResourceCollection
    {
        return BookingResource::collection(
            $account->bookings()->latest('bookings.id')->cursorPaginate(50),   // the account is injected by the middleware
        );
    }

    public function show(Booking $booking): BookingResource
    {
        return new BookingResource($booking);                                     // the route's policy has checked it
    }

    public function move(MoveBookingRequest $request, Booking $booking): BookingResource
    {
        $booking->property_id = $request->validated('property_id');             // one field, by name, after validation
        $booking->save();                                                       // (Day 5 adds the availability check)

        return new BookingResource($booking);
    }
}`,
        },
        {
          text: ['`CreateBooking` saves them with the rest; only its description of `$guest` changes:'],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
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

            $taken = $property->bookings()->overlapping($stay)->exists()
                || $property->externalBlocks()->overlapping($stay)->exists();   // nights sold on Airbnb or Booking.com
            if ($taken) {
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

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
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
        $template = $this->message->template;
        $booking = $this->message->booking;
        $renderer = app(TemplateRenderer::class);                         // resolved here, so the notification stays small

        return (new MailMessage())
            ->subject($renderer->text($template->subject, $booking, now()))               // a subject is plain text
            ->view('mail.guest', ['html' => $renderer->html($template->body, $booking, now())]);
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
          text: ['The routes are named after our words (`sms`, `whatsapp`), and each channel asks for its own by that name.'],
          path: 'app/Jobs/SendScheduledMessage.php',
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
            $booking = $this->message->booking;

            Notification::route('mail', $booking->guest_email)             // an address for every channel;
                ->route('sms', $booking->guest_phone)                       // the message picks which one is used
                ->route('whatsapp', $booking->guest_phone)
                ->notifyNow(new GuestMessage($this->message));
        } catch (Throwable $e) {
            ScheduledMessage::query()->whereKey($this->message->id)->update(['status' => ScheduledMessageStatus::Pending, 'sent_at' => null]);
            throw $e;                                                                 // give it back, so the retry can claim it
        }
    }
}`,
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
        $to = $notifiable->routeNotificationFor('sms', $notification)
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
        },
      ],
    },
    {
      title: 'The fix, part 5: WhatsApp, with templates Meta approves',
      text: [
        'WhatsApp needs one more channel class, posting to Meta’s WhatsApp Cloud API. Unlike SMS, WhatsApp decides what a business may send, and its rules shape the design more than the code does:',
      ],
      blocks: [
        {
          table: [
            ['WhatsApp’s rule', 'What it means here'],
            ['A business may only **start** a conversation with a **template** Meta has approved', 'Our arrival message goes out before the guest ever writes to us, so it must be an approved template'],
            ['A template is fixed text with numbered variables, `{{1}}`, `{{2}}`; it may not start or end with a variable, and a variable’s value may not contain a line break', 'Arbitrary text can’t be squeezed into one variable: a "template" that is only `{{1}}` is rejected, and our messages have line breaks'],
            ['Approval takes minutes to a day, and can be refused', 'A message needs a plan for the time before approval'],
          ],
          after: [
            'So every host template is submitted to Meta **as its own template**. The host’s text becomes the fixed text, and scene 24’s variables become WhatsApp’s numbered ones: `Hi {guest_name}, your code is {door_code}.` is registered as `Hi {{1}}, your code is {{2}}.`, and each send fills in the values. The values are short and single-line by nature (a name, a date, a code), which is what WhatsApp allows.',
            'Until Meta has approved a template, guests who chose WhatsApp get that message **by email**. A guest always gets the message; WhatsApp is how, once it is allowed.',
          ],
        },
        {
          title: 'The template remembers its WhatsApp twin',
          path: 'database/migrations/2026_04_14_000002_add_whatsapp_to_message_templates_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('message_templates', function (Blueprint $table) {
            $table->string('whatsapp_name')->nullable();                  // the name Meta knows it by, e.g. nordic_812
            $table->string('whatsapp_status')->nullable();                // null: not submitted · pending · approved · rejected
        });
    }
};`,
        },
        {
          path: 'app/Models/MessageTemplate.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\MessageTrigger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MessageTemplate extends Model
{
    protected $fillable = ['name', 'trigger', 'days_offset', 'send_time', 'subject', 'body', 'active'];

    protected function casts(): array
    {
        return ['trigger' => MessageTrigger::class, 'active' => 'boolean'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /** Meta has approved this template, so it may be sent on WhatsApp. */
    public function sendableOnWhatsApp(): bool
    {
        return $this->whatsapp_status === 'approved';
    }
}`,
          after: ['The two new columns are not fillable: only the job below writes them, never a request.'],
        },
        {
          title: 'The host’s text, in WhatsApp’s format',
          path: 'app/Messaging/WhatsAppTemplate.php',
          code: String.raw`<?php

namespace App\Messaging;

final class WhatsAppTemplate
{
    /** An example value per variable: Meta asks for one per {{n}} when a template is submitted. */
    private const SAMPLES = [
        'guest_name' => 'Anna',
        'property_name' => 'Skagen cottage',
        'check_in' => 'Friday 2 July 2027',
        'check_out' => 'Monday 5 July 2027',
        'check_in_time' => '15:00',
        'door_code' => '4821',
    ];

    /** "Hi {guest_name}, see you {check_in}." → "Hi {{1}}, see you {{2}}.": every occurrence gets the next number. */
    public static function body(string $template): string
    {
        $n = 0;

        return preg_replace_callback('/\{[a-z_]+\}/', function () use (&$n): string {
            return '{{' . ++$n . '}}';
        }, $template);
    }

    /** @return list<string> the variable names in the order WhatsApp numbers them, repeats included */
    public static function variables(string $template): array
    {
        preg_match_all('/\{([a-z_]+)\}/', $template, $matches);

        return $matches[1];
    }

    /** @return list<string> */
    public static function samples(string $template): array
    {
        return array_map(fn (string $name): string => self::SAMPLES[$name], self::variables($template));
    }

    /** WhatsApp refuses a template that starts or ends with a variable. */
    public static function problem(string $template): ?string
    {
        $text = trim($template);

        return preg_match('/^\{[a-z_]+\}|\{[a-z_]+\}[.!?]?$/', $text) === 1
            ? 'WhatsApp needs a word before the first variable and after the last one, e.g. “Hi {guest_name}, welcome.”'
            : null;
    }
}`,
          after: ['The rule is checked when the host saves the template, below, because any guest may choose WhatsApp. A variable followed only by a full stop or a question mark counts as the end too: Meta’s review is strict about variables at the edges, and a word after the last one is the safe form.'],
        },
        {
          title: 'The values, in the same order',
          path: 'app/Messaging/TemplateRenderer.php',
          code: String.raw`<?php

namespace App\Messaging;

use App\Models\Booking;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use LogicException;

final class TemplateRenderer
{
    /** The host's Markdown as HTML, with every value escaped. */
    public function html(string $template, Booking $booking, CarbonImmutable $sentAt): string
    {
        $html = Str::markdown($template, ['html_input' => 'escape', 'allow_unsafe_links' => false]);   // the host's own markup

        return $this->fill($html, $booking, $sentAt, fn (string $value): string => e($value));         // values: never markup
    }

    /** For SMS: no markup at all. */
    public function text(string $template, Booking $booking, CarbonImmutable $sentAt): string
    {
        return $this->fill($template, $booking, $sentAt, fn (string $value): string => $value);
    }

    /** For WhatsApp: only the values, in the order of WhatsAppTemplate::body()'s numbers, each on one line. @return list<string> */
    public function values(string $template, Booking $booking, CarbonImmutable $sentAt): array
    {
        return array_map(
            fn (string $name): string => trim(preg_replace('/\s+/u', ' ', $this->value($name, $booking, $sentAt))),   // WhatsApp refuses line breaks in a value
            WhatsAppTemplate::variables($template),
        );
    }

    /** @param callable(string): string $escape */
    private function fill(string $text, Booking $booking, CarbonImmutable $sentAt, callable $escape): string
    {
        return preg_replace_callback('/\{([a-z_]+)\}/', fn (array $m): string => $escape($this->value($m[1], $booking, $sentAt)), $text);
    }

    private function value(string $name, Booking $booking, CarbonImmutable $sentAt): string
    {
        $property = $booking->property;

        return match ($name) {
            'guest_name' => $booking->guest_name,
            'property_name' => $property->name,
            'check_in' => $booking->stay->checkIn->format('l j F Y'),
            'check_out' => $booking->stay->checkOut->format('l j F Y'),
            'check_in_time' => substr($property->check_in_time, 0, 5),
            'door_code' => $this->doorCode($booking, $sentAt),
            default => throw new LogicException("Unknown template variable {{$name}}."),   // never sent as text
        };
    }

    private function doorCode(Booking $booking, CarbonImmutable $sentAt): string
    {
        $hoursBefore = $sentAt->diffInHours($booking->stay->checkInAt($booking->property), false);

        if ($hoursBefore > TemplateVariables::SENSITIVE_HOURS_BEFORE_CHECK_IN || $booking->door_code === null) {
            return 'sent to you the day before arrival';           // too early, or not set yet: never the code
        }

        return $booking->door_code;
    }
}`,
          after: ['The door-code rule from scene 24 holds on WhatsApp too: `values()` asks `value()`, the one place that decides what the code variable may show.'],
        },
        {
          title: 'Saving a template checks the rule, and submits it',
          path: 'app/Http/Requests/StoreMessageTemplateRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Enums\MessageTrigger;
use App\Messaging\TemplateVariables;
use App\Messaging\WhatsAppTemplate;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreMessageTemplateRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'trigger' => ['required', Rule::enum(MessageTrigger::class)],
            'days_offset' => ['required', 'integer', 'between:-30,30'],
            'send_time' => ['nullable', 'date_format:H:i'],
            'subject' => ['required', 'string', 'max:150', $this->knownVariables(...)],
            'body' => ['required', 'string', 'max:1024', $this->knownVariables(...), $this->doorCodeOnlyNearArrival(...), $this->sendableOnWhatsApp(...)],   // 1,024: WhatsApp's limit for a template body
        ];
    }

    private function knownVariables(string $attribute, mixed $value, Closure $fail): void
    {
        $unknown = array_diff(TemplateVariables::in((string) $value), TemplateVariables::NAMES);

        if ($unknown !== []) {
            $fail('Unknown variable: {' . implode('}, {', $unknown) . '}. Use one of: {' . implode('}, {', TemplateVariables::NAMES) . '}.');
        }
    }

    private function doorCodeOnlyNearArrival(string $attribute, mixed $value, Closure $fail): void
    {
        $usesSecret = array_intersect(TemplateVariables::in((string) $value), TemplateVariables::SENSITIVE) !== [];
        $nearArrival = $this->input('trigger') === MessageTrigger::BeforeCheckIn->value && in_array((int) $this->input('days_offset'), [-2, -1, 0], true);

        if ($usesSecret && ! $nearArrival) {
            $fail('{door_code} can only be used in messages sent at most 2 days before check-in.');
        }
    }

    private function sendableOnWhatsApp(string $attribute, mixed $value, Closure $fail): void
    {
        if (($problem = WhatsAppTemplate::problem((string) $value)) !== null) {
            $fail($problem);                                            // any guest may choose WhatsApp
        }
    }
}`,
          after: ['The body limit drops from 5,000 to 1,024 characters, WhatsApp’s limit for a template body. No host template so far was longer than 900.'],
        },
        {
          path: 'app/Http/Controllers/MessageTemplateController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreMessageTemplateRequest;
use App\Jobs\SyncWhatsAppTemplate;
use App\Models\Account;
use App\Models\MessageTemplate;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

class MessageTemplateController extends Controller
{
    public function store(StoreMessageTemplateRequest $request, Account $account): JsonResponse
    {
        Gate::authorize('create', [MessageTemplate::class, $account]);

        $template = $account->messageTemplates()->create($request->validated());   // only validated fields

        SyncWhatsAppTemplate::dispatch($template)->afterCommit();       // submit it to Meta, then follow it to approval

        return response()->json(['id' => $template->id], 201);
    }
}`,
        },
        {
          title: 'Submitting, and waiting for Meta’s answer',
          text: ['One job does both: if the template hasn’t been submitted, it submits it; if Meta is still reviewing it, it checks again in ten minutes, for up to three days.'],
          path: 'app/Jobs/SyncWhatsAppTemplate.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Messaging\WhatsAppTemplate;
use App\Models\MessageTemplate;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

class SyncWhatsAppTemplate implements ShouldQueue
{
    use Queueable;

    public const RECHECK_SECONDS = 600;

    public function __construct(public MessageTemplate $template)
    {
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addDays(3);                                       // Meta usually answers within a day
    }

    public function handle(): void
    {
        if ($this->template->whatsapp_name === null) {
            $this->submit();
        } elseif ($this->template->whatsapp_status === 'pending') {
            $this->refreshStatus();
        }

        if ($this->template->whatsapp_status === 'pending') {
            $this->release(self::RECHECK_SECONDS);                      // not a failure: Meta is still reviewing
        }
    }

    private function submit(): void
    {
        $name = "nordic_{$this->template->id}";                         // lowercase, digits and underscores, as Meta requires
        $body = ['type' => 'BODY', 'text' => WhatsAppTemplate::body($this->template->body)];
        if (($samples = WhatsAppTemplate::samples($this->template->body)) !== []) {
            $body['example'] = ['body_text' => [$samples]];
        }

        $response = $this->graph()->post('/message_templates', [
            'name' => $name,
            'language' => 'en',
            'category' => 'UTILITY',                                    // about a stay the guest booked: not marketing
            'components' => [$body],
        ])->throw();

        $this->template->forceFill(['whatsapp_name' => $name, 'whatsapp_status' => strtolower($response->json('status'))])->save();
    }

    private function refreshStatus(): void
    {
        $status = $this->graph()->get('/message_templates', ['name' => $this->template->whatsapp_name])
            ->throw()
            ->json('data.0.status');

        $this->template->forceFill(['whatsapp_status' => strtolower((string) $status)])->save();
    }

    /** The WhatsApp Business Account's endpoints, where templates live. */
    private function graph(): PendingRequest
    {
        $config = config('services.whatsapp');

        return Http::withToken($config['token'])
            ->timeout(10)
            ->baseUrl("https://graph.facebook.com/{$config['api_version']}/{$config['business_account_id']}");
    }
}`,
          after: ['A **rejected** template stops the job and stays rejected: the template page shows the host Meta’s answer, and the messages keep going out by email. Meta also offers a webhook for template status changes; checking every ten minutes is simpler and enough for templates a host creates a few times a year.'],
        },
        {
          title: 'The message and the channel',
          path: 'app/Notifications/Channels/WhatsAppMessage.php',
          code: String.raw`<?php

namespace App\Notifications\Channels;

/** What a notification hands the WhatsApp channel. */
final readonly class WhatsAppMessage
{
    /** @param list<string> $parameters */
    private function __construct(
        public string $template,
        public array $parameters,
    ) {
    }

    /** An approved template and its values in order: the only kind a business may send first. @param list<string> $parameters */
    public static function template(string $name, array $parameters): self
    {
        return new self($name, $parameters);
    }
}`,
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
        $to = $notifiable->routeNotificationFor('whatsapp', $notification)
            ?? throw new LogicException('No WhatsApp number for this recipient.');

        /** @var WhatsAppMessage $message */
        $message = $notification->toWhatsApp($notifiable);
        $config = config('services.whatsapp');                                 // token, api_version, phone_number_id

        Http::withToken($config['token'])
            ->timeout(10)
            ->post("https://graph.facebook.com/{$config['api_version']}/{$config['phone_number_id']}/messages", [
                'messaging_product' => 'whatsapp',
                'to' => ltrim($to, '+'),                                       // WhatsApp wants the number without "+"
                'type' => 'template',
                'template' => [
                    'name' => $message->template,
                    'language' => ['code' => 'en'],
                    'components' => $message->parameters === [] ? [] : [[
                        'type' => 'body',
                        'parameters' => array_map(fn (string $value): array => ['type' => 'text', 'text' => $value], $message->parameters),
                    ]],
                ],
            ])
            ->throw();
    }
}`,
        },
        {
          title: 'The guest message: WhatsApp once approved, email until then',
          path: 'app/Notifications/GuestMessage.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Enums\GuestChannel;
use App\Messaging\TemplateRenderer;
use App\Models\ScheduledMessage;
use App\Notifications\Channels\WhatsAppMessage;
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
        $choice = $this->message->booking->guest_channel;

        if ($choice === GuestChannel::WhatsApp && ! $this->message->template->sendableOnWhatsApp()) {
            return ['mail'];                                            // not approved yet: the guest still gets the message
        }

        return [$choice->notificationChannel()];                        // the fix for the incident
    }

    public function toMail(object $notifiable): MailMessage
    {
        $template = $this->message->template;
        $booking = $this->message->booking;
        $renderer = app(TemplateRenderer::class);                         // resolved here, so the notification stays small

        return (new MailMessage())
            ->subject($renderer->text($template->subject, $booking, now()))               // a subject is plain text
            ->view('mail.guest', ['html' => $renderer->html($template->body, $booking, now())]);
    }

    public function toSms(object $notifiable): string
    {
        return app(TemplateRenderer::class)->text($this->message->template->body, $this->message->booking, now());   // scene 24
    }

    public function toWhatsApp(object $notifiable): WhatsAppMessage
    {
        $template = $this->message->template;

        return WhatsAppMessage::template(
            $template->whatsapp_name,
            app(TemplateRenderer::class)->values($template->body, $this->message->booking, now()),
        );
    }
}`,
          after: ['Adding WhatsApp took a channel class and a `toWhatsApp()` method, as the Bridge promises. What made it bigger than SMS is not the code but the provider: WhatsApp approves the words before it delivers them.'],
        },
        {
          title: 'Configuration',
          text: ['Both channels read their settings from `config/services.php`:'],
          path: 'config/services.php',
          code: String.raw`<?php

// Credentials for the services Nordic Stays talks to. Values come from .env, never from code.
return [

    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'version' => env('STRIPE_API_VERSION'),              // the API version your Stripe account is pinned to
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),     // checks that a webhook really comes from Stripe
    ],

    'airbnb' => [
        'base_url' => env('AIRBNB_BASE_URL'),
        'token_url' => env('AIRBNB_TOKEN_URL'),
        'client_id' => env('AIRBNB_CLIENT_ID'),
        'client_secret' => env('AIRBNB_CLIENT_SECRET'),
        'webhook_secret' => env('AIRBNB_WEBHOOK_SECRET'),
        'requests_per_minute' => env('AIRBNB_REQUESTS_PER_MINUTE', 60),   // a little under the partner's published limit
    ],

    'booking_com' => [
        'base_url' => env('BOOKING_COM_BASE_URL'),
        'username' => env('BOOKING_COM_USERNAME'),
        'password' => env('BOOKING_COM_PASSWORD'),
        'webhook_secret' => env('BOOKING_COM_WEBHOOK_SECRET'),
        'requests_per_minute' => env('BOOKING_COM_REQUESTS_PER_MINUTE', 60),
    ],

    'sms' => [
        'url' => env('SMS_API_URL'),                          // your SMS provider's "send message" endpoint
        'token' => env('SMS_API_TOKEN'),
        'from' => env('SMS_FROM', 'NordicStays'),             // the sender name guests see
    ],

    'whatsapp' => [
        'token' => env('WHATSAPP_TOKEN'),
        'api_version' => env('WHATSAPP_API_VERSION', 'v21.0'),
        'phone_number_id' => env('WHATSAPP_PHONE_NUMBER_ID'),   // the business number, from Meta's dashboard
        'business_account_id' => env('WHATSAPP_BUSINESS_ACCOUNT_ID'),   // where templates are submitted and approved
    ],

];`,
        },
        {
          text: ['The values come from your SMS provider’s dashboard and from Meta’s WhatsApp Business dashboard:'],
          path: '.env (add these lines)',
          lang: 'env',
          fragment: true,
          code: String.raw`SMS_API_URL=https://api.your-sms-provider.example/v1/messages
SMS_API_TOKEN=
SMS_FROM=NordicStays
WHATSAPP_TOKEN=
WHATSAPP_API_VERSION=v21.0
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=`,
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
      text: ['Hosts are users, so their choice lives on their own row, and the overbooking alert reads it. The same SMS channel delivers it; only the message is different.'],
      blocks: [
        {
          text: ['Two columns on `users`:'],
          path: 'database/migrations/2026_04_15_000001_add_notification_settings_to_users_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone')->nullable();                           // E.164
            $table->json('notification_channels')->nullable();            // e.g. ["mail", "sms"]; null = mail only
        });
    }
};`,
        },
        {
          text: ['The user casts the list, and tells `SmsChannel` where to send:'],
          path: 'app/Models/User.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Notifications\Notification;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return ['email_verified_at' => 'datetime', 'password' => 'hashed', 'notification_channels' => 'array'];
    }

    public function accounts(): BelongsToMany
    {
        return $this->belongsToMany(Account::class, 'memberships')
            ->using(Membership::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    public function currentAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'current_account_id');
    }

    /** The user's role in an account, or null when they are not a member. */
    public function roleIn(int $accountId): ?MembershipRole
    {
        return $this->accounts->firstWhere('id', $accountId)?->pivot->role;
    }

    /** The number SmsChannel sends to: $notifiable->routeNotificationFor('sms') calls this. */
    public function routeNotificationForSms(Notification $notification): ?string
    {
        return $this->phone;
    }
}`,
          after: ['For a user, Laravel turns `routeNotificationFor(\'sms\')` into a call to `routeNotificationForSms()`.'],
        },
        {
          text: ['The overbooking alert from scene 18 reads the host’s choice in `via()`, and gets a short SMS version:'],
          path: 'app/Notifications/OverbookingDetected.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Models\Overbooking;
use App\Notifications\Channels\SmsChannel;
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
        $allowed = ['mail' => 'mail', 'sms' => SmsChannel::class];            // what a host can choose for this alert

        return array_values(array_intersect_key($allowed, array_flip($notifiable->notification_channels ?? ['mail'])));
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

    public function toSms(object $notifiable): string
    {
        return "Overbooking at {$this->overbooking->booking->property->name}. Details in your email and the app.";
    }
}`,
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
use App\Jobs\SyncWhatsAppTemplate;
use App\Models\Booking;
use App\Models\MessageTemplate;
use App\Models\Property;
use App\Models\ScheduledMessage;
use App\Notifications\Channels\SmsChannel;
use App\Notifications\Channels\WhatsAppChannel;
use App\Notifications\GuestMessage;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;

function messageFor(GuestChannel $channel, ?string $whatsappStatus = 'approved'): ScheduledMessage
{
    $booking = Booking::factory()->create(['guest_channel' => $channel, 'guest_phone' => '+4512345678', 'guest_name' => 'Søren']);
    $template = MessageTemplate::forceCreate([
        'account_id' => $booking->property->account_id, 'name' => 'Hi', 'trigger' => 'booking_confirmed', 'subject' => 'Hi',
        'body' => 'Hi {guest_name}, welcome to {property_name}. See you soon!',
        'whatsapp_name' => $whatsappStatus === null ? null : 'nordic_1', 'whatsapp_status' => $whatsappStatus,
    ]);

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

it('emails a WhatsApp guest until Meta has approved the template', function (?string $status) {
    Notification::fake();

    app()->call([new SendScheduledMessage(messageFor(GuestChannel::WhatsApp, $status)), 'handle']);

    Notification::assertSentOnDemand(GuestMessage::class, fn (GuestMessage $n, array $channels): bool => $channels === ['mail']);
})->with(['not submitted' => [null], 'pending' => ['pending'], 'rejected' => ['rejected']]);

it('sends the rendered text to the guest’s number by SMS', function () {
    config(['services.sms' => ['url' => 'https://sms.test/messages', 'token' => 't', 'from' => 'NordicStays']]);
    Http::fake(['sms.test/*' => Http::response(['id' => 'm1'])]);

    $message = messageFor(GuestChannel::Sms);
    app()->call([new SendScheduledMessage($message), 'handle']);

    Http::assertSent(fn (Request $request): bool => $request['to'] === '+4512345678'
        && $request['from'] === 'NordicStays'
        && $request['text'] === "Hi Søren, welcome to {$message->booking->property->name}. See you soon!");
});

it('sends WhatsApp as the approved template, with the values in order', function () {
    config(['services.whatsapp' => ['token' => 't', 'api_version' => 'v21.0', 'phone_number_id' => '10987', 'business_account_id' => '55501']]);
    Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.1']]])]);

    $message = messageFor(GuestChannel::WhatsApp);
    app()->call([new SendScheduledMessage($message), 'handle']);

    Http::assertSent(fn (Request $request): bool => $request['to'] === '4512345678'
        && $request['template']['name'] === 'nordic_1'
        && array_column($request['template']['components'][0]['parameters'], 'text') === ['Søren', $message->booking->property->name]);
});

it('submits a new template to Meta in WhatsApp’s format, and checks again while it is pending', function () {
    config(['services.whatsapp' => ['token' => 't', 'api_version' => 'v21.0', 'phone_number_id' => '10987', 'business_account_id' => '55501']]);
    Http::fake(['graph.facebook.com/v21.0/55501/message_templates' => Http::response(['id' => '9001', 'status' => 'PENDING', 'category' => 'UTILITY'])]);
    $template = MessageTemplate::forceCreate(['account_id' => Property::factory()->create()->account_id, 'name' => 'Arrival', 'trigger' => 'before_check_in', 'days_offset' => -1, 'subject' => 'Tomorrow', 'body' => "Hi {guest_name},\n\nYour door code is {door_code}. See you!"]);

    $job = (new SyncWhatsAppTemplate($template))->withFakeQueueInteractions();
    $job->handle();

    Http::assertSent(fn (Request $request): bool => $request['name'] === "nordic_{$template->id}"
        && $request['components'][0]['text'] === "Hi {{1}},\n\nYour door code is {{2}}. See you!"   // line breaks are fine in the fixed text
        && $request['components'][0]['example']['body_text'] === [['Anna', '4821']]);
    expect($template->fresh()->whatsapp_status)->toBe('pending');
    $job->assertReleased(SyncWhatsAppTemplate::RECHECK_SECONDS);
});

it('refuses a template that starts or ends with a variable', function (string $body) {
    Queue::fake();
    $property = Property::factory()->create();

    $this->actingAs(hostOf($property))->postJson('/api/v1/message-templates', [
        'name' => 'Welcome', 'trigger' => 'booking_confirmed', 'days_offset' => 0, 'subject' => 'Welcome', 'body' => $body,
    ])->assertUnprocessable()->assertJsonValidationErrors('body');
})->with([
    'starts with one' => ['{guest_name}, welcome!'],
    'ends with one' => ['Welcome to {property_name}'],
    'ends with one and a full stop' => ['Welcome to {property_name}.'],
]);`,
      },
      {
        title: 'Older tests send the new required field',
        text: ['The booking form now requires `contact_channel` (part 1). Three earlier test files post a booking without it, so they now send `\'contact_channel\' => \'email\'`; nothing else in them changes.'],
        path: 'tests/Feature/CreateBookingTest.php',
        code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;

// The clock is frozen at 2027-06-01 for every test (tests/Pest.php).
beforeEach(function () {
    $this->property = Property::factory()->create();               // €150.00 a night, up to 4 guests
    $this->host = hostOf($this->property);
});

function bookingInput(array $overrides = []): array
{
    return [
        'check_in' => '2027-07-01', 'check_out' => '2027-07-04', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com', 'contact_channel' => 'email', ...$overrides,
    ];
}

it('creates a pending booking priced per night', function () {
    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", bookingInput())
        ->assertCreated()
        ->assertJsonPath('data.status', 'pending')
        ->assertJsonPath('data.nights', 3)
        ->assertJsonPath('data.total.amount', 45_000);
});

it('rejects invalid input', function (array $input, string $field) {
    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", bookingInput($input))
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'check-out before check-in' => [['check_out' => '2027-06-30'], 'check_out'],
    'in the past' => [['check_in' => '2027-05-30'], 'check_in'],
    'too many guests' => [['guests' => 5], 'guests'],
    'bad email' => [['guest_email' => 'not-an-email'], 'guest_email'],
]);

it('forbids users of another account, and cleaners', function (?MembershipRole $role) {
    $user = $role ? hostOf($this->property, $role) : User::factory()->create();

    $this->actingAs($user)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", bookingInput())
        ->assertForbidden();
})->with(['another account' => [null], 'a cleaner' => [MembershipRole::Cleaner]]);

it('refuses overlapping nights with 409', function () {
    Booking::factory()->for($this->property)->forStay('2027-07-03', 2)->create();

    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", bookingInput())
        ->assertConflict();
});

// Trap 1: green with no overlap check at all; red with the naive "<=" rule.
it('allows a stay that starts on the day the previous one ends', function () {
    Booking::factory()->for($this->property)->forStay('2027-06-28', 3)->create();   // leaves 2027-07-01

    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", bookingInput())
        ->assertCreated();
});

// Trap 2: green with no overlap check at all; red when the rule forgets the status.
it('ignores cancelled bookings', function () {
    Booking::factory()->for($this->property)->forStay('2027-07-01', 3)->cancelled()->create();

    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", bookingInput())
        ->assertCreated();
});`,
      },
      {
        path: 'tests/Feature/PriceQuoterTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Property;
use App\Money\Money;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;

beforeEach(function () {
    $this->property = Property::factory()->create([
        'nightly_rate_cents' => 15_000, 'cleaning_fee_cents' => 6_000, 'weekly_discount_bps' => 1_000, 'tax_rate_bps' => 1_000,
    ]);
    $this->host = hostOf($this->property);
});

it('gives the weekly discount from 7 nights, not before', function (string $checkOut, int $total) {
    $this->getJson("/api/v1/properties/{$this->property->id}/quote?check_in=2027-07-01&check_out={$checkOut}")
        ->assertOk()
        ->assertJsonPath('total.amount', $total);
})->with([
    '6 nights' => ['2027-07-07', 105_600],      // (90000 + 6000) + 10% tax
    '7 nights' => ['2027-07-08', 110_550],
]);

it('charges exactly what the price page showed', function () {
    $shown = $this->getJson("/api/v1/properties/{$this->property->id}/quote?check_in=2027-07-01&check_out=2027-07-08")->json('total.amount');

    $this->actingAs($this->host)->postJson("/api/v1/properties/{$this->property->id}/bookings", [
        'check_in' => '2027-07-01', 'check_out' => '2027-07-08', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com', 'contact_channel' => 'email',
    ])->assertCreated()->assertJsonPath('data.total.amount', $shown);
});

it('builds a host’s custom offer with the same order and the same tax', function () {
    $quote = app(PriceQuoter::class)->customOffer($this->property, Stay::fromDates('2027-07-01', '2027-07-08'), Money::of(13_000, 'EUR'), discountBps: 500);

    expect(array_map(fn (LineItem $line): int => $line->amount->amount, $quote->lines))->toBe([91_000, -4_550, 6_000, 9_245])
        ->and($quote->total()->amount)->toBe(101_695);               // no weekly discount on top of the host's own
});

it('stores every line with the booking', function () {
    $this->actingAs($this->host)->postJson("/api/v1/properties/{$this->property->id}/bookings", [
        'check_in' => '2027-07-01', 'check_out' => '2027-07-08', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com', 'contact_channel' => 'email',
    ]);

    expect($this->property->bookings()->sole()->lineItems()->orderBy('id')->pluck('amount_cents')->all())->toBe([105_000, -10_500, 6_000, 10_050]);
});`,
      },
      {
        path: 'tests/Feature/IcalSyncTest.php',
        code: String.raw`<?php

use App\Channels\Ical\IcalImporter;
use App\Enums\Channel;
use App\Models\ExternalBlock;
use App\Models\IcalFeed;
use App\Models\Property;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;

function ics(string ...$events): string
{
    return "BEGIN:VCALENDAR\r\n" . implode('', $events) . "END:VCALENDAR\r\n";
}

function vevent(string $uid, string $start, string $end, string $summary = 'Reserved'): string
{
    return "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:{$start}\r\nDTEND;VALUE=DATE:{$end}\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\nEND:VEVENT\r\n";
}

beforeEach(function () {
    $this->property = Property::factory()->create();
    $this->airbnb = IcalFeed::forceCreate(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'url' => 'https://airbnb.test/1.ics']);
    $this->bookingCom = IcalFeed::forceCreate(['property_id' => $this->property->id, 'source' => Channel::BookingCom, 'url' => 'https://booking.test/1.ics']);
});

it('saves each event once, by UID, however often it syncs', function () {
    Http::fake(['airbnb.test/*' => Http::response(ics(vevent('a1', '20270710', '20270713'), vevent('a2', '20270801', '20270804', 'Airbnb (Not available)')))]);

    app(IcalImporter::class)->sync($this->airbnb);
    app(IcalImporter::class)->sync($this->airbnb);

    expect(ExternalBlock::orderBy('uid')->pluck('kind', 'uid')->all())->toBe(['a1' => 'reservation', 'a2' => 'blocked']);
});

it('removes a cancelled event, and never touches another channel’s blocks', function () {
    Http::fake([
        'booking.test/*' => Http::response(ics(vevent('b1', '20270720', '20270722', 'CLOSED - Not available'))),
        'airbnb.test/*' => Http::sequence()
            ->push(ics(vevent('a1', '20270710', '20270713'), vevent('a2', '20270801', '20270804')))
            ->push(ics(vevent('a1', '20270710', '20270713'))),                   // a2 was cancelled on Airbnb
    ]);

    app(IcalImporter::class)->sync($this->bookingCom);
    app(IcalImporter::class)->sync($this->airbnb);
    app(IcalImporter::class)->sync($this->airbnb);

    expect(ExternalBlock::orderBy('uid')->pluck('uid')->all())->toBe(['a1', 'b1']);
});

it('keeps every block when the channel fails', function () {
    ExternalBlock::create(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'uid' => 'a1', 'kind' => 'reservation', 'starts_on' => '2027-07-10', 'ends_on' => '2027-07-13']);
    Http::fake(['airbnb.test/*' => Http::response('Service Unavailable', 503)]);

    expect(fn () => app(IcalImporter::class)->sync($this->airbnb))->toThrow(RequestException::class)
        ->and(ExternalBlock::count())->toBe(1);                                  // the incident: nothing deleted
});

it('refuses a direct booking over a channel block', function () {
    ExternalBlock::create(['property_id' => $this->property->id, 'source' => Channel::Airbnb, 'uid' => 'a1', 'kind' => 'reservation', 'starts_on' => '2027-07-10', 'ends_on' => '2027-07-13']);

    $this->actingAs(hostOf($this->property))->postJson("/api/v1/properties/{$this->property->id}/bookings", [
        'check_in' => '2027-07-12', 'check_out' => '2027-07-15', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com', 'contact_channel' => 'email',
    ])->assertConflict();
});`,
      },
    ],
  },
  next: 'Day 4 is done: accounts and roles, send times, messages sent once and stopped on cancellation, date changes that undo themselves, safe variables and every channel. Day 5 starts on Wednesday, when a cleaner walks in while the guests are still asleep.',
};
