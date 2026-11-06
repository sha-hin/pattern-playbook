// Scene 1 · Value Object: Money.

export default {
  description: 'A guest was charged €450.29 for a €450.30 stay because prices were floats. Fix it with money in cents and a Money value object in Laravel, with an Eloquent cast.',
  incident: {
    channel: '#support',
    when: 'Monday 09:12',
    messages: [
      ['Mona · support', 'A guest booked the Nyhavn flat for 3 nights at €150.10. The confirmation email says €450.30, but Stripe charged **€450.29**. She’s asking if we’re scamming her. It’s the third complaint this month, always one cent.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Http/Controllers/CheckoutController.php (before)',
          broken: true, fragment: true,
          code: String.raw`$nightly = $property->nightly_rate;                 // 150.10, a DECIMAL column read as float
$total = $nightly * $nights;                        // 450.3 ... or is it?

$stripe->paymentIntents->create([
    'amount' => (int) ($total * 100),               // Stripe wants cents
    'currency' => 'eur',
]);`,
        },
        {
          text: ['Run it in Tinker:'],
          path: 'php artisan tinker',
          lang: 'shell',
          code: String.raw`> 150.10 * 3
= 450.29999999999995
> (int) (150.10 * 3 * 100)
= 45029`,
          after: ['A float is stored in binary, and **150.10 has no exact binary form**, just as 1/3 has no exact decimal form. The multiplication lands a hair below 450.30, and `(int)` cuts off the rest instead of rounding. The email rounded for display, Stripe got the cut-off value.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: integers, in cents',
      text: [
        'Money is never a float. It is a whole number in the currency’s smallest unit: €150.10 is stored as `15010`. That’s why the [`properties`](F#table-properties) table has `nightly_rate_cents`, an unsigned integer. Integer arithmetic is exact: `15010 * 3` is `45030`, every time.',
        'That fixes the cent. But the amount is now a bare `int`, with its currency in another column, and nothing stops this:',
      ],
      blocks: [
        {
          path: 'anywhere in the app',
          broken: true, fragment: true,
          code: String.raw`$total = $flat->nightly_rate_cents + $loft->nightly_rate_cents;   // EUR cents + EGP piastres = a meaningless number`,
          after: ['The number and its currency have to travel together, as one thing.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: one object for amount and currency',
      blocks: [
        {
          title: 'The currency knows its decimals',
          text: ['Not every currency has cents: 15010 euro cents is €150.10, but 15010 yen is ¥15,010. The enum lists the currencies Nordic Stays accepts, and an unknown code fails the moment it is read.'],
          path: 'app/Money/Currency.php',
          code: String.raw`<?php

namespace App\Money;

enum Currency: string
{
    case EUR = 'EUR';
    case USD = 'USD';
    case EGP = 'EGP';
    case JPY = 'JPY';

    /** Digits after the decimal point (ISO 4217). */
    public function minorUnits(): int
    {
        return match ($this) {
            self::JPY => 0,
            default => 2,
        };
    }
}`,
        },
        {
          title: 'Money',
          text: [
            'Three choices do the work. `readonly`: a `Money` can’t change after it’s created, so one passed around the app can’t be modified behind your back. A **private constructor**: `of()` is the only way in, and it always resolves the currency. And no float, anywhere in a calculation.',
          ],
          path: 'app/Money/Money.php',
          code: String.raw`<?php

namespace App\Money;

use Illuminate\Support\Number;
use LogicException;

final readonly class Money
{
    private function __construct(
        public int $amount,                                     // in minor units: cents, piastres, yen
        public Currency $currency,
    ) {
    }

    public static function of(int $amount, Currency|string $currency): self
    {
        return new self($amount, $currency instanceof Currency ? $currency : Currency::from($currency));
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount + $other->amount, $this->currency);   // a new object; $this never changes
    }

    public function times(int $factor): self
    {
        return new self($this->amount * $factor, $this->currency);
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount && $this->currency === $other->currency;
    }

    /** For people only (emails, screens). Never feed this back into a calculation. */
    public function format(): string
    {
        return Number::currency($this->amount / 10 ** $this->currency->minorUnits(), $this->currency->value);
    }

    private function assertSameCurrency(self $other): void
    {
        if ($other->currency !== $this->currency) {
            throw new LogicException("Can't combine {$this->currency->value} with {$other->currency->value}.");
        }
    }
}`,
        },
      ],
    },
    {
      title: 'Using it',
      blocks: [
        {
          title: 'A cast: the model hands out Money',
          text: ['One `Money` attribute is built from **two** columns: the amount and `currency`. So `set()` returns both.'],
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
    public function __construct(private string $amountColumn)  // e.g. "nightly_rate_cents"
    {
    }

    /** @param array<string, mixed> $attributes */
    public function get(Model $model, string $key, mixed $value, array $attributes): Money
    {
        return Money::of((int) $attributes[$this->amountColumn], $attributes['currency']);
    }

    /**
     * @param array<string, mixed> $attributes
     * @return array<string, int|string>
     */
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
          title: 'On the models',
          text: ['The argument after the colon tells the cast which column holds the amount. Added to the casts of [Property](F#model-property) and [Booking](F#model-booking):'],
          path: 'app/Models/Property.php · app/Models/Booking.php (casts)',
          fragment: true,
          code: String.raw`// Property
protected function casts(): array
{
    return ['nightly_rate' => MoneyCast::class . ':nightly_rate_cents'];
}

// Booking: one line added to its casts
'total' => MoneyCast::class . ':total_cents',`,
        },
        {
          title: 'The charge, fixed',
          path: 'app/Http/Controllers/CheckoutController.php (after)',
          fragment: true,
          code: String.raw`$total = $property->nightly_rate->times($nights);    // Money(45030, EUR)

$stripe->paymentIntents->create([
    'amount' => $total->amount,                         // 45030: already in minor units, nothing to convert
    'currency' => strtolower($total->currency->value),
]);`,
          after: ['The email shows `$total->format()` (€450.30) and Stripe charges `45030`. Both come from the same object, so they can’t disagree again.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Value Object'],
    rules: [['Value Object', 'A small object defined only by its value: immutable, and valid from the moment it exists.']],
    points: [
      'Two `Money(45030, EUR)` objects are **equal** even though they are different objects. That’s why `equals()` compares values, not identity.',
      'It **protects its own rules**: no mixing currencies, no floats, no changing after creation.',
      'It comes from Domain-Driven Design (Eric Evans, 2003), not from the Gang of Four book.',
    ],
    whenNot: [
      'A value with no rules, like a guest’s name. A `string` is enough.',
      'Something with its own identity that changes over time, like a booking. That’s an entity (a model), not a value.',
    ],
  },
  laravel: {
    text: ['Every date Laravel gives you is a value object: `CarbonImmutable`, switched on in the [foundation](F#app-provider) with `Date::use(CarbonImmutable::class)`.'],
    blocks: [
      {
        path: 'php artisan tinker',
        fragment: true,
        code: String.raw`$checkIn = CarbonImmutable::parse('2027-07-01');
$checkOut = $checkIn->addDays(3);         // a NEW object

$checkIn->toDateString();                 // still "2027-07-01"`,
        after: ['With the mutable `Carbon`, `addDays()` would have moved `$checkIn` too: the same kind of hidden change that `readonly` rules out for `Money`.'],
      },
      {
        title: 'How Eloquent calls your cast',
        text: ['The cast runs the first time you read the attribute, and the result is cached on the model, so `$property->nightly_rate` builds one `Money` per model, not one per read.'],
        path: 'Illuminate/Database/Eloquent/Concerns/HasAttributes.php (simplified)',
        fragment: true,
        code: String.raw`protected function getClassCastableAttributeValue($key, $value)
{
    $caster = $this->resolveCasterClass($key);            // new MoneyCast('nightly_rate_cents')

    return $this->classCastCache[$key] ??= $caster->get($this, $key, $value, $this->attributes);
}`,
      },
    ],
  },
  tests: {
    summary: 'Money arithmetic, currencies, formatting and the cast',
    blocks: [
      {
        path: 'tests/Unit/MoneyTest.php',
        code: String.raw`<?php

use App\Money\Money;

it('multiplies exactly, with no lost cent', function () {
    expect(Money::of(15_010, 'EUR')->times(3)->amount)->toBe(45_030);   // the incident
});

it('never changes the original', function () {
    $nightly = Money::of(15_010, 'EUR');

    $nightly->times(3);

    expect($nightly->amount)->toBe(15_010);
});

it('refuses to mix currencies', function () {
    Money::of(100, 'EUR')->add(Money::of(100, 'EGP'));
})->throws(LogicException::class, "Can't combine EUR with EGP.");

it('compares by value', function () {
    expect(Money::of(45_030, 'EUR')->equals(Money::of(45_030, 'EUR')))->toBeTrue()
        ->and(Money::of(45_030, 'EUR')->equals(Money::of(45_030, 'USD')))->toBeFalse();
});

it('formats with the currency’s own decimals', function (int $amount, string $currency, string $shown) {
    expect(Money::of($amount, $currency)->format())->toBe($shown);
})->with([
    [45_030, 'EUR', '€450.30'],
    [15_010, 'JPY', '¥15,010'],
]);`,
      },
      {
        path: 'tests/Feature/MoneyCastTest.php',
        code: String.raw`<?php

use App\Models\Property;
use App\Money\Money;

it('reads the nightly rate as Money', function () {
    $property = Property::factory()->create(['nightly_rate_cents' => 15_010, 'currency' => 'EUR']);

    expect($property->fresh()->nightly_rate->equals(Money::of(15_010, 'EUR')))->toBeTrue();
});

it('writes the amount and the currency together', function () {
    $property = Property::factory()->create();

    $property->nightly_rate = Money::of(9_900, 'USD');
    $property->save();

    expect($property->fresh())
        ->nightly_rate_cents->toBe(9_900)
        ->currency->toBe('USD');
});`,
      },
    ],
  },
  next: 'Money is fixed. Tuesday morning, a guest who booked four nights gets an invoice for three.',
};
