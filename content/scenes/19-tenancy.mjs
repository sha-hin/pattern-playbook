// Scene 19 · Multi-tenancy: every query scoped to the account. No new pattern.

export default {
  description: 'A host changed a number in the URL and saw another company’s bookings, guests and prices. Fix it in Laravel the way multi-tenant SaaS apps must: policies on every record, queries that start from the current account, scoped exists rules and route bindings, no mass assignment, and a test that tries every endpoint as the wrong account.',
  incident: {
    channel: '#security',
    when: 'Monday 09:00',
    messages: [
      ['Email from a host', 'Hi, I opened one of my bookings and changed the 812 in the address to 813. I can now see a booking for a property that isn’t mine: the guest’s name, email and what they paid. I stopped there. You might want to look at this.'],
      ['Sara · tech lead', 'That’s an IDOR. Every account’s data is one number away from every other account. Nobody touches anything else until this is closed.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Nordic Stays is multi-tenant: many host companies (accounts, from the [foundation](F#table-accounts)) share one database. Three new endpoints were written fast:'],
      blocks: [
        {
          path: 'app/Http/Controllers/BookingController.php (before)',
          broken: true, fragment: true,
          code: String.raw`public function index()
{
    return BookingResource::collection(Booking::latest()->paginate());       // every account's bookings
}

public function show(Booking $booking)
{
    return new BookingResource($booking);                                     // any id works: the IDOR
}

public function move(Request $request, Booking $booking)
{
    $request->validate(['property_id' => 'required|exists:properties,id']);  // exists in ANY account
    $booking->update($request->all());                                        // and every other column too
}`,
          after: [
            '**IDOR** (insecure direct object reference) means: the app checks that you’re logged in, but not that the thing you asked for is yours. Ids are sequential, so trying 813, 814, 815 is all it takes.',
            '`exists:properties,id` checks that the property exists, not that it belongs to you, so a booking can be moved into another account. And `$request->all()` passes whatever the request contains to the model: a crafted request could change `status` or `total_cents`. (The `$fillable` list from the foundation limits that damage; validated input is what stops it.)',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one current account per request',
      text: [
        'A user can belong to several accounts ([memberships](F#table-memberships)) and works in one at a time (`current_account_id`). A middleware resolves that account once per request and refuses the request if the user isn’t actually a member, for example after being removed (scene 20).',
      ],
      blocks: [
        {
          path: 'app/Http/Middleware/SetCurrentAccount.php',
          code: String.raw`<?php

namespace App\Http\Middleware;

use App\Models\Account;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetCurrentAccount
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $account = $user?->current_account_id ? Account::find($user->current_account_id) : null;

        if ($account === null || $user->roleIn($account->id) === null) {
            abort(403, 'Choose an account you are a member of.');
        }

        app()->instance(Account::class, $account);              // anything that asks for "Account" gets this one

        return $next($request);
    }
}`,
          after: ['`bootstrap/app.php` adds it to the API group after `auth:sanctum`. Under Octane, where the app stays in memory between requests, register `Account` with `$this->app->scoped()` so it is forgotten after each request (scene 38).'],
        },
      ],
    },
    {
      title: 'The fix, part 2: lists start from the account',
      text: [
        'The rule that prevents most leaks is about **where a query starts**. `Booking::query()` starts from every booking in the database. `$account->bookings()` starts from this account’s bookings, so forgetting a `where` can only ever show too little.',
      ],
      blocks: [
        {
          path: 'app/Models/Account.php (one relation added)',
          fragment: true,
          code: String.raw`/** Bookings of all this account's properties: bookings → properties.account_id */
public function bookings(): HasManyThrough
{
    return $this->hasManyThrough(Booking::class, Property::class);
}`,
        },
        {
          path: 'app/Http/Controllers/BookingController.php (index, after)',
          fragment: true,
          code: String.raw`public function index(Account $account): AnonymousResourceCollection
{
    return BookingResource::collection(
        $account->bookings()->latest('bookings.id')->cursorPaginate(50),   // the account is injected by the middleware
    );
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: single records go through a policy',
      text: [
        'A record found by its id in the URL gets the same check every time: is the user a member of the account that owns it? The policy is the one place that answers. `can()` on the route runs it before the controller, so a controller can’t forget.',
      ],
      blocks: [
        {
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

    private function member(User $user, Booking $booking): bool
    {
        return $user->roleIn($booking->property->account_id) !== null;
    }
}`,
        },
        {
          title: 'Routes: every id is checked',
          text: [
            'For another account’s booking the policy answers **404, not 403**: a 403 would confirm that booking 813 exists. `Response::denyAsNotFound()` does exactly that. A member without the right role gets a 403, because they may know the booking exists.',
          ],
          path: 'routes/api.php',
          fragment: true,
          code: String.raw`Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v1')->group(function (): void {
    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
});`,
        },
      ],
    },
    {
      title: 'The fix, part 4: input is scoped too',
      text: [
        'Ids that arrive in the **body** need the same care as ids in the URL. The `exists` rule gets a `where` for the account, and only validated fields reach the model.',
      ],
      blocks: [
        {
          path: 'app/Http/Requests/MoveBookingRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Models\Account;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MoveBookingRequest extends FormRequest
{
    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'property_id' => [
                'required',
                'integer',
                Rule::exists('properties', 'id')->where('account_id', app(Account::class)->id),   // yours, not just existing
            ],
        ];
    }
}`,
        },
        {
          path: 'app/Http/Controllers/BookingController.php (move, after)',
          fragment: true,
          code: String.raw`public function move(MoveBookingRequest $request, Booking $booking): BookingResource
{
    $booking->property_id = $request->validated('property_id');             // one field, by name, after validation
    $booking->save();                                                       // (Day 5 adds the availability check)

    return new BookingResource($booking);
}`,
          after: ['There is no `$request->all()` left anywhere in the app, and a Larastan rule or a simple CI grep keeps it that way (scene 40).'],
        },
      ],
    },
  ],
  laravel: {
    title: 'Laravel inside: scoped route bindings',
    text: [
      'For nested routes like `/properties/{property}/bookings/{booking}`, Laravel can find the child **through** the parent instead of by its id alone. With `->scopeBindings()`, booking 813 is looked up as `$property->bookings()->where("id", 813)`, so a booking of another property is a 404 before any policy runs.',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/Eloquent/Model.php (simplified)',
        fragment: true,
        code: String.raw`public function resolveChildRouteBinding($childType, $value, $field)
{
    $relationship = $this->{Str::plural(Str::camel($childType))}();     // {booking} under {property} → $property->bookings()

    $field = $field ?: $relationship->getRelated()->getRouteKeyName();

    return $relationship->where($field, $value)->first();               // null → 404
}`,
        after: [
          'A **global scope** (`where account_id = current` added to every query of a model) is the other common tool. It’s safe in web requests, but queued jobs and commands have no current account, so it either has to throw there or be switched off, and code that switches it off is where the next leak hides. Nordic Stays keeps the scoping visible instead: queries start from the account, and policies guard records.',
        ],
      },
    ],
  },
  tests: {
    summary: 'Every endpoint, tried as the wrong account',
    text: ['One dataset lists every route that takes an id. Each new endpoint is added to it, so "can another account reach this?" is answered by the suite, not by a reviewer’s memory.'],
    blocks: [
      {
        path: 'tests/Feature/TenancyTest.php',
        code: String.raw`<?php

use App\Models\Booking;
use App\Models\Property;
use App\Models\User;

beforeEach(function () {
    $this->theirs = Booking::factory()->create();                             // another account's booking
    $this->ourProperty = Property::factory()->create();
    $this->us = hostOf($this->ourProperty);
});

it('hides another account’s booking on every endpoint', function (string $method, string $uri, array $body) {
    $this->actingAs($this->us)
        ->json($method, str_replace('{booking}', (string) $this->theirs->id, $uri), $body)
        ->assertNotFound();                                                    // not 403: don't confirm it exists
})->with([
    'show' => ['GET', '/api/v1/bookings/{booking}', []],
    'move' => ['PATCH', '/api/v1/bookings/{booking}/property', ['property_id' => 1]],
]);

it('lists only our own bookings', function () {
    $ours = Booking::factory()->for($this->ourProperty)->create();

    $this->actingAs($this->us)->getJson('/api/v1/bookings')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $ours->id);
});

it('refuses to move our booking into another account’s property', function () {
    $ours = Booking::factory()->for($this->ourProperty)->create();

    $this->actingAs($this->us)
        ->patchJson("/api/v1/bookings/{$ours->id}/property", ['property_id' => $this->theirs->property_id])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('property_id');
});

it('refuses a user whose current account is not theirs', function () {
    $stranger = User::factory()->create(['current_account_id' => $this->ourProperty->account_id]);   // not a member

    $this->actingAs($stranger)->getJson('/api/v1/bookings')->assertForbidden();
});`,
      },
    ],
  },
  next: 'Accounts are sealed off from each other. Tuesday: inside one account, the cleaner opens a booking and sees how much the guest paid.',
};
