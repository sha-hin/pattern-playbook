<?php

declare(strict_types=1);

/**
 * Generators: the full idea in plain PHP, no framework.
 * Run it: php examples/generators.php
 *
 * Roles:
 * - Generator function: evaluations() (contains yield, so PHP turns it into an Iterator)
 * - yield: hands out one value and pauses until the loop asks for the next
 * - Consumer: the foreach writing the CSV (looks exactly like a normal loop)
 *
 * In Laravel:
 * LazyCollection::make(function () { yield ...; }) is built on generators.
 * Model::lazyById(1000) runs one "WHERE id > ? ORDER BY id LIMIT 1000" query at a time and
 * yields each row, and cursor() yields rows from a single PDO statement.
 */

$db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE TABLE evaluations (id INTEGER PRIMARY KEY, school_id INTEGER, score INTEGER, notes TEXT)');
$db->beginTransaction();
$insert = $db->prepare('INSERT INTO evaluations (school_id, score, notes) VALUES (?, ?, ?)');
for ($i = 1; $i <= 100_000; $i++) {
    $insert->execute([$i % 300, $i % 101, str_repeat('x', 60)]);
}
$db->commit();

/** @return Generator<int, array{id: int, school_id: int, score: int, notes: string}> */
function evaluations(PDO $db, int $chunk = 1000): Generator   // ★ a generator function
{
    $query = $db->prepare('SELECT * FROM evaluations WHERE id > ? ORDER BY id LIMIT ?');
    $lastId = 0;

    do {
        $query->execute([$lastId, $chunk]);
        $rows = $query->fetchAll(PDO::FETCH_ASSOC);             // at most one chunk in memory

        foreach ($rows as $row) {
            yield $row;                                         // ★ hand out one row, pause here
            $lastId = (int) $row['id'];
        }
    } while (count($rows) === $chunk);                          // WHERE id > ? stays fast at any depth
}

function exportCsv(iterable $rows): int                         // works with arrays AND generators
{
    $out = fopen('php://temp', 'w+') ?: throw new RuntimeException('Cannot open a temp stream.');
    $count = 0;
    foreach ($rows as $row) {
        fputcsv($out, $row, ',', '"', '');
        $count++;
    }
    fclose($out);

    return $count;
}

// ── 1. With a generator: memory stays flat ─────────────────────────────
memory_reset_peak_usage();
$before = memory_get_usage();
$count = exportCsv(evaluations($db));                           // ★ looks like a normal loop
printf("Generator: %d rows, peak extra memory %.1f MB\n", $count, (memory_get_peak_usage() - $before) / 1048576);

// ── 2. Loading everything first: memory grows with the table ───────────
memory_reset_peak_usage();
$before = memory_get_usage();
$all = $db->query('SELECT * FROM evaluations ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$count = exportCsv($all);
printf("fetchAll:  %d rows, peak extra memory %.1f MB\n", $count, (memory_get_peak_usage() - $before) / 1048576);
