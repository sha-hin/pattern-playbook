// Lesson 1: Value Object. Money and Stay.

export default {
  description: 'Money and stays passed around as bare integers and strings cause lost cents, wrong currencies and wrong night counts. Fix it with the Value Object pattern in Laravel: Money, Currency and Stay, with Eloquent casts.',
  ticket: {
    from: 'Finance',
    title: 'A deposit lost a cent, and a Japanese guest was charged ¥150.00',
    body: 'Three problems this month. A €100.00 booking paid in three instalments was charged 3 × €33.33 = €99.99. The Tokyo apartment shows "¥150.00" and sends 15000 to Stripe, which for yen means ¥15,000. And a Copenhagen guest was charged for 2 nights instead of 3, because someone counted nights between two datetimes in UTC.',
  },
  pain: {
    text: ['Every screen does its own arithmetic on bare numbers:'],
    code: String.raw`$deposit = intdiv($booking->total_cents, 3);                      // the remainder disappears
$balance = intdiv($booking->total_cents * 2, 3);

$display = number_format($property->nightly_rate_cents / 100, 2);   // assumes 2 decimals: wrong for JPY

$nights = $checkIn->diffInDays($checkOut);                          // datetimes in UTC: DST shifts the result`,
    after: [
      'An integer has no currency, so nothing stops adding euros to pounds. Every place that divides or formats has to remember that JPY has no minor unit and KWD has three. A pair of date strings has no rule that check-out comes after check-in, and every place that needs the number of nights calculates it again, slightly differently.',
      'The rules belong to the **values themselves**: a money amount always knows its currency and its minor unit; a stay always has a valid range and knows its nights.',
    ],
  },
  patterns: [
    {
      name: 'Value Object',
      rule: 'A small immutable object defined by its value, not its identity. It checks itself when created, so if you hold one it is valid, and every operation returns a new one.',
      explain: [
        'Instead of passing `45000` and `\'EUR\'` separately, the code passes one `Money` object. Its constructor is the only way in, so an invalid amount or an unknown currency can never exist. It is `readonly`: nothing can change it after it was checked. Two `Money` objects with the same amount and currency are equal, even if they are different instances.',
        'Operations like `add()` or `allocate()` never change the object; they return new ones. That makes them safe to pass around: no code can change a price that another part of the system is still using.',
        'Value Object comes from Domain-Driven Design (Eric Evans, 2003). It is not in the Gang of Four book.',
      ],
      drawing: {
        bad: [['b', 4, 14, 96, 30, 'Checkout ÷ 100', 'x'], ['b', 4, 68, 96, 30, 'Deposit ÷ 3', 'x'], ['b', 4, 122, 96, 30, 'Nights in UTC', 'x'], ['a', 100, 29, 196, 76, '', 'x'], ['a', 100, 83, 196, 83, '', 'x'], ['a', 100, 137, 196, 90, '', 'x'], ['b', 198, 60, 98, 46, '45000, "EUR"', 'n'], ['t', 247, 128, 'bare values', 'kx', 'middle']],
        good: [['b', 4, 14, 84, 30, 'Checkout', 'n'], ['b', 4, 68, 84, 30, 'Payments', 'n'], ['b', 4, 122, 84, 30, 'Calendar', 'n'], ['a', 88, 29, 160, 70, '', 'k'], ['a', 88, 83, 160, 83, '', 'k'], ['a', 88, 137, 160, 96, '', 'k'], ['b', 162, 52, 134, 62, 'Money · Stay', 'v'], ['t', 229, 132, 'rules live in the value', 's', 'middle']],
        badCaption: 'Every screen does its own arithmetic on bare numbers, and each one can get it wrong.',
        goodCaption: 'Every screen uses the same objects, which carry their own rules.',
      },
    },
  ],
  sections: [
    {
      title: 'Build it',
      blocks: [
        {
          title: 'The currency knows its minor unit',
          text: ['ISO 4217 defines how many decimals each currency has: two for EUR and USD, zero for JPY, three for KWD. A backed enum lists the currencies the PMS accepts, and `match` gives each its exponent. An unknown currency code fails when it is read, not when Stripe rejects it.'],
          path: 'app/Money/Currency.php',
          code: String.raw`<?php

namespace App\Money;

enum Currency: string
{
    case EUR = 'EUR';
    case USD = 'USD';
    case GBP = 'GBP';
    case EGP = 'EGP';
    case JPY = 'JPY';
    case KWD = 'KWD';

    /** Digits after the decimal point (ISO 4217). Stripe expects amounts in this unit. */
    public function minorUnits(): int
    {
        return match ($this) {
            self::JPY => 0,
            self::KWD => 3,
            default => 2,
        };
    }
}`,
        },
        {
          title: 'Money',
          text: [
            '`final readonly class`: nobody can extend it, and no property can change after construction. The amount is always an integer in the minor unit, so there is no floating-point arithmetic anywhere.',
            '`allocate()` splits an amount by ratios without losing anything: each part gets its share rounded down, and the leftover units go one by one to the first parts. 100.00 split 1:1:1 becomes 33.34 + 33.33 + 33.33, which adds back to exactly 100.00.',
          ],
          path: 'app/Money/Money.php',
          code: String.raw`<?php

namespace App\Money;

use InvalidArgumentException;

final readonly class Money
{
    /** @param int $amount in the currency's minor unit: cents for EUR, yen for JPY */
    public function __construct(
        public int $amount,
        public Currency $currency,
    ) {
    }

    public static function of(int $amount, Currency|string $currency): self
    {
        return new self($amount, $currency instanceof Currency ? $currency : Currency::from($currency));
    }

    public static function zero(Currency $currency): self
    {
        return new self(0, $currency);
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount + $other->amount, $this->currency);
    }

    public function subtract(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount - $other->amount, $this->currency);
    }

    public function times(int $quantity): self
    {
        return new self($this->amount * $quantity, $this->currency);
    }

    /** A percentage of this amount, rounded half up to the minor unit (e.g. a 50% refund). */
    public function percent(int $percent): self
    {
        return new self(intdiv($this->amount * $percent + 50, 100), $this->currency);
    }

    /**
     * Splits the amount by ratios without losing a single minor unit.
     *
     * @param int ...$ratios e.g. 30, 70 for a deposit and a balance
     * @return list<self>
     */
    public function allocate(int ...$ratios): array
    {
        $total = array_sum($ratios);
        if ($total <= 0 || min($ratios) < 0) {
            throw new InvalidArgumentException('Ratios must be zero or positive, with a positive total.');
        }
        if ($this->amount < 0) {
            throw new InvalidArgumentException('Only a positive amount can be allocated.');
        }

        $parts = [];
        $remainder = $this->amount;
        foreach ($ratios as $ratio) {
            $share = intdiv($this->amount * $ratio, $total);          // rounded down
            $parts[] = $share;
            $remainder -= $share;
        }
        for ($i = 0; $remainder > 0; $i++, $remainder--) {
            $parts[$i % count($parts)]++;                               // leftover units, one each, from the first part
        }

        return array_map(fn (int $amount): self => new self($amount, $this->currency), $parts);
    }

    public function isZero(): bool
    {
        return $this->amount === 0;
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount && $this->currency === $other->currency;
    }

    /** The amount as a decimal string in major units: "150.00" for EUR, "15000" for JPY. */
    public function toDecimal(): string
    {
        $units = $this->currency->minorUnits();

        return $units === 0 ? (string) $this->amount : number_format($this->amount / 10 ** $units, $units, '.', '');
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new InvalidArgumentException("Cannot combine {$this->currency->value} with {$other->currency->value}.");
        }
    }
}`,
        },
        {
          title: 'Stay: a valid date range that knows its nights',
          text: [
            'A stay is two dates, check-in included and check-out excluded. It refuses an empty or reversed range, so `nights()` is always at least 1. Dates are kept at midnight UTC on purpose: they are calendar dates, not moments, so no daylight-saving change can move them.',
            'When a moment is needed ("check-in is at 15:00 in Copenhagen"), `checkInMoment()` builds it in the **property’s** timezone and returns it in UTC, which is how the database stores times.',
          ],
          path: 'app/Bookings/Stay.php',
          code: String.raw`<?php

namespace App\Bookings;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

final readonly class Stay
{
    public CarbonImmutable $checkIn;
    public CarbonImmutable $checkOut;

    public function __construct(CarbonImmutable $checkIn, CarbonImmutable $checkOut)
    {
        $this->checkIn = $checkIn->utc()->startOfDay();                 // a calendar date, not a moment
        $this->checkOut = $checkOut->utc()->startOfDay();

        if ($this->checkOut->lessThanOrEqualTo($this->checkIn)) {
            throw new InvalidArgumentException('Check-out must be after check-in.');
        }
    }

    public static function fromDates(string $checkIn, string $checkOut): self
    {
        return new self(CarbonImmutable::parse($checkIn, 'UTC'), CarbonImmutable::parse($checkOut, 'UTC'));
    }

    public function nights(): int
    {
        return (int) $this->checkIn->diffInDays($this->checkOut);       // exact: both are UTC midnights
    }

    /** True when the two stays share at least one night. Back-to-back stays don't overlap. */
    public function overlaps(self $other): bool
    {
        return $this->checkIn->lessThan($other->checkOut) && $this->checkOut->greaterThan($other->checkIn);
    }

    /** The real moment of check-in, e.g. 15:00 in Europe/Copenhagen, returned in UTC. */
    public function checkInMoment(string $timezone, string $time): CarbonImmutable
    {
        return CarbonImmutable::parse("{$this->checkIn->toDateString()} {$time}", $timezone)->utc();
    }

    public function equals(self $other): bool
    {
        return $this->checkIn->equalTo($other->checkIn) && $this->checkOut->equalTo($other->checkOut);
    }
}`,
        },
        {
          title: 'Eloquent casts: the model hands out value objects',
          text: [
            'A cast class turns columns into a value object when you read the attribute, and back into columns when you set it. One `Money` attribute uses **two** columns (`total_cents` and `currency`), so `set()` returns an array of both.',
          ],
          path: 'app/Casts/MoneyCast.php',
          code: String.raw`<?php

namespace App\Casts;

use App\Money\Money;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/** @implements CastsAttributes<Money, Money> */
final class MoneyCast implements CastsAttributes
{
    /** @param string $amountColumn e.g. "total_cents"; the currency is always in "currency" */
    public function __construct(private readonly string $amountColumn)
    {
    }

    public function get(Model $model, string $key, mixed $value, array $attributes): ?Money
    {
        if (($attributes[$this->amountColumn] ?? null) === null) {
            return null;
        }

        return Money::of((int) $attributes[$this->amountColumn], $attributes['currency']);
    }

    /** @return array<string, int|string> */
    public function set(Model $model, string $key, mixed $value, array $attributes): array
    {
        if (! $value instanceof Money) {
            throw new InvalidArgumentException("{$key} must be set with a Money object.");
        }

        return [$this->amountColumn => $value->amount, 'currency' => $value->currency->value];
    }
}`,
        },
        {
          title: 'The Stay cast',
          text: ['Same idea for the stay: two date columns in, one `Stay` out.'],
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
    public function get(Model $model, string $key, mixed $value, array $attributes): ?Stay
    {
        if (! isset($attributes['check_in'], $attributes['check_out'])) {
            return null;
        }

        return Stay::fromDates((string) $attributes['check_in'], (string) $attributes['check_out']);
    }

    /** @return array<string, string> */
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
          title: 'Using the casts on the models',
          text: ['The cast arguments come after a colon. `total` is not a column: it is a virtual attribute built from `total_cents` and `currency`. The `Stay` cast follows the same idea with `check_in` and `check_out`.'],
          path: 'app/Models/Booking.php (casts)', fragment: true,
          code: String.raw`protected function casts(): array
{
    return [
        'check_in' => 'date:Y-m-d',
        'check_out' => 'date:Y-m-d',
        'status' => BookingStatus::class,
        'total' => MoneyCast::class . ':total_cents',
        'stay' => StayCast::class,
        'expires_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];
}

// Anywhere in the app:
$booking->total;                                 // Money(45000, EUR)
$booking->stay->nights();                        // 3
[$deposit, $balance] = $booking->total->allocate(30, 70);`,
        },
      ],
    },
  ],
  laravel: {
    text: [
      'Laravel builds value objects from casts inside `HasAttributes`. When you read `$booking->total`, the model sees that `total` has a class cast, calls the cast’s `get()` with **all** raw attributes, and caches the object so the same instance is returned until the underlying columns change. Setting it does the reverse and merges the returned columns into the attributes.',
    ],
    blocks: [
      {
        title: 'Reading a class-cast attribute',
        path: 'Illuminate/Database/Eloquent/Concerns/HasAttributes.php (simplified)',
        code: String.raw`protected function getClassCastableAttributeValue($key, $value)
{
    $caster = $this->resolveCasterClass($key);               // new MoneyCast('total_cents')

    if (isset($this->classCastCache[$key])) {
        return $this->classCastCache[$key];                  // the same object until the columns change
    }

    $value = $caster->get($this, $key, $value, $this->attributes);

    if (is_object($value)) {
        $this->classCastCache[$key] = $value;
    }

    return $value;
}`,
      },
      {
        title: 'Setting it: one value, several columns',
        path: 'Illuminate/Database/Eloquent/Concerns/HasAttributes.php (simplified)',
        code: String.raw`protected function setClassCastableAttribute($key, $value)
{
    $caster = $this->resolveCasterClass($key);

    $this->attributes = array_replace(
        $this->attributes,
        $this->normalizeCastClassResponse($key, $caster->set($this, $key, $value, $this->attributes)),
    );                                                       // ['total_cents' => 45000, 'currency' => 'EUR']

    unset($this->classCastCache[$key]);
}`,
      },
      {
        title: 'Immutable dates everywhere',
        text: ['Laravel’s own date value objects are Carbon instances. By default they are mutable: `$date->addDay()` changes the object, and every model or variable holding it. One line makes every date Laravel creates immutable.'],
        path: 'app/Providers/AppServiceProvider.php', fragment: true,
        code: String.raw`use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Date;

public function boot(): void
{
    Date::use(CarbonImmutable::class);       // now(), casts and Carbon::parse() return immutable dates
}`,
      },
    ],
  },
  topics: {
    blocks: [
      {
        title: 'Money as integers, and currencies',
        text: [
          'Floats can’t represent most decimal fractions exactly (`0.1 + 0.2 !== 0.3`), so money is stored and calculated as integers in the minor unit. The minor unit differs per currency (ISO 4217), and Stripe expects amounts in exactly that unit: `15000` means €150.00 but ¥15,000. That is why `Money` carries its `Currency`, and why no code divides by 100.',
          'For display, Laravel’s `Number::currency()` formats a major-unit amount in the user’s locale: `Number::currency((float) $money->toDecimal(), in: $money->currency->value, locale: \'da\')` gives "150,00 €".',
        ],
      },
      {
        title: 'Deposits and balances',
        text: ['A booking is often paid in two parts: a deposit now and the balance some days before arrival. `allocate(30, 70)` splits the total so the two parts always add back to it exactly. Lesson 20 charges them through Stripe.'],
      },
      {
        title: 'Dates and timezones with Carbon',
        text: [
          'Three rules: store **calendar dates** (`check_in`) as `DATE` and treat them as UTC midnights; store **moments** (`send_at`, `due_at`) as UTC datetimes; convert to the **property’s** timezone only when you build a moment from a local time ("15:00 in Copenhagen"). Daylight-saving changes then can’t shift a stay, and the guest’s 15:00 is right in both summer and winter.',
        ],
      },
      {
        title: 'PHP 8: readonly classes and enums',
        text: ['`readonly` properties can be set once, in the constructor, and never again; `final readonly class` makes every property readonly. Backed enums give a fixed list of values with methods (`minorUnits()`), and `match` returns a value per case without a forgotten `break`.'],
      },
    ],
  },
  whenNot: [
    'Not every scalar needs a class. A guest name has no rules beyond "not empty", which validation already covers. Create a value object when the value has **rules or behaviour**: money, date ranges, coordinates, percentages.',
    'Keep value objects free of database queries and services. A `Money` that looks up exchange rates is no longer a value; that belongs in a service that takes and returns `Money`.',
    'Don’t replace the integer columns with JSON to "store the object". Keep plain columns so the database can index, sum and constrain them; the cast is the bridge.',
  ],
  tests: {
    summary: 'Unit tests for Money and Stay, and the cast round trip',
    text: ['Value objects are pure PHP, so most of these are unit tests: no database, very fast. Each one was red before the code existed; the comments name the mutation that would make it fail.'],
    blocks: [
      {
        title: 'Money',
        path: 'tests/Unit/MoneyTest.php',
        code: String.raw`<?php

use App\Money\Currency;
use App\Money\Money;

it('splits an amount without losing a cent', function (int $amount, array $ratios, array $expected) {
    $parts = Money::of($amount, 'EUR')->allocate(...$ratios);

    expect(array_map(fn (Money $m): int => $m->amount, $parts))->toBe($expected)
        ->and(array_sum($expected))->toBe($amount);           // mutation: drop the remainder loop → fails
})->with([
    'thirds' => [10_000, [1, 1, 1], [3_334, 3_333, 3_333]],
    'deposit and balance' => [45_001, [30, 70], [13_501, 31_500]],
    'a zero ratio' => [1_000, [0, 1], [0, 1_000]],
]);

it('refuses to mix currencies', function () {
    Money::of(100, 'EUR')->add(Money::of(100, 'GBP'));
})->throws(InvalidArgumentException::class, 'Cannot combine EUR with GBP');

it('rounds a percentage half up', function () {
    expect(Money::of(1_005, 'EUR')->percent(50)->amount)->toBe(503);   // 502.5 → 503
});

it("prints amounts in the currency's own decimals", function (Currency $currency, int $amount, string $decimal) {
    expect(Money::of($amount, $currency)->toDecimal())->toBe($decimal);
})->with([
    [Currency::EUR, 15_000, '150.00'],
    [Currency::JPY, 15_000, '15000'],
    [Currency::KWD, 15_000, '15.000'],
]);`,
      },
      {
        title: 'Stay',
        path: 'tests/Unit/StayTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;

it('counts nights across a daylight-saving change', function () {
    // Europe moves clocks forward on 28 March 2027; the stay still has 3 nights.
    expect(Stay::fromDates('2027-03-27', '2027-03-30')->nights())->toBe(3);
});

it('refuses an empty or reversed stay', function (string $in, string $out) {
    Stay::fromDates($in, $out);
})->with([['2027-07-04', '2027-07-04'], ['2027-07-04', '2027-07-01']])
  ->throws(InvalidArgumentException::class);

it('lets back-to-back stays share the changeover day', function () {
    $first = Stay::fromDates('2027-07-01', '2027-07-04');

    expect($first->overlaps(Stay::fromDates('2027-07-04', '2027-07-06')))->toBeFalse()   // mutation: < → <= fails here
        ->and($first->overlaps(Stay::fromDates('2027-07-03', '2027-07-05')))->toBeTrue();
});

it('builds check-in time in the property timezone', function () {
    $stay = Stay::fromDates('2027-07-01', '2027-07-04');

    expect($stay->checkInMoment('Europe/Copenhagen', '15:00')->toIso8601String())
        ->toBe('2027-07-01T13:00:00+00:00');                  // summer time: UTC+2
});`,
      },
      {
        title: 'The cast round trip',
        path: 'tests/Feature/MoneyCastTest.php',
        code: String.raw`<?php

use App\Models\Booking;
use App\Money\Money;

it('stores Money in two columns and reads it back', function () {
    $booking = Booking::factory()->create();
    $booking->total = Money::of(98_765, 'JPY');
    $booking->save();

    $fresh = $booking->fresh();

    expect($fresh->total_cents)->toBe(98_765)
        ->and($fresh->currency)->toBe('JPY')
        ->and($fresh->total->equals(Money::of(98_765, 'JPY')))->toBeTrue();
});`,
      },
    ],
  },
  next: 'With values in place, lesson 2 decides where the booking logic and its SQL live: in the model, in a mapper, or in a repository.',
};
