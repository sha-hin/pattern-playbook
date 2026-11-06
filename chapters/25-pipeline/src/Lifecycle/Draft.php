<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

/** Being designed. Nobody can answer yet. */
final class Draft extends RunStatus
{
    public function name(): string
    {
        return 'draft';
    }

    public function open(): RunStatus
    {
        return new Open();
    }
}
