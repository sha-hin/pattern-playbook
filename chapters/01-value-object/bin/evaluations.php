<?php

declare(strict_types=1);

/*
 * Evalu8, chapter 1: bad values can no longer get in.
 *
 *     composer dump-autoload
 *     php bin/evaluations.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Evalu8\Domain\EmailAddress;
use Evalu8\Domain\InvalidValue;
use Evalu8\Domain\RespondentRole;
use Evalu8\Domain\Score;

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$db->exec('CREATE TABLE teachers (id INTEGER PRIMARY KEY, name TEXT, email TEXT, school TEXT)');
$db->exec('CREATE TABLE responses (id INTEGER PRIMARY KEY, teacher_id INTEGER, role TEXT, score INTEGER, comment TEXT)');

$db->exec("INSERT INTO teachers (id, name, email, school) VALUES
    (1, 'Hany Mostafa', 'hany@smouha.edu.eg', 'Smouha'),
    (2, 'Nadia Fawzy', '', 'Smouha'),
    (3, 'Karim Adel', 'karim@miami.edu.eg', 'Miami')");

// ── Answers coming in from the survey form (scores are 1 to 5) ──
$submitted = [
    ['teacher_id' => 1, 'role' => 'student', 'score' => '5', 'comment' => 'Explains clearly'],
    ['teacher_id' => 1, 'role' => 'student', 'score' => '4', 'comment' => ''],
    ['teacher_id' => 1, 'role' => 'principal', 'score' => '140', 'comment' => 'typo: meant 4'],
    ['teacher_id' => 2, 'role' => 'student', 'score' => '3', 'comment' => 'Starts late'],
    ['teacher_id' => 2, 'role' => 'peer', 'score' => 'five', 'comment' => ''],
    ['teacher_id' => 3, 'role' => 'studnet', 'score' => '2', 'comment' => 'Too fast'],
    ['teacher_id' => 3, 'role' => 'peer', 'score' => '4', 'comment' => ''],
];

$insert = $db->prepare('INSERT INTO responses (teacher_id, role, score, comment) VALUES (?, ?, ?, ?)');

echo "REJECTED ANSWERS\n";
foreach ($submitted as $number => $answer) {
    try {
        $role = RespondentRole::fromInput($answer['role']);  // invalid input stops here...
        $score = Score::fromInput($answer['score']);  // ...or here
    } catch (InvalidValue $e) {
        echo "Row {$number}: {$e->getMessage()}\n";  // rejected loudly, never stored
        continue;
    }

    $insert->execute([$answer['teacher_id'], $role->value, $score->value, $answer['comment']]);
}

// ── The term report ──
echo "\nTERM REPORT\n";
$teachers = $db->query('SELECT * FROM teachers')->fetchAll();
foreach ($teachers as $teacher) {
    $rows = $db->query('SELECT * FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();
    $total = 0;
    foreach ($rows as $row) {
        $total += (int) $row['score'];
    }
    $average = count($rows) > 0 ? $total / count($rows) : 0;
    echo str_pad($teacher['name'], 14) . ' average ' . number_format($average, 2) . "\n";
}

// ── Email each teacher a summary ──
echo "\nEMAILS\n";
foreach ($teachers as $teacher) {
    try {
        $email = new EmailAddress($teacher['email']);  // no more emails to <>
    } catch (InvalidValue $e) {
        echo "Not sent to {$teacher['name']}: {$e->getMessage()}\n";
        continue;
    }

    $rows = $db->query('SELECT * FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();
    $total = 0;
    foreach ($rows as $row) {
        $total += (int) $row['score'];
    }
    $average = count($rows) > 0 ? $total / count($rows) : 0;
    echo "To: <{$email}> Your average this term is " . number_format($average, 2) . "\n";
}

// ── CSV export for the Ministry ──
echo "\nMINISTRY CSV\n";
echo "teacher,school,responses,average\n";
foreach ($teachers as $teacher) {
    $rows = $db->query('SELECT score FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();
    $sum = 0;
    foreach ($rows as $row) {
        $sum += (int) $row['score'];
    }
    $average = count($rows) > 0 ? round($sum / count($rows), 2) : 0;
    echo "{$teacher['name']},{$teacher['school']}," . count($rows) . ",{$average}\n";
}
