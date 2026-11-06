<?php

declare(strict_types=1);

namespace Evalu8\Scoring;

use Evalu8\Domain\RespondentRole;
use InvalidArgumentException;

/**
 * Each group of respondents gets a share of the final score,
 * e.g. students 50%, peers 20%, principal 30%.
 *
 * The average of each group is weighted. If a group gave no answers,
 * its share is spread over the groups that did, so the result stays on the 1–5 scale.
 */
final readonly class WeightedScoring implements ScoringMethod
{
    /** @var array<string, float> role value => weight */
    private array $weights;

    /**
     * @param array<string, float> $weights role value => weight, must add up to 1.0
     */
    public function __construct(array $weights)
    {
        foreach (array_keys($weights) as $role) {
            if (RespondentRole::tryFrom($role) === null) {
                throw new InvalidArgumentException("Unknown role \"{$role}\" in scoring weights.");
            }
        }

        if (abs(array_sum($weights) - 1.0) > 0.0001) {
            throw new InvalidArgumentException('Scoring weights must add up to 1.0, got ' . array_sum($weights) . '.');
        }

        $this->weights = $weights;
    }

    public function score(array $responses): ?float
    {
        /** @var array<string, list<int>> $byRole role value => that group's scores */
        $byRole = [];
        foreach ($responses as $response) {
            $byRole[$response->role->value][] = $response->score->value;
        }

        $weightedTotal = 0.0;
        $usedWeight = 0.0;
        foreach ($byRole as $role => $scores) {
            $weight = $this->weights[$role] ?? 0.0;
            $weightedTotal += $weight * (array_sum($scores) / count($scores));
            $usedWeight += $weight;
        }

        if ($usedWeight === 0.0) {
            return null;                                    // no answers from any weighted group
        }

        return $weightedTotal / $usedWeight;
    }

    public function name(): string
    {
        return 'weighted';
    }
}
