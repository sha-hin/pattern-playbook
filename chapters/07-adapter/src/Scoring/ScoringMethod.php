<?php

declare(strict_types=1);

namespace Evalu8\Scoring;

use Evalu8\Domain\Response;

/**
 * The Strategy: one way of turning a teacher's answers into one number.
 * Every scoring method follows this interface, so the code that uses a
 * method never needs to know which one it has.
 */
interface ScoringMethod
{
    /**
     * @param list<Response> $responses
     * @return float|null null when there are no answers to score
     */
    public function score(array $responses): ?float;

    /** A short label for reports, e.g. "median". */
    public function name(): string;
}
