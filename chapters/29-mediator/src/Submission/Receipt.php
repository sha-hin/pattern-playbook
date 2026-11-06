<?php

declare(strict_types=1);

namespace Evalu8\Submission;

/** What the respondent is told after submitting. */
final readonly class Receipt
{
    public function __construct(
        public bool $accepted,
        public string $message,
    ) {
    }
}
