<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 3: each school scores teachers its own way.
 *
 *     composer dump-autoload
 *     php bin/evaluations.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Domain\InvalidValue;
use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Response;
use Evalu8\Domain\Score;
use Evalu8\Infrastructure\Sqlite\Schema;
use Evalu8\Infrastructure\Sqlite\SqliteResponseRepository;
use Evalu8\Infrastructure\Sqlite\SqliteTeacherRepository;
use Evalu8\Reporting\TermReport;
use Evalu8\Scoring\AverageScoring;
use Evalu8\Scoring\MedianScoring;
use Evalu8\Scoring\WeightedScoring;

const CURRENT_TERM = '2026-T1';

// ── Setup: database, tables and the teachers ──
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
Schema::create($db);
$db->exec("INSERT INTO teachers (id, name, email, school) VALUES
    (1, 'Hany Mostafa', 'hany@smouha.edu.eg', 'Smouha'),
    (2, 'Nadia Fawzy', NULL, 'Smouha'),
    (3, 'Karim Adel', 'karim@miami.edu.eg', 'Miami'),
    (4, 'Laila Samir', 'laila@victoria.edu.eg', 'Victoria')");

$teachers = new SqliteTeacherRepository($db);
$responses = new SqliteResponseRepository($db);

// ── Answers coming in from the survey form ──
$submitted = [
    [1, 'student', '5', 'Explains clearly'], [1, 'student', '4', ''], [1, 'student', '5', ''],
    [1, 'peer', '3', ''], [1, 'principal', '4', 'Good planning'],
    [2, 'student', '3', 'Starts late'], [2, 'student', '4', ''], [2, 'peer', '2', ''], [2, 'principal', '2', ''],
    [3, 'student', '1', 'I failed the test'], [3, 'student', '4', ''], [3, 'student', '4', ''], [3, 'peer', '5', ''],
    [4, 'student', '4', ''], [4, 'peer', '3', ''],
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

// ── Each school's scoring method. Adding a method = one new class. ──
$report = new TermReport(
    $teachers,
    $responses,
    [
        'Smouha' => new WeightedScoring(['student' => 0.5, 'peer' => 0.2, 'principal' => 0.3]),
        'Miami' => new MedianScoring(),
    ],
    new AverageScoring(),  // every other school
);

$results = $report->results(CURRENT_TERM);                  // calculated ONCE, used three times below

// ── The term report ──
echo "\nTERM REPORT " . CURRENT_TERM . "\n";
foreach ($results as $result) {
    echo str_pad($result->teacher->name, 14) . str_pad($result->teacher->school, 10)
        . str_pad($result->method, 10) . $result->formattedScore() . "\n";
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
