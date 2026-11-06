<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Domain\Teacher;

/**
 * One line of the term report: calculated once, then printed, emailed and exported.
 */
final readonly class TeacherResult
{
    public function __construct(
        public Teacher $teacher,
        public int $responseCount,
        public ?float $score,                               // null = no answers this term
        public string $method,
        public string $commentSummary,
    ) {
    }

    public function formattedScore(): string
    {
        return $this->score === null ? 'no answers' : number_format($this->score, 2);
    }
}
