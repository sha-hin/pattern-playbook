// Scene 28 · Prototype: a new listing copied from an existing one, with its own rate plan.

export default {
  description: 'A host duplicated a cottage, lowered the copy’s prices, and the original got cheaper too: replicate() copied the rate_plan_id, so both listings shared one plan. Fix it in Laravel with a deep copy: the listing is copied with its own copy of the plan and seasons, and the parts that must never be copied stay behind.',
  incident: {
    channel: '#support',
    when: 'Wednesday 16:05',
    messages: [
      ['Ingrid · host, Skagen cottages', 'I pressed **Duplicate** on Cottage 1 to set up the new, smaller Cottage 4, and lowered Cottage 4’s price to **€120**. Now Cottages 1, 2 and 3 are **€120** too. Two guests booked Cottage 1 at that price in the last hour.'],
      ['Mona · support', 'Cottages 1 to 3 share one rate plan on purpose: they’re identical. Cottage 4 was never meant to be on it.'],
      ['Karim · developer', 'Duplicate copies every column of the property. One of those columns is `rate_plan_id`.'],
    ],
  },
  sections: [
    {
      title: 'The duplicate button',
      text: [
        'Hosts with several similar listings set up the next one by duplicating an existing one: same address details, check-in times, house rules, fees. The button has been there since the spring. Owners and co-hosts may use it:',
      ],
      blocks: [
        {
          path: 'app/Policies/PropertyPolicy.php',
          code: String.raw`<?php

namespace App\Policies;

use App\Enums\MembershipRole;
use App\Models\Property;
use App\Models\User;

class PropertyPolicy
{
    public function createBooking(User $user, Property $property): bool
    {
        $role = $user->roleIn($property->account_id);                    // null when not a member

        return in_array($role, [MembershipRole::Owner, MembershipRole::CoHost], true);
    }

    public function update(User $user, Property $property): bool
    {
        return in_array($user->roleIn($property->account_id), [MembershipRole::Owner, MembershipRole::CoHost], true);
    }
}`,
          after: ['Owners already pass every check through `Gate::before` (scene 20); this method decides for co-hosts and cleaners.'],
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
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
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);

    Route::post('/message-templates', [MessageTemplateController::class, 'store']);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
        },
      ],
    },
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/DuplicatePropertyController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Property;
use Illuminate\Http\JsonResponse;

class DuplicatePropertyController extends Controller
{
    public function __invoke(Property $property): JsonResponse
    {
        $copy = $property->replicate();                  // the bug: every column, rate_plan_id included
        $copy->name = "{$property->name} (copy)";
        $copy->save();

        return response()->json(['id' => $copy->id], 201);
    }
}`,
          after: [
            'Until last week this was right: a property’s prices were columns on its own row, so a copy of the row was a copy of the prices. Since rate plans (scene 27), the prices live in another table, and the property only holds a **reference** to them: `rate_plan_id`.',
            '`replicate()` copies references as they are. The copy and the original now point at the same plan, and changing "the copy’s prices" changes the plan they share.',
          ],
        },
      ],
    },
    {
      title: 'Shallow and deep copies',
      text: [
        'A **shallow copy** copies an object’s own values, and shares everything it points to. A **deep copy** also copies what it points to, so nothing is shared. Neither is always right: for each reference, decide.',
      ],
      blocks: [
        {
          table: [
            ['What the property points to', 'In the copy', 'Why'],
            ['Account (`account_id`)', 'Shared', 'The copy belongs to the same host'],
            ['Rate plan and its seasons', '**Copied**', 'The host will change the copy’s prices; sharing is a choice she makes later, never a side effect'],
            ['Bookings, payments', 'Not copied', 'They are guests’ stays at the original'],
            ['Channel listings, iCal feeds', 'Not copied', 'The copy isn’t on Airbnb or Booking.com until the host lists it; a copied listing id would send its calendar to the original’s listing'],
          ],
          after: ['`replicate()` already does the last two rows: it copies the model’s own columns, never its related rows. Only the plan needs code.'],
        },
      ],
    },
    {
      title: 'The fix: an action that copies what must be copied',
      blocks: [
        {
          path: 'app/Properties/DuplicateProperty.php',
          code: String.raw`<?php

namespace App\Properties;

use App\Models\Property;
use App\Models\RatePlan;
use Illuminate\Support\Facades\DB;

final class DuplicateProperty
{
    public function handle(Property $property): Property
    {
        return DB::transaction(function () use ($property): Property {       // a copy without its plan is never saved
            $copy = $property->replicate();                                  // its own columns: no id, no timestamps
            $copy->name = "{$property->name} (copy)";

            if ($property->ratePlan !== null) {
                $copy->rate_plan_id = $this->copyOf($property->ratePlan)->id;   // its own plan, not the original's
            }

            $copy->save();

            return $copy;
        });
    }

    private function copyOf(RatePlan $plan): RatePlan
    {
        $copy = $plan->replicate();
        $copy->name = "{$plan->name} (copy)";
        $copy->save();

        foreach ($plan->seasons as $season) {
            $copy->seasons()->save($season->replicate());    // save() through the relation points rate_plan_id at the copy
        }

        return $copy;
    }
}`,
          after: [
            '`$season->replicate()` still carries the original plan’s `rate_plan_id`. Saving it through `$copy->seasons()` overwrites that foreign key with the copy’s id. Saving it with `->save()` on its own would quietly add the season to the original plan a second time.',
          ],
        },
        {
          title: 'The controller only calls it',
          path: 'app/Http/Controllers/DuplicatePropertyController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Models\Property;
use App\Properties\DuplicateProperty;
use Illuminate\Http\JsonResponse;

class DuplicatePropertyController extends Controller
{
    public function __invoke(Property $property, DuplicateProperty $duplicate): JsonResponse
    {
        $copy = $duplicate->handle($property);

        return response()->json(['id' => $copy->id], 201);
    }
}`,
        },
        {
          title: 'Fixing the three cottages',
          text: ['The fix stops new copies from sharing. Cottage 4 was copied before the fix and still shares the plan, so a developer gives it its own copy of the plan, with the same steps as the action:'],
          path: 'terminal',
          lang: 'shell',
          code: String.raw`php artisan tinker
> $cottage4 = App\Models\Property::findOrFail(412);
> $plan = $cottage4->ratePlan->replicate(); $plan->name = 'Cottage 4'; $plan->save();
> $cottage4->ratePlan->seasons->each(fn ($season) => $plan->seasons()->save($season->replicate()));
> $cottage4->forceFill(['rate_plan_id' => $plan->id])->save();`,
          after: ['Then Ingrid sets Cottages 1–3 back to €160. The two bookings already made at €120 keep their price: a booking stores its own total and line items (scene 7), and a price change never rewrites a booking.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Prototype'],
    rules: [['Prototype', 'Create a new object by copying an existing one, the prototype, instead of building it from scratch. The copy decides, part by part, what is shared and what is copied.']],
    points: [
      'The host’s cottage is the prototype: copying it keeps dozens of settings a new listing would otherwise need typed in again.',
      '`replicate()` is Laravel’s prototype operation. It is shallow on purpose: only the model’s own columns. Every reference to another table is a decision you make in code.',
      'The decision is written down once, in `DuplicateProperty`, and its tests say which parts are shared.',
    ],
    whenNot: [
      'When building from scratch is just as easy: a model with three columns needs `create()`, not a copy.',
      'When the copy must stay linked to the original. Then share the reference on purpose (one plan for three identical cottages), don’t copy it.',
    ],
  },
  laravel: {
    title: 'Laravel inside: what replicate() copies',
    text: [
      '`replicate()` builds a new, unsaved model from the raw attributes, minus the primary key and the timestamps. It also hands over the relations that are **already loaded**, as the same objects. After `$property->load("ratePlan")`, `$copy->ratePlan` is the original’s plan object until you change `rate_plan_id` and reload it.',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/Eloquent/Model.php (simplified)',
        fragment: true,
        code: String.raw`public function replicate(?array $except = null)
{
    $defaults = array_values(array_filter([
        $this->getKeyName(),
        $this->getCreatedAtColumn(),
        $this->getUpdatedAtColumn(),
        ...$this->uniqueIds(),
    ]));

    $attributes = Arr::except($this->getAttributes(), $except ? array_unique(array_merge($except, $defaults)) : $defaults);

    return tap(new static, function ($instance) use ($attributes) {
        $instance->setRawAttributes($attributes);       // every other column, foreign keys included
        $instance->setRelations($this->relations);       // loaded relations: the same objects, shared
        $instance->fireModelEvent('replicating', false);
    });
}`,
        after: ['The `replicating` event fires before you get the copy: a model can listen to it to reset columns that must never be copied, like a public slug or a counter.'],
      },
    ],
  },
  tests: {
    summary: 'The incident, the seasons that come along, what stays behind, and who may duplicate',
    blocks: [
      {
        path: 'tests/Feature/DuplicatePropertyTest.php',
        code: String.raw`<?php

use App\Enums\Channel;
use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\ChannelListing;
use App\Models\Property;
use App\Models\RatePlan;

beforeEach(function () {
    $this->cottage = Property::factory()->create(['name' => 'Cottage 1']);
    $this->plan = RatePlan::forceCreate([
        'account_id' => $this->cottage->account_id, 'name' => 'Skagen cottages',
        'nightly_rate_cents' => 16_000, 'currency' => 'EUR', 'weekend_uplift_bps' => 2_000,
    ]);
    $this->plan->seasons()->create(['name' => 'Summer', 'starts_on' => '2027-07-01', 'ends_on' => '2027-08-31', 'nightly_rate_cents' => 18_000]);
    $this->cottage->forceFill(['rate_plan_id' => $this->plan->id])->save();
    $this->host = hostOf($this->cottage);
});

function duplicate(Property $property): Property
{
    $id = test()->actingAs(test()->host)->postJson("/api/v1/properties/{$property->id}/duplicate")->assertCreated()->json('id');

    return Property::findOrFail($id);
}

it('gives the copy its own plan, so its prices change alone', function () {
    $copy = duplicate($this->cottage);

    $copy->ratePlan->forceFill(['nightly_rate_cents' => 12_000])->save();

    expect($copy->rate_plan_id)->not->toBe($this->plan->id)
        ->and($this->plan->fresh()->nightly_rate_cents)->toBe(16_000);           // the incident: the original keeps its price
});

it('copies every season into the copy’s plan', function () {
    $copy = duplicate($this->cottage);

    expect($copy->ratePlan->seasons->pluck('nightly_rate_cents')->all())->toBe([18_000])
        ->and($this->plan->seasons()->count())->toBe(1);                         // nothing was added to the original
});

it('leaves bookings and channel listings with the original', function () {
    Booking::factory()->for($this->cottage)->create();
    ChannelListing::forceCreate(['property_id' => $this->cottage->id, 'channel' => Channel::Airbnb, 'external_listing_id' => '41793625']);

    $copy = duplicate($this->cottage);

    expect($copy->name)->toBe('Cottage 1 (copy)')
        ->and($copy->bookings()->count())->toBe(0)
        ->and($copy->channelListings()->count())->toBe(0);
});

it('lets a co-host duplicate, and nobody from another account', function () {
    $coHost = hostOf($this->cottage, MembershipRole::CoHost);
    $stranger = memberOf(Property::factory()->create()->account);

    $this->actingAs($coHost)->postJson("/api/v1/properties/{$this->cottage->id}/duplicate")->assertCreated();
    $this->actingAs($stranger)->postJson("/api/v1/properties/{$this->cottage->id}/duplicate")->assertForbidden();
});`,
      },
    ],
  },
  next: 'Duplicates now start on their own plan. Next, Booking.com sells one night of a cabin that only takes stays of three nights or more.',
};
