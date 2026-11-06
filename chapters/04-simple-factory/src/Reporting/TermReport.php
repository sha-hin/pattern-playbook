<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\SchoolRepository;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Scoring\ScoringMethodFactory;

/**
 * The Context: it uses a scoring method without knowing which one.
 * Which one each school uses now comes from the school's own settings.
 */
final readonly class TermReport
{
    public function __construct(
        private TeacherRepository $teachers,
        private ResponseRepository $responses,
        private SchoolRepository $schools,
        private ScoringMethodFactory $scoringMethods,
    ) {
    }

    /** @return list<TeacherResult> */
    public function results(string $term): array
    {
        $results = [];

        foreach ($this->teachers->all() as $teacher) {
            $answers = $this->responses->forTeacherInTerm($teacher->id, $term);
            $method = $this->scoringMethods->forSchool($this->schools->get($teacher->school));

            $results[] = new TeacherResult(
                $teacher,
                count($answers),
                $method->score($answers),
                $method->name(),
            );
        }

        return $results;
    }
}
