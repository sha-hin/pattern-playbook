// Scene 33 · The guest inbox: presence channels, who else is answering, typing whispers, and a server check that never trusts the socket.

export default {
  description: 'Two co-hosts answered the same guest at the same minute with different check-in times: the inbox loaded the conversation once and never showed that a teammate had it open, was typing, or had already replied. Fix it in Laravel with a presence channel per conversation authorised by the account, typing whispers, live new messages, and a 409 when a teammate answered first.',
  incident: {
    channel: '#support',
    when: 'Wednesday 22:10',
    messages: [
      ['Guest (Airbnb) · to the Skagen cottages', '21:41 “Check-in from **15:00**, see you tomorrow!” 21:42 “You can come from **12:00**, the cleaning is done early.” **Which one is it?** We booked a ferry for 11:00.'],
      ['Sofie · co-host', 'I answered 15:00. I had no idea Jonas was in the same conversation. His answer only showed up when I reloaded the page.'],
      ['Karim · developer', 'The inbox fetches the conversation when the page opens, and that’s it. Nobody sees who else has it open, who is typing, or a reply sent a minute ago. Support counts 9 double answers since it went live on Monday.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature: the inbox',
      text: [
        'Every booking has one conversation with its guest. Guest messages arrive from the channels and by email reply, and are stored with `author = guest`; how they are received doesn’t change in this scene. Owners and co-hosts read the thread and reply from the inbox, and the reply goes to the guest on the channel the guest chose (scene 25).',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_22_000002_create_conversation_messages_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversation_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained()->cascadeOnDelete();   // the booking is the conversation
            $table->string('author');                                         // guest or host
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();   // which teammate, for host messages
            $table->text('body');
            $table->timestamps();

            $table->index(['booking_id', 'id']);                              // a thread, in order
        });
    }
};`,
        },
        {
          path: 'app/Enums/MessageAuthor.php',
          code: String.raw`<?php

namespace App\Enums;

enum MessageAuthor: string
{
    case Guest = 'guest';
    case Host = 'host';
}`,
        },
        {
          path: 'app/Models/ConversationMessage.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\MessageAuthor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ConversationMessage extends Model
{
    protected function casts(): array
    {
        return ['author' => MessageAuthor::class];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array{id: int, author: string, by: ?string, body: string, sent_at: string} what the inbox shows */
    public function present(): array
    {
        return [
            'id' => $this->id,
            'author' => $this->author->value,
            'by' => $this->user?->name,                                        // null for the guest
            'body' => $this->body,
            'sent_at' => $this->created_at->toIso8601String(),
        ];
    }
}`,
        },
        {
          path: 'app/Notifications/HostReply.php',
          code: String.raw`<?php

namespace App\Notifications;

use App\Enums\GuestChannel;
use App\Enums\MessageAuthor;
use App\Models\ConversationMessage;
use App\Notifications\Channels\WhatsAppMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class HostReply extends Notification implements ShouldQueue
{
    use Queueable;

    /** WhatsApp lets a business send free text only this long after the guest's last message. */
    public const WHATSAPP_WINDOW_HOURS = 24;

    public function __construct(public ConversationMessage $message)
    {
        $this->afterCommit();                                            // never send a reply that was rolled back
    }

    /** @return list<string> */
    public function via(object $notifiable): array
    {
        $choice = $this->message->booking->guest_channel;

        if ($choice === GuestChannel::WhatsApp && ! $this->guestWroteRecently()) {
            return ['mail'];                                            // outside the window only approved templates may go out
        }

        return [$choice->notificationChannel()];                        // the guest's choice (scene 25)
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage())
            ->subject("Re: your stay at {$this->message->booking->property->name}")
            ->line($this->message->body);                               // escaped by the mail template
    }

    public function toSms(object $notifiable): string
    {
        return $this->message->body;
    }

    public function toWhatsApp(object $notifiable): WhatsAppMessage
    {
        return WhatsAppMessage::text($this->message->body);             // a reply in an open conversation: free text is allowed
    }

    private function guestWroteRecently(): bool
    {
        return ConversationMessage::query()
            ->whereBelongsTo($this->message->booking)
            ->where('author', MessageAuthor::Guest)
            ->where('created_at', '>=', now()->subHours(self::WHATSAPP_WINDOW_HOURS))
            ->exists();
    }
}`,
          after: ['A reply is the host’s own words, not a template Meta has approved, so WhatsApp only takes it while the conversation is open: within 24 hours of the guest’s last message. Outside that window the reply goes by email instead of failing.'],
        },
        {
          title: 'WhatsApp learns to send free text (scene 25 only sent templates)',
          path: 'app/Notifications/Channels/WhatsAppMessage.php',
          code: String.raw`<?php

namespace App\Notifications\Channels;

/** What a notification hands the WhatsApp channel. */
final readonly class WhatsAppMessage
{
    /** @param list<string> $parameters */
    private function __construct(
        public ?string $template,
        public array $parameters,
        public ?string $text,
    ) {
    }

    /** An approved template and its values in order: the only kind a business may send first. @param list<string> $parameters */
    public static function template(string $name, array $parameters): self
    {
        return new self($name, $parameters, null);
    }

    /** Free text: allowed only within 24 hours of the guest's last message to us. */
    public static function text(string $body): self
    {
        return new self(null, [], $body);
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

        $content = $message->text !== null
            ? ['type' => 'text', 'text' => ['body' => $message->text]]
            : ['type' => 'template', 'template' => [
                'name' => $message->template,
                'language' => ['code' => 'en'],
                'components' => $message->parameters === [] ? [] : [[
                    'type' => 'body',
                    'parameters' => array_map(fn (string $value): array => ['type' => 'text', 'text' => $value], $message->parameters),
                ]],
            ]];

        Http::withToken($config['token'])
            ->timeout(10)
            ->post("https://graph.facebook.com/{$config['api_version']}/{$config['phone_number_id']}/messages", [
                'messaging_product' => 'whatsapp',
                'to' => ltrim($to, '+'),                                       // WhatsApp wants the number without "+"
                ...$content,
            ])
            ->throw();
    }
}`,
        },
        {
          path: 'app/Http/Controllers/ConversationController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\MessageAuthor;
use App\Models\Booking;
use App\Models\ConversationMessage;
use App\Notifications\HostReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Notification;

class ConversationController extends Controller
{
    public function index(Booking $booking): JsonResponse
    {
        $messages = ConversationMessage::query()->whereBelongsTo($booking)->with('user:id,name')->orderBy('id')->get();

        return response()->json(['messages' => $messages->map(fn (ConversationMessage $message): array => $message->present())]);
    }

    public function store(Request $request, Booking $booking): JsonResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'max:2000']]);

        $message = ConversationMessage::forceCreate([
            'booking_id' => $booking->id,
            'author' => MessageAuthor::Host,
            'user_id' => $request->user()->id,
            'body' => $data['body'],
        ]);

        Notification::route('mail', $booking->guest_email)
            ->route('sms', $booking->guest_phone)
            ->route('whatsapp', $booking->guest_phone)
            ->notify(new HostReply($message));

        return response()->json($message->load('user:id,name')->present(), 201);
    }
}`,
        },
      ],
    },
    {
      title: 'The broken code',
      text: ['The server did what it was asked. The page is where the conversation stops moving:'],
      blocks: [
        {
          path: 'resources/js/inbox.js',
          broken: true,
          lang: 'js',
          code: String.raw`const bookingId = document.querySelector('meta[name="booking-id"]').content;

window.inbox.load(bookingId);                         // the bug: fetched once; nothing on this screen changes after that

document.querySelector('#reply-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await window.inbox.send(bookingId, event.target.body.value);
    window.inbox.load(bookingId);                     // only the sender ever sees the thread move
});`,
          after: [
            'At 21:40 Sofie and Jonas both opened the guest’s question. Each saw a thread with no answer, typed one, and sent it. Neither page knew about the other, and the server took both, because nothing told it which messages the sender had seen.',
            'Two things are missing, and they are different. The **screen** should show who else is here, who is typing, and new messages as they arrive: that is what makes a double answer rare. The **server** should refuse a reply written without seeing a teammate’s newer one: that is what makes it impossible to send by accident, because a socket can drop and a whisper can be missed.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: a presence channel per conversation',
      text: [
        'A **presence** channel is a private channel that also tells every subscriber who else is subscribed. Laravel authorises it like a private channel (scene 32), with one difference: the callback returns the user’s details instead of `true`, and those details are what the others see.',
        'The channel is per booking, so the account check goes through the booking’s property: a co-host of another account gets the same 403 as on `account.{id}`.',
      ],
      blocks: [
        {
          path: 'routes/channels.php',
          code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('account.{accountId}', function (User $user, int $accountId): bool {
    return in_array($user->roleIn($accountId), [MembershipRole::Owner, MembershipRole::CoHost], true);
});

// Who has a guest conversation open. Laravel finds the booking by id, like a route, before calling this.
Broadcast::channel('conversation.{booking}', function (User $user, Booking $booking): array|false {
    $role = $user->roleIn($booking->property->account_id);

    return in_array($role, [MembershipRole::Owner, MembershipRole::CoHost], true)
        ? ['id' => $user->id, 'name' => $user->name]                   // what teammates see: nothing more
        : false;
});`,
        },
        {
          path: 'app/Events/MessagePosted.php',
          code: String.raw`<?php

namespace App\Events;

use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Foundation\Events\Dispatchable;

final class MessagePosted implements ShouldBroadcast, ShouldDispatchAfterCommit
{
    use Dispatchable;

    public function __construct(
        public readonly int $bookingId,
        public readonly int $messageId,
    ) {
    }

    /** @return list<PresenceChannel> */
    public function broadcastOn(): array
    {
        return [new PresenceChannel("conversation.{$this->bookingId}")];
    }

    public function broadcastAs(): string
    {
        return 'message.posted';
    }

    /** @return array{message_id: int} the screen fetches the thread itself: no guest text goes through the socket */
    public function broadcastWith(): array
    {
        return ['message_id' => $this->messageId];
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: the server refuses a reply that missed a newer one',
      text: [
        'The page sends the id of the newest message on the host’s screen, `seen_up_to`. If a teammate has replied since, the server answers **409** with those replies, and the page shows them: “Jonas answered at 21:42. Send yours anyway?” Sending anyway is allowed, because sometimes a second answer is right.',
        'The check and the insert happen under a lock on the booking row (scene 4), so two replies sent in the same second can’t both pass the check.',
      ],
      blocks: [
        {
          path: 'app/Http/Controllers/ConversationController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\MessageAuthor;
use App\Events\MessagePosted;
use App\Models\Booking;
use App\Models\ConversationMessage;
use App\Notifications\HostReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

class ConversationController extends Controller
{
    public function index(Booking $booking): JsonResponse
    {
        $messages = ConversationMessage::query()->whereBelongsTo($booking)->with('user:id,name')->orderBy('id')->get();

        return response()->json(['messages' => $messages->map(fn (ConversationMessage $message): array => $message->present())]);
    }

    public function store(Request $request, Booking $booking): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:2000'],
            'seen_up_to' => ['required', 'integer', 'min:0'],               // the newest message id on the sender's screen
            'send_anyway' => ['sometimes', 'boolean'],
        ]);

        $result = DB::transaction(function () use ($request, $booking, $data): ConversationMessage|JsonResponse {
            Booking::query()->whereKey($booking->id)->lockForUpdate()->first();   // one reply at a time per conversation

            $missed = ConversationMessage::query()
                ->whereBelongsTo($booking)
                ->where('author', MessageAuthor::Host)
                ->where('id', '>', $data['seen_up_to'])
                ->with('user:id,name')
                ->get();

            if ($missed->isNotEmpty() && ! $request->boolean('send_anyway')) {
                return response()->json([
                    'message' => 'A teammate replied while you were writing.',
                    'replies' => $missed->map(fn (ConversationMessage $message): array => $message->present()),
                ], 409);
            }

            return ConversationMessage::forceCreate([
                'booking_id' => $booking->id,
                'author' => MessageAuthor::Host,
                'user_id' => $request->user()->id,
                'body' => $data['body'],
            ]);
        });

        if ($result instanceof JsonResponse) {
            return $result;                                                    // nothing was saved or sent
        }

        MessagePosted::dispatch($booking->id, $result->id);                    // every open screen fetches the thread
        Notification::route('mail', $booking->guest_email)
            ->route('sms', $booking->guest_phone)
            ->route('whatsapp', $booking->guest_phone)
            ->notify(new HostReply($result));

        return response()->json($result->load('user:id,name')->present(), 201);
    }
}`,
          after: ['Only **host** messages count as missed. A new guest message while you type is the conversation going on, not a teammate answering for you; the screen shows it live, and the reply goes out.'],
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CalendarRulesController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');
    Route::put('/properties/{property}/calendar-rules', CalendarRulesController::class)->can('update', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');
    Route::get('/bookings/{booking}/messages', [ConversationController::class, 'index'])->can('update', 'booking');   // owners and co-hosts: not cleaners
    Route::post('/bookings/{booking}/messages', [ConversationController::class, 'store'])->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);

    Route::post('/message-templates', [MessageTemplateController::class, 'store']);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
          after: ['The inbox was already behind these routes last week; they are shown here because the 409 is new. A cleaner can see a booking (scene 20) but not the guest’s messages, which hold names, phone numbers and door questions.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: the page joins the conversation',
      text: [
        '`Echo.join()` subscribes to the presence channel. `here()` gives the people already on it, `joining()` and `leaving()` the changes. A new message only says "look again", and the page fetches the thread from the API, as the calendar does (scene 32).',
        '**Typing** is a *whisper*: a client event sent from one browser to the others on the channel, straight through Reverb, never touching Laravel. Whispers only work on private and presence channels, so only people who passed the channel check above can send or receive them. A keystroke fires dozens of input events, so the page sends at most one whisper every two seconds, and hides the "typing" line when the whispers stop.',
      ],
      blocks: [
        {
          path: 'resources/js/inbox.js',
          lang: 'js',
          code: String.raw`import './echo';                                      // creates window.Echo, connected to Reverb (scene 32)

const bookingId = document.querySelector('meta[name="booking-id"]').content;
const inbox = window.inbox;                           // renders the thread, the "also here" bar and the typing line

const channel = window.Echo.join(` + '`conversation.${bookingId}`' + String.raw`)
    .here((people) => inbox.showViewers(people))       // [{id, name}, …] from routes/channels.php
    .joining((person) => inbox.addViewer(person))
    .leaving((person) => inbox.removeViewer(person))
    .listen('.message.posted', () => inbox.load(bookingId))
    .listenForWhisper('typing', ({ name }) => inbox.showTyping(name, 4000));   // hidden after 4 s without a new whisper

let lastWhisper = 0;
document.querySelector('#reply-form textarea').addEventListener('input', () => {
    if (Date.now() - lastWhisper < 2000) return;          // at most one whisper every 2 seconds
    lastWhisper = Date.now();
    channel.whisper('typing', { name: inbox.me.name });
});

document.querySelector('#reply-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await inbox.send(bookingId, event.target.body.value, { seenUpTo: inbox.lastMessageId() });

    if (response.status === 409) {
        inbox.showMissedReplies((await response.json()).replies);   // "Jonas answered at 21:42. Send yours anyway?"
        return;
    }
    inbox.load(bookingId);
});

// After a dropped connection, messages sent while we were away were never pushed to us: fetch the thread again.
window.Echo.connector.pusher.connection.bind('connected', () => inbox.load(bookingId));`,
          after: [
            'The whisper carries a name the sender’s browser chose. That is fine for a typing hint among teammates who already passed the account check; nothing the server stores or decides is based on a whisper.',
            'Sofie and Jonas now see each other in the conversation’s header, and “Jonas is typing…” under the thread. If both still send, the second one gets the 409.',
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'A reply that missed a teammate’s is refused, the event carries only an id, and the presence channel checks the account',
    blocks: [
      {
        path: 'tests/Feature/ConversationTest.php',
        code: String.raw`<?php

use App\Enums\GuestChannel;
use App\Enums\MembershipRole;
use App\Enums\MessageAuthor;
use App\Events\MessagePosted;
use App\Models\Booking;
use App\Models\ConversationMessage;
use App\Models\Property;
use App\Notifications\Channels\WhatsAppChannel;
use App\Notifications\HostReply;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;

beforeEach(function () {
    $this->booking = Booking::factory()->for(Property::factory()->create(['name' => 'Skagen cottage']))->create();
    $this->sofie = hostOf($this->booking->property, MembershipRole::CoHost);
    $this->jonas = hostOf($this->booking->property, MembershipRole::CoHost);
    $this->question = ConversationMessage::forceCreate(['booking_id' => $this->booking->id, 'author' => MessageAuthor::Guest, 'body' => 'What time can we check in?']);
});

function replyAs(object $test, object $user, string $body, int $seenUpTo, bool $anyway = false): Illuminate\Testing\TestResponse
{
    return $test->actingAs($user)->postJson("/api/v1/bookings/{$test->booking->id}/messages", ['body' => $body, 'seen_up_to' => $seenUpTo, 'send_anyway' => $anyway]);
}

it('refuses a reply written without seeing a teammate’s newer one', function () {
    Notification::fake();
    replyAs($this, $this->jonas, 'You can come from 12:00.', $this->question->id)->assertCreated();

    replyAs($this, $this->sofie, 'Check-in from 15:00.', $this->question->id)                 // the incident
        ->assertConflict()
        ->assertJsonPath('replies.0.by', $this->jonas->name);

    expect(ConversationMessage::count())->toBe(2);                                        // the question and Jonas's answer
    Notification::assertSentOnDemandTimes(HostReply::class, 1);                            // the guest got one answer
});

it('sends anyway when the host chooses to', function () {
    Notification::fake();
    replyAs($this, $this->jonas, 'You can come from 12:00.', $this->question->id);

    replyAs($this, $this->sofie, 'Sorry, 15:00: the cleaner needs the time.', $this->question->id, anyway: true)->assertCreated();
});

it('does not count a new guest message as a missed reply', function () {
    $more = ConversationMessage::forceCreate(['booking_id' => $this->booking->id, 'author' => MessageAuthor::Guest, 'body' => 'And is there parking?']);

    replyAs($this, $this->sofie, 'Check-in from 15:00, and yes.', $this->question->id)->assertCreated();
    expect($more->id)->toBeGreaterThan($this->question->id);
});

it('tells open screens about a new message with its id only, after commit', function () {
    Event::fake([MessagePosted::class]);
    Notification::fake();

    $id = replyAs($this, $this->sofie, 'Check-in from 15:00.', $this->question->id)->json('id');

    Event::assertDispatched(MessagePosted::class, function (MessagePosted $event) use ($id): bool {
        return $event->broadcastOn() == [new PresenceChannel("conversation.{$this->booking->id}")]
            && $event->broadcastWith() === ['message_id' => $id];                         // no guest text in the socket
    });
});

it('lets the account’s owners and co-hosts join the conversation, by name', function (MembershipRole|null $role, int $status) {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'test-key',
        'broadcasting.connections.reverb.secret' => 'test-secret',
        'broadcasting.connections.reverb.app_id' => 'test',
    ]);
    require base_path('routes/channels.php');

    $user = $role === null ? memberOf(Property::factory()->create()->account, MembershipRole::Owner) : hostOf($this->booking->property, $role);

    $response = $this->actingAs($user)
        ->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "presence-conversation.{$this->booking->id}"])
        ->assertStatus($status);

    if ($status === 200) {
        expect(json_decode($response->json('channel_data'), true)['user_info'])->toBe(['id' => $user->id, 'name' => $user->name]);
    }
})->with([
    'owner' => [MembershipRole::Owner, 200],
    'co-host' => [MembershipRole::CoHost, 200],
    'cleaner' => [MembershipRole::Cleaner, 403],
    'another account’s owner' => [null, 403],
]);

it('replies on WhatsApp only while the guest’s 24-hour window is open', function (int $hoursAgo, string $channel) {
    Notification::fake();
    $this->booking->forceFill(['guest_channel' => GuestChannel::WhatsApp, 'guest_phone' => '+4512345678'])->save();
    $this->question->forceFill(['created_at' => now()->subHours($hoursAgo)])->save();

    replyAs($this, $this->sofie, 'Check-in from 15:00.', $this->question->id)->assertCreated();

    Notification::assertSentOnDemand(HostReply::class, fn (HostReply $n, array $channels): bool => $channels === [$channel]);
})->with([
    'wrote 2 hours ago' => [2, WhatsAppChannel::class],
    'wrote 2 days ago' => [48, 'mail'],
]);

it('keeps the thread from cleaners', function () {
    $this->actingAs(hostOf($this->booking->property, MembershipRole::Cleaner))
        ->getJson("/api/v1/bookings/{$this->booking->id}/messages")
        ->assertForbidden();
});`,
        after: [
          'Mutations: drop the `seen_up_to` check and the first test fails with 201 and two notifications, the incident. Count guest messages as missed too and the third test fails. Return `true` instead of the user’s details from the channel callback, and the presence test fails: Laravel answers 403, because a presence channel must say **who** joined.',
        ],
      },
    ],
  },
  next: 'Day 5 is done: cleanings that follow the calendar, rate plans, copies with their own prices, minimum stays every door knows, rules for single dates, one availability rule, live calendars and an inbox where teammates see each other. Day 6 starts with a properties page that takes four seconds to load.',
};
