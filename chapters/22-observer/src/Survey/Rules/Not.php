<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/** `not a` */
final readonly class Not implements Condition
{
    public function __construct(private Condition $condition)
    {
    }

    public function isTrue(RuleContext $context): bool
    {
        return !$this->condition->isTrue($context);
    }

    public function describe(): string
    {
        return "not {$this->condition->describe()}";
    }
}
