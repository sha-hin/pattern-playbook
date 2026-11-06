<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

use DateTimeImmutable;
use Evalu8\Domain\EmailAddress;

/**
 * An event: a plain, read-only record of something that happened. It carries data, no behaviour.
 */
final readonly class SurveyClosed
{
    public function __construct(
        public string $title,
        public string $school,
        public EmailAddress $principal,
        public int $answers,
        public DateTimeImmutable $closedAt,
    ) {
    }
}
