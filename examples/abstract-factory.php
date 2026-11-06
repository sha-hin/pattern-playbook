<?php

declare(strict_types=1);

/**
 * Abstract Factory: the full pattern in plain PHP, no framework.
 * Run it: php examples/abstract-factory.php
 *
 * Roles:
 * - Abstract factory: InfrastructureKit (one create method per product in the family)
 * - Concrete factories: CloudKit, LocalKit (each makes a whole matching family)
 * - Abstract products: FileStorage, MessageQueue
 * - Concrete products: BucketStorage + RemoteQueue (cloud family), DiskStorage + MemoryQueue (local family)
 * - Client: ReportPublisher (uses a kit; can never mix families)
 *
 * In Laravel:
 * Database connections: each Connection class makes its own matching family through
 * getDefaultQueryGrammar(), getDefaultSchemaGrammar() and getDefaultPostProcessor().
 * A MySqlConnection always comes with MySQL grammars, a SQLiteConnection with SQLite ones,
 * so SQL written for one database is never sent to another.
 */

interface FileStorage                                           // ★ Abstract product A
{
    public function put(string $path, string $contents): string;
}

interface MessageQueue                                          // ★ Abstract product B
{
    public function push(string $message): void;
}

interface InfrastructureKit                                     // ★ Abstract factory
{
    public function storage(): FileStorage;

    public function queue(): MessageQueue;
}

// ── Family 1: cloud ─────────────────────────────────────────────────────
final class BucketStorage implements FileStorage
{
    public function __construct(private readonly string $bucket) {}

    public function put(string $path, string $contents): string
    {
        return "https://{$this->bucket}.storage.example.com/{$path}";   // pretend upload
    }
}

final class RemoteQueue implements MessageQueue
{
    public function push(string $message): void
    {
        echo "  [remote queue] {$message}", PHP_EOL;
    }
}

final class CloudKit implements InfrastructureKit                // ★ Concrete factory: cloud family
{
    public function __construct(private readonly string $bucket) {}

    public function storage(): FileStorage
    {
        return new BucketStorage($this->bucket);
    }

    public function queue(): MessageQueue
    {
        return new RemoteQueue();
    }
}

// ── Family 2: local development ─────────────────────────────────────────
final class DiskStorage implements FileStorage
{
    public function __construct(private readonly string $dir) {}

    public function put(string $path, string $contents): string
    {
        $file = $this->dir . '/' . basename($path);
        if (file_put_contents($file, $contents) === false) {
            throw new RuntimeException("Cannot write {$file}");
        }

        return $file;
    }
}

final class MemoryQueue implements MessageQueue
{
    /** @var list<string> */
    public array $messages = [];

    public function push(string $message): void
    {
        $this->messages[] = $message;
        echo "  [memory queue] {$message}", PHP_EOL;
    }
}

final class LocalKit implements InfrastructureKit                // ★ Concrete factory: local family
{
    public function storage(): FileStorage
    {
        return new DiskStorage(sys_get_temp_dir());
    }

    public function queue(): MessageQueue
    {
        return new MemoryQueue();
    }
}

// ── Client: only knows the abstract factory ─────────────────────────────
final class ReportPublisher                                     // ★ Client
{
    public function __construct(private readonly InfrastructureKit $kit) {}

    public function publish(int $reportId, string $pdf): void
    {
        $location = $this->kit->storage()->put("report-{$reportId}.pdf", $pdf);   // ★ both products...
        $this->kit->queue()->push("report {$reportId} ready at {$location}");    // ★ ...from the SAME family
    }
}

// ── The ONE decision ────────────────────────────────────────────────────
$production = getenv('APP_ENV') === 'production';
$kit = $production ? new CloudKit('school-reports') : new LocalKit();

echo $production ? 'Production:' : 'Local:', PHP_EOL;
(new ReportPublisher($kit))->publish(42, '%PDF-1.7 ...');
@unlink(sys_get_temp_dir() . '/report-42.pdf');               // tidy up the demo file

echo 'Cloud:', PHP_EOL;
(new ReportPublisher(new CloudKit('school-reports')))->publish(43, '%PDF-1.7 ...');
