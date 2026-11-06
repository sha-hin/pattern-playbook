<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Scoring\ScoringMethod;

/**
 * The Context: it uses a scoring method without knowing which one.
 */
final readonly class TermReport
{
    /**
     * @param array<string, ScoringMethod> $scoringBySchool school name => its scoring method
     */
    public function __construct(
        private TeacherRepository $teachers,
        private ResponseRepository $responses,
        private array $scoringBySchool,
        private ScoringMethod $defaultScoring,
    ) {
    }

    /** @return list<TeacherResult> */
    public function results(string $term): array
    {
        $results = [];

        foreach ($this->teachers->all() as $teacher) {
            $answers = $this->responses->forTeacherInTerm($teacher->id, $term);
            $method = $this->scoringBySchool[$teacher->school] ?? $this->defaultScoring;

            $results[] = new TeacherResult(
                $teacher,
                count($answers),
                $method->score($answers),  // no "if school is..." anywhere
                $method->name(),
            );
        }

        return $results;
    }
}
