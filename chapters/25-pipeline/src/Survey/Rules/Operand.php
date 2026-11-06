<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/**
 * An expression that produces a value: an answer, the role, or a literal.
 */
interface Operand
{
    /** @return int|string|null null when the value isn't known (an unanswered question) */
    public function valueIn(RuleContext $context): int|string|null;

    public function describe(): string;
}
