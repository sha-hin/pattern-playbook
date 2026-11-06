<?php

declare(strict_types=1);

namespace Evalu8\Submission\Stages;

use Closure;
use Evalu8\Lifecycle\SurveyRun;
use Evalu8\Lifecycle\TransitionNotAllowed;
use Evalu8\Submission\Receipt;
use Evalu8\Submission\Submission;
use Evalu8\Submission\SubmissionStage;

final readonly class RequireOpenSurvey implements SubmissionStage
{
    public function __construct(private SurveyRun $run)
    {
    }

    public function handle(Submission $submission, Closure $next): Receipt
    {
        try {
            $this->run->ensureAcceptsAnswers();             // the State from chapter 21 decides
        } catch (TransitionNotAllowed $e) {
            return new Receipt(false, $e->getMessage());
        }

        return $next($submission);
    }
}
