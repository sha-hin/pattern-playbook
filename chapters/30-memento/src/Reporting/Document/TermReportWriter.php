<?php

declare(strict_types=1);

namespace Evalu8\Reporting\Document;

use Evalu8\Reporting\TeacherResult;

/**
 * The Director: knows the ORDER of the steps (title, then each school with its teachers,
 * then the footnote), but not what document is being made. Any ReportBuilder works.
 */
final readonly class TermReportWriter
{
    /** @param list<TeacherResult> $results */
    public function write(ReportBuilder $builder, string $term, array $results): void
    {
        $builder->title("Teacher evaluation results {$term}");

        $bySchool = [];
        foreach ($results as $result) {
            $bySchool[$result->teacher->school][] = $result;
        }
        ksort($bySchool);

        foreach ($bySchool as $school => $schoolResults) {
            $builder->schoolHeading($school);
            foreach ($schoolResults as $result) {
                $builder->teacherRow($result);
            }
        }

        $builder->footnote('Each school chooses its own scoring method; scores are on the 1–5 scale.');
    }
}
