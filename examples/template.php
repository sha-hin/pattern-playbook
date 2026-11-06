<?php

declare(strict_types=1);

/**
 * Template Method: the full pattern in plain PHP, no framework.
 * Run it: php examples/template.php
 *
 * Roles:
 * - Abstract class: GradeImport (owns the template method)
 * - Template method: import() (marked final: the order of steps can never change)
 * - Abstract steps: read(), map() (each child MUST write them)
 * - Hook: afterImport() (has a default: a child MAY replace it)
 * - Concrete classes: CsvGradeImport, JsonGradeImport
 *
 * In Laravel:
 * Form requests. Laravel always runs the same steps in the same order: prepareForValidation(),
 * then your authorize(), then validation with your rules(), then passedValidation().
 * You only write rules() and authorize(), and may override the two hooks.
 */

// ── Step 1: the abstract class with the locked recipe ──
abstract class GradeImport                                  // ★ Abstract class
{
    public array $saved = [];

    final public function import(string $source): void      // ★ Template method: final = nobody can change the order
    {
        $rawRows = $this->read($source);                    // 1. read the file      (differs per system)

        foreach ($rawRows as $raw) {
            $row = $this->map($raw);                        // 2. rename the columns (differs per system)
            $this->validate($row);                          // 3. validate           (same for everyone)
            $this->saved[] = $row;                          // 4. save               (same for everyone)
        }

        $this->afterImport(count($rawRows));                // 5. a hook
    }

    abstract protected function read(string $source): array;   // ★ MUST be written by each child

    abstract protected function map(array $raw): array;         // ★ MUST be written by each child

    protected function afterImport(int $count): void        // ★ hook: MAY be replaced
    {
        echo get_class($this) . " imported {$count} rows\n";
    }

    private function validate(array $row): void            // private: children cannot skip it
    {
        if ($row['score'] < 0 || $row['score'] > 100) {
            throw new InvalidArgumentException("Score must be 0-100, got {$row['score']}.");
        }
    }
}

// ── Step 2: concrete classes. Each writes only the steps that differ. ──
class CsvGradeImport extends GradeImport                    // ★ Concrete class
{
    protected function read(string $source): array
    {
        $rows = [];
        foreach (explode("\n", trim($source)) as $line) {
            $rows[] = explode(',', $line);                  // "S-1,Math,88" becomes ['S-1', 'Math', '88']
        }

        return $rows;
    }

    protected function map(array $raw): array
    {
        return ['student' => $raw[0], 'score' => (int) $raw[2]];   // System A: score is the 3rd column
    }
}

class JsonGradeImport extends GradeImport                   // ★ Concrete class
{
    protected function read(string $source): array
    {
        return json_decode($source, true);
    }

    protected function map(array $raw): array
    {
        return ['student' => $raw['name'], 'score' => (int) $raw['mark']];   // System B: different names
    }
}

// ── Using it ──
$csv = new CsvGradeImport();
$csv->import("S-1,Math,88\nS-2,Math,74");

$json = new JsonGradeImport();
$json->import('[{"name":"S-3","mark":91}]');

try {
    $bad = new CsvGradeImport();
    $bad->import('S-4,Math,140');
} catch (InvalidArgumentException $e) {
    echo 'Rejected: ' . $e->getMessage() . "\n";           // validation could not be skipped
}
