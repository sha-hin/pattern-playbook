<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * A valid email address, stored in lower case so that two spellings of the
 * same address are equal.
 */
final readonly class EmailAddress
{
    public string $value;

    public function __construct(string $value)
    {
        $normalized = strtolower(trim($value));

        if (filter_var($normalized, FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidValue("\"{$value}\" is not a valid email address.");
        }

        $this->value = $normalized;
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
