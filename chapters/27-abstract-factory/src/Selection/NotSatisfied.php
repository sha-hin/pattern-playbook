<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

final class NotSatisfied extends BaseSpecification
{
    public function __construct(private readonly Specification $inner)
    {
    }

    public function isSatisfiedBy(TeacherResult $result): bool
    {
        return !$this->inner->isSatisfiedBy($result);
    }

    public function describe(): string
    {
        return "not {$this->inner->describe()}";
    }
}
