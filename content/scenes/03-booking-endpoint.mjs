// Scene 3 · Active Record: the booking endpoint.

export default {
  description: 'A 200-line booking controller returned 500 on double bookings and let any user book any property. Split it into a Form Request, a Policy, an action and a Resource, and see why Eloquent’s Active Record is the right home for it.',
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
          text: ['The endpoint as it stands after scenes 1 and 2:'],
          path: 'app/Http/Controllers/BookingController.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BookingController extends Controller
{
    public function store(Request $request, int $propertyId): JsonResponse
    {
        $property = Property::findOrFail($propertyId);
        $data = $request->all();

        $clash = DB::table('bookings')->where('property_id', $propertyId)
            ->where('check_in', '<=', $data['check_out'])
            ->where('check_out', '>=', $data['check_in'])
            ->exists();
        if ($clash) {
            throw new Exception('Already booked');
        }

        $stay = Stay::fromDates($data['check_in'], $data['check_out']);   // throws on 5 → 1 July

        $booking = new Booking($data);
        $booking->property_id = $property->id;
        $booking->stay = $stay;                                         // two DATE columns, no time attached
        $booking->status = BookingStatus::Pending;
        $booking->total = $property->nightly_rate->times($stay->nights());
        $booking->save();

        return response()->json($booking);
    }
}`,
          after: ['Four bugs in one method. `findOrFail()` lets anyone logged in book any property. `$request->all()` accepts every field unvalidated. The clash check uses `<=` and `>=`, so back-to-back stays are refused, and it counts cancelled bookings. And a clash throws a plain `Exception`: a 500.', 'Validation, permission, the business rule, saving and the response format are mixed in one method. None can be reused or tested on its own, which is exactly why the Airbnb import copied the overlap rule instead of calling it.'],
        },
      ],
    },
    {
      title: 'The fix: one home for each part',
      text: ['The request goes through five small pieces, each with one job. Read them in the order a request meets them.'],
      blocks: [
        {
          title: '1. The route',
          text: ['`auth:sanctum` answers **401** without a valid token. Route model binding answers **404** for an unknown property. `can()` runs the policy below and answers **403**. The whole file, replacing the launch-week route:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\BookingController;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api: the full URL is /api/v1/properties/{property}/bookings.
Route::post('/v1/properties/{property}/bookings', [BookingController::class, 'store'])
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
          text: ['The correct rule, in one place: an existing booking blocks the new stay when it **starts before the new one ends** and **ends after the new one starts**. Strict `<` and `>`, so back-to-back stays pass. And only pending and confirmed bookings count.', 'First, the statuses that occupy the calendar, on the enum:'],
          path: 'app/Enums/BookingStatus.php',
          code: String.raw`<?php

namespace App\Enums;

enum BookingStatus: string
{
    case Pending = 'pending';                 // a hold, waiting for payment
    case Confirmed = 'confirmed';
    case Cancelled = 'cancelled';
    case Expired = 'expired';                 // a hold that was never paid

    /** The statuses that occupy the calendar. @return list<self> */
    public static function blocking(): array
    {
        return [self::Pending, self::Confirmed];
    }
}`,
        },
        {
          text: ['Then the rule, as a query scope on the model, so every caller (this endpoint, the Airbnb import, an admin tool) uses the same rule, and the database runs it with the [composite index](F#table-bookings):'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Casts\StayCast;
use App\Enums\BookingStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'check_in', 'check_out', 'guests'];

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

    /** Bookings that share at least one night with $stay: $property->bookings()->overlapping($stay). */
    public function scopeOverlapping(Builder $query, Stay $stay): void
    {
        $query->whereIn('status', BookingStatus::blocking())
            ->where('check_in', '<', $stay->checkOut->toDateString())     // starts before the new stay ends
            ->where('check_out', '>', $stay->checkIn->toDateString());    // ends after the new stay starts
    }
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
          rewrite: true,
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
      'When the business rules are much richer than the tables (complex insurance or trading domains), objects that know nothing about the database are easier to keep correct. That’s the Data Mapper, built at the end of the course.',
    ],
  },
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
