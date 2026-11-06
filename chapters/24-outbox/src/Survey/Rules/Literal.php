<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/** `4` or `"peer"`: a fixed value written in the rule. */
final readonly class Literal implements Operand
{
    public function __construct(private int|string $value)
    {
    }

    public function valueIn(RuleContext $context): int|string
    {
        return $this->value;
    }

    public function describe(): string
    {
        return is_int($this->value) ? (string) $this->value : '"' . $this->value . '"';
    }
}
