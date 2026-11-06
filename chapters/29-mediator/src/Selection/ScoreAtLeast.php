<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

final class ScoreAtLeast extends BaseSpecification
{
    public function __construct(private readonly float $minimum)
    {
    }

    public function isSatisfiedBy(TeacherResult $result): bool
    {
        return $result->score !== null && $result->score >= $this->minimum;
    }

    public function describe(): string
    {
        return sprintf('score of at least %.1f', $this->minimum);
    }
}
