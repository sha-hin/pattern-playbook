<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 26: who qualifies for which program, from rules written once and combined.
 *
 *     composer dump-autoload
 *     php bin/programs.php
 */

use Evalu8\Container\Container;
use Evalu8\Demo\SampleData;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Reporting\TermReport;
use Evalu8\Selection\Programs;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';
SampleData::loadAnswers($app->make(ResponseRepository::class), CURRENT_TERM);
$results = $app->make(TermReport::class)->results(CURRENT_TERM);

$programs = [
    'Support program' => Programs::support(),
    'Excellence award' => Programs::excellenceAward(),
];

foreach ($programs as $name => $rule) {
    echo "\n" . strtoupper($name) . "\n  rule: {$rule->describe()}\n";

    foreach ($results as $result) {
        $mark = $rule->isSatisfiedBy($result) ? 'yes' : ' - ';
        echo "  {$mark}  " . str_pad($result->teacher->name, 14)
            . "score {$result->formattedScore()}, {$result->responseCount} answers"
            . ($result->teacher->onLeave ? ', on leave' : '') . "\n";
    }
}
