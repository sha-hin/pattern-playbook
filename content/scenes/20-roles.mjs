// Scene 20 · Roles inside an account: policies, Gate::before, invitations with signed URLs. No new pattern.

export default {
  description: 'A cleaner could see what every guest paid, and co-hosts were invited by sharing the owner’s password. Fix it in Laravel with role-based policies, conditional resource fields, Gate::before for account owners, invitations through temporary signed URLs, and safe member removal.',
  incident: {
    channel: '#support',
    when: 'Tuesday 10:30',
    messages: [
      ['Ahmed · host', 'My cleaner just asked why the guests in the Lake Cabin pay €1,105 and she gets €40 a turnover. She saw it in the booking screen. How?'],
      ['Mona · support', 'Also: Ahmed added his co-host by giving her **his own password**, because there’s no way to invite anyone.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Resources/BookingResource.php (before) · app/Policies/BookingPolicy.php (from scene 19)',
          broken: true, fragment: true,
          code: String.raw`// the resource: the same fields for everyone who may see the booking
'total' => ['amount' => $this->total->amount, 'currency' => $this->total->currency->value],

// the policy: "may see it" means "is a member", whatever the role
public function view(User $user, Booking $booking): Response { /* member of the account? */ }`,
          after: [
            'Scene 19 answered "which **account** may see this?". Inside an account there are roles (owner, co-host, cleaner, from the [foundation](F#enum-membership-role)), and the code ignores them: a cleaner needs dates and the number of guests, not money.',
            'And with no invitations, the only way to add a co-host was to share a login: no record of who did what, and no way to remove her without changing the owner’s password.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: what each role may do',
      blocks: [
        {
          table: [
            ['Ability', 'Owner', 'Co-host', 'Cleaner'],
            ['See a booking (dates, guests)', '✓', '✓', '✓'],
            ['See money (totals, payments, payouts)', '✓', '✓', '✗'],
            ['Change or cancel a booking', '✓', '✓', '✗'],
            ['Invite and remove members', '✓', '✗', '✗'],
          ],
        },
        {
          title: 'One more ability on the policy',
          path: 'app/Policies/BookingPolicy.php',
          code: String.raw`<?php

namespace App\Policies;

use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class BookingPolicy
{
    public function view(User $user, Booking $booking): Response
    {
        return $this->member($user, $booking) ? Response::allow() : Response::denyAsNotFound();   // 404, not 403
    }

    public function update(User $user, Booking $booking): Response
    {
        if (! $this->member($user, $booking)) {
            return Response::denyAsNotFound();
        }

        return in_array($user->roleIn($booking->property->account_id), [MembershipRole::Owner, MembershipRole::CoHost], true)
            ? Response::allow()
            : Response::deny('Only owners and co-hosts can change bookings.');     // a member may know it exists
    }

    public function viewFinancials(User $user, Booking $booking): bool
    {
        return $user->roleIn($booking->property->account_id) === MembershipRole::CoHost;   // owners: see Gate::before
    }

    private function member(User $user, Booking $booking): bool
    {
        return $user->roleIn($booking->property->account_id) !== null;
    }
}`,
        },
        {
          title: 'The resource leaves money out unless allowed',
          text: ['`when()` drops the key entirely, so the cleaner’s JSON has no `total` at all, not a `null` that hints something is hidden.'],
          path: 'app/Http/Resources/BookingResource.php',
          code: String.raw`<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Booking */
class BookingResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status->value,
            'check_in' => $this->stay->checkIn->toDateString(),
            'check_out' => $this->stay->checkOut->toDateString(),
            'nights' => $this->stay->nights(),
            'guests' => $this->guests,                                      // what a cleaner needs
            'total' => $this->when(                                         // money only for those allowed to see it
                $request->user()?->can('viewFinancials', $this->resource),
                fn (): array => ['amount' => $this->total->amount, 'currency' => $this->total->currency->value],
            ),
            'expires_at' => $this->expires_at?->toIso8601String(),
        ];
    }
}`,
        },
        {
          title: 'Owners may do everything in their own account',
          text: ['Instead of repeating "or the owner" in every policy method, one check runs **before** every policy, in the provider’s `boot()`. It returns `true` for the owner of the record’s account, and `null` for everyone else, which means "no opinion, ask the policy". Returning `false` would deny every ability to everybody who isn’t an owner.'],
          path: 'app/Providers/AppServiceProvider.php',
          code: String.raw`<?php

namespace App\Providers;

use App\Channels\ChannelManager;
use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;
use App\Payments\PaymentGateway;
use App\Payments\StripeGateway;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
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
    }

    public function boot(): void
    {
        Date::use(CarbonImmutable::class);                        // every date Laravel creates is immutable (scene 1)
        Model::shouldBeStrict(! $this->app->isProduction());     // lazy loading, unknown and unfillable attributes throw

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
    }
}`,
          after: ['It only says yes for the owner of **that** record’s account, so an owner of another account still gets scene 19’s 404.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: invitations, not shared passwords',
      text: [
        'An owner invites an email address with a role. The invitee gets a link that only works for 7 days and can’t be edited: a **signed URL**. Accepting requires being logged in as that email address, so a forwarded link is useless to anyone else.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_06_000001_create_account_invitations_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('account_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invited_by')->constrained('users');
            $table->string('email');
            $table->string('role');                                   // co_host or cleaner; owners are not invited
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->unique(['account_id', 'email']);                  // one open invitation per person per account
        });
    }
};`,
        },
        {
          path: 'app/Accounts/InviteMember.php',
          code: String.raw`<?php

namespace App\Accounts;

use App\Enums\MembershipRole;
use App\Mail\InvitationMail;
use App\Models\Account;
use App\Models\AccountInvitation;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use InvalidArgumentException;

final class InviteMember
{
    public const DAYS_VALID = 7;

    public function handle(Account $account, User $owner, string $email, MembershipRole $role): AccountInvitation
    {
        if ($role === MembershipRole::Owner) {
            throw new InvalidArgumentException('Owners are not invited; ownership is transferred.');
        }

        $invitation = AccountInvitation::updateOrCreate(
            ['account_id' => $account->id, 'email' => mb_strtolower($email)],
            ['invited_by' => $owner->id, 'role' => $role, 'expires_at' => now()->addDays(self::DAYS_VALID), 'accepted_at' => null],
        );

        $url = URL::temporarySignedRoute('invitations.accept', $invitation->expires_at, ['invitation' => $invitation->id]);

        Mail::to($invitation->email)->queue(new InvitationMail($account, $role, $url));

        return $invitation;
    }
}`,
        },
        {
          text: ['The invitation model:'],
          path: 'app/Models/AccountInvitation.php',
          code: String.raw`<?php

namespace App\Models;

use App\Enums\MembershipRole;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccountInvitation extends Model
{
    protected $fillable = ['account_id', 'email', 'invited_by', 'role', 'expires_at', 'accepted_at'];   // written by InviteMember only

    protected function casts(): array
    {
        return [
            'role' => MembershipRole::class,
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}`,
        },
        {
          title: 'The email',
          path: 'app/Mail/InvitationMail.php',
          code: String.raw`<?php

namespace App\Mail;

use App\Enums\MembershipRole;
use App\Models\Account;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

class InvitationMail extends Mailable
{
    use Queueable;

    public function __construct(public Account $account, public MembershipRole $role, public string $url)
    {
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: "You're invited to {$this->account->name} on Nordic Stays");
    }

    public function content(): Content
    {
        return new Content(markdown: 'mail.invitation');      // shows the role and a button to $url
    }
}`,
        },
        {
          title: 'Accepting',
          text: ['The `signed` middleware rejects an edited or expired link with a 403 before this code runs. The rest are the checks a signature can’t do.'],
          path: 'app/Http/Controllers/AcceptInvitationController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\AccountInvitation;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AcceptInvitationController extends Controller
{
    public function __invoke(Request $request, AccountInvitation $invitation): RedirectResponse
    {
        $user = $request->user();

        abort_if($invitation->accepted_at !== null, 410, 'This invitation was already used.');
        abort_if(mb_strtolower($user->email) !== $invitation->email, 403, 'This invitation is for another email address.');

        DB::transaction(function () use ($invitation, $user): void {
            $invitation->account->users()->syncWithoutDetaching([$user->id => ['role' => $invitation->role->value]]);
            $invitation->forceFill(['accepted_at' => now()])->save();
            $user->forceFill(['current_account_id' => $invitation->account_id])->save();
        });

        return redirect('/dashboard');
    }
}`,
        },
        {
          text: ['Its route is a web route, because the invitee clicks it in an email and arrives in a browser:'],
          path: 'routes/web.php',
          code: String.raw`<?php

use App\Http\Controllers\AcceptInvitationController;
use App\Http\Controllers\PaymentReturnController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('welcome'));

// Stripe sends the guest's browser here after a card payment (the return_url of the payment).
Route::get('/payments/return', PaymentReturnController::class)->name('payments.return');

// The link in the invitation email: logged in, and the signature must match.
Route::get('/invitations/{invitation}/accept', AcceptInvitationController::class)
    ->middleware(['auth', 'signed'])
    ->name('invitations.accept');`,
        },
      ],
    },
    {
      title: 'The fix, part 3: removing a member',
      text: [
        'Removal takes effect on the member’s **next request**: scene 19’s middleware checks the membership every time, so no session or token has to be hunted down. The one rule that needs code is that an account can never lose its last owner.',
      ],
      blocks: [
        {
          path: 'app/Accounts/RemoveMember.php',
          code: String.raw`<?php

namespace App\Accounts;

use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use LogicException;

final class RemoveMember
{
    public function handle(Account $account, User $member): void
    {
        DB::transaction(function () use ($account, $member): void {
            $owners = $account->users()->wherePivot('role', MembershipRole::Owner->value)->lockForUpdate()->pluck('users.id');

            if ($owners->count() === 1 && $owners->first() === $member->id) {
                throw new LogicException('An account must keep at least one owner.');
            }

            $account->users()->detach($member->id);

            if ($member->current_account_id === $account->id) {
                $member->forceFill(['current_account_id' => null])->save();     // next request: choose another account
            }
        });
    }
}`,
          after: ['The owners are read with a lock, so two owners removing each other at the same moment can’t both succeed.'],
        },
        {
          title: 'The endpoints',
          text: ['Inviting and removing are owner-only. The policy says no to everyone, and `Gate::before` from part 1 lets owners through:'],
          path: 'app/Policies/AccountPolicy.php',
          code: String.raw`<?php

namespace App\Policies;

use App\Models\Account;
use App\Models\User;

class AccountPolicy
{
    /** Only owners, who are let through by Gate::before. Everyone else: no. */
    public function manageMembers(User $user, Account $account): bool
    {
        return false;
    }
}`,
        },
        {
          text: ['The controller validates, checks the policy and calls the two actions:'],
          path: 'app/Http/Controllers/AccountMemberController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Accounts\InviteMember;
use App\Accounts\RemoveMember;
use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AccountMemberController extends Controller
{
    public function store(Request $request, Account $account, InviteMember $invite): JsonResponse
    {
        Gate::authorize('manageMembers', $account);                     // the current account, from scene 19's middleware

        $data = $request->validate([
            'email' => ['required', 'email'],
            'role' => ['required', Rule::enum(MembershipRole::class)->except([MembershipRole::Owner])],
        ]);

        $invitation = $invite->handle($account, $request->user(), $data['email'], MembershipRole::from($data['role']));

        return response()->json(['id' => $invitation->id, 'expires_at' => $invitation->expires_at->toIso8601String()], 201);
    }

    public function destroy(Account $account, User $user, RemoveMember $remove): Response
    {
        Gate::authorize('manageMembers', $account);

        $remove->handle($account, $user);

        return response()->noContent();
    }
}`,
        },
        {
          text: ['Both routes go in scene 19’s group, so they always act on the current account:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices.
Route::get('/v1/properties/{property}/quote', QuoteController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
        },
      ],
    },
  ],
  laravel: {
    title: 'Laravel inside: what a signed URL is',
    text: [
      'A signed URL is the normal URL plus `expires` and a `signature`: an HMAC of the whole URL made with your `APP_KEY`. Change one character, the invitation id or the expiry, and the signature no longer matches. Nothing is stored in the database.',
    ],
    blocks: [
      {
        path: 'Illuminate/Routing/UrlGenerator.php (simplified)',
        fragment: true,
        code: String.raw`public function hasCorrectSignature(Request $request, $absolute = true, array $ignoreQuery = [])
{
    $url = $absolute ? $request->url() : '/' . $request->path();
    $queryString = $this->queryStringWithout($request, ['signature', ...$ignoreQuery]);   // everything but the signature

    $original = rtrim($url . '?' . $queryString, '?');
    $expected = hash_hmac('sha256', $original, $this->keyResolver());

    return hash_equals($expected, (string) $request->query('signature', ''));             // constant-time compare
}

public function signatureHasNotExpired(Request $request)
{
    $expires = $request->query('expires');

    return ! ($expires && Carbon::now()->getTimestamp() > $expires);
}`,
        after: ['Rotating `APP_KEY` invalidates every signed link at once, open invitations included. Laravel’s `APP_PREVIOUS_KEYS` keeps old links working during a rotation.'],
      },
    ],
  },
  tests: {
    summary: 'Each role sees what it should, owners via Gate::before, and every way an invitation can be misused',
    blocks: [
      {
        path: 'tests/Feature/RolesTest.php',
        code: String.raw`<?php

use App\Accounts\RemoveMember;
use App\Enums\MembershipRole;
use App\Models\Booking;

beforeEach(fn () => $this->booking = Booking::factory()->create());

it('shows money to owners and co-hosts, never to cleaners', function (MembershipRole $role, bool $seesTotal) {
    $response = $this->actingAs(hostOf($this->booking->property, $role))->getJson("/api/v1/bookings/{$this->booking->id}")->assertOk();

    $seesTotal ? $response->assertJsonPath('data.total.amount', 45_000) : $response->assertJsonMissingPath('data.total');
})->with([
    [MembershipRole::Owner, true],
    [MembershipRole::CoHost, true],
    [MembershipRole::Cleaner, false],
]);

it('never lets an account lose its last owner', function () {
    $owner = hostOf($this->booking->property);

    app(RemoveMember::class)->handle($this->booking->property->account, $owner);
})->throws(LogicException::class, 'at least one owner');`,
      },
      {
        path: 'tests/Feature/InvitationTest.php',
        code: String.raw`<?php

use App\Accounts\InviteMember;
use App\Enums\MembershipRole;
use App\Models\Property;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;

beforeEach(function () {
    Mail::fake();
    $this->property = Property::factory()->create();
    $this->owner = hostOf($this->property);
    $this->invitation = app(InviteMember::class)->handle($this->property->account, $this->owner, 'Lina@Example.com', MembershipRole::CoHost);
    $this->url = URL::temporarySignedRoute('invitations.accept', $this->invitation->expires_at, ['invitation' => $this->invitation->id]);
});

it('adds the invitee with the invited role', function () {
    $lina = User::factory()->create(['email' => 'lina@example.com']);

    $this->actingAs($lina)->get($this->url)->assertRedirect('/dashboard');

    expect($lina->fresh()->roleIn($this->property->account_id))->toBe(MembershipRole::CoHost);
});

it('refuses an edited link, an expired link, and someone else', function (string $case) {
    $user = User::factory()->create(['email' => $case === 'someone else' ? 'mallory@example.com' : 'lina@example.com']);
    $url = $case === 'edited' ? str_replace('expires=', 'expires=9', $this->url) : $this->url;     // a later expiry, same signature

    if ($case === 'expired') {
        $this->travel(8)->days();
    }

    $this->actingAs($user)->get($url)->assertForbidden();
    expect($user->fresh()->roleIn($this->property->account_id))->toBeNull();
})->with(['edited', 'expired', 'someone else']);`,
      },
    ],
  },
  next: 'Everyone sees exactly what their role allows. Wednesday: a guest in New Zealand gets her arrival instructions at 3 in the morning.',
};
