<?php

declare(strict_types=1);

namespace Evalu8\Import;

/**
 * One answer as read from a file, before any validation: every field is still text.
 */
final readonly class RawAnswer
{
    public function __construct(
        public string $teacherId,
        public string $role,
        public string $score,
        public string $comment,
    ) {
    }
}
