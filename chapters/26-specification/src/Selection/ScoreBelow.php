<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

final class ScoreBelow extends BaseSpecification
{
    public function __construct(private readonly float $limit)
    {
    }

    public function isSatisfiedBy(TeacherResult $result): bool
    {
        return $result->score !== null && $result->score < $this->limit;   // no answers is not a low score
    }

    public function describe(): string
    {
        return sprintf('score below %.1f', $this->limit);
    }
}
