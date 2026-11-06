<?php

declare(strict_types=1);

namespace Evalu8\Selection;

use Evalu8\Reporting\TeacherResult;

/**
 * A business rule as an object: "is this teacher's result what we are looking for?"
 * Rules combine with and(), or() and not() into bigger rules.
 */
interface Specification
{
    public function isSatisfiedBy(TeacherResult $result): bool;

    /** The rule in words, for screens and audit logs. */
    public function describe(): string;

    public function and(Specification $other): Specification;

    public function or(Specification $other): Specification;

    public function not(): Specification;
}
