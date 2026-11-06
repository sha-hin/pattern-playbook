<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 16: score a survey tree of any depth.
 *
 *     composer dump-autoload
 *     php bin/survey.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Survey\AnswerSheet;
use Evalu8\Survey\SurveyNode;
use Evalu8\Survey\TeacherEvaluationSurvey;

$survey = TeacherEvaluationSurvey::create();

// One student's answers. They skipped q5.
$answers = AnswerSheet::fromArray(['q1' => 5, 'q2' => 4, 'q3' => 3, 'q4' => 2, 'q6' => 4]);

function show(SurveyNode $node, AnswerSheet $answers, int $depth = 0): void
{
    $score = $node->score($answers);                        // the same call at every level
    echo str_repeat('    ', $depth)
        . str_pad($node->title(), 44 - 4 * $depth)
        . ($score === null ? 'not answered' : number_format($score, 2))
        . ($node->weight() !== 1.0 ? "   (weight {$node->weight()})" : '')
        . "\n";

    foreach ($node->children() as $child) {
        show($child, $answers, $depth + 1);
    }
}

show($survey, $answers);
