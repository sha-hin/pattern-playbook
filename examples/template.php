<?php

declare(strict_types=1);

/**
 * Template Method: the full pattern in plain PHP, no framework.
 * Run it: php examples/template.php
 *
 * Roles:
 * - Abstract class: GradeImport (owns the template method import(), marked final)
 * - Template method: import() (the fixed order of steps)
 * - Primitive operations: read(), map() (abstract: each child MUST fill them in)
 * - Hook: afterImport() (has a default: a child MAY override it)
 * - Concrete classes: CsvGradeImport, JsonGradeImport
 *
 * In Laravel:
 * FormRequest: ValidatesWhenResolvedTrait::validateResolved() always runs
 * prepareForValidation() → authorize → build validator → fail or passedValidation(),
 * in that order. You only fill in rules() and authorize(), and may override the hooks.
 */

final class GradeStore
{
    /** @var list<array{student: string, score: int}> */
    public array $rows = [];
}

final class InvalidImport extends RuntimeException {}

abstract class GradeImport                                      // ★ Abstract class
{
    public function __construct(protected readonly GradeStore $store) {}

    final public function import(string $source): int           // ★ Template method: the locked recipe
    {
        $raw = $this->read($source);                            // differs per system
        $rows = array_map(fn (array $r): array => $this->map($r), $raw);   // differs per system
        $this->validate($rows);                                 // same for everyone
        array_push($this->store->rows, ...$rows);               // same for everyone
        $this->afterImport(count($rows));                       // hook

        return count($rows);
    }

    /** @return list<array<string|int, mixed>> */
    abstract protected function read(string $source): array;   // ★ primitive operation: MUST fill in

    /** @return array{student: string, score: int} */
    abstract protected function map(array $raw): array;        // ★ primitive operation: MUST fill in

    protected function afterImport(int $count): void           // ★ hook: MAY override
    {
        echo static::class . " imported {$count} rows", PHP_EOL;
    }

    /** @param list<array{student: string, score: int}> $rows */
    private function validate(array $rows): void                // private: children cannot skip it
    {
        foreach ($rows as $i => $row) {
            if ($row['score'] < 0 || $row['score'] > 100) {
                throw new InvalidImport("Row {$i}: score must be 0-100, got {$row['score']}.");
            }
        }
    }
}

final class CsvGradeImport extends GradeImport                 // ★ Concrete class: only the 2 steps
{
    protected function read(string $source): array
    {
        $lines = array_filter(explode("\n", trim($source)));

        return array_map(fn (string $line): array => str_getcsv($line, ',', '"', ''), $lines);
    }

    protected function map(array $raw): array
    {
        return ['student' => (string) $raw[0], 'score' => (int) $raw[2]];   // System A: score is column 3
    }
}

final class JsonGradeImport extends GradeImport                 // ★ Concrete class
{
    protected function read(string $source): array
    {
        return json_decode($source, true, 8, JSON_THROW_ON_ERROR);
    }

    protected function map(array $raw): array
    {
        return ['student' => (string) $raw['name'], 'score' => (int) $raw['mark']];   // System B: other names
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$store = new GradeStore();

(new CsvGradeImport($store))->import("S-1,Math,88\nS-2,Math,74");
(new JsonGradeImport($store))->import('[{"name":"S-3","mark":91}]');

try {
    (new CsvGradeImport($store))->import('S-4,Math,140');
} catch (InvalidImport $e) {
    echo 'Rejected: ', $e->getMessage(), PHP_EOL;              // validation could not be skipped
}

echo 'Stored rows: ', count($store->rows), PHP_EOL;
