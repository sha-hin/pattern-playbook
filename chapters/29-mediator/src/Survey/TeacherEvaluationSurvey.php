<?php

declare(strict_types=1);

namespace Evalu8\Survey;

/**
 * The teacher evaluation survey, as designed by the quality team. Reads top to bottom
 * like the printed form.
 */
final class TeacherEvaluationSurvey
{
    public static function create(): Section
    {
        return SurveyBuilder::survey('Teacher evaluation 2026-T2')
            ->section('Teaching', weight: 3)
                ->question('q1', 'Explains clearly')
                ->question('q2', 'Checks that we understood', weight: 2)
            ->end()
            ->section('Classroom', weight: 2)
                ->question('q3', 'Keeps the class focused')
                ->section('Time management')
                    ->question('q4', 'Starts lessons on time')
                    ->question('q5', 'Finishes the lesson plan')
                ->end()
            ->end()
            ->question('q6', 'Overall, I would recommend this teacher')
            ->question('q7', 'What would help this teacher start on time?', visibleIf: 'q4 <= 2')
            ->build();
    }
}
