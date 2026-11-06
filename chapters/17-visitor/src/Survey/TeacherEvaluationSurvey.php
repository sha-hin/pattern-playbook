<?php

declare(strict_types=1);

namespace Evalu8\Survey;

/**
 * The 2026-T2 teacher evaluation survey, as designed by the quality team.
 */
final class TeacherEvaluationSurvey
{
    public static function create(): Section
    {
        $timeManagement = (new Section('Time management'))
            ->add(new Question('q4', 'Starts lessons on time'))
            ->add(new Question('q5', 'Finishes the lesson plan'));

        $classroom = (new Section('Classroom', weight: 2))
            ->add(new Question('q3', 'Keeps the class focused'))
            ->add($timeManagement);                         // a section inside a section

        $teaching = (new Section('Teaching', weight: 3))
            ->add(new Question('q1', 'Explains clearly'))
            ->add(new Question('q2', 'Checks that we understood', weight: 2));

        return (new Section('Teacher evaluation 2026-T2'))
            ->add($teaching)
            ->add($classroom)
            ->add(new Question('q6', 'Overall, I would recommend this teacher'));
    }
}
