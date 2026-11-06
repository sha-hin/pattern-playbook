<?php

declare(strict_types=1);

/**
 * Generators: the full idea in plain PHP, no framework.
 * Run it: php examples/generators.php
 *
 * Roles:
 * - Generator function: evaluations() (it contains yield, so PHP turns it into an iterator)
 * - yield: hands out one value and pauses until the loop asks for the next one
 * - Consumer: the foreach that writes the CSV (it looks like a normal loop)
 *
 * In Laravel:
 * Model::lazyById(1000) returns a LazyCollection built on a generator: it runs one
 * "WHERE id > ? ORDER BY id LIMIT 1000" query at a time and yields each row, so memory
 * stays small however big the table is.
 */

// ── Setup: a table with 100,000 rows in an in-memory SQLite database ──
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE evaluations (id INTEGER PRIMARY KEY, school_id INTEGER, score INTEGER, notes TEXT)');

$db->beginTransaction();
$insert = $db->prepare('INSERT INTO evaluations (school_id, score, notes) VALUES (?, ?, ?)');
for ($i = 1; $i <= 100000; $i++) {
    $insert->execute([$i % 300, $i % 101, str_repeat('x', 60)]);
}
$db->commit();

// ── Step 1: a generator function. Notice "yield" instead of "return". ──
/** @return Generator<int, array<string, mixed>> */
function evaluations(PDO $db): Generator                   // ★ generator function
{
    $query = $db->prepare('SELECT * FROM evaluations WHERE id > ? ORDER BY id LIMIT 1000');
    $lastId = 0;

    while (true) {
        $query->execute([$lastId]);
        $rows = $query->fetchAll(PDO::FETCH_ASSOC);         // at most 1,000 rows in memory

        if (count($rows) === 0) {
            return;                                         // no more rows: the loop ends
        }

        foreach ($rows as $row) {
            yield $row;                                     // ★ hand out one row, pause here
            $lastId = $row['id'];
        }
    }
}

// ── Step 2: a normal loop that works with arrays AND generators ──
/** @param iterable<array<string, mixed>> $rows */
function exportCsv(iterable $rows): int
{
    $file = fopen('php://memory', 'w');
    $count = 0;

    foreach ($rows as $row) {
        fwrite($file, implode(',', $row) . "\n");
        $count++;
    }

    fclose($file);

    return $count;
}

// ── Compare the memory used ──
$start = memory_get_usage();
$count = exportCsv(evaluations($db));                       // ★ looks like any other loop
$usedByGenerator = memory_get_peak_usage() - $start;

$start = memory_get_usage();
$allRows = $db->query('SELECT * FROM evaluations')->fetchAll(PDO::FETCH_ASSOC);   // everything at once
exportCsv($allRows);
$usedByFetchAll = memory_get_peak_usage() - $start;

echo "Exported {$count} rows\n";
echo 'Generator: about ' . round($usedByGenerator / 1048576) . " MB\n";
echo 'fetchAll:  about ' . round($usedByFetchAll / 1048576) . " MB\n";
