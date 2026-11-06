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
 * Laravel ships several: Illuminate\Cache\NullStore (cache driver "null"),
 * Illuminate\Broadcasting\Broadcasters\NullBroadcaster, and the "null" log channel
 * (Monolog's NullHandler). Choosing them in config turns a feature off without a single if.
 */

interface Discount                                              // ★ Abstract object
{
    public function apply(int $subtotalInPiastres): int;

    public function label(): string;
}

final class PercentageCoupon implements Discount                // Real object
{
    public function __construct(private readonly string $code, private readonly int $percent)
    {
        if ($percent < 1 || $percent > 100) {
            throw new InvalidArgumentException('Percent must be between 1 and 100.');
        }
    }

    public function apply(int $subtotalInPiastres): int
    {
        return (int) round($subtotalInPiastres * (100 - $this->percent) / 100);
    }

    public function label(): string
    {
        return "{$this->code} (-{$this->percent}%)";
    }
}

final class NoDiscount implements Discount                      // ★ Null object
{
    public function apply(int $subtotalInPiastres): int
    {
        return $subtotalInPiastres;                             // ★ does nothing, safely
    }

    public function label(): string
    {
        return 'no coupon';
    }
}

final class Checkout                                            // ★ Client: no null checks anywhere
{
    public function __construct(private readonly Discount $discount) {}

    public function total(int $subtotalInPiastres): string
    {
        return sprintf('%.2f EGP (%s)', $this->discount->apply($subtotalInPiastres) / 100, $this->discount->label());
    }
}

// ── Decide ONCE, where the input is read ────────────────────────────────
function discountFor(?string $coupon): Discount
{
    return match ($coupon) {
        null, '' => new NoDiscount(),                           // "no coupon" is a normal case
        'STUDENT' => new PercentageCoupon('STUDENT', 10),
        default => throw new InvalidArgumentException("Unknown coupon [{$coupon}]."),   // a wrong coupon is an error, not "nothing"
    };
}

echo (new Checkout(discountFor('STUDENT')))->total(20000), PHP_EOL;
echo (new Checkout(discountFor(null)))->total(20000), PHP_EOL;

// Never use a Null Object where "missing" is a bug: no payment method must throw,
// not silently charge nothing.
