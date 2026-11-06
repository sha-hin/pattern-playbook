// Lesson 2: Active Record, Data Mapper, Repository. Where booking logic and its SQL belong.

export default {
  description: 'Where does booking logic and its SQL belong in Laravel? Active Record (Eloquent), Data Mapper and Repository compared on a real PMS booking endpoint, with Form Requests, Policies, actions, status codes 201/403/409/422 and architecture tests.',
  ticket: {
    from: 'QA',
    title: 'Double bookings return 500, and a stranger booked our cabin',
    body: 'The booking endpoint is a 200-line controller method. A second booking for the same nights returns a 500 page instead of a clear error, any logged-in user can create a booking on any property, and the channel import has its own copy of the overlap check that already behaves differently.',
  },
  pain: {
    text: ['Everything lives in the controller:'],
    code: String.raw`public function store(Request $request, int $propertyId)
{
    $property = Property::findOrFail($propertyId);                  // no ownership check
    $data = $request->all();                                       // no validation, mass assignment risk

    $clash = DB::table('bookings')->where('property_id', $propertyId)
        ->where('check_in', '<=', $data['check_out'])              // wrong rule: blocks back-to-back stays
        ->where('check_out', '>=', $data['check_in'])
        ->exists();                                                // ignores the status: cancelled bookings block too
    if ($clash) {
        throw new Exception('Already booked');                     // becomes a 500
    }

    $booking = Booking::create($data + ['property_id' => $propertyId, 'status' => 'pending']);

    return response()->json($booking);                             // 200, the raw model, every column
}`,
    after: [
      'Validation, authorization, the business rule, persistence and the response format are mixed in one method, so none of them can be reused or tested alone. The channel import can’t call this code, so it copied the overlap rule, and the two copies drifted.',
      'Before splitting it, one question decides the shape of everything after: **who talks to the database**, the model itself, a separate mapper, or a repository?',
    ],
  },
  patterns: [
    {
      name: 'Active Record',
      rule: 'One object wraps one database row: it holds the data, knows its table, and saves itself.',
      explain: [
        'Eloquent is Active Record. A `Booking` model is the row (`$booking->check_in`), knows its table (`bookings`), and persists itself (`$booking->save()`). Relations, scopes and casts live on the same class. It is the fastest way to build a CRUD-heavy app, and the reason Laravel code is short.',
        'The cost: every model depends on the database, and it is tempting to put business rules on the model until it becomes a "god class". The fix is not to drop Active Record but to keep **rules in small actions**, and keep the model for data, relations, casts and query scopes.',
      ],
      drawing: {
        bad: [['b', 4, 60, 92, 46, 'Controller', 'x'], ['a', 96, 70, 196, 30, '', 'x'], ['a', 96, 83, 196, 83, '', 'x'], ['a', 96, 96, 196, 136, '', 'x'], ['b', 198, 14, 98, 30, 'validation', 'n'], ['b', 198, 68, 98, 30, 'overlap SQL', 'n'], ['b', 198, 122, 98, 30, 'JSON shape', 'n'], ['t', 50, 130, 'all in one method', 'kx', 'middle']],
        good: [['b', 4, 64, 64, 38, 'Request', 'n'], ['a', 68, 83, 84, 83], ['b', 86, 64, 74, 38, 'Controller', 'n'], ['a', 160, 83, 176, 83, '', 'k'], ['b', 178, 64, 62, 38, 'Action', 'v'], ['a', 240, 83, 254, 83, '', 'k'], ['b', 256, 64, 40, 38, 'Model', 'v2'], ['t', 36, 124, 'rules', 's', 'middle'], ['t', 209, 124, 'business rule', 's', 'middle'], ['t', 276, 124, 'row', 's', 'middle']],
        badCaption: 'The controller validates, checks, queries and formats. Nothing can be reused.',
        goodCaption: 'Each step has one home. The model stays a row with relations and scopes.',
      },
    },
    {
      name: 'Data Mapper',
      rule: 'The objects know nothing about the database; a separate mapper copies data between rows and objects.',
      explain: [
        'In a Data Mapper ORM such as Doctrine, a `Booking` is a plain PHP class with no `save()` and no table. An entity manager tracks the objects and writes them in one go. Business objects can be tested without a database and shaped freely, at the price of mapping configuration and more code.',
        'Laravel ships Active Record, not a Data Mapper. You meet Data Mapper in Symfony projects and in large domains whose rules are much richer than their tables.',
      ],
      table: [
        ['', 'Active Record (Eloquent)', 'Data Mapper (Doctrine)'],
        ['Who saves?', '`$booking->save()`', '`$entityManager->persist($booking); $entityManager->flush();`'],
        ['Does the object know its table?', 'Yes', 'No'],
        ['Testing rules without a database', 'Use plain classes next to the model (value objects, actions with fakes)', 'Natural'],
        ['Best for', 'Most Laravel apps, CRUD plus focused rules', 'Very rich domains, storage that must be swappable'],
      ],
    },
    {
      name: 'Repository',
      rule: 'An interface that looks like a collection of domain objects ("add this", "find these"); the storage details hide behind it.',
      explain: [
        'A repository gives business code methods named after what it needs, such as `$bookings->overlapping($propertyId, $stay)`, and hides whether that is Eloquent, an API or a cache. It shines with a Data Mapper, and when there is a **real second implementation**: a different storage, or an external system.',
        'Over Eloquent, repositories are debated. Eloquent already is a repository-like API (`Booking::overlapping(...)`), and wrapping it either leaks Eloquent through (returning models and builders) or throws away its features (eager loading, pagination, scopes). Most production Laravel teams use **scopes** for named queries and **actions** for rules, and add a repository only when something real must be swappable.',
      ],
    },
  ],
  sections: [
    {
      title: 'Build it: the booking endpoint, one responsibility per class',
      blocks: [
        {
          title: 'The route',
          text: ['Versioned under `/api/v1` from the start (lesson 16). `can:` runs the policy before the controller; `scopeBindings()` makes Laravel resolve child models through their parent.'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\BookingController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->middleware('auth:sanctum')->scopeBindings()->group(function () {
    Route::post('properties/{property}/bookings', [BookingController::class, 'store'])
        ->can('createBooking', 'property');
});`,
        },
        {
          title: 'The Form Request: validation, and the value objects',
          text: ['It turns valid input into the value objects from lesson 1, so the action never sees raw strings. The maximum guests rule depends on the property, which route model binding already loaded.'],
          path: 'app/Http/Requests/StoreBookingRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Bookings\Stay;
use App\Models\Property;
use Illuminate\Foundation\Http\FormRequest;

class StoreBookingRequest extends FormRequest
{
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
        ];
    }

    public function stay(): Stay
    {
        return Stay::fromDates($this->validated('check_in'), $this->validated('check_out'));
    }
}`,
        },
        {
          title: 'The Policy: who may create a booking on this property',
          text: ['Only members of the account that owns the property, and not cleaners. A user of another account gets 403. `User::roleIn()` reads the role from the membership pivot (lesson 0); lesson 11 extends this into a full role model.'],
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
}`,
        },
        {
          title: 'The conflict exception: a clear 409',
          text: ['A domain exception that knows its HTTP meaning. Laravel calls `render()` when it reaches the exception handler.'],
          path: 'app/Bookings/BookingConflict.php',
          code: String.raw`<?php

namespace App\Bookings;

use Illuminate\Http\JsonResponse;
use RuntimeException;

final class BookingConflict extends RuntimeException
{
    public static function for(Stay $stay): self
    {
        return new self("The property is already booked for some nights between {$stay->checkIn->toDateString()} and {$stay->checkOut->toDateString()}.");
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], 409);
    }
}`,
        },
        {
          title: 'The action: the business rule, reusable by any caller',
          text: [
            'One class, one job: create a booking if the nights are free. The controller, the channel import and an admin command all call the same `handle()`, so there is one overlap rule.',
            'The property row is locked inside the transaction, so two requests for the same property run one after the other: the second one sees the first booking and gets a 409 instead of a double booking. Lesson 27 explains the lock in depth.',
          ],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Money\Money;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;                                     // unpaid bookings expire (lesson 20)

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->first();   // one booking at a time per property

            $taken = $property->bookings()
                ->overlapping($stay->checkIn->toDateString(), $stay->checkOut->toDateString())
                ->exists();
            if ($taken) {
                throw BookingConflict::for($stay);
            }

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = Money::of($property->nightly_rate_cents, $property->currency)->times($stay->nights());
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            return $booking;
        });
    }
}`,
        },
        {
          title: 'The API Resource: only what the client needs',
          path: 'app/Http/Resources/BookingResource.php',
          code: String.raw`<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\Booking */
class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status->value,
            'check_in' => $this->stay->checkIn->toDateString(),
            'check_out' => $this->stay->checkOut->toDateString(),
            'nights' => $this->stay->nights(),
            'total' => ['amount' => $this->total->amount, 'currency' => $this->total->currency->value],
            'expires_at' => $this->expires_at?->toIso8601String(),
        ];
    }
}`,
        },
        {
          title: 'The thin controller',
          text: ['It translates HTTP into a call and back. No rule lives here. A resource wrapping a model that was just created answers **201** on its own (see below).'],
          path: 'app/Http/Controllers/BookingController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\CreateBooking;
use App\Http\Requests\StoreBookingRequest;
use App\Http\Resources\BookingResource;
use App\Models\Property;

class BookingController extends Controller
{
    public function store(StoreBookingRequest $request, Property $property, CreateBooking $createBooking): BookingResource
    {
        $booking = $createBooking->handle(
            $property,
            $request->stay(),
            $request->safe()->only(['guest_name', 'guest_email', 'guests']),
        );

        return new BookingResource($booking);
    }
}`,
        },
        {
          title: 'Every status code, and where it comes from',
          table: [
            ['Code', 'When', 'Produced by'],
            ['201 Created', 'The booking was created', '`BookingResource` on a model with `wasRecentlyCreated`'],
            ['401 Unauthorized', 'No or invalid token', '`auth:sanctum`'],
            ['403 Forbidden', 'Not a host of this property', '`can:createBooking` → `PropertyPolicy`'],
            ['404 Not Found', 'Unknown property id', 'Route model binding'],
            ['409 Conflict', 'Some nights are already booked', '`BookingConflict::render()`'],
            ['422 Unprocessable', 'Invalid input', '`StoreBookingRequest`'],
          ],
        },
      ],
    },
    {
      title: 'Data Mapper and Repository, side by side',
      text: ['For comparison only: what the same idea looks like with a Data Mapper, and with a repository over Eloquent. Neither is added to this app; the reasons are in "When not to use it".'],
      numbered: false,
      blocks: [
        {
          title: 'Data Mapper: Doctrine (a Symfony-style app, not ours)',
          path: 'Doctrine ORM example',
          code: String.raw`#[ORM\Entity]
class Booking
{
    #[ORM\Id, ORM\GeneratedValue, ORM\Column]
    private ?int $id = null;

    public function __construct(
        #[ORM\Column] private string $guestName,
        #[ORM\Embedded] private Stay $stay,
    ) {
    }
}

$booking = new Booking('Hany Mostafa', $stay);   // a plain object: no table, no save()
$entityManager->persist($booking);               // the mapper starts tracking it
$entityManager->flush();                         // one INSERT, inside a transaction`,
        },
        {
          title: 'A repository over Eloquent',
          path: 'app/Bookings/BookingRepository.php (not added)',
          code: String.raw`interface BookingRepository
{
    public function hasOverlap(int $propertyId, Stay $stay): bool;

    public function add(Booking $booking): void;
}

final class EloquentBookingRepository implements BookingRepository
{
    public function hasOverlap(int $propertyId, Stay $stay): bool
    {
        return Booking::where('property_id', $propertyId)
            ->overlapping($stay->checkIn->toDateString(), $stay->checkOut->toDateString())
            ->exists();
    }

    public function add(Booking $booking): void
    {
        $booking->save();                        // still Eloquent models in and out: the abstraction leaks
    }
}`,
        },
      ],
    },
  ],
  laravel: {
    text: ['Two pieces of Laravel used above, from the inside: how an Active Record saves itself, and why a new resource answers 201.'],
    blocks: [
      {
        title: 'Model::save(): the row writes itself',
        path: 'Illuminate/Database/Eloquent/Model.php (simplified)',
        code: String.raw`public function save(array $options = [])
{
    $query = $this->newModelQuery();                         // an Eloquent Builder for this table

    if ($this->fireModelEvent('saving') === false) {
        return false;                                        // an observer can cancel (lesson 21)
    }

    $saved = $this->exists
        ? $this->performUpdate($query)                       // only the dirty columns
        : $this->performInsert($query);

    if ($saved) {
        $this->finishSave($options);                         // fires "saved", syncs the original attributes
    }

    return $saved;
}

protected function performInsert(Builder $query)
{
    $attributes = $this->getAttributesForInsert();

    $id = $query->insertGetId($attributes, $keyName = $this->getKeyName());   // Query\Builder → Grammar → Connection
    $this->setAttribute($keyName, $id);

    $this->exists = true;
    $this->wasRecentlyCreated = true;                        // remembered for the 201 below

    $this->fireModelEvent('created', false);

    return true;
}`,
      },
      {
        title: 'Why a new resource answers 201',
        path: 'Illuminate/Http/Resources/Json/ResourceResponse.php (simplified)',
        code: String.raw`protected function calculateStatus()
{
    return $this->resource->resource instanceof Model
        && $this->resource->resource->wasRecentlyCreated ? 201 : 200;
}`,
      },
    ],
  },
  topics: {
    blocks: [
      {
        title: 'Actions vs services vs repositories',
        table: [
          ['', 'What it is', 'Use it for'],
          ['Action', 'One class, one business operation, one public method (`CreateBooking::handle()`)', 'Every write with rules. Callable from controllers, jobs, commands and other actions.'],
          ['Service', 'A class grouping operations around one external system (`StripeClient`, `ChannelClient`)', 'Talking to APIs and infrastructure.'],
          ['Repository', 'A collection-like interface over storage', 'Only when storage must be swappable, or with a Data Mapper.'],
        ],
      },
      {
        title: 'SOLID in Laravel terms',
        text: [
          '**S**ingle responsibility: the request validates, the policy authorizes, the action decides, the resource formats. **O**pen/closed: new channels or pricing rules are new classes, not edits to the action (lessons 9 and 16). **L**iskov: any implementation of an interface can replace another without surprising the caller (every channel adapter returns the same types). **I**nterface segregation: small interfaces (`refundCents()` only, not a "PaymentEverything"). **D**ependency inversion: the action depends on interfaces once a second implementation exists (lesson 3).',
          'SOLID never justifies an abstraction nobody needs yet. That is why there is no repository above.',
        ],
      },
      {
        title: 'A modular monolith by domain',
        text: ['One Laravel app, organised by business area instead of by technical layer. Each folder owns its rules; other areas use it through its actions and events.'],
        path: 'app/',
        lang: 'text',
        code: String.raw`app/
├── Bookings/      CreateBooking, Stay, BookingConflict
├── Pricing/       PriceCalculator, rate plans              (lessons 12, 16)
├── Payments/      Stripe, refunds, cancellation policies   (lessons 15, 20)
├── Channels/      adapters, sync, webhooks                 (lessons 6, 9, 17)
├── Messaging/     templates, scheduled messages            (lessons 13, 24)
├── Money/         Money, Currency
├── Models/        Eloquent models
└── Http/          controllers, requests, resources`,
      },
      {
        title: 'Architecture tests, static analysis and formatting',
        text: [
          'Rules about the code itself are tested too. Pest arch tests fail the build when someone puts SQL in a controller or makes Bookings depend on Channels. **Larastan** (PHPStan for Laravel) at level 8+ catches wrong types and null access before runtime; **Pint** formats every file the same way; **Rector** applies automated refactors and upgrade rules.',
        ],
        path: 'tests/Arch/ArchitectureTest.php · phpstan.neon',
        code: String.raw`<?php

arch('controllers stay thin')
    ->expect('App\Http\Controllers')
    ->not->toUse(['Illuminate\Support\Facades\DB', 'App\Models\Booking']);

arch('value objects are immutable')
    ->expect(['App\Money', 'App\Bookings\Stay'])
    ->toBeReadonly()
    ->toBeFinal();

arch('domains talk through actions, not internals')
    ->expect('App\Bookings')
    ->not->toUse('App\Channels');

arch()->preset()->laravel();          // Laravel's own conventions (naming, folders)

// phpstan.neon
// includes:
//     - vendor/larastan/larastan/extension.neon
// parameters:
//     level: 8
//     paths: [app]`,
      },
      {
        title: 'Refactoring legacy code safely, and upgrading Laravel',
        text: [
          'The old controller above is legacy code: before moving it, pin its **current** behaviour with feature tests (including the bugs you will fix on purpose, marked as such), then move one responsibility at a time and rerun the **full** suite after each move.',
          'Major Laravel upgrades follow the same discipline: read the upgrade guide, upgrade on a branch, let Rector apply the mechanical changes, run Larastan and the full suite, and fix what the tests reveal. Keep upgrades yearly so each one is small.',
        ],
      },
      {
        title: 'Drill: build the next resource the same way, until it’s automatic',
        text: [
          'Build `PUT /api/v1/properties/{property}/calendar/{date}` for blocking a day or setting its price, with the same pieces: route with `can:`, a Form Request (`blocked` boolean, `price_cents` nullable integer, the date in the future), a policy method (owners and co-hosts), an action `SetCalendarDay` that `updateOrCreate`s the `calendar_days` row, a resource, and the right status codes (200, 403, 404, 422). Then do it once more from memory for `DELETE`.',
        ],
      },
    ],
  },
  whenNot: [
    'Don’t wrap Eloquent in a repository "for clean architecture". It hides eager loading, pagination and scopes, and every method returns Eloquent models anyway. Add one when a **second implementation** exists today.',
    'Don’t move every model method into an action. Relations, casts, scopes and tiny helpers such as `isCancelled()` belong on the model; actions are for operations with rules.',
    'Don’t switch to a Data Mapper ORM inside a Laravel app. Mixing two ORMs costs more than it saves.',
  ],
  tests: {
    summary: 'Feature tests for the endpoint, the two trap tests, and the architecture tests',
    text: [
      'Written first, one at a time, red → green. The two **trap tests** (back-to-back stays, cancelled bookings) are the important ones: with no overlap check at all they already pass, and they turn red the moment someone writes the naive `<=` rule from the quick fix. That is why the **full** suite runs after every change, not just the newest test.',
    ],
    blocks: [
      {
        path: 'tests/Feature/CreateBookingTest.php',
        code: String.raw`<?php

use App\Enums\MembershipRole;
use App\Models\Booking;
use App\Models\Property;
use App\Models\User;

beforeEach(function () {
    $this->travelTo('2027-06-01');                                  // "after_or_equal:today" must not depend on the real date
    $this->property = Property::factory()->create(['nightly_rate_cents' => 15_000, 'currency' => 'EUR', 'max_guests' => 4]);
    $this->host = User::factory()->create();
    $this->property->account->users()->attach($this->host, ['role' => MembershipRole::Owner->value]);
});

function book(Property $property, array $overrides = []): array
{
    return [
        'check_in' => '2027-07-01', 'check_out' => '2027-07-04', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com', ...$overrides,
    ];
}

it('creates a pending booking priced per night', function () {
    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", book($this->property))
        ->assertCreated()
        ->assertJsonPath('data.status', 'pending')
        ->assertJsonPath('data.nights', 3)
        ->assertJsonPath('data.total.amount', 45_000);
});

it('rejects invalid input', function (array $input, string $field) {
    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", book($this->property, $input))
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'check-out before check-in' => [['check_out' => '2027-06-30'], 'check_out'],
    'too many guests' => [['guests' => 5], 'guests'],
    'bad email' => [['guest_email' => 'not-an-email'], 'guest_email'],
]);

it('forbids users of another account', function () {
    $this->actingAs(User::factory()->create())
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", book($this->property))
        ->assertForbidden();
});

it('refuses overlapping nights with 409', function () {
    Booking::factory()->for($this->property)->forStay('2027-07-03', 2)->create();

    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", book($this->property))
        ->assertConflict();
});

// Trap 1: green before any overlap code; red with the naive "<=" rule.
it('allows a stay that starts on the day the previous one ends', function () {
    Booking::factory()->for($this->property)->forStay('2027-06-28', 3)->create();   // leaves 2027-07-01

    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", book($this->property))
        ->assertCreated();
});

// Trap 2: green before any overlap code; red when the rule forgets the status.
it('ignores cancelled bookings', function () {
    Booking::factory()->for($this->property)->forStay('2027-07-01', 3)->cancelled()->create();

    $this->actingAs($this->host)
        ->postJson("/api/v1/properties/{$this->property->id}/bookings", book($this->property))
        ->assertCreated();
});`,
      },
    ],
  },
  next: 'The action above is resolved by Laravel’s container. Lesson 3 looks at that container, and at the Stripe client that is currently created with `new` in five places.',
};
