<?php

declare(strict_types=1);

/*
 * Evalu8: the code as we found it.
 *
 * One script does everything: it saves answers, prints the term report,
 * emails each teacher a summary and exports a CSV for the Ministry.
 * It "works". Run it and read the output carefully.
 *
 *     php evaluations.php
 */

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$db->exec('CREATE TABLE teachers (id INTEGER PRIMARY KEY, name TEXT, email TEXT, school TEXT)');
$db->exec('CREATE TABLE responses (id INTEGER PRIMARY KEY, teacher_id INTEGER, role TEXT, score, comment TEXT)');

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

foreach ($submitted as $answer) {
    $db->exec("INSERT INTO responses (teacher_id, role, score, comment) VALUES ("
        . $answer['teacher_id'] . ", '" . $answer['role'] . "', '" . $answer['score'] . "', '"
        . $answer['comment'] . "')");
}

// ── The term report ──
echo "TERM REPORT\n";
$teachers = $db->query('SELECT * FROM teachers')->fetchAll();
foreach ($teachers as $teacher) {
    $rows = $db->query('SELECT * FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();
    $total = 0;
    foreach ($rows as $row) {
        $total += (float) $row['score'];
    }
    $average = count($rows) > 0 ? $total / count($rows) : 0;
    echo str_pad($teacher['name'], 14) . ' average ' . number_format($average, 2) . "\n";
}

// ── Email each teacher a summary ──
echo "\nEMAILS\n";
foreach ($teachers as $teacher) {
    $rows = $db->query('SELECT * FROM responses WHERE teacher_id = ' . $teacher['id'])->fetchAll();
    $total = 0;
    foreach ($rows as $row) {
        $total += (float) $row['score'];
    }
    $average = count($rows) > 0 ? $total / count($rows) : 0;
    echo "To: <{$teacher['email']}> Your average this term is " . number_format($average, 2) . "\n";
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
