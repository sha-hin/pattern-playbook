<?php

declare(strict_types=1);

/**
 * Strategy: the full pattern in plain PHP, no framework.
 * Run it: php examples/strategy.php
 *
 * Roles:
 * - Strategy: Exporter (the interface every way of doing the job must follow)
 * - Concrete strategies: CsvExporter, JsonExporter (one class per way)
 * - Context: ReportService (uses whichever strategy it is given, never asks which)
 *
 * In Laravel:
 * Password hashing is built this way. The Hasher interface is the Strategy, BcryptHasher and
 * ArgonHasher are the concrete strategies, and your code only calls Hash::make(). Which one
 * runs is decided by config('hashing.driver').
 */

// ── Step 1: the Strategy. One interface that every "way" must follow. ──
interface Exporter                                          // ★ Strategy
{
    public function export(array $rows): string;
}

// ── Step 2: concrete strategies. One class per way of doing the same job. ──
class CsvExporter implements Exporter                       // ★ Concrete strategy #1
{
    public function export(array $rows): string
    {
        if (count($rows) === 0) {
            return '';
        }

        $lines = [];
        $lines[] = implode(',', array_keys($rows[0]));     // header: school,average
        foreach ($rows as $row) {
            $lines[] = implode(',', $row);                  // a real one uses fputcsv() to escape commas
        }

        return implode("\n", $lines) . "\n";
    }
}

class JsonExporter implements Exporter                      // ★ Concrete strategy #2
{
    public function export(array $rows): string
    {
        return json_encode($rows, JSON_PRETTY_PRINT) . "\n";
    }
}

// ── Step 3: the Context. It uses a strategy without knowing which one. ──
class ReportService                                         // ★ Context
{
    public function __construct(private array $rows)
    {
    }

    public function export(Exporter $exporter): string     // ★ accepts ANY strategy
    {
        return $exporter->export($this->rows);              // ★ never checks which one it got
    }
}

// ── Using it ──
$report = new ReportService([
    ['school' => 'Smouha', 'average' => 81],
    ['school' => 'Miami', 'average' => 77],
]);

echo $report->export(new CsvExporter());
echo $report->export(new JsonExporter());

// Adding XML later = one new class that implements Exporter. ReportService never changes.
