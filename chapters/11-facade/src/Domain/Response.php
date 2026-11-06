<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * One answer to the evaluation survey. Built only from valid values,
 * and it has no save() method: storing it is the repository's job.
 */
final readonly class Response
{
    public function __construct(
        public int $teacherId,
        public string $term,                                // e.g. "2026-T1"
        public RespondentRole $role,
        public Score $score,
        public string $comment,
    ) {
    }
}
