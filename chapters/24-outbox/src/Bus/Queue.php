<?php

declare(strict_types=1);

namespace Evalu8\Bus;

use Throwable;

interface Queue
{
    /** @return int the job id */
    public function push(ShouldQueue $command): int;

    /** The next pending job, or null when there is nothing to do. */
    public function reserve(): ?Job;

    public function complete(Job $job): void;

    /** Puts the job back for another attempt, or marks it failed for good when $final is true. */
    public function release(Job $job, Throwable $error, bool $final): void;
}
