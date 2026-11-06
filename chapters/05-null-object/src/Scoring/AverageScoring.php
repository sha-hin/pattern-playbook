<?php

declare(strict_types=1);

namespace Evalu8\Scoring;

/**
 * Every answer counts the same. The method every school used until now.
 */
final readonly class AverageScoring implements ScoringMethod
{
    public function score(array $responses): ?float
    {
        if (count($responses) === 0) {
            return null;
        }

        $total = 0;
        foreach ($responses as $response) {
            $total += $response->score->value;
        }

        return $total / count($responses);
    }

    public function name(): string
    {
        return 'average';
    }
}
