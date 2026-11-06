<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/** `role`: who is answering ("student", "peer" or "principal"). */
final readonly class Role implements Operand
{
    public function valueIn(RuleContext $context): string
    {
        return $context->role->value;
    }

    public function describe(): string
    {
        return 'role';
    }
}
