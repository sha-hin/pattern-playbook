<?php

declare(strict_types=1);

/**
 * Factory Method: the full pattern in plain PHP, no framework.
 * Run it: php examples/factory-method.php
 *
 * Roles:
 * - Creator: StudentImport (runs the process, but leaves "which reader?" to its children)
 * - Factory method: createReader() (abstract: each child decides what to create)
 * - Concrete creators: CsvStudentImport, JsonStudentImport
 * - Product: RowReader; Concrete products: CsvReader, JsonReader
 *
 * In Laravel:
 * Laravel's Manager base class (behind sessions, hashing, notifications) runs the same
 * process for every driver and calls a factory method that each child class supplies:
 * SessionManager has createFileDriver(), createDatabaseDriver(), createRedisDriver()...
 */

// ── Step 1: the Product and its concrete versions ──
interface RowReader                                         // ★ Product
{
    public function rows(string $content): array;
}

class CsvReader implements RowReader                        // Concrete product
{
    public function rows(string $content): array
    {
        $rows = [];
        foreach (explode("\n", trim($content)) as $line) {
            [$code, $name] = explode(',', $line);           // "S-1,Mona Adel"
            $rows[] = ['code' => $code, 'name' => $name];
        }

        return $rows;
    }
}

class JsonReader implements RowReader                       // Concrete product
{
    public function rows(string $content): array
    {
        $rows = [];
        foreach (json_decode($content, true) as $item) {
            $rows[] = ['code' => $item['code'], 'name' => $item['full_name']];
        }

        return $rows;
    }
}

// ── Step 2: the Creator. The process is fixed; the reader is left to the children. ──
abstract class StudentImport                                // ★ Creator
{
    public array $students = [];

    public function run(string $content): int               // the process: same for every format
    {
        $reader = $this->createReader();                    // ★ "give me a reader", don't care which

        foreach ($reader->rows($content) as $row) {
            $this->students[$row['code']] = $row['name'];
        }

        return count($this->students);
    }

    abstract protected function createReader(): RowReader;  // ★ the factory method
}

// ── Step 3: concrete creators. Each one decides which reader to create. ──
class CsvStudentImport extends StudentImport                // ★ Concrete creator
{
    protected function createReader(): RowReader
    {
        return new CsvReader();                             // ★ the child decides
    }
}

class JsonStudentImport extends StudentImport               // ★ Concrete creator
{
    protected function createReader(): RowReader
    {
        return new JsonReader();
    }
}

// ── Using it ──
$fromCsv = new CsvStudentImport();
echo 'CSV imported: ' . $fromCsv->run("S-1,Mona Adel\nS-2,Omar Said") . "\n";

$fromJson = new JsonStudentImport();
echo 'JSON imported: ' . $fromJson->run('[{"code":"S-3","full_name":"Laila Hassan"}]') . "\n";

// A new format (Excel) = one new creator + one new reader. StudentImport::run() never changes.
