<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Evalu8\Bus\ShouldQueue;

/**
 * A Command: the request "analyse this teacher's comments for this term", as an object.
 * Only data, no logic, so it can be stored in the queue and run later by a worker.
 */
final readonly class AnalyzeTeacherComments implements ShouldQueue
{
    public function __construct(
        public int $teacherId,
        public string $term,
    ) {
    }
}
