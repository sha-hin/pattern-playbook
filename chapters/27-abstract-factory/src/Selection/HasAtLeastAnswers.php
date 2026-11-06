<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

/** Enough answers for the score to mean something. */
final class HasAtLeastAnswers extends BaseSpecification
{
    public function __construct(private readonly int $minimum)
    {
    }

    public function isSatisfiedBy(TeacherResult $result): bool
    {
        return $result->responseCount >= $this->minimum;
    }

    public function describe(): string
    {
        return "at least {$this->minimum} answers";
    }
}
