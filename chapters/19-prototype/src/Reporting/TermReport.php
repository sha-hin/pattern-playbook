<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Analysis\CommentAnalyzerFactory;
use Evalu8\Domain\Response;
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
        private CommentAnalyzerFactory $commentAnalyzers,
    ) {
    }

    /** @return list<TeacherResult> */
    public function results(string $term): array
    {
        $results = [];

        foreach ($this->teachers->all() as $teacher) {
            $answers = $this->responses->forTeacherInTerm($teacher->id, $term);
            $school = $this->schools->get($teacher->school);
            $method = $this->scoringMethods->forSchool($school);
            $analyzer = $this->commentAnalyzers->forSchool($school);    // never null

            $results[] = new TeacherResult(
                $teacher,
                count($answers),
                $method->score($answers),
                $method->name(),
                $analyzer->summarize($this->commentsOf($answers)),   // no "if analyzer !== null"
            );
        }

        return $results;
    }

    /**
     * @param list<Response> $answers
     * @return list<string>
     */
    private function commentsOf(array $answers): array
    {
        $comments = [];
        foreach ($answers as $answer) {
            if (trim($answer->comment) !== '') {
                $comments[] = $answer->comment;
            }
        }

        return $comments;
    }
}
