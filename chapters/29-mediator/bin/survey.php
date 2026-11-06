<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 17: new operations on the survey, without editing Question or Section.
 *
 *     composer dump-autoload
 *     php bin/survey.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Survey\Question;
use Evalu8\Survey\Section;
use Evalu8\Survey\TeacherEvaluationSurvey;
use Evalu8\Survey\Visitor\MarkdownExporter;
use Evalu8\Survey\Visitor\QuestionCounter;
use Evalu8\Survey\Visitor\SurveyValidator;

$survey = TeacherEvaluationSurvey::create();

$counter = new QuestionCounter();
$survey->accept($counter);
echo "COUNT\n{$counter->questions} questions in {$counter->sections} sections\n\n";

$validator = new SurveyValidator();
$survey->accept($validator);
echo 'VALIDATE the real survey: ' . ($validator->isValid() ? 'no problems' : implode(' ', $validator->errors)) . "\n";

$draft = (new Section('Draft'))
    ->add(new Question('q1', 'Explains clearly'))
    ->add(new Section('Homework'))                          // forgot to add questions
    ->add(new Question('q1', 'Gives useful feedback'));     // copied q1 by mistake
$validator = new SurveyValidator();
$draft->accept($validator);
echo "VALIDATE a draft:\n  - " . implode("\n  - ", $validator->errors) . "\n\n";

$exporter = new MarkdownExporter();
$survey->accept($exporter);
echo "MARKDOWN HANDOUT\n" . $exporter->markdown();
