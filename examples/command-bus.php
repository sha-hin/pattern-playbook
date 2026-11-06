<?php

declare(strict_types=1);

/**
 * Command Bus: the full pattern in plain PHP, no framework.
 * Run it: php examples/command-bus.php
 *
 * Roles:
 * - Command: RecalculateSchoolStats (only data: WHAT should happen)
 * - Handler: RecalculateSchoolStatsHandler (the logic: HOW it happens)
 * - Bus: CommandBus (finds the right handler and runs it)
 * - Shared rules: logging and a database transaction, written once inside the bus
 *
 * In Laravel:
 * Laravel's Bus Dispatcher: dispatch() puts a job on the queue if it implements ShouldQueue,
 * otherwise runs it now. Every job passes through the same middleware first (rate limits,
 * "don't run twice at once"), which is the "shared rules" idea below.
 */

// ── Step 1: the command. Only data. ──
final class RecalculateSchoolStats                          // ★ Command
{
    public function __construct(public readonly int $schoolId)
    {
    }
}

// ── Step 2: the handler. The logic, with what it needs. ──
final class RecalculateSchoolStatsHandler                   // ★ Handler
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function handle(RecalculateSchoolStats $command): float
    {
        $query = $this->db->prepare('SELECT AVG(score) FROM evaluations WHERE school_id = ?');
        $query->execute([$command->schoolId]);
        $average = round((float) $query->fetchColumn(), 1);

        $save = $this->db->prepare('REPLACE INTO school_stats (school_id, average) VALUES (?, ?)');
        $save->execute([$command->schoolId, $average]);

        return $average;
    }
}

// ── Step 3: the bus. Finds the handler, and applies the shared rules to EVERY command. ──
final class CommandBus                                      // ★ Bus
{
    /** @var array<class-string, object> command class => its handler */
    private array $handlers = [];

    public function __construct(private readonly PDO $db)
    {
    }

    public function register(string $commandClass, object $handler): void
    {
        $this->handlers[$commandClass] = $handler;
    }

    public function dispatch(object $command): mixed
    {
        $class = get_class($command);

        if (!isset($this->handlers[$class])) {
            throw new LogicException("No handler registered for {$class}.");
        }

        $handler = $this->handlers[$class];                 // ★ find the handler

        echo "-> {$class}\n";                               // shared rule 1: log every command

        $this->db->beginTransaction();                      // shared rule 2: all or nothing
        try {
            $result = $handler->handle($command);           // ★ run it
            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }

        echo "<- done\n";

        return $result;
    }
}

// ── Setup: an in-memory SQLite database ──
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE evaluations (school_id INTEGER, score INTEGER)');
$db->exec('CREATE TABLE school_stats (school_id INTEGER PRIMARY KEY, average REAL)');
$db->exec('INSERT INTO evaluations VALUES (7, 80), (7, 91), (7, 74)');

$bus = new CommandBus($db);
$bus->register(RecalculateSchoolStats::class, new RecalculateSchoolStatsHandler($db));

// ── The admin button, the nightly schedule and the importer all use this one line ──
$average = $bus->dispatch(new RecalculateSchoolStats(7));
echo "Average: {$average}\n";
