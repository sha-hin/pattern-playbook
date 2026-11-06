<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 2: all SQL lives in two repository classes.
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

const CURRENT_TERM = '2026-T1';

// ── Setup: database, tables and the three teachers ──
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
Schema::create($db);
$db->exec("INSERT INTO teachers (id, name, email, school) VALUES
    (1, 'Hany Mostafa', 'hany@smouha.edu.eg', 'Smouha'),
    (2, 'Nadia Fawzy', NULL, 'Smouha'),
    (3, 'Karim Adel', 'karim@miami.edu.eg', 'Miami')");

$teachers = new SqliteTeacherRepository($db);  // the app talks to these two objects...
$responses = new SqliteResponseRepository($db);  // ...and never writes SQL itself

// ── Answers coming in from the survey form (scores are 1 to 5) ──
$submitted = [
    ['teacher_id' => 1, 'term' => '2025-T2', 'role' => 'student', 'score' => '1', 'comment' => 'Last term'],
    ['teacher_id' => 1, 'term' => '2026-T1', 'role' => 'student', 'score' => '5', 'comment' => 'Explains clearly'],
    ['teacher_id' => 1, 'term' => '2026-T1', 'role' => 'student', 'score' => '4', 'comment' => ''],
    ['teacher_id' => 1, 'term' => '2026-T1', 'role' => 'principal', 'score' => '140', 'comment' => 'typo: meant 4'],
    ['teacher_id' => 2, 'term' => '2026-T1', 'role' => 'student', 'score' => '3', 'comment' => 'Starts late'],
    ['teacher_id' => 2, 'term' => '2026-T1', 'role' => 'peer', 'score' => 'five', 'comment' => ''],
    ['teacher_id' => 3, 'term' => '2026-T1', 'role' => 'studnet', 'score' => '2', 'comment' => 'Too fast'],
    ['teacher_id' => 3, 'term' => '2026-T1', 'role' => 'peer', 'score' => '4', 'comment' => "Didn't use the lab"],
];

echo "REJECTED ANSWERS\n";
foreach ($submitted as $number => $answer) {
    try {
        $response = new Response(
            $answer['teacher_id'],
            $answer['term'],
            RespondentRole::fromInput($answer['role']),
            Score::fromInput($answer['score']),
            $answer['comment'],
        );
    } catch (InvalidValue $e) {
        echo "Row {$number}: {$e->getMessage()}\n";
        continue;
    }

    $responses->add($response);  // one line instead of an INSERT
}

/** @param list<Response> $answers */
function averageOf(array $answers): float
{
    if (count($answers) === 0) {
        return 0.0;
    }

    $total = 0;
    foreach ($answers as $answer) {
        $total += $answer->score->value;
    }

    return $total / count($answers);
}

// ── The term report ──
echo "\nTERM REPORT " . CURRENT_TERM . "\n";
foreach ($teachers->all() as $teacher) {
    $answers = $responses->forTeacherInTerm($teacher->id, CURRENT_TERM);  // the same question, asked the same way
    echo str_pad($teacher->name, 14) . ' average ' . number_format(averageOf($answers), 2) . "\n";
}

// ── Email each teacher a summary ──
echo "\nEMAILS\n";
foreach ($teachers->all() as $teacher) {
    if ($teacher->email === null) {
        echo "Not sent to {$teacher->name}: no email address on file.\n";
        continue;
    }

    $answers = $responses->forTeacherInTerm($teacher->id, CURRENT_TERM);
    echo "To: <{$teacher->email}> Your average this term is " . number_format(averageOf($answers), 2) . "\n";
}

// ── CSV export for the Ministry ──
echo "\nMINISTRY CSV\n";
echo "teacher,school,responses,average\n";
foreach ($teachers->all() as $teacher) {
    $answers = $responses->forTeacherInTerm($teacher->id, CURRENT_TERM);
    echo "{$teacher->name},{$teacher->school}," . count($answers) . ',' . round(averageOf($answers), 2) . "\n";
}
