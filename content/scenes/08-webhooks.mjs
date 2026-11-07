// Scene 8 · Stripe webhooks, and a Simple Factory that turns payloads into typed events.

export default {
  description: 'A guest paid but her booking stayed pending, because confirmation depended on the browser coming back. Fix it with Stripe webhooks in Laravel: verify the signature, store the event, answer 200, process it in a queued job, and turn payloads into typed events with a Simple Factory.',
  incident: {
    channel: '#support',
    when: 'Tuesday 21:15',
    messages: [
      ['Mona · support', 'A guest paid €1,105.50 for the Nyhavn flat. Stripe shows **succeeded**. Our system shows the booking as **pending**, and in 10 minutes the hold expires and the dates go back on sale.'],
      ['Karim · developer', 'Her phone lost signal right after paying. We confirm bookings on the page Stripe redirects back to, and she never came back to it.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/PaymentReturnController.php (before)',
          broken: true, fragment: true,
          code: String.raw`// Stripe redirects the guest's browser here after the payment
public function __invoke(Request $request, BookingConfirmation $confirmation)
{
    $payment = Payment::where('provider_payment_id', $request->query('payment_intent'))->firstOrFail();
    $confirmation->confirm($payment->booking, $payment);

    return view('bookings.thank-you');
}`,
          after: [
            'The browser is not a reliable messenger. A closed tab, a dead battery or a lost connection, and the confirmation never happens. Worse: anyone can open this URL with someone else’s `payment_intent` in it.',
            'Stripe offers a reliable messenger: a **webhook**. Stripe’s servers call ours with every event, sign the request, and retry for up to three days until we answer 2xx.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: store first, process later',
      text: [
        'A webhook handler has three jobs, in this order: prove the request came from Stripe, **store** it, and answer **200 fast**. The actual work happens afterwards, in a queued job. If the work fails, the event is safe in our database and the job retries; if we did the work before answering and it was slow, Stripe would time out and send the same event again.',
      ],
      blocks: [
        {
          title: 'The inbox table',
          text: ['`unique(provider, event_id)` is what makes a duplicate delivery harmless: Stripe can send the same event twice, and the second insert is refused.'],
          path: 'database/migrations/2026_02_03_000001_create_webhook_events_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->id();
            $table->string('provider');                           // stripe; Day 3 adds airbnb, booking_com
            $table->string('event_id');                           // the provider's id, e.g. evt_1Q...
            $table->string('type');                               // payment_intent.succeeded
            $table->json('payload');
            $table->string('status')->default('received');        // received, processed, failed
            $table->text('error')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
            $table->unique(['provider', 'event_id']);
        });
    }
};`,
        },
        {
          path: 'app/Models/WebhookEvent.php · app/Enums/WebhookStatus.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\WebhookStatus;
use Illuminate\Database\Eloquent\Model;

class WebhookEvent extends Model
{
    protected $fillable = ['provider', 'event_id', 'type', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'status' => WebhookStatus::class, 'processed_at' => 'datetime'];
    }

    public function markProcessed(): void
    {
        $this->forceFill(['status' => WebhookStatus::Processed, 'processed_at' => now(), 'error' => null])->save();
    }

    public function markFailed(string $error): void
    {
        $this->forceFill(['status' => WebhookStatus::Failed, 'error' => $error])->save();
    }
}`,
        },
        {
          path: 'app/Enums/WebhookStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum WebhookStatus: string
{
    case Received = 'received';
    case Processed = 'processed';
    case Failed = 'failed';
}`,
        },
        {
          title: 'The endpoint',
          text: [
            '`Webhook::constructEvent()` from Stripe’s SDK checks the `Stripe-Signature` header: an HMAC of the raw body with our webhook secret, plus a timestamp it rejects if older than 5 minutes, so a captured request can’t be replayed later. Anything that fails gets a 400 and is never stored.',
            '`createOrFirst()` inserts the row, or returns the existing one when the unique index refuses a duplicate (see how below). Only a new row dispatches the job.',
          ],
          path: 'app/Http/Controllers/StripeWebhookController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessStripeWebhook;
use App\Models\WebhookEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Stripe\Exception\SignatureVerificationException;
use Stripe\Webhook;
use UnexpectedValueException;

class StripeWebhookController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        try {
            $event = Webhook::constructEvent(
                $request->getContent(),                                  // the raw body: re-encoding JSON would break the signature
                (string) $request->header('Stripe-Signature'),
                config('services.stripe.webhook_secret'),
            );
        } catch (SignatureVerificationException|UnexpectedValueException) {
            return response()->json(['message' => 'Invalid signature.'], 400);
        }

        $webhook = WebhookEvent::createOrFirst(
            ['provider' => 'stripe', 'event_id' => $event->id],
            ['type' => $event->type, 'payload' => json_decode($request->getContent(), true, flags: JSON_THROW_ON_ERROR)],
        );

        if ($webhook->wasRecentlyCreated) {
            ProcessStripeWebhook::dispatch($webhook);                    // the work happens after we answer
        }

        return response()->json(['received' => true]);
    }
}`,
        },
        {
          path: 'routes/api.php · config/services.php · .env',
          lang: 'shell',
          code: String.raw`# routes/api.php (API routes have no CSRF check, which Stripe couldn't pass)
Route::post('/webhooks/stripe', StripeWebhookController::class);

# config/services.php, in the stripe array
'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),

# .env (from the Stripe dashboard, or "stripe listen" locally)
STRIPE_WEBHOOK_SECRET=whsec_...`,
          after: ['The return page stays, but only shows "Thanks, we’re confirming your payment". It no longer confirms anything.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: from a payload to an event we can trust',
      text: [
        'A Stripe payload is a deep array whose shape depends on its `type`. Reading `$payload[\'data\'][\'object\'][\'amount_received\']` all over the job is how typos and silent nulls get in. One class reads the array **once** and creates a small typed object for each type we act on.',
      ],
      blocks: [
        {
          title: 'The typed events',
          path: 'app/Payments/Events/PaymentSucceeded.php · PaymentFailed.php',
          code: String.raw`<?php

namespace App\Payments\Events;

use App\Money\Money;

final readonly class PaymentSucceeded
{
    public function __construct(
        public string $paymentIntentId,
        public Money $amount,
    ) {
    }
}`,
        },
        {
          path: 'app/Payments/Events/PaymentFailed.php',
          code: String.raw`<?php

namespace App\Payments\Events;

final readonly class PaymentFailed
{
    public function __construct(
        public string $paymentIntentId,
        public string $reason,                                // e.g. "Your card has insufficient funds."
    ) {
    }
}`,
        },
        {
          title: 'The factory',
          text: ['One static method, one `match`: the event type decides which class is created. A type we don’t act on returns `null`, so a new event Stripe adds can never break the job.'],
          path: 'app/Payments/Events/StripeEventFactory.php',
          code: String.raw`<?php

namespace App\Payments\Events;

use App\Money\Money;

final class StripeEventFactory
{
    /** @param array{type: string, data: array{object: array<string, mixed>}} $payload */
    public static function fromPayload(array $payload): PaymentSucceeded|PaymentFailed|null
    {
        $intent = $payload['data']['object'];

        return match ($payload['type']) {
            'payment_intent.succeeded' => new PaymentSucceeded(
                $intent['id'],
                Money::of($intent['amount_received'], strtoupper($intent['currency'])),   // Stripe sends "eur"
            ),
            'payment_intent.payment_failed' => new PaymentFailed(
                $intent['id'],
                $intent['last_payment_error']['message'] ?? 'Unknown reason',
            ),
            default => null,
        };
    }
}`,
        },
        {
          title: 'The job does the work',
          text: [
            'It confirms through scene 6’s facade, so a webhook confirmation runs exactly the same steps as any other. Before confirming, it checks that Stripe received **the amount we asked for**: a mismatch stops the job instead of confirming a booking that is underpaid.',
            'If anything throws, the queue retries with growing pauses. After the last try, `failed()` marks the event, so support can see it in the inbox table.',
          ],
          path: 'app/Jobs/ProcessStripeWebhook.php',
          code: String.raw`<?php

namespace App\Jobs;

use App\Bookings\BookingConfirmation;
use App\Enums\PaymentStatus;
use App\Models\Payment;
use App\Models\WebhookEvent;
use App\Money\Money;
use App\Payments\Events\PaymentFailed;
use App\Payments\Events\PaymentSucceeded;
use App\Payments\Events\StripeEventFactory;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;
use UnexpectedValueException;

class ProcessStripeWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public WebhookEvent $webhook)
    {
    }

    /** @return list<int> seconds to wait before each retry */
    public function backoff(): array
    {
        return [10, 60, 300, 900];
    }

    public function handle(BookingConfirmation $confirmation): void
    {
        $event = StripeEventFactory::fromPayload($this->webhook->payload);

        if ($event instanceof PaymentSucceeded) {
            $payment = $this->payment($event->paymentIntentId);
            $expected = Money::of($payment->amount_cents, $payment->currency);

            if (! $event->amount->equals($expected)) {
                throw new UnexpectedValueException("Stripe received {$event->amount->format()} for payment {$payment->id}, expected {$expected->format()}.");
            }

            $confirmation->confirm($payment->booking, $payment);
        }

        if ($event instanceof PaymentFailed) {
            $payment = $this->payment($event->paymentIntentId);
            $payment->status = PaymentStatus::Failed;
            $payment->save();
        }

        $this->webhook->markProcessed();                       // also for types we don't act on
    }

    public function failed(Throwable $exception): void
    {
        $this->webhook->markFailed($exception->getMessage());
    }

    private function payment(string $paymentIntentId): Payment
    {
        return Payment::where('provider_payment_id', $paymentIntentId)->firstOrFail();
    }
}`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Simple Factory'],
    rules: [['Simple Factory', 'One place that decides which class to create from some input, so the rest of the code receives a ready, typed object and never repeats that decision.']],
    points: [
      'The rest of the app never touches the raw array again. The job works with `PaymentSucceeded`, whose `amount` is already a `Money`.',
      'Supporting a new event type is one new class and one new `match` arm, in one file.',
      'It’s the simplest factory there is: a static method with a `match`. Day 3 meets its bigger relative, Abstract Factory, where the choice itself needs to vary.',
    ],
    whenNot: [
      'When there is only one possible class. `new PaymentSucceeded(...)` at the one place that needs it is enough.',
      'Don’t make the factory fetch data or do work. It only turns input into objects.',
    ],
  },
  laravel: {
    title: 'Laravel inside: why createOrFirst() needs the unique index',
    text: [
      '`firstOrCreate()` runs a SELECT, then an INSERT if nothing came back: the same "check, then insert" race as scene 4, so two deliveries of one event a millisecond apart could both insert. `createOrFirst()` flips the order: it **inserts first** and lets the unique index decide. Only when the database refuses the duplicate does it read the existing row.',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/Eloquent/Builder.php',
        fragment: true,
        code: String.raw`public function createOrFirst(array $attributes = [], array $values = [])
{
    try {
        return $this->withSavepointIfNeeded(fn () => $this->create(array_merge($attributes, $values)));
    } catch (UniqueConstraintViolationException $e) {
        return $this->useWritePdo()->where($attributes)->first() ?? throw $e;   // read from the primary, not a replica
    }
}`,
        after: ['Without `unique(provider, event_id)` there is no violation to catch, and `createOrFirst()` would happily insert duplicates. The index **is** the guarantee; the method only uses it.'],
      },
    ],
  },
  tests: {
    summary: 'Signature, storage, duplicates, confirmation and the amount check',
    text: ['The test signs payloads the way Stripe does: an HMAC-SHA256 of `timestamp.body` with the webhook secret from the [test environment](F#phpunit).'],
    blocks: [
      {
        path: 'tests/Feature/StripeWebhookTest.php',
        code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Enums\WebhookStatus;
use App\Jobs\ProcessStripeWebhook;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\WebhookEvent;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;

function stripeEvent(string $type, array $object, string $id = 'evt_test_1'): array
{
    return ['id' => $id, 'type' => $type, 'data' => ['object' => $object]];
}

function postStripe(array $event, ?string $secret = null): TestResponse
{
    $body = json_encode($event, JSON_THROW_ON_ERROR);
    $timestamp = time();
    $signature = hash_hmac('sha256', "{$timestamp}.{$body}", $secret ?? config('services.stripe.webhook_secret'));

    return test()->call('POST', '/api/webhooks/stripe', server: [
        'HTTP_STRIPE_SIGNATURE' => "t={$timestamp},v1={$signature}",
        'CONTENT_TYPE' => 'application/json',
    ], content: $body);
}

it('rejects a request Stripe did not sign', function () {
    postStripe(stripeEvent('payment_intent.succeeded', ['id' => 'pi_1']), secret: 'whsec_wrong')->assertStatus(400);

    expect(WebhookEvent::count())->toBe(0);
});

it('stores the event, answers 200 and queues the work once, even when delivered twice', function () {
    Queue::fake();
    $event = stripeEvent('payment_intent.succeeded', ['id' => 'pi_1']);

    postStripe($event)->assertOk();
    postStripe($event)->assertOk();

    expect(WebhookEvent::count())->toBe(1);
    Queue::assertPushedTimes(ProcessStripeWebhook::class, 1);
});

it('confirms the booking when the payment succeeds', function () {
    Notification::fake();
    $booking = Booking::factory()->pending()->create();
    Payment::factory()->for($booking)->create(['provider_payment_id' => 'pi_1', 'amount_cents' => 110_550, 'currency' => 'EUR']);

    postStripe(stripeEvent('payment_intent.succeeded', ['id' => 'pi_1', 'amount_received' => 110_550, 'currency' => 'eur']))->assertOk();

    expect($booking->fresh()->status)->toBe(BookingStatus::Confirmed)
        ->and(WebhookEvent::sole()->status)->toBe(WebhookStatus::Processed);
});

it('refuses to confirm when Stripe received a different amount', function () {
    $booking = Booking::factory()->pending()->create();
    Payment::factory()->for($booking)->create(['provider_payment_id' => 'pi_1', 'amount_cents' => 110_550, 'currency' => 'EUR']);
    $webhook = WebhookEvent::create([
        'provider' => 'stripe', 'event_id' => 'evt_1', 'type' => 'payment_intent.succeeded',
        'payload' => stripeEvent('payment_intent.succeeded', ['id' => 'pi_1', 'amount_received' => 100, 'currency' => 'eur']),
    ]);

    expect(fn () => app()->call([new ProcessStripeWebhook($webhook), 'handle']))->toThrow(UnexpectedValueException::class)
        ->and($booking->fresh()->status)->toBe(BookingStatus::Pending);
});`,
      },
      {
        path: 'tests/Unit/StripeEventFactoryTest.php',
        code: String.raw`<?php

use App\Payments\Events\PaymentFailed;
use App\Payments\Events\PaymentSucceeded;
use App\Payments\Events\StripeEventFactory;

it('creates a typed event for each type we act on', function () {
    $succeeded = StripeEventFactory::fromPayload(['type' => 'payment_intent.succeeded', 'data' => ['object' => ['id' => 'pi_1', 'amount_received' => 110_550, 'currency' => 'eur']]]);
    $failed = StripeEventFactory::fromPayload(['type' => 'payment_intent.payment_failed', 'data' => ['object' => ['id' => 'pi_2', 'last_payment_error' => ['message' => 'Card declined.']]]]);

    expect($succeeded)->toBeInstanceOf(PaymentSucceeded::class)
        ->and($succeeded->amount->amount)->toBe(110_550)
        ->and($succeeded->amount->currency->value)->toBe('EUR')
        ->and($failed)->toBeInstanceOf(PaymentFailed::class)
        ->and($failed->reason)->toBe('Card declined.');
});

it('ignores types we do not act on', function () {
    expect(StripeEventFactory::fromPayload(['type' => 'customer.created', 'data' => ['object' => []]]))->toBeNull();
});`,
      },
      {
        path: 'phpunit.xml (one line added)',
        lang: 'xml',
        code: String.raw`<env name="STRIPE_WEBHOOK_SECRET" value="whsec_test"/>`,
      },
    ],
  },
  next: 'Payments now confirm reliably. Wednesday: a guest’s payment arrives 2 minutes after her hold expired, and the job can’t decide what to do.',
};
