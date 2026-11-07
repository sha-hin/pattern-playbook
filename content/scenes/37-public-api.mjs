// Scene 37 · Chain of Responsibility and Pipeline: an Idempotency-Key middleware that answers a retry itself.

export default {
  description: 'A host’s app timed out on Book, retried the same request, and was told the cabin was taken, by the booking its first try had just made; she booked the guest into a second cottage. Fix it in Laravel with an Idempotency-Key middleware: the first request’s response is stored, and a retry with the same key gets that response back without running the action again.',
  incident: {
    channel: '#support',
    when: 'Thursday 17:50',
    messages: [
      ['Mona · support', 'A Hygge Homes host pressed **Book** in the mobile app on a train. It spun, then said **“The property is already booked for some nights between 12 and 15 August.”** She thought it had failed and booked the guest into **Cottage 3** instead.'],
      ['Mona · support', 'The guest now holds Cottage 2 **and** Cottage 3, and got two payment links.'],
      ['Karim · developer', 'The first request booked Cottage 2, but the response never reached the phone. The app retries on a timeout, and the retry hit our availability check: the nights were taken, by itself.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Nothing on the server is wrong on its own. The app does what mobile apps must do on a flaky network: no answer within 10 seconds means try again. And the server answers every request as if it were the first:'],
      blocks: [
        {
          path: 'the request, sent twice',
          broken: true,
          fragment: true,
          lang: 'shell',
          code: String.raw`POST /api/v1/properties/412/bookings
Authorization: Bearer 7|hU2…
{"check_in":"2027-08-12","check_out":"2027-08-15","guests":2,"guest_name":"Lena Berg", …}

# 1st try: 201 Created, booking 9301 … the response is lost in a tunnel
# 2nd try: 409 Conflict, "The property is already booked …"   ← the bug: the server can't tell a retry from a new booking`,
          after: [
            'A POST is not safe to repeat: every time it runs, it creates something. The server needs a way to recognise "this is the same request again". The industry answer is the one Stripe uses, and the one our own Stripe calls already send (scene 9): an **Idempotency-Key** header. The client makes up a random key per user action and sends the same key on every retry of that action.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: a table that remembers each key’s answer',
      blocks: [
        {
          path: 'database/migrations/2026_04_27_000001_create_idempotency_keys_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('key', 100);
            $table->char('fingerprint', 64);                            // what the request was: method, path and body
            $table->unsignedSmallInteger('response_status')->nullable(); // null: the first request is still running
            $table->mediumText('response_body')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'key']);                         // the atomic claim: only one request can insert it
        });
    }
};`,
          after: ['Keys belong to a user: two people can’t collide, and nobody can replay another user’s response by guessing a key.'],
        },
        {
          path: 'app/Models/IdempotencyKey.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;

class IdempotencyKey extends Model
{
    use MassPrunable;

    protected $fillable = ['user_id', 'key', 'fingerprint'];

    /** A retry comes within minutes. After a day the key is forgotten (scene 36's model:prune). */
    public function prunable(): Builder
    {
        return static::query()->where('created_at', '<', now()->subDay());
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: a middleware that answers the retry itself',
      text: [
        'Every request passes through the route’s middleware, one after the other, before it reaches the controller. Each one can do some work and **pass the request on**, or **answer it itself** and stop there. This middleware does both, depending on the key:',
      ],
      blocks: [
        {
          table: [
            ['The key is…', 'The middleware…'],
            ['missing, or the request is not a POST or PATCH', 'passes the request on, as before'],
            ['new', 'claims it, passes the request on, and stores the response'],
            ['done, same request', '**answers with the stored response**: the controller never runs'],
            ['done, different request', 'answers 422: the client reused a key for something else'],
            ['still running', 'answers 409: “try again in a moment”'],
          ],
        },
        {
          path: 'app/Http/Middleware/Idempotent.php',
          code: String.raw`<?php

namespace App\Http\Middleware;

use App\Models\IdempotencyKey;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class Idempotent
{
    public const ABANDONED_AFTER_SECONDS = 60;                         // a first request that never finished (a crash)

    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');

        if ($key === null || ! in_array($request->method(), ['POST', 'PATCH'], true)) {
            return $next($request);                                     // not ours to handle: pass it on
        }

        if (strlen($key) > 100) {
            return response()->json(['message' => 'The Idempotency-Key header is at most 100 characters.'], 400);
        }

        $fingerprint = hash('sha256', $request->method() . ' ' . $request->path() . ' ' . $request->getContent());
        $record = IdempotencyKey::createOrFirst(                       // the unique index decides who is first
            ['user_id' => $request->user()->id, 'key' => $key],
            ['fingerprint' => $fingerprint],
        );

        if (! $record->wasRecentlyCreated) {
            if ($record->fingerprint !== $fingerprint) {
                return response()->json(['message' => 'This Idempotency-Key was already used for a different request.'], 422);
            }

            if ($record->response_status !== null) {
                return response($record->response_body, $record->response_status, [   // answer it here, and stop
                    'Content-Type' => 'application/json',
                    'Idempotent-Replayed' => 'true',
                ]);
            }

            if (! $this->takeOverAbandoned($record)) {
                return response()->json(['message' => 'A request with this Idempotency-Key is still running. Try again in a moment.'], 409);
            }
        }

        try {
            $response = $next($request);                                // pass it on: the rest of the chain and the controller
        } catch (Throwable $e) {
            $record->delete();                                          // nothing was answered: the retry runs it again
            throw $e;
        }

        if ($response->getStatusCode() >= 500) {
            $record->delete();                                          // our failure: a retry should get a real second try
            return $response;
        }

        $record->forceFill(['response_status' => $response->getStatusCode(), 'response_body' => $response->getContent()])->save();

        return $response;
    }

    /** A first request that crashed never stores its answer. Take its key over, once, atomically. */
    private function takeOverAbandoned(IdempotencyKey $record): bool
    {
        return IdempotencyKey::query()
            ->whereKey($record->id)
            ->whereNull('response_status')
            ->where('updated_at', '<', now()->subSeconds(self::ABANDONED_AFTER_SECONDS))
            ->update(['updated_at' => now()]) === 1;                   // two retries at once: only one gets 1
    }
}`,
          after: [
            'A 4xx is stored and replayed like a success: a retry of a request that failed validation fails the same way. A 5xx is never stored: it was our fault, and the retry deserves to run again.',
            'Most exceptions never reach the `catch`. Laravel turns a `BookingConflict` or a `ValidationException` into a response inside `$next()`, so they come back as a 409 or a 422 and are stored like any other answer.',
          ],
        },
        {
          title: 'Every host POST goes through it',
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
use App\Http\Controllers\PropertyController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\Idempotent;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy, retries answered once.
Route::middleware(['auth:sanctum', SetCurrentAccount::class, Idempotent::class])->prefix('v1')->group(function (): void {
    Route::get('/properties', [PropertyController::class, 'index']);             // the current account's properties
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
          after: ['The middleware runs after `auth:sanctum`, so `$request->user()` is always there. The key is optional: a client that doesn’t send one gets the old behaviour. The API documentation tells clients to send one on every POST; the mobile app makes a new UUID each time the host taps Book, and sends the same one on every retry of that tap.'],
        },
      ],
    },
    {
      title: 'The guest with two cottages',
      text: ['Support cancels the Cottage 3 hold, which was never paid, with the normal cancel endpoint, and the cottage is free again on every channel (scene 18). Nothing else needs fixing by hand.'],
    },
  ],
  reveal: {
    names: ['Chain of Responsibility', 'Pipeline'],
    rules: [
      ['Chain of Responsibility', 'A request passes along a chain of handlers. Each one either handles it, or passes it to the next; the sender doesn’t know which one will answer.'],
      ['Pipeline', 'The way Laravel builds that chain: a list of stages, each a function that receives the request and a `$next` that calls the rest of the list.'],
    ],
    points: [
      '`Idempotent` is one handler in the chain. For a retry, it answers itself and the controller never runs; for anything else, it calls `$next($request)` and the request moves on to the next middleware and the controller.',
      'Each middleware does one job (log in, pick the account, check the key, throttle) and knows nothing about the others. Adding a step to every host request is one entry in a list.',
      'A handler can also work on the way **back**: `Idempotent` stores the response after `$next()` returns. Every middleware wraps everything after it.',
    ],
    whenNot: [
      'When every step must always run, in order, with nothing to stop early: that is a list of method calls, not a chain.',
      'For business rules inside one action. A minimum stay (scene 29) is a check in the code that books, not a middleware: the channels and the date change must apply it too.',
    ],
  },
  laravel: {
    title: 'Laravel inside: the Pipeline that runs every middleware',
    text: [
      'Laravel builds the chain by folding the middleware list into one closure, from the last to the first. Each middleware’s `$next` is the closure for everything after it; the innermost closure is the controller.',
    ],
    blocks: [
      {
        path: 'Illuminate/Pipeline/Pipeline.php (simplified)',
        fragment: true,
        code: String.raw`public function then(Closure $destination)
{
    $pipeline = array_reduce(
        array_reverse($this->pipes),                     // fold from the last middleware to the first
        $this->carry(),
        $this->prepareDestination($destination),        // the innermost step: the controller
    );

    return $pipeline($this->passable);                    // call the outermost: auth runs first
}

protected function carry()
{
    return fn ($stack, $pipe) => fn ($passable) => app($pipe)->handle($passable, $stack);   // $stack is "$next"
}`,
        after: ['The same class works outside HTTP: `Pipeline::send($booking)->through([...])->thenReturn()` runs any list of stages over any value. Laravel uses it for job middleware too, which is how `WithoutOverlapping` and `RateLimited` (scene 17) wrap a job.'],
      },
    ],
  },
  tests: {
    summary: 'The incident, a key reused for another request, a request still running, a crashed one, and keys per user',
    blocks: [
      {
        path: 'tests/Feature/IdempotencyTest.php',
        code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\IdempotencyKey;
use App\Models\Property;
use App\Models\User;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    $this->cottage = Property::factory()->create(['name' => 'Cottage 2']);
    $this->host = hostOf($this->cottage);
    $this->booking = [
        'check_in' => '2027-08-12', 'check_out' => '2027-08-15', 'guests' => 2,
        'guest_name' => 'Lena Berg', 'guest_email' => 'lena@example.com', 'contact_channel' => 'email',
    ];
});

/** What the middleware computes for this booking request: method, path and the JSON body postJson() sends. */
function fingerprintOf(array $data): string
{
    return hash('sha256', 'POST api/v1/properties/' . test()->cottage->id . '/bookings ' . json_encode($data));
}

function book(array $data, string $key, ?User $user = null): TestResponse
{
    return test()->actingAs($user ?? test()->host)
        ->withHeader('Idempotency-Key', $key)
        ->postJson('/api/v1/properties/' . test()->cottage->id . '/bookings', $data);
}

it('answers a retry with the first response, and books once', function () {
    $first = book($this->booking, 'tap-5c1e')->assertCreated();
    $retry = book($this->booking, 'tap-5c1e')->assertCreated();                // the incident: 201, not 409

    expect($retry->json('data.id'))->toBe($first->json('data.id'))
        ->and($retry->headers->get('Idempotent-Replayed'))->toBe('true')
        ->and(Booking::count())->toBe(1);
});

it('refuses a key reused for a different request', function () {
    book($this->booking, 'tap-5c1e')->assertCreated();

    book([...$this->booking, 'check_out' => '2027-08-16'], 'tap-5c1e')->assertUnprocessable();
});

it('answers 409 while the first request with the key is still running', function () {
    IdempotencyKey::forceCreate(['user_id' => $this->host->id, 'key' => 'tap-5c1e', 'fingerprint' => fingerprintOf($this->booking)]);   // claimed, no answer yet

    book($this->booking, 'tap-5c1e')->assertConflict();

    expect(Booking::count())->toBe(0);
});

it('runs the request again when the first one crashed and never answered', function () {
    $stale = IdempotencyKey::forceCreate(['user_id' => $this->host->id, 'key' => 'tap-5c1e', 'fingerprint' => fingerprintOf($this->booking)]);
    $stale->forceFill(['updated_at' => now()->subMinutes(2)])->saveQuietly();

    book($this->booking, 'tap-5c1e')->assertCreated();
});

it('keeps each user’s keys apart', function () {
    $coHost = hostOf($this->cottage, MembershipRole::CoHost);
    book($this->booking, 'tap-5c1e')->assertCreated();

    book([...$this->booking, 'check_in' => '2027-09-01', 'check_out' => '2027-09-04'], 'tap-5c1e', $coHost)->assertCreated();   // her own key, her own booking
});`,
        after: ['`json_encode($data)` is exactly the body `postJson()` sends, which is why `fingerprintOf()` matches what the middleware computes.'],
      },
    ],
  },
  next: 'Retries are safe now. Next, a cleaning company’s nightly sync misses three bookings, and nobody cleans Villa Sol before the next guests arrive.',
};
