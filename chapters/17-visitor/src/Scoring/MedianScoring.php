<?php

declare(strict_types=1);

namespace Evalu8\Scoring;

/**
 * The middle answer. One extreme answer can't pull the result up or down.
 */
final readonly class MedianScoring implements ScoringMethod
{
    public function score(array $responses): ?float
    {
        $count = count($responses);
        if ($count === 0) {
            return null;
        }

        $values = [];
        foreach ($responses as $response) {
            $values[] = $response->score->value;
        }
        sort($values);

        $middle = intdiv($count, 2);
        if ($count % 2 === 1) {
            return (float) $values[$middle];
        }

        return ($values[$middle - 1] + $values[$middle]) / 2;   // even count: average of the two middle values
    }

    public function name(): string
    {
        return 'median';
    }
}
