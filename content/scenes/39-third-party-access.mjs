// Scene 39 · Tokens for third parties: abilities, expiry, one account, a budget per token, JSON errors, and when OAuth is the answer.

export default {
  description: 'A channel manager cancelled 14 bookings in two seconds with a token its host had pasted in: every API token could do everything the host could, forever. Fix it in Laravel with Sanctum token abilities checked on every route, expiry, a token bound to one account, a rate limit per token with 429 and Retry-After, JSON errors for every API client, and a look at when OAuth with Passport is the right tool.',
  incident: {
    channel: '#support',
    when: 'Tuesday 07:55',
    messages: [
      ['Peter · host, 8 cabins in Ebeltoft', '**14 of my bookings** were cancelled between 02:10 and 02:12 last night. The guests got cancellation emails and refunds. I didn’t touch anything.'],
      ['Mona · support', 'Our log says it was Peter: **his API token**, the one he named “RateBridge”. Eleven guests have written to us already. We are rebooking them by phone.'],
      ['Karim · developer', 'RateBridge is his channel manager. On Monday he made a token on the API access page and pasted it in. Every token we make can do everything the host can, and never expires. RateBridge shipped a bug that treats bookings it doesn’t know as cancelled, and our API said yes 14 times in two seconds.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Monday’s API access page. Hosts asked for it so partners like Hjem Rengøring (scene 38) could read their bookings:'],
      blocks: [
        {
          path: 'app/Http/Controllers/ApiTokenController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\MembershipRole;
use App\Models\Account;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ApiTokenController extends Controller
{
    public function store(Request $request, Account $account): JsonResponse
    {
        abort_unless($request->user()->roleIn($account->id) === MembershipRole::Owner, 403, 'Only owners can create API tokens.');
        $data = $request->validate(['name' => ['required', 'string', 'max:60']]);

        $token = $request->user()->createToken($data['name']);           // the bug: abilities default to ['*'], and no expiry

        return response()->json(['token' => $token->plainTextToken], 201);
    }

    public function destroy(Request $request, int $tokenId): JsonResponse
    {
        $request->user()->tokens()->whereKey($tokenId)->delete();          // only the user's own tokens

        return response()->json(status: 204);
    }
}`,
          after: [
            '`createToken()` with one argument makes a token with the abilities `[\'*\']`: everything. The token belongs to Peter, who owns the account, so every policy says yes too: `Gate::before` lets an owner do anything in his account (scene 20). A token is the **user**, with no limit of its own.',
            'Three more things the token didn’t have. An **end**: it works until someone deletes it. An **account**: it follows Peter’s `current_account_id`, so if he switches accounts in the web app, RateBridge would start reading the other one. And a **budget**: 14 cancellations in two seconds is not a human, and nothing slowed it down.',
          ],
        },
      ],
    },
    {
      title: 'The design: what a token for someone else must carry',
      blocks: [
        {
          table: [
            ['Limit', 'How', 'Laravel'],
            ['**What** it may do', 'A list of abilities chosen by the host, checked on every route', 'Sanctum’s `createToken($name, $abilities)`, `tokenCan()`'],
            ['**Until when**', 'Required expiry, at most a year', '`createToken(…, expiresAt: …)`; Sanctum refuses an expired token with 401'],
            ['**Where**', 'The account it was made in, never the host’s current one', 'An `account_id` on the token, read by `SetCurrentAccount`'],
            ['**How fast**', 'Its own budget per minute, separate from the host’s apps', '`RateLimiter::for()`, `throttle`, 429 with `Retry-After`'],
          ],
          after: ['Our own web and mobile apps keep full access: the mobile app’s token is created at login with `[\'*\']`, and the web app logs in with a session. Abilities are for credentials we hand to someone else.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: abilities from a fixed list, an expiry and an account',
      blocks: [
        {
          path: 'app/Enums/TokenAbility.php',
          code: String.raw`<?php

namespace App\Enums;

/** What an integration token may do. Each route names the one it needs (routes/api.php). */
enum TokenAbility: string
{
    case PropertiesRead = 'properties:read';
    case PropertiesWrite = 'properties:write';
    case CalendarWrite = 'calendar:write';                             // stay rules and date rules
    case BookingsRead = 'bookings:read';
    case BookingsWrite = 'bookings:write';                             // create, move, change, cancel
    case MessagesRead = 'messages:read';
    case MessagesWrite = 'messages:write';
    case TeamWrite = 'team:write';
    case TemplatesWrite = 'templates:write';
}`,
          after: ['There is no case for `*`. The validation below only accepts cases of this enum, so a host can’t hand out full access, even by asking for it.'],
        },
        {
          path: 'database/migrations/2026_04_29_000001_add_account_to_personal_access_tokens_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->foreignId('account_id')->nullable()->after('tokenable_id')   // null: our own apps, which follow the user
                ->constrained()->cascadeOnDelete();
        });
    }
};`,
        },
        {
          path: 'app/Http/Controllers/ApiTokenController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\MembershipRole;
use App\Enums\TokenAbility;
use App\Models\Account;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ApiTokenController extends Controller
{
    public const MAX_DAYS = 365;

    public function store(Request $request, Account $account): JsonResponse
    {
        abort_unless($request->user()->roleIn($account->id) === MembershipRole::Owner, 403, 'Only owners can create API tokens.');
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'abilities' => ['required', 'array', 'min:1'],
            'abilities.*' => ['distinct', Rule::enum(TokenAbility::class)],         // never '*'
            'expires_in_days' => ['required', 'integer', 'min:1', 'max:' . self::MAX_DAYS],
        ]);

        $token = $request->user()->createToken($data['name'], $data['abilities'], now()->addDays($data['expires_in_days']));
        $token->accessToken->forceFill(['account_id' => $account->id])->save();    // this account, whatever the host switches to

        return response()->json([
            'token' => $token->plainTextToken,                                      // shown once: only its hash is stored
            'abilities' => $token->accessToken->abilities,
            'expires_at' => $token->accessToken->expires_at->toIso8601String(),
        ], 201);
    }

    public function destroy(Request $request, int $tokenId): JsonResponse
    {
        $request->user()->tokens()->whereKey($tokenId)->delete();                  // only the user's own tokens

        return response()->json(status: 204);
    }
}`,
        },
        {
          title: 'The account comes from the token when the token has one',
          path: 'app/Http/Middleware/SetCurrentAccount.php',
          code: String.raw`<?php

namespace App\Http\Middleware;

use App\Models\Account;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class SetCurrentAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $user?->currentAccessToken();

        $accountId = $token instanceof PersonalAccessToken && $token->account_id !== null
            ? $token->account_id                                     // an integration token: only the account it was made in
            : $user?->current_account_id;                            // our apps: the account the user picked
        $account = $accountId ? Account::find($accountId) : null;

        if ($account === null || $user->roleIn($account->id) === null) {
            abort(403, 'Choose an account you are a member of.');   // also when the token's host has left the account
        }

        app()->instance(Account::class, $account);              // anything that asks for "Account" gets this one

        return $next($request);
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 2: every route says which ability it needs',
      text: [
        'Sanctum ships `abilities` and `ability` middleware, and they are the right tool when **every** request to a route carries a token. Ours don’t: the web app logs in with a session, and every feature test in this course logs in with `actingAs()`, which has no token at all; Sanctum’s middleware answers those with 401. What we need is narrower: *if* the request carries a personal access token, that token must allow this. A few lines:',
      ],
      blocks: [
        {
          path: 'app/Http/Middleware/RequireTokenAbility.php',
          code: String.raw`<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\Exceptions\MissingAbilityException;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class RequireTokenAbility
{
    /** Usage on a route: ->middleware('token-can:bookings:write'). Sessions have no token and pass. */
    public function handle(Request $request, Closure $next, string $ability): Response
    {
        $token = $request->user()?->currentAccessToken();

        if ($token instanceof PersonalAccessToken && ! $token->can($ability)) {
            throw new MissingAbilityException([$ability]);           // 403, before the controller runs
        }

        return $next($request);
    }
}`,
          after: ['`can()` is true for a token with `*`, so the mobile app passes every route. `token-can:*` on a route therefore means "full-access tokens only", which is what minting new tokens needs.'],
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\BookingChangesController;
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
use App\Http\Controllers\V2\BookingChangesController as BookingChangesV2Controller;
use App\Http\Middleware\Deprecated;
use App\Http\Middleware\Idempotent;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, limited per token, every id checked by a policy,
// and each route names what an integration token must be allowed to do (scene 39). Retries are answered once.
Route::middleware(['auth:sanctum', 'throttle:api', SetCurrentAccount::class, Idempotent::class])->prefix('v1')->group(function (): void {
    Route::get('/properties', [PropertyController::class, 'index'])->middleware('token-can:properties:read');             // the current account's properties
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property')->middleware('token-can:bookings:write');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property')->middleware('token-can:properties:write');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property')->middleware('token-can:calendar:write');
    Route::put('/properties/{property}/calendar-rules', CalendarRulesController::class)->can('update', 'property')->middleware('token-can:calendar:write');

    Route::get('/bookings', [BookingController::class, 'index'])->middleware('token-can:bookings:read');
    Route::get('/bookings/changes', BookingChangesController::class)               // before {booking}: "changes" is not an id
        ->middleware(['token-can:bookings:read', Deprecated::class . ':2027-06-03,2027-12-01,/api/v2/bookings/changes']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking')->middleware('token-can:bookings:read');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking')->middleware('token-can:bookings:write');
    Route::get('/bookings/{booking}/messages', [ConversationController::class, 'index'])->can('update', 'booking')->middleware('token-can:messages:read');   // owners and co-hosts: not cleaners
    Route::post('/bookings/{booking}/messages', [ConversationController::class, 'store'])->can('update', 'booking')->middleware('token-can:messages:write');

    Route::post('/members', [AccountMemberController::class, 'store'])->middleware('token-can:team:write');         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy'])->middleware('token-can:team:write');

    Route::post('/message-templates', [MessageTemplateController::class, 'store'])->middleware('token-can:templates:write');

    Route::post('/api-tokens', [ApiTokenController::class, 'store'])->middleware('token-can:*');            // a limited token can't mint tokens
    Route::delete('/api-tokens/{tokenId}', [ApiTokenController::class, 'destroy'])->middleware('token-can:*');
});

// v2: only what changed in a breaking way. Everything else stays on v1, which is not going away.
Route::middleware(['auth:sanctum', 'throttle:api', SetCurrentAccount::class])->prefix('v2')->group(function (): void {
    Route::get('/bookings/changes', BookingChangesV2Controller::class)->middleware('token-can:bookings:read');
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
// No throttle here: a burst of webhooks after a channel outage must all be stored (scene 8).
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
          after: [
            'The ability check sits **next to** the policy, not inside it. The policy answers "may Peter do this?", and for an owner it is always yes. The ability answers "did Peter let this token do it?". RateBridge’s token now has `bookings:read` and `calendar:write`: its 14 cancellations would have been 14 × 403.',
            'A route added later without `token-can` is open to every token that reaches it. The arch test in scene 47 is where a rule like "every route in the v1 group names an ability" belongs, so a review doesn’t have to remember it.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 3: a budget per token, and errors every client can read',
      text: [
        '`throttle:api` runs the limiter named `api`. An integration token gets 60 requests a minute of its own, keyed by the token, so one partner’s loop can’t use up the host’s budget or another partner’s. Our own apps get 300 per user. Over the limit, Laravel answers **429** with `Retry-After` in seconds.',
        'The webhooks are deliberately **not** throttled: after a channel outage, Airbnb sends every queued webhook at once, and each one must be stored (scene 8).',
      ],
      blocks: [
        {
          path: 'app/Providers/AppServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use App\Channels\ChannelManager;
use App\Enums\MembershipRole;
use App\Http\Controllers\QuoteController;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;
use App\Payments\PaymentGateway;
use App\Payments\StripeGateway;
use App\Pricing\CachedNightlyRates;
use App\Pricing\NightlyPrices;
use App\Pricing\NightlyRates;
use App\Pricing\PriceQuoter;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Stripe\StripeClient;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(StripeClient::class, fn (): StripeClient => new StripeClient([
            'api_key' => config('services.stripe.secret'),
            'stripe_version' => config('services.stripe.version'),    // pinned: a Stripe release can't change responses
            'max_network_retries' => 2,
        ]));

        $this->app->bind(PaymentGateway::class, StripeGateway::class);

        $this->app->singleton(ChannelManager::class);                  // one manager: each driver is built once per process

        $this->app->bind(NightlyPrices::class, NightlyRates::class);    // the truth, from the database: bookings, changes, refunds

        $this->app->when(QuoteController::class)                         // the one place that may show a cached price
            ->needs(PriceQuoter::class)
            ->give(fn (Application $app): PriceQuoter => new PriceQuoter($app->make(CachedNightlyRates::class)));
    }

    public function boot(): void
    {
        Date::use(CarbonImmutable::class);                        // every date Laravel creates is immutable (scene 1)
        Model::shouldBeStrict(! $this->app->isProduction());     // lazy loading, unknown and unfillable attributes throw

        if ($this->app->isProduction()) {
            Model::preventLazyLoading();                          // detect it in production too, but don't throw:
            Model::handleLazyLoadingViolationUsing(function (Model $model, string $relation): void {
                Log::warning('Lazy loading', ['model' => $model::class, 'relation' => $relation, 'url' => request()->fullUrl()]);
            });
        }

        // An account's owner may do everything in that account. null = "no opinion, ask the policy".
        Gate::before(function (User $user, string $ability, array $arguments): ?bool {
            $accountId = match (true) {
                ($arguments[0] ?? null) instanceof Booking => $arguments[0]->property->account_id,
                ($arguments[0] ?? null) instanceof Property => $arguments[0]->account_id,
                ($arguments[0] ?? null) instanceof Account => $arguments[0]->id,
                default => null,
            };

            return $accountId !== null && $user->roleIn($accountId) === MembershipRole::Owner ? true : null;
        });

        // throttle:api. An integration token has its own budget; our web and mobile apps share one per user.
        RateLimiter::for('api', function (Request $request): Limit {
            $token = $request->user()?->currentAccessToken();

            if ($token instanceof PersonalAccessToken && ! $token->can('*')) {
                return Limit::perMinute(60)->by("token:{$token->id}");
            }

            return Limit::perMinute(300)->by((string) ($request->user()?->id ?? $request->ip()));
        });
    }
}`,
        },
        {
          title: 'One error shape, whatever the client sends',
          text: [
            'RateBridge’s client sends no `Accept: application/json`. For such a request Laravel’s default is a browser’s answer: a redirect to a login page for 401, an HTML page for 404 or 429. A partner’s code can’t read either. One line makes every error under `/api` JSON, in the shape Laravel already uses for 422: a `message`, plus `errors` for validation.',
          ],
          path: 'bootstrap/app.php',
          code: String.raw`<?php

use App\Http\Middleware\RequireTokenAbility;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

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
        $middleware->alias(['token-can' => RequireTokenAbility::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // 401, 403, 404, 409, 422, 429 and 500 under /api: always {"message": …}, never a redirect or an HTML page
        $exceptions->shouldRenderJsonWhen(fn (Request $request): bool => $request->is('api/*') || $request->expectsJson());
    })->create();`,
          after: ['The shape is the documented contract now, in the API docs: `401` not logged in or token expired, `403` not allowed (policy or ability), `404` not found or not yours (scene 19), `409` conflict (taken nights, a teammate’s reply), `422` invalid input with `errors`, `429` slow down and retry after `Retry-After` seconds.'],
        },
      ],
    },
    {
      title: 'When a token isn’t enough: OAuth',
      text: [
        'Scoped tokens fixed this incident, and many PMSs give partners exactly this: an API key per integration. The weak spot is the copy and paste. Peter still handles a secret, can paste it anywhere, and has to pick abilities he may not understand.',
        '**OAuth 2.0** removes the copy. RateBridge registers once with us as a *client*. A host clicks “Connect Nordic Stays” in RateBridge, lands on **our** page, sees “RateBridge wants to read your bookings and update your calendar”, and clicks Allow. RateBridge gets a short-lived access token and a refresh token, and never sees a password or a long-lived secret the host made. In Laravel the server side is **Passport**; Sanctum doesn’t do OAuth.',
      ],
      blocks: [
        {
          path: 'the authorization code flow, as RateBridge sees it',
          fragment: true,
          lang: 'shell',
          code: String.raw`# 1. RateBridge sends the host's browser to us, with the scopes it wants and a random state (and PKCE)
GET https://app.nordicstays.dk/oauth/authorize?client_id=9a1f…&redirect_uri=https://ratebridge.io/callback
    &response_type=code&scope=bookings:read calendar:write&state=k3J9…&code_challenge=E9Mel…&code_challenge_method=S256

# 2. The host logs in to Nordic Stays, sees the scopes, clicks Allow. We redirect back with a one-time code.
HTTP/1.1 302 Found
Location: https://ratebridge.io/callback?code=def502…&state=k3J9…

# 3. RateBridge's server swaps the code for tokens (the code works once, for a few minutes)
POST https://app.nordicstays.dk/oauth/token
grant_type=authorization_code&client_id=9a1f…&redirect_uri=https://ratebridge.io/callback&code=def502…&code_verifier=dBjft…

{"token_type":"Bearer","expires_in":3600,"access_token":"eyJ0eX…","refresh_token":"def50200a8…"}

# 4. An hour later the access token has expired: RateBridge refreshes it, without the host
POST https://app.nordicstays.dk/oauth/token
grant_type=refresh_token&refresh_token=def50200a8…&client_id=9a1f…&scope=bookings:read calendar:write`,
        },
        {
          table: [
            ['', 'Scoped API tokens (today)', 'OAuth with Passport'],
            ['The host handles a secret', 'Yes, copies it once', 'No, clicks Allow'],
            ['Lifetime', 'Days to a year, then a new one by hand', 'An hour, refreshed by the partner'],
            ['Revoking', 'Delete the token', 'Disconnect the app; every token of that client for that host dies'],
            ['Who knows which partner it is', 'The token’s name, typed by the host', 'A registered client, with its name and redirect URL'],
            ['What it costs us', 'One table we already have', 'Passport, its tables and keys, a consent page, client registration, docs'],
            ['Worth it when', 'A handful of partners, set up with support', 'An app marketplace: partners we don’t know, hosts connecting on their own'],
          ],
          after: [
            'Nordic Stays has five partners, each onboarded by support. Scoped tokens are the honest fix today, and the scope names are already the ones an OAuth server would use. The day a partner directory opens, Passport takes over the third-party side, and the mobile app keeps its Sanctum token: first-party apps never need the consent screen.',
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'A limited token can read but not cancel, can’t mint tokens, expires, stays in its account, is throttled, and every error is JSON',
    blocks: [
      {
        path: 'tests/Feature/ApiTokensTest.php',
        code: String.raw`<?php

use App\Enums\BookingStatus;
use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;

beforeEach(function () {
    $this->cabin = Property::factory()->create(['name' => 'Ebeltoft cabin 3']);
    $this->peter = hostOf($this->cabin);
    $this->booking = Booking::factory()->for($this->cabin)->create(['status' => BookingStatus::Confirmed]);
});

function rateBridgeToken(object $test, array $abilities = ['bookings:read', 'calendar:write'], int $days = 30): string
{
    return $test->actingAs($test->peter)
        ->postJson('/api/v1/api-tokens', ['name' => 'RateBridge', 'abilities' => $abilities, 'expires_in_days' => $days])
        ->assertCreated()
        ->json('token');
}

it('lets a read token read bookings but not cancel them', function () {
    $token = rateBridgeToken($this);
    app('auth')->forgetGuards();                                               // the next requests use only the token

    $this->withToken($token)->getJson('/api/v1/bookings')->assertOk();
    $this->withToken($token)->postJson("/api/v1/bookings/{$this->booking->id}/cancel")->assertForbidden();   // the incident

    expect($this->booking->fresh()->status)->toBe(BookingStatus::Confirmed);
});

it('never hands out full access, and a limited token can’t mint one', function () {
    $this->actingAs($this->peter)
        ->postJson('/api/v1/api-tokens', ['name' => 'All of it', 'abilities' => ['*'], 'expires_in_days' => 30])
        ->assertUnprocessable();

    $token = rateBridgeToken($this);
    app('auth')->forgetGuards();
    $this->withToken($token)
        ->postJson('/api/v1/api-tokens', ['name' => 'Escalate', 'abilities' => ['bookings:write'], 'expires_in_days' => 30])
        ->assertForbidden();
});

it('stops working when it expires, with a JSON 401 even without an Accept header', function () {
    $token = rateBridgeToken($this, days: 7);
    app('auth')->forgetGuards();

    $this->travel(8)->days();

    $this->withToken($token)->get('/api/v1/bookings')                               // no Accept: application/json
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('stays in the account it was made in when the host switches accounts', function () {
    $token = rateBridgeToken($this);
    $other = Account::factory()->create();
    $other->users()->attach($this->peter, ['role' => MembershipRole::Owner->value]);
    $this->peter->forceFill(['current_account_id' => $other->id])->save();     // Peter works in his other account
    app('auth')->forgetGuards();

    $ids = $this->withToken($token)->getJson('/api/v1/bookings')->assertOk()->json('data.*.id');

    expect($ids)->toBe([$this->booking->id]);                                   // still the account it was made for
});

it('gives each integration token its own budget, and answers 429 with Retry-After', function () {
    $token = rateBridgeToken($this);
    app('auth')->forgetGuards();

    foreach (range(1, 60) as $_) {
        $this->withToken($token)->getJson('/api/v1/bookings')->assertOk();
    }

    $this->withToken($token)->get('/api/v1/bookings')
        ->assertTooManyRequests()
        ->assertHeader('Retry-After')
        ->assertJsonStructure(['message']);
});`,
        after: [
          '`forgetGuards()` matters: after `actingAs()`, the guard remembers Peter for the rest of the test, and a token request would pass as Peter’s session. Without it, the first test passes even with the bug, which is the kind of green test that proves nothing.',
          'Mutations: create the token without abilities (`createToken($name)`) and the first test fails with 200 on cancel. Drop the account from the token and the fourth test returns the other account’s bookings. Remove `throttle:api` and the fifth runs 61 requests without a 429.',
        ],
      },
    ],
  },
  next: 'Partners now get exactly the access they need. Next, the accountant downloads the tax export and finds another host’s bookings in it.',
};
