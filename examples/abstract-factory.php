<?php

declare(strict_types=1);

/**
 * Abstract Factory: the full pattern in plain PHP, no framework.
 * Run it: php examples/abstract-factory.php
 *
 * Roles:
 * - Abstract products: FileStorage, MessageQueue (the things a family contains)
 * - Concrete products: CloudStorage + CloudQueue (cloud family), DiskStorage + MemoryQueue (local family)
 * - Abstract factory: InfrastructureKit (one create method per product)
 * - Concrete factories: CloudKit, LocalKit (each makes a whole matching family)
 * - Client: ReportPublisher (uses one kit, so it can never mix families)
 *
 * In Laravel:
 * Database connections. Each connection class creates its own matching family: a MySQL
 * connection always comes with the MySQL query grammar, schema grammar and result processor,
 * an SQLite connection with the SQLite ones. SQL for one database never reaches another.
 */

// ── Step 1: the abstract products ──
interface FileStorage                                       // ★ Abstract product A
{
    public function put(string $name): string;             // returns where the file is
}

interface MessageQueue                                      // ★ Abstract product B
{
    public function push(string $message): void;
}

// ── Step 2: the cloud family ──
class CloudStorage implements FileStorage
{
    public function put(string $name): string
    {
        return "https://reports.cloud.example.com/{$name}";
    }
}

class CloudQueue implements MessageQueue
{
    public function push(string $message): void
    {
        echo "  [cloud queue] {$message}\n";
    }
}

// ── Step 3: the local family ──
class DiskStorage implements FileStorage
{
    public function put(string $name): string
    {
        return "/var/app/storage/{$name}";
    }
}

class MemoryQueue implements MessageQueue
{
    public function push(string $message): void
    {
        echo "  [memory queue] {$message}\n";
    }
}

// ── Step 4: the abstract factory and one concrete factory per family ──
interface InfrastructureKit                                 // ★ Abstract factory
{
    public function storage(): FileStorage;

    public function queue(): MessageQueue;
}

class CloudKit implements InfrastructureKit                 // ★ Concrete factory: cloud family only
{
    public function storage(): FileStorage
    {
        return new CloudStorage();
    }

    public function queue(): MessageQueue
    {
        return new CloudQueue();
    }
}

class LocalKit implements InfrastructureKit                 // ★ Concrete factory: local family only
{
    public function storage(): FileStorage
    {
        return new DiskStorage();
    }

    public function queue(): MessageQueue
    {
        return new MemoryQueue();
    }
}

// ── Step 5: the client. It only knows the kit. ──
class ReportPublisher                                       // ★ Client
{
    public function __construct(private InfrastructureKit $kit)
    {
    }

    public function publish(int $reportId): void
    {
        $location = $this->kit->storage()->put("report-{$reportId}.pdf");   // ★ both products...
        $this->kit->queue()->push("Report {$reportId} is ready at {$location}");   // ★ ...from the SAME family
    }
}

// ── Using it: ONE decision picks the whole family ──
echo "Local development:\n";
$publisher = new ReportPublisher(new LocalKit());
$publisher->publish(42);

echo "Production:\n";
$publisher = new ReportPublisher(new CloudKit());
$publisher->publish(42);
