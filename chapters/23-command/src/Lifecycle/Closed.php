<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

use DateTimeImmutable;

/**
 * No more answers. It can be reopened for a week (a school closed it too early),
 * then only archived.
 */
final class Closed extends RunStatus
{
    public const REOPEN_WITHIN_DAYS = 7;

    public function __construct(public readonly DateTimeImmutable $closedAt)
    {
    }

    public function name(): string
    {
        return 'closed';
    }

    public function reopen(DateTimeImmutable $at): RunStatus
    {
        $days = $this->closedAt->diff($at)->days;
        if ($days > self::REOPEN_WITHIN_DAYS) {
            throw new TransitionNotAllowed(
                "Can't reopen: it was closed {$days} days ago, and the limit is " . self::REOPEN_WITHIN_DAYS . ' days.'
            );
        }

        return new Open();
    }

    public function archive(): RunStatus
    {
        return new Archived();
    }
}
