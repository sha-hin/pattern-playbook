<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * A school and its settings. The settings are stored exactly as the school
 * chose them; turning them into objects is the factory's job.
 */
final readonly class School
{
    /**
     * @param array<string, float> $scoringWeights role value => weight, only used by the "weighted" method
     */
    public function __construct(
        public string $name,
        public string $scoringMethod,                       // e.g. "average", "median", "weighted"
        public array $scoringWeights = [],
    ) {
    }
}
