<?php

declare(strict_types=1);

namespace Evalu8\Survey\Rules;

/**
 * An expression that is true or false, e.g. `q3 >= 4 and role = "peer"`.
 */
interface Condition
{
    public function isTrue(RuleContext $context): bool;

    /** The rule written back as text, with brackets showing how it was understood. */
    public function describe(): string;
}
