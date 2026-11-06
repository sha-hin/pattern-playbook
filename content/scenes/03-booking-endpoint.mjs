// Scene 3 · Active Record, Data Mapper, Repository: the booking endpoint.

export default {
  description: 'A 200-line booking controller returned 500 on double bookings and let any user book any property. Split it into a Form Request, a Policy, an action and a Resource, and see where Active Record, Data Mapper and Repository fit in Laravel.',
  incident: {
    channel: '#bugs',
    when: 'Wednesday 11:05',
    messages: [
      ['Karim · QA', 'Three things on the booking endpoint. Booking nights that are already taken shows a **500 page**. A user from a **different host account** created a booking on our Lake Cabin. And the Airbnb import has its own copy of the "is it free?" check that already gives different answers.'],
      ['Sara · tech lead', 'Before we patch it: the whole thing is one controller method. Let’s give each part a home.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/BookingController.php (before)',
          broken: true, fragment: true,
          code: String.raw`public function store(Request $request, int $propertyId)
{
    $property = Property::findOrFail($propertyId);                 // anyone logged in, any property
    $data = $request->all();                                       // no validation, every field accepted

    $clash = DB::table('bookings')->where('property_id', $propertyId)
        ->where('check_in', '<=', $data['check_out'])              // blocks back-to-back stays
        ->where('check_out', '>=', $data['check_in'])
        ->exists();                                                // cancelled bookings block too
    if ($clash) {
        throw new Exception('Already booked');                     // becomes a 500
    }

    $booking = Booking::create($data + ['property_id' => $propertyId, 'status' => 'pending']);

    return response()->json($booking);                             // 200, every column of the row
}`,
          after: ['Validation, permission, the business rule, saving and the response format are mixed in one method. None can be reused or tested on its own, which is exactly why the Airbnb import copied the overlap rule instead of calling it.'],
        },
      ],
    },
    {
      title: 'The fix: one home for each part',
      text: ['The request goes through five small pieces, each with one job. Read them in the order a request meets them.'],
      blocks: [
        {
          title: '1. The route',
          text: ['`auth:sanctum` answers **401** without a valid token. Route model binding answers **404** for an unknown property. `can()` runs the policy below and answers **403**.'],
          path: 'routes/api.php',
          fragment: true,
          code: String.raw`Route::post('/v1/properties/{property}/bookings', [BookingController::class, 'store'])
    ->middleware('auth:sanctum')
    ->can('createBooking', 'property');`,
        },
        {
          title: '2. Who may book: the Policy',
          text: ['Owners and co-hosts of the account that owns the property. Not cleaners, and nobody from another account. [`roleIn()`](F#model-user) reads the role from the membership.'],
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
          title: '3. What a valid request looks like: the Form Request',
          text: ['Bad input never reaches the business code: Laravel answers **422** with the errors. `stay()` hands the rest of the app scene 2’s value object instead of two strings.'],
          path: 'app/Http/Requests/StoreBookingRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Bookings\Stay;
use App\Models\Property;
use Illuminate\Foundation\Http\FormRequest;

class StoreBookingRequest extends FormRequest
{
    /** @return array<string, list<string>> */
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
          title: '4. Which bookings block a stay: a scope',
          text: [
            'The correct rule, in one place: an existing booking blocks the new stay when it **starts before the new one ends** and **ends after the new one starts**. Strict `<` and `>`, so back-to-back stays pass. And only pending and confirmed bookings count.',
            'It lives on the model as a query scope, so every caller (this endpoint, the Airbnb import, an admin tool) uses the same rule, and the database runs it with the [composite index](F#table-bookings).',
          ],
          path: 'app/Enums/BookingStatus.php · app/Models/Booking.php (added)',
          fragment: true,
          code: String.raw`// BookingStatus: the statuses that occupy the calendar
/** @return list<self> */
public static function blocking(): array
{
    return [self::Pending, self::Confirmed];
}

// Booking
public function scopeOverlapping(Builder $query, Stay $stay): void
{
    $query->whereIn('status', BookingStatus::blocking())
        ->where('check_in', '<', $stay->checkOut->toDateString())     // starts before the new stay ends
        ->where('check_out', '>', $stay->checkIn->toDateString());    // ends after the new stay starts
}`,
        },
        {
          title: '5. The business rule: an action',
          text: [
            'One class, one public method: create a booking if the nights are free. It knows nothing about HTTP, so the Airbnb import can call the same `handle()`.',
            'A new booking is a **pending hold** for 30 minutes while the guest pays; scene 9 expires unpaid holds.',
          ],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        if ($property->bookings()->overlapping($stay)->exists()) {
            throw BookingConflict::for($stay);
        }

        $booking = new Booking($guest);
        $booking->stay = $stay;                                                // scene 2
        $booking->total = $property->nightly_rate->times($stay->nights());     // scene 1
        $booking->status = BookingStatus::Pending;
        $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
        $property->bookings()->save($booking);                                 // sets property_id

        return $booking;
    }
}`,
        },
        {
          title: '6. A conflict is a clear 409',
          text: ['A domain exception that knows its HTTP meaning. Laravel’s exception handler calls `render()`, so the controller never catches anything.'],
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
          title: '7. Only what the client needs: the Resource',
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
            'total' => ['amount' => $this->total->amount, 'currency' => $this->total->currency->value],
            'expires_at' => $this->expires_at?->toIso8601String(),
        ];
    }
}`,
        },
        {
          title: '8. The controller is now three lines',
          text: ['It translates HTTP into a call and back. Returning a resource for a model that was just created answers **201** on its own (see below).'],
          path: 'app/Http/Controllers/BookingController.php (after)',
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
            ['401 Unauthorized', 'No valid token', '`auth:sanctum`'],
            ['403 Forbidden', 'Not a host of this property', '`can()` → `PropertyPolicy`'],
            ['404 Not Found', 'Unknown property', 'Route model binding'],
            ['409 Conflict', 'Some nights are taken', '`BookingConflict::render()`'],
            ['422 Unprocessable', 'Invalid input', '`StoreBookingRequest`'],
          ],
        },
      ],
    },
  ],
  reveal: {
    names: ['Active Record'],
    rules: [['Active Record', 'One object wraps one database row: it holds the data, knows its table, and saves itself. Eloquent is Active Record.']],
    text: [
      'The question behind today’s fix was **who talks to the database**. In Laravel the answer is the model itself: `$property->bookings()->save($booking)` is Active Record. That’s what keeps Laravel code short.',
      'The cost is that it’s tempting to pile rules onto the model until it’s a 2,000-line class. That’s why the rule went into the `CreateBooking` action, and the model only kept data, relations and a scope.',
    ],
    whenNot: [
      'When the business rules are much richer than the tables (complex insurance or trading domains), objects that know nothing about the database are easier to keep correct. That’s the Data Mapper, below.',
    ],
  },
  afterReveal: [
    {
      title: 'The two other answers, and why Nordic Stays doesn’t use them',
      text: ['There are two other common answers to "who talks to the database?". Here is the same booking written with each, so you can recognise them in other codebases.'],
      blocks: [
        {
          title: 'Data Mapper: the object doesn’t know the database',
          text: [
            'In a Data Mapper ORM, such as Doctrine (the default in Symfony), `Booking` is a plain PHP class. It has no `save()`, no table and no query methods. A separate object, the **entity manager**, copies data between rows and objects, and writes every change in one go when you call `flush()`.',
          ],
          path: 'src/Entity/Booking.php (Doctrine, in a Symfony app)',
          fragment: true,
          code: String.raw`use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'bookings')]
class Booking
{
    #[ORM\Id, ORM\GeneratedValue, ORM\Column]
    private ?int $id = null;

    public function __construct(
        #[ORM\ManyToOne] private Property $property,
        #[ORM\Column] private string $guestName,
        #[ORM\Embedded] private Stay $stay,                 // a value object stored in two columns
    ) {
    }
}

// Saving it: the object can't save itself, the mapper does
$booking = new Booking($property, 'Mona Adel', $stay);
$entityManager->persist($booking);                          // start tracking it
$entityManager->flush();                                    // one INSERT, inside a transaction`,
        },
        {
          title: 'Repository: storage behind a collection-like interface',
          text: [
            'A repository looks like a collection of bookings: you ask it for bookings and hand it new ones, and it hides where they are stored. Over Eloquent, it would look like this:',
          ],
          path: 'app/Bookings/BookingRepository.php (not added to Nordic Stays)',
          fragment: true,
          code: String.raw`interface BookingRepository
{
    public function hasOverlap(Property $property, Stay $stay): bool;

    public function add(Booking $booking): void;
}

final class EloquentBookingRepository implements BookingRepository
{
    public function hasOverlap(Property $property, Stay $stay): bool
    {
        return $property->bookings()->overlapping($stay)->exists();   // the same scope, one more layer
    }

    public function add(Booking $booking): void
    {
        $booking->save();                                              // still Eloquent underneath
    }
}

// CreateBooking would then ask for the repository instead of using the model
public function __construct(private BookingRepository $bookings)
{
}`,
          after: [
            'Look at what it hides: nothing. The interface takes and returns Eloquent `Booking` models, so the app still depends on Eloquent, and every query is now written twice (once in the scope, once in the repository).',
          ],
        },
        {
          title: 'Side by side',
          table: [
            ['', 'Active Record (Eloquent)', 'Data Mapper (Doctrine)', 'Repository over Eloquent'],
            ['Who saves?', '`$booking->save()`', '`$entityManager->flush()`', '`$bookings->add($booking)`'],
            ['Does the object know its table?', 'Yes', 'No', 'Yes, underneath'],
            ['Extra code per query', 'None', 'Mapping configuration', 'An interface method and an implementation'],
            ['Use it when', 'Most Laravel apps', 'Rules much richer than the tables', 'There is a real second storage, like an external API'],
          ],
          after: [
            'Nordic Stays stays with Active Record: it is what Laravel is built around, and the rules already live in actions and value objects. A repository would be added only on the day bookings also come from somewhere that isn’t our database, never "just in case".',
          ],
        },
      ],
    },
  ],
  laravel: {
    title: 'Laravel inside',
    text: ['How an Active Record saves itself, and why a fresh resource answers 201.'],
    blocks: [
      {
        title: 'Model::save()',
        text: ['The model decides between INSERT and UPDATE from `$exists`, fires its events, and after an insert sets `wasRecentlyCreated`.'],
        path: 'Illuminate/Database/Eloquent/Model.php (simplified)',
        fragment: true,
        code: String.raw`public function save(array $options = [])
{
    $query = $this->newModelQuery();

    if ($this->fireModelEvent('saving') === false) {
        return false;
    }

    $saved = $this->exists
        ? $this->performUpdate($query)            // only the changed columns ("dirty")
        : $this->performInsert($query);           // sets $this->exists and $this->wasRecentlyCreated

    if ($saved) {
        $this->finishSave($options);              // fires "saved", syncs the original attributes
    }

    return $saved;
}`,
      },
      {
        title: 'Why the resource answers 201',
        path: 'Illuminate/Http/Resources/Json/ResourceResponse.php',
        fragment: true,
        code: String.raw`protected function calculateStatus()
{
    return $this->resource->resource instanceof Model &&
           $this->resource->resource->wasRecentlyCreated ? 201 : 200;
}`,
      },
    ],
  },
  tests: {
    summary: 'Every status code, and the two trap tests',
    text: [
      'Written one at a time, red then green. The two **trap tests** matter most: with no overlap check at all they already pass, and they turn red the moment someone writes the naive `<=` rule from the broken code, or forgets the status. That’s why the **whole** suite runs after every change, not just the newest test.',
    ],
    blocks: [
      {
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
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com', ...$overrides,
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
    ],
  },
  next: 'Every test is green. Thursday evening, two guests click "Book" on the same nights in the same second, and both get a confirmation.',
};
