<?php

declare(strict_types=1);

/**
 * Value Object: the full pattern in plain PHP, no framework.
 * Run it: php examples/value-object.php
 *
 * Roles:
 * - Value object: Money
 * - Rule 1, can't change: every property is readonly
 * - Rule 2, checks itself: the constructor refuses bad values
 * - Rule 3, equal by value: equals() compares amounts, not object identity
 * - Rule 4, returns new objects: add() never changes $this
 *
 * In Laravel:
 * Str::of('text') returns a Stringable: each method like upper() returns a NEW Stringable
 * and leaves the original unchanged. CarbonImmutable does the same for dates. A custom
 * Eloquent cast turns a database column into your own value object and back.
 */

class Money                                                 // ★ Value object
{
    public function __construct(
        public readonly int $amount,                        // ★ rule 1: readonly. Stored in piastres, never a float
        public readonly string $currency,
    ) {
        if ($amount < 0) {                                  // ★ rule 2: an invalid Money can never exist
            throw new InvalidArgumentException('Money cannot be negative.');
        }
        if (strlen($currency) !== 3) {
            throw new InvalidArgumentException("Invalid currency [{$currency}].");
        }
    }

    public static function egp(int $pounds): Money
    {
        return new Money($pounds * 100, 'EGP');
    }

    public function add(Money $other): Money
    {
        if ($other->currency !== $this->currency) {
            throw new LogicException("Cannot add {$other->currency} to {$this->currency}.");
        }

        return new Money($this->amount + $other->amount, $this->currency);   // ★ rule 4: a NEW object
    }

    public function equals(Money $other): bool              // ★ rule 3: same value = equal
    {
        return $this->amount === $other->amount && $this->currency === $other->currency;
    }

    public function format(): string
    {
        return number_format($this->amount / 100, 2) . ' ' . $this->currency;
    }
}

// ── Why integers: floats can't store some decimals exactly ──
var_dump(0.1 + 0.2 === 0.3);                               // bool(false)

// ── Rule 4 in action: always keep the returned object ──
$price = Money::egp(100);
$price->add(Money::egp(20));                                // ✗ the result is thrown away
echo $price->format() . "\n";                              // still 100.00 EGP

$price = $price->add(Money::egp(20));                       // ✓ keep the new object
echo $price->format() . "\n";                              // 120.00 EGP

// ── Rule 3: two different objects, same value ──
var_dump(Money::egp(5)->equals(new Money(500, 'EGP')));     // bool(true)

// ── Rule 2: mistakes are caught immediately ──
try {
    Money::egp(10)->add(new Money(500, 'USD'));
} catch (LogicException $e) {
    echo $e->getMessage() . "\n";
}
