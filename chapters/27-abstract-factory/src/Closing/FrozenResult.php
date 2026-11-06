<?php

declare(strict_types=1);

namespace Evalu8\Closing;

use Evalu8\Reporting\TeacherResult;

/** One teacher's final result for a closed term. */
final readonly class FrozenResult
{
    public function __construct(
        public string $term,
        public TeacherResult $result,
    ) {
    }
}
