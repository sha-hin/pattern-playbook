<?php

declare(strict_types=1);

namespace Evalu8\Bus;

/** A queued command, as the worker receives it. */
final readonly class Job
{
    public function __construct(
        public int $id,
        public object $command,
        public int $attempts,                               // attempts made before this one
    ) {
    }
}
