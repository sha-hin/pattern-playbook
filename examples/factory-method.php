<?php

declare(strict_types=1);

/**
 * Factory Method: the full pattern in plain PHP, no framework.
 * Run it: php examples/factory-method.php
 *
 * Roles:
 * - Creator: StudentImport (runs the process; leaves createReader() to its children)
 * - Factory method: createReader() (abstract: "give me a reader, I don't care which")
 * - Concrete creators: CsvStudentImport, JsonLinesStudentImport (each decides which reader)
 * - Product: RowReader; Concrete products: CsvRowReader, JsonLinesRowReader
 *
 * In Laravel:
 * Illuminate\Support\Manager: its driver() method runs the process (pick, build once,
 * reuse) and calls create{Name}Driver(), a factory method that each child supplies:
 * CacheManager::createRedisDriver(), createFileDriver(), and so on.
 */

interface RowReader                                             // ★ Product
{
    /** @return iterable<array{code: string, name: string}> */
    public function rows(): iterable;
}

final class CsvRowReader implements RowReader                   // Concrete product
{
    public function __construct(private readonly string $path) {}

    public function rows(): iterable
    {
        $file = new SplFileObject($this->path);
        $file->setFlags(SplFileObject::READ_CSV | SplFileObject::SKIP_EMPTY | SplFileObject::READ_AHEAD);
        $file->setCsvControl(',', '"', '');
        foreach ($file as $cells) {
            yield ['code' => (string) $cells[0], 'name' => (string) $cells[1]];
        }
    }
}

final class JsonLinesRowReader implements RowReader            // Concrete product
{
    public function __construct(private readonly string $path) {}

    public function rows(): iterable
    {
        foreach (new SplFileObject($this->path) as $line) {
            if (trim((string) $line) === '') {
                continue;
            }
            $row = json_decode((string) $line, true, 4, JSON_THROW_ON_ERROR);
            yield ['code' => (string) $row['code'], 'name' => (string) $row['full_name']];
        }
    }
}

abstract class StudentImport                                    // ★ Creator
{
    /** @var array<string, string> */
    public array $students = [];

    final public function run(string $path): int                // the process: same for every format
    {
        $count = 0;
        foreach ($this->createReader($path)->rows() as $row) {  // ★ "give me a reader", don't care which
            $this->students[$row['code']] = $row['name'];
            $count++;
        }

        return $count;
    }

    abstract protected function createReader(string $path): RowReader;   // ★ the factory method
}

final class CsvStudentImport extends StudentImport              // ★ Concrete creator
{
    protected function createReader(string $path): RowReader
    {
        return new CsvRowReader($path);                         // ★ the child decides
    }
}

final class JsonLinesStudentImport extends StudentImport        // ★ Concrete creator
{
    protected function createReader(string $path): RowReader
    {
        return new JsonLinesRowReader($path);
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$csv = tempnam(sys_get_temp_dir(), 'students');
$jsonl = tempnam(sys_get_temp_dir(), 'students');
file_put_contents($csv, "S-1,Mona Adel\nS-2,Omar Said\n");
file_put_contents($jsonl, "{\"code\":\"S-3\",\"full_name\":\"Laila Hassan\"}\n");

$fromCsv = new CsvStudentImport();
echo 'CSV imported: ', $fromCsv->run($csv), PHP_EOL;

$fromJson = new JsonLinesStudentImport();
echo 'JSONL imported: ', $fromJson->run($jsonl), PHP_EOL;

echo implode(', ', [...$fromCsv->students, ...$fromJson->students]), PHP_EOL;

unlink($csv);
unlink($jsonl);
// A new format = one new creator + one new reader. StudentImport::run() never changes.
