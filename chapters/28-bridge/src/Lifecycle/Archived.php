<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

/** Read-only forever. Every action is refused by the base class. */
final class Archived extends RunStatus
{
    public function name(): string
    {
        return 'archived';
    }
}
