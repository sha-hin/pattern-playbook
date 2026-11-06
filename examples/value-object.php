<?php

declare(strict_types=1);

/**
 * Value Object: the full pattern in plain PHP, no framework.
 * Run it: php examples/value-object.php
 *
 * Roles:
 * - Value object: Money (immutable, checks itself, equal by value)
 * - The four rules: readonly properties · validation in the constructor ·
 *   equals() compares values · every operation returns a NEW object
 *
 * In Laravel:
 * Laravel has no Money class, but it gives you the plumbing: a custom cast
 * (Illuminate\Contracts\Database\Eloquent\CastsAttributes) turns a column into a value
 * object and back. CarbonImmutable is a value object for dates: addDay() returns a new instance.
 */

final class Money                                               // ★ Value object
{
    public function __construct(
        public readonly int $amount,                            // ★ smallest unit (piastres): exact math, no floats
        public readonly string $currency,
    ) {
        if ($amount < 0) {                                      // ★ checks itself: an invalid Money cannot exist
            throw new InvalidArgumentException('Money cannot be negative.');
        }
        if (preg_match('/^[A-Z]{3}$/', $currency) !== 1) {
            throw new InvalidArgumentException("Invalid currency [{$currency}].");
        }
    }

    public static function egp(int $pounds, int $piastres = 0): self
    {
        return new self($pounds * 100 + $piastres, 'EGP');
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount + $other->amount, $this->currency);   // ★ a NEW object
    }

    /**
     * Split fairly without losing a piastre: 100.00 / 3 = 33.34 + 33.33 + 33.33.
     *
     * @return list<self>
     */
    public function allocate(int $parts): array
    {
        if ($parts < 1) {
            throw new InvalidArgumentException('Parts must be at least 1.');
        }

        $base = intdiv($this->amount, $parts);
        $remainder = $this->amount % $parts;

        return array_map(
            fn (int $i): self => new self($base + ($i < $remainder ? 1 : 0), $this->currency),
            range(0, $parts - 1),
        );
    }

    public function equals(self $other): bool                   // ★ equal by value, not by identity
    {
        return $this->amount === $other->amount && $this->currency === $other->currency;
    }

    public function format(): string
    {
        return sprintf('%d.%02d %s', intdiv($this->amount, 100), $this->amount % 100, $this->currency);
    }

    private function assertSameCurrency(self $other): void
    {
        if ($other->currency !== $this->currency) {
            throw new LogicException("Cannot combine {$this->currency} and {$other->currency}.");
        }
    }
}

// ── Using it ────────────────────────────────────────────────────────────
var_dump(0.1 + 0.2 === 0.3);                                   // false: why money is never a float

$price = Money::egp(100);
$price->add(Money::egp(20));                                    // ✗ result thrown away
echo $price->format(), PHP_EOL;                                 // still 100.00 EGP
$price = $price->add(Money::egp(20));                           // ✓ keep the returned object
echo $price->format(), PHP_EOL;

echo implode(' + ', array_map(fn (Money $m) => $m->format(), Money::egp(100)->allocate(3))), PHP_EOL;
var_dump(Money::egp(5)->equals(new Money(500, 'EGP')));         // true: same value

try {
    Money::egp(10)->add(new Money(500, 'USD'));
} catch (LogicException $e) {
    echo $e->getMessage(), PHP_EOL;
}
