<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

use DateTimeImmutable;

/** Collecting answers. */
final class Open extends RunStatus
{
    public function name(): string
    {
        return 'open';
    }

    public function acceptAnswer(): void
    {
        // allowed: nothing to refuse
    }

    public function close(DateTimeImmutable $at): RunStatus
    {
        return new Closed($at);
    }
}
