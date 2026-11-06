<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/** `q3`: the score given to question q3, or null if it wasn't answered. */
final readonly class AnswerTo implements Operand
{
    public function __construct(private string $questionCode)
    {
    }

    public function valueIn(RuleContext $context): ?int
    {
        return $context->answers->scoreFor($this->questionCode)?->value;
    }

    public function describe(): string
    {
        return $this->questionCode;
    }
}
