<?php

declare(strict_types=1);

namespace Evalu8\Closing;

/**
 * What closing a term did, so every caller can show the same summary.
 */
final readonly class ClosingSummary
{
    /** @param list<string> $notEmailed names of teachers with no email address */
    public function __construct(
        public string $term,
        public int $teachers,
        public int $emailed,
        public array $notEmailed,
        public string $exportPath,
    ) {
    }
}
