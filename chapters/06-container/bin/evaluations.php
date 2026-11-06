<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 6: the container builds and connects every object.
 *
 *     composer dump-autoload
 *     php bin/evaluations.php
 */

use Evalu8\Container\Container;
use Evalu8\Container\ContainerException;
use Evalu8\Domain\InvalidValue;
use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\ResponseRepository;
use Evalu8\Domain\Score;
use Evalu8\Reporting\TermReport;

const CURRENT_TERM = '2026-T1';

/** @var Container $app */
$app = require __DIR__ . '/../bootstrap/app.php';

$responses = $app->make(ResponseRepository::class);

// ── Answers coming in from the survey form ──
$submitted = [
    [1, 'student', '5', 'Explains clearly'], [1, 'student', '4', ''], [1, 'student', '5', ''],
    [1, 'peer', '3', ''], [1, 'principal', '4', 'Good planning'],
    [2, 'student', '3', 'Starts late'], [2, 'student', '4', ''], [2, 'peer', '2', ''], [2, 'principal', '2', ''],
    [3, 'student', '1', 'I failed the test'], [3, 'student', '4', ''], [3, 'student', '4', ''], [3, 'peer', '5', ''],
    [4, 'student', '4', 'Explains clearly'], [4, 'peer', '3', 'Lessons feel rushed'],
    [4, 'principal', '140', 'typo'],
];

echo "REJECTED ANSWERS\n";
foreach ($submitted as $number => [$teacherId, $role, $score, $comment]) {
    try {
        $responses->add(new Response(
            $teacherId,
            CURRENT_TERM,
            RespondentRole::fromInput($role),
            Score::fromInput($score),
            $comment,
        ));
    } catch (InvalidValue $e) {
        echo "Row {$number}: {$e->getMessage()}\n";
    }
}

// ── Ask the container; it reads TermReport's constructor and builds the rest ──
$report = $app->make(TermReport::class);                    // built with everything it needs

$results = $report->results(CURRENT_TERM);                  // calculated ONCE, used three times below

// ── The term report ──
echo "\nTERM REPORT " . CURRENT_TERM . "\n";
foreach ($results as $result) {
    echo str_pad($result->teacher->name, 14) . str_pad($result->teacher->school, 10)
        . str_pad($result->method, 10) . str_pad($result->formattedScore(), 7) . "comments: {$result->commentSummary}\n";
}

// ── Email each teacher a summary ──
echo "\nEMAILS\n";
foreach ($results as $result) {
    if ($result->teacher->email === null) {
        echo "Not sent to {$result->teacher->name}: no email address on file.\n";
        continue;
    }

    echo "To: <{$result->teacher->email}> Your {$result->method} score this term is {$result->formattedScore()}\n";
}

// ── CSV export for the Ministry ──
echo "\nMINISTRY CSV\n";
echo "teacher,school,responses,method,score\n";
foreach ($results as $result) {
    $score = $result->score === null ? '' : round($result->score, 2);
    echo "{$result->teacher->name},{$result->teacher->school},{$result->responseCount},{$result->method},{$score}\n";
}


// ── The container at work ──
echo "\nCONTAINER\n";
$sameConnection = $app->make(PDO::class) === $app->make(PDO::class);
echo 'One shared database connection: ' . ($sameConnection ? 'yes' : 'no') . "\n";

try {
    (new Container())->make(TermReport::class);    // a container with no bindings
} catch (ContainerException $e) {
    echo "Clear error when wiring is missing: {$e->getMessage()}\n";
}
