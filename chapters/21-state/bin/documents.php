<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 20: a survey built step by step, and one report in two formats.
 *
 *     composer dump-autoload
 *     php bin/documents.php
 */

use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Reporting\Document\HtmlReportBuilder;
use Evalu8\Reporting\Document\PlainTextReportBuilder;
use Evalu8\Reporting\Document\TermReportWriter;
use Evalu8\Reporting\TermReport;
use Evalu8\Survey\InvalidSurvey;
use Evalu8\Survey\SurveyBuilder;
use Evalu8\Survey\TeacherEvaluationSurvey;
use Evalu8\Survey\Visitor\QuestionCounter;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';

// ── Part 1: the fluent builder ──
$survey = TeacherEvaluationSurvey::create();
$counter = new QuestionCounter();
$survey->accept($counter);
echo "SURVEY BUILT: {$survey->title()}, {$counter->questions} questions in {$counter->sections} sections\n\n";

try {
    SurveyBuilder::survey('Draft')
        ->section('Teaching')
            ->question('q1', 'Explains clearly')
            ->question('q1', 'Checks that we understood')
        ->section('Homework')
        ->build();
} catch (InvalidSurvey $e) {
    echo $e->getMessage() . "\n\n";
}

// ── Part 2: the book's form, one director and two builders ──
SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);
$results = $app->make(TermReport::class)->results(CURRENT_TERM);
$writer = new TermReportWriter();

$text = new PlainTextReportBuilder();
$writer->write($text, CURRENT_TERM, $results);
echo $text->text() . "\n";

$html = new HtmlReportBuilder();
$writer->write($html, CURRENT_TERM, $results);
echo $html->html();
