<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * One answer on the 1–5 scale.
 *
 * If you hold a Score, it is valid: the constructor refuses anything outside 1–5.
 *
 * Flyweight: there are only five possible scores, so Score::of() hands out five shared
 * objects instead of creating one per answer. Sharing is safe because a Score can never change.
 */
final class Score
{
    public const MIN = 1;
    public const MAX = 5;

    /** @var array<int, self> the shared instances, created on first use */
    private static array $shared = [];

    public function __construct(public readonly int $value)
    {
        if ($value < self::MIN || $value > self::MAX) {
            throw new InvalidValue("A score must be between 1 and 5, got {$value}.");
        }
    }

    /**
     * The flyweight factory: always the same object for the same value.
     */
    public static function of(int $value): self
    {
        return self::$shared[$value] ??= new self($value);   // the constructor still validates
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

        return self::of($value);
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }
}
