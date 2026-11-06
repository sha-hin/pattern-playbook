<?php

declare(strict_types=1);

namespace Evalu8\Submission;

use Closure;

/**
 * One stage of the pipeline. A stage can stop the submission (return a refusal) or call
 * $next to pass it on, and it can act both before and after the stages that follow it.
 */
interface SubmissionStage
{
    /** @param Closure(Submission): Receipt $next */
    public function handle(Submission $submission, Closure $next): Receipt;
}
