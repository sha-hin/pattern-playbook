<?php

declare(strict_types=1);

/**
 * Null Object: the full pattern in plain PHP, no framework.
 * Run it: php examples/null-object.php
 *
 * Roles:
 * - Abstract object: Discount (the interface the caller depends on)
 * - Real object: PercentageCoupon (does real work)
 * - Null object: NoDiscount (same interface, safely does nothing)
 * - Client: Checkout (calls apply() without ever checking for null)
 *
 * In Laravel:
 * Laravel ships several null objects: the "null" cache driver (NullStore), the "null"
 * broadcaster and the "null" log channel. Choosing one in config turns a feature off
 * without a single if in your code.
 */

// ── Step 1: the interface the caller depends on ──
interface Discount                                          // ★ Abstract object
{
    public function apply(int $subtotal): int;

    public function label(): string;
}

// ── Step 2: the real object ──
class PercentageCoupon implements Discount                  // Real object
{
    public function __construct(private string $code, private int $percent)
    {
    }

    public function apply(int $subtotal): int
    {
        return (int) round($subtotal * (100 - $this->percent) / 100);
    }

    public function label(): string
    {
        return "{$this->code} (-{$this->percent}%)";
    }
}

// ── Step 3: the null object. Same interface, does nothing, never crashes. ──
class NoDiscount implements Discount                        // ★ Null object
{
    public function apply(int $subtotal): int
    {
        return $subtotal;                                   // ★ returns the total unchanged
    }

    public function label(): string
    {
        return 'no coupon';
    }
}

// ── Step 4: the client. No "if ($discount !== null)" anywhere. ──
class Checkout                                              // ★ Client
{
    public function __construct(private Discount $discount)
    {
    }

    public function total(int $subtotal): string
    {
        $total = $this->discount->apply($subtotal);         // ★ always safe to call

        return ($total / 100) . ' EGP (' . $this->discount->label() . ')';
    }
}

// ── Using it: decide ONCE, where the coupon is read ──
function discountFor(?string $coupon): Discount
{
    if ($coupon === null || $coupon === '') {
        return new NoDiscount();                            // "no coupon" is a normal case
    }

    if ($coupon === 'STUDENT') {
        return new PercentageCoupon('STUDENT', 10);
    }

    throw new InvalidArgumentException("Unknown coupon [{$coupon}].");   // a WRONG coupon is an error, not "nothing"
}

$withCoupon = new Checkout(discountFor('STUDENT'));
$withoutCoupon = new Checkout(discountFor(null));

echo $withCoupon->total(20000) . "\n";
echo $withoutCoupon->total(20000) . "\n";

// Never use a Null Object where "missing" is a bug: no payment method must throw,
// not silently charge nothing.
