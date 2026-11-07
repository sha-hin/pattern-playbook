// Scene 2 · Value Object: Stay.

export default {
  description: 'After a release, every stay was billed one night short and shown a day early, because nights were counted between two moments. Fix it with a Stay value object of calendar dates in Laravel, and build real moments from the property timezone.',
  incident: {
    channel: '#support',
    when: 'Tuesday 08:40',
    messages: [
      ['Ahmed · host', 'My payout for this week is a quarter lower than it should be. A guest booked **1 to 5 July**, four nights; your system billed her for **3**. And her booking page says she arrives on **30 June**: she just emailed asking if her dates were changed.'],
      ['Karim · developer', 'Every booking since Monday’s release has one night too few. That release added check-in and check-out times to bookings.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Monday’s release turned the dates into the exact moments of arrival and departure, stored them, and counted the nights between them. The whole file, after that release:'],
      blocks: [
        {
          path: 'app/Http/Controllers/BookingController.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use Carbon\CarbonImmutable;
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

        $arrival = CarbonImmutable::parse("{$data['check_in']} {$property->check_in_time}", $property->timezone);
        $departure = CarbonImmutable::parse("{$data['check_out']} {$property->check_out_time}", $property->timezone);
        $nights = (int) $arrival->diffInDays($departure);                // 3.83 days → 3

        $booking = new Booking($data);
        $booking->property_id = $property->id;
        $booking->check_in = $arrival->utc();                          // a date stored as a moment
        $booking->check_out = $departure->utc();
        $booking->status = BookingStatus::Pending;
        $booking->total = $property->nightly_rate->times($nights);   // Money(45030, EUR): integers all the way
        $booking->save();

        return response()->json($booking);
    }
}`,
        },
        {
          path: 'php artisan tinker',
          lang: 'shell',
          code: String.raw`> $arrival->diffInDays($departure)            // 1 July 15:00 → 5 July 11:00
= 3.8333333333333
> CarbonImmutable::parse('2027-07-01 00:00', 'Europe/Copenhagen')->utc()
= 2027-06-30 22:00:00`,
          after: [
            '**Two bugs, one cause.** From 15:00 on the 1st to 11:00 on the 5th is 3 days and 20 hours, and `(int)` drops the 20 hours. And a date at midnight in Copenhagen is 22:00 the *day before* in UTC, so the booking page shows 30 June.',
            'The cause: **a stay is not two moments. It is two calendar dates.** "1 to 5 July" is four nights whatever the clock says, in any timezone.',
          ],
        },
      ],
    },
    {
      title: 'The fix: a Stay made of dates',
      text: [
        'The [`bookings`](F#table-bookings) table already stores `check_in` and `check_out` as `DATE` columns. What’s missing is one object that holds the two dates, refuses an impossible range, and knows how many nights it covers.',
      ],
      blocks: [
        {
          title: 'Stay',
          text: [
            'Both dates are kept at midnight UTC on purpose: they are calendar dates, not moments, and UTC has no daylight-saving changes, so the difference between them is always a whole number of days.',
            'A stay is `[check_in, check_out)`: the check-in night counts, the check-out day doesn’t. That’s what lets the next guest arrive on the day this one leaves.',
          ],
          path: 'app/Bookings/Stay.php',
          code: String.raw`<?php

namespace App\Bookings;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

final readonly class Stay
{
    private function __construct(
        public CarbonImmutable $checkIn,
        public CarbonImmutable $checkOut,
    ) {
    }

    /** @param string $checkIn e.g. "2027-07-01" */
    public static function fromDates(string $checkIn, string $checkOut): self
    {
        $in = CarbonImmutable::parse($checkIn, 'UTC')->startOfDay();      // a calendar date: midnight UTC
        $out = CarbonImmutable::parse($checkOut, 'UTC')->startOfDay();

        if ($out->lessThanOrEqualTo($in)) {
            throw new InvalidArgumentException('Check-out must be after check-in.');
        }

        return new self($in, $out);
    }

    public function nights(): int
    {
        return (int) $this->checkIn->diffInDays($this->checkOut);       // exact: two UTC midnights
    }

    /** True when the two stays share at least one night. Back-to-back stays don't overlap. */
    public function overlaps(self $other): bool
    {
        return $this->checkIn->lessThan($other->checkOut) && $this->checkOut->greaterThan($other->checkIn);
    }

    public function equals(self $other): bool
    {
        return $this->checkIn->equalTo($other->checkIn) && $this->checkOut->equalTo($other->checkOut);
    }
}`,
        },
        {
          title: 'When you do need a moment',
          text: ['Some things really happen at a moment: the arrival message goes out "the day before check-in, at 15:00". The moment is **built** from the date, the property’s check-in time and the property’s timezone, and returned in UTC, which is how the database stores times. It is never stored in place of the date. One more method on `Stay`:'],
          path: 'app/Bookings/Stay.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Models\Property;
use Carbon\CarbonImmutable;
use InvalidArgumentException;

final readonly class Stay
{
    private function __construct(
        public CarbonImmutable $checkIn,
        public CarbonImmutable $checkOut,
    ) {
    }

    /** @param string $checkIn e.g. "2027-07-01" */
    public static function fromDates(string $checkIn, string $checkOut): self
    {
        $in = CarbonImmutable::parse($checkIn, 'UTC')->startOfDay();      // a calendar date: midnight UTC
        $out = CarbonImmutable::parse($checkOut, 'UTC')->startOfDay();

        if ($out->lessThanOrEqualTo($in)) {
            throw new InvalidArgumentException('Check-out must be after check-in.');
        }

        return new self($in, $out);
    }

    public function nights(): int
    {
        return (int) $this->checkIn->diffInDays($this->checkOut);       // exact: two UTC midnights
    }

    /** True when the two stays share at least one night. Back-to-back stays don't overlap. */
    public function overlaps(self $other): bool
    {
        return $this->checkIn->lessThan($other->checkOut) && $this->checkOut->greaterThan($other->checkIn);
    }

    public function equals(self $other): bool
    {
        return $this->checkIn->equalTo($other->checkIn) && $this->checkOut->equalTo($other->checkOut);
    }

    /** The moment the guest can arrive, e.g. 1 July 15:00 in Europe/Copenhagen, returned in UTC. */
    public function checkInAt(Property $property): CarbonImmutable
    {
        return CarbonImmutable::parse(
            "{$this->checkIn->toDateString()} {$property->check_in_time}",
            $property->timezone,                          // the property's clock, not the server's
        )->utc();
    }
}`,
          after: ['The same 15:00 is 13:00 UTC in summer and 14:00 UTC in winter. Building it from the timezone gets that right on its own; a stored UTC time would be wrong for half the year.'],
        },
        {
          title: 'A cast: the booking hands out a Stay',
          path: 'app/Casts/StayCast.php',
          code: String.raw`<?php

namespace App\Casts;

use App\Bookings\Stay;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/** @implements CastsAttributes<Stay, Stay> */
final class StayCast implements CastsAttributes
{
    /** @param array<string, mixed> $attributes */
    public function get(Model $model, string $key, mixed $value, array $attributes): Stay
    {
        return Stay::fromDates((string) $attributes['check_in'], (string) $attributes['check_out']);
    }

    /**
     * @param array<string, mixed> $attributes
     * @return array<string, string>
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        if (! $value instanceof Stay) {
            throw new InvalidArgumentException("{$key} must be set with a Stay object.");
        }

        return ['check_in' => $value->checkIn->toDateString(), 'check_out' => $value->checkOut->toDateString()];
    }
}`,
        },
        {
          title: 'On the booking',
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Casts\MoneyCast;
use App\Casts\StayCast;
use App\Enums\BookingStatus;
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
}`,
        },
        {
          title: 'The booking, fixed',
          text: ['The whole file; the highlighted lines are the fix. The date check and the overlap check are scene 3’s.'],
          path: 'app/Http/Controllers/BookingController.php (after)',
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
          after: ['Nights are never stored: they are always computed from the dates, so they can never disagree with them.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Value Object'],
    rules: [['Value Object, again', 'The same pattern as `Money`, for a different value: a stay is defined by its two dates, can’t exist in an invalid state, and never changes.']],
    points: [
      '**Valid from the start:** `fromDates()` is the only way in, so every `Stay` in the app has check-out after check-in. Code that receives one never checks again.',
      '**Knows its own rules:** nights and overlap are answered in one place. In scene 3 the database uses the same `[check_in, check_out)` rule.',
      '**Equal by value:** two stays from 1 to 5 July are the same stay.',
    ],
    whenNot: [
      'A single date with no rules around it, like a guest’s birthday. A `CarbonImmutable` is enough.',
    ],
  },
  laravel: {
    text: [
      'Two things inside Laravel make this work. First, a `date` cast in Eloquent reads a `DATE` column as midnight **in the app timezone**. That’s why the foundation sets [`APP_TIMEZONE=UTC`](F#env): midnight UTC, the same as `Stay`.',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/Eloquent/Concerns/HasAttributes.php (simplified)',
        fragment: true,
        code: String.raw`protected function asDate($value)
{
    return $this->asDateTime($value)->startOfDay();   // a date is a datetime at 00:00 in config('app.timezone')
}`,
      },
      {
        text: ['Second, Laravel 11 and later ship **Carbon 3**, where `diffInDays()` returns a **float** (3.8333…), not an integer as it did in Carbon 2. Code that relied on the old rounding broke silently on upgrade. Counting days between two midnights, as `Stay` does, gives a whole number in both versions.'],
      },
    ],
  },
  tests: {
    summary: 'Nights, invalid ranges, overlap, arrival across daylight saving, and the cast',
    blocks: [
      {
        path: 'tests/Unit/StayTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;

it('counts calendar nights', function () {
    expect(Stay::fromDates('2027-07-01', '2027-07-05')->nights())->toBe(4);   // the incident
});

it('refuses a check-out that is not after check-in', function (string $out) {
    Stay::fromDates('2027-07-05', $out);
})->with(['2027-07-05', '2027-07-01'])->throws(InvalidArgumentException::class);

it('lets the next guest arrive on the day the last one leaves', function () {
    $first = Stay::fromDates('2027-07-01', '2027-07-05');

    expect($first->overlaps(Stay::fromDates('2027-07-05', '2027-07-08')))->toBeFalse()
        ->and($first->overlaps(Stay::fromDates('2027-07-04', '2027-07-08')))->toBeTrue();
});`,
      },
      {
        path: 'tests/Feature/StayTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Booking;
use App\Models\Property;

it('builds the arrival moment from the property timezone, across daylight saving', function (string $date, string $utc) {
    $property = Property::factory()->create(['timezone' => 'Europe/Copenhagen', 'check_in_time' => '15:00']);

    $arrival = Stay::fromDates($date, '2027-04-10')->checkInAt($property);

    expect($arrival->toDateTimeString())->toBe($utc);
})->with([
    'winter time (UTC+1)' => ['2027-03-27', '2027-03-27 14:00:00'],
    'summer time (UTC+2)' => ['2027-03-29', '2027-03-29 13:00:00'],   // clocks moved on 28 March
]);

it('reads and writes a booking’s stay', function () {
    $booking = Booking::factory()->forStay('2027-07-01', 4)->create();

    $booking->stay = Stay::fromDates('2027-07-02', '2027-07-06');
    $booking->save();

    expect($booking->fresh()->stay->equals(Stay::fromDates('2027-07-02', '2027-07-06')))->toBeTrue()
        ->and($booking->fresh()->check_in->toDateString())->toBe('2027-07-02');
});`,
      },
    ],
  },
  next: 'Money and dates are now values with rules. Wednesday: the booking endpoint itself falls over, and someone who isn’t a host books a cabin.',
};
