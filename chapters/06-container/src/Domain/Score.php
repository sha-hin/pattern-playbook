<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * One answer on the 1–5 scale.
 *
 * If you hold a Score, it is valid: the constructor is the only way in,
 * and it refuses anything outside 1–5.
 */
final readonly class Score
{
    public const MIN = 1;
    public const MAX = 5;

    public function __construct(public int $value)
    {
        if ($value < self::MIN || $value > self::MAX) {
            throw new InvalidValue("A score must be between 1 and 5, got {$value}.");
        }
    }

    /**
     * Builds a Score from raw form input such as "4".
     */
    public static function fromInput(string $raw): self
    {
        $value = filter_var(trim($raw), FILTER_VALIDATE_INT);

        if ($value === false) {
            throw new InvalidValue("A score must be a whole number, got \"{$raw}\".");
        }

        return new self($value);
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }
}
