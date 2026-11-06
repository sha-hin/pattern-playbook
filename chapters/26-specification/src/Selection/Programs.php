<?php

declare(strict_types=1);

namespace Evalu8\Selection;

/**
 * The school programs' entry rules, each written once, by combining small specifications.
 */
final class Programs
{
    public static function support(): Specification
    {
        return (new ScoreBelow(3.0))
            ->and(new HasAtLeastAnswers(3))
            ->and((new OnLeave())->not());
    }

    public static function excellenceAward(): Specification
    {
        return (new ScoreAtLeast(4.0))
            ->and(new HasAtLeastAnswers(4))
            ->and((new OnLeave())->not());
    }
}
