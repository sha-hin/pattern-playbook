<?php

declare(strict_types=1);

namespace Evalu8\Selection;

/**
 * Gives every specification the three combinators, so rules read like sentences:
 *     (new ScoreBelow(3.0))->and(new HasAtLeastAnswers(3))->and((new OnLeave())->not())
 */
abstract class BaseSpecification implements Specification
{
    public function and(Specification $other): Specification
    {
        return new AllOf($this, $other);
    }

    public function or(Specification $other): Specification
    {
        return new AnyOf($this, $other);
    }

    public function not(): Specification
    {
        return new NotSatisfied($this);
    }
}
