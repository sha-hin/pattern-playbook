<?php

declare(strict_types=1);

namespace Evalu8\Scoring;

use Evalu8\Domain\School;

/**
 * The Simple Factory: the ONE place that reads a school's settings and
 * decides which ScoringMethod to build. Every caller just asks for one.
 */
final readonly class ScoringMethodFactory
{
    public function forSchool(School $school): ScoringMethod
    {
        return match ($school->scoringMethod) {
            'average' => new AverageScoring(),
            'median' => new MedianScoring(),
            'weighted' => new WeightedScoring($school->scoringWeights),
            default => throw new UnknownScoringMethod(
                "School \"{$school->name}\" uses unknown scoring method \"{$school->scoringMethod}\". "
                . 'Expected one of: average, median, weighted.'
            ),
        };
    }
}
