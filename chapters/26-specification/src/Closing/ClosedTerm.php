<?php

declare(strict_types=1);

namespace Evalu8\Closing;

use DateTimeImmutable;

final readonly class ClosedTerm
{
    public function __construct(
        public string $term,
        public DateTimeImmutable $closedAt,
    ) {
    }
}
