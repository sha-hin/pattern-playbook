<?php

declare(strict_types=1);

/**
 * Strategy: the full pattern in plain PHP, no framework.
 * Run it: php examples/strategy.php
 *
 * Roles:
 * - Strategy: Exporter (the interface every way of doing the job signs)
 * - Concrete strategies: CsvExporter, JsonExporter (one class per way)
 * - Context: ReportService (uses whichever strategy it is given, never asks which)
 *
 * In Laravel:
 * Hashing is built this way. Illuminate\Contracts\Hashing\Hasher is the Strategy interface,
 * BcryptHasher and ArgonHasher are the concrete strategies, and your code only ever calls
 * make() and check() on the interface. Which one runs is decided by config('hashing.driver').
 */

interface Exporter                                              // ★ Strategy: one contract for every way
{
    /** @param list<array<string, scalar>> $rows */
    public function export(array $rows): string;
}

final class CsvExporter implements Exporter                     // ★ Concrete strategy #1
{
    public function export(array $rows): string
    {
        if ($rows === []) {
            return '';
        }

        $out = fopen('php://temp', 'r+') ?: throw new RuntimeException('Cannot open a memory stream.');
        fputcsv($out, array_keys($rows[0]), ',', '"', '');
        foreach ($rows as $row) {
            fputcsv($out, array_values($row), ',', '"', '');
        }
        rewind($out);
        $csv = (string) stream_get_contents($out);
        fclose($out);

        return $csv;
    }
}

final class JsonExporter implements Exporter                    // ★ Concrete strategy #2
{
    public function export(array $rows): string
    {
        return json_encode($rows, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . PHP_EOL;
    }
}

final class ReportService                                       // ★ Context
{
    /** @param list<array<string, scalar>> $rows */
    public function __construct(private readonly array $rows) {}

    public function export(Exporter $exporter): string          // ★ accepts ANY strategy
    {
        return $exporter->export($this->rows);                  // ★ never checks which one it got
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$report = new ReportService([
    ['school' => 'Smouha', 'average' => 81],
    ['school' => 'Miami', 'average' => 77],
]);

echo $report->export(new CsvExporter());
echo $report->export(new JsonExporter());

// Adding XML later = one new class that implements Exporter. ReportService never changes.
