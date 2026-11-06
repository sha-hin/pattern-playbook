<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 19: start next term's survey from a copy of this term's.
 *
 *     composer dump-autoload
 *     php bin/new-term.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Survey\Question;
use Evalu8\Survey\Section;
use Evalu8\Survey\TeacherEvaluationSurvey;
use Evalu8\Survey\Visitor\QuestionCounter;

function questionCount(Section $survey): int
{
    $counter = new QuestionCounter();
    $survey->accept($counter);

    return $counter->questions;
}

$thisTerm = TeacherEvaluationSurvey::create();             // already answered by 1,200 students

// "Start from last term": copy it, then change only what's new.
$nextTerm = clone $thisTerm;
$nextTerm->rename('Teacher evaluation 2027-T1');
$nextTerm->section('Time management')->add(new Question('q8', 'Gives homework back within a week'));

echo "THIS TERM: {$thisTerm->title()}\n";
echo '  questions: ' . questionCount($thisTerm) . "\n";
echo '  Time management: ' . count($thisTerm->section('Time management')->children()) . " questions\n\n";

echo "NEXT TERM: {$nextTerm->title()}\n";
echo '  questions: ' . questionCount($nextTerm) . "\n";
echo '  Time management: ' . count($nextTerm->section('Time management')->children()) . " questions\n\n";

$sameSection = $thisTerm->section('Time management') === $nextTerm->section('Time management');
$sameQuestion = $thisTerm->children()[2] === $nextTerm->children()[2];
echo 'Sections shared between the two? ' . ($sameSection ? 'yes' : 'no, each survey has its own') . "\n";
echo 'Questions shared between the two? ' . ($sameQuestion ? 'yes, safely: a Question can never change' : 'no') . "\n";
