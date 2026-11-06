<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

use DateTimeImmutable;

/**
 * The State: what a survey run may do in its current status.
 * Every action is refused here; each concrete status allows only its own moves,
 * and an allowed move returns the NEXT status.
 */
abstract class RunStatus
{
    abstract public function name(): string;

    public function open(): RunStatus
    {
        throw $this->refuse('open');
    }

    public function acceptAnswer(): void
    {
        throw new TransitionNotAllowed("This survey is {$this->name()}; it doesn't accept answers.");
    }

    public function close(DateTimeImmutable $at): RunStatus
    {
        throw $this->refuse('close');
    }

    public function reopen(DateTimeImmutable $at): RunStatus
    {
        throw $this->refuse('reopen');
    }

    public function archive(): RunStatus
    {
        throw $this->refuse('archive');
    }

    protected function refuse(string $action): TransitionNotAllowed
    {
        return new TransitionNotAllowed("Can't {$action} a survey that is {$this->name()}.");
    }
}
