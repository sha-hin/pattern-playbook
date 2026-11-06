<?php

declare(strict_types=1);

/**
 * Command Bus: the full pattern in plain PHP, no framework.
 * Run it: php examples/command-bus.php
 *
 * Roles:
 * - Command: RecalculateSchoolStats (only data: what should happen)
 * - Handler: RecalculateSchoolStatsHandler (the logic and its dependencies: how)
 * - Bus: CommandBus (finds the handler, runs it through middleware)
 * - Middleware: LogMiddleware, TransactionMiddleware (rules shared by every command)
 *
 * In Laravel:
 * Illuminate\Bus\Dispatcher: dispatch() sends a job to the queue if it implements
 * ShouldQueue, otherwise runs it now. pipeThrough() and job middleware wrap every job in
 * shared rules (rate limits, no overlapping), using Laravel's Pipeline.
 */

final class RecalculateSchoolStats                              // ★ Command: only data
{
    public function __construct(public readonly int $schoolId) {}
}

final class RecalculateSchoolStatsHandler                       // ★ Handler: the logic
{
    public function __construct(private readonly PDO $db) {}

    public function handle(RecalculateSchoolStats $command): float
    {
        $statement = $this->db->prepare('SELECT AVG(score) FROM evaluations WHERE school_id = ?');
        $statement->execute([$command->schoolId]);
        $average = round((float) $statement->fetchColumn(), 1);

        $this->db->prepare('REPLACE INTO school_stats (school_id, average) VALUES (?, ?)')
            ->execute([$command->schoolId, $average]);

        return $average;
    }
}

interface Middleware
{
    /** @param Closure(object): mixed $next */
    public function handle(object $command, Closure $next): mixed;
}

final class LogMiddleware implements Middleware
{
    public function handle(object $command, Closure $next): mixed
    {
        echo '→ ', $command::class, PHP_EOL;
        $result = $next($command);
        echo '← done', PHP_EOL;

        return $result;
    }
}

final class TransactionMiddleware implements Middleware        // every command is all-or-nothing
{
    public function __construct(private readonly PDO $db) {}

    public function handle(object $command, Closure $next): mixed
    {
        $this->db->beginTransaction();
        try {
            $result = $next($command);
            $this->db->commit();

            return $result;
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}

final class CommandBus                                          // ★ Bus
{
    /**
     * @param array<class-string, Closure(): object> $handlers   command class => how to build its handler
     * @param list<Middleware> $middleware
     */
    public function __construct(private readonly array $handlers, private readonly array $middleware = []) {}

    public function dispatch(object $command): mixed
    {
        $factory = $this->handlers[$command::class]
            ?? throw new LogicException('No handler for ' . $command::class);   // wiring bugs fail loudly

        $core = fn (object $c): mixed => $factory()->handle($c);           // ★ find and run the handler

        $pipeline = array_reduce(                                           // ★ wrap it in every middleware
            array_reverse($this->middleware),
            fn (Closure $next, Middleware $m): Closure => fn (object $c): mixed => $m->handle($c, $next),
            $core,
        );

        return $pipeline($command);
    }
}

// ── Setup ───────────────────────────────────────────────────────────────
$db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE TABLE evaluations (school_id INTEGER, score INTEGER)');
$db->exec('CREATE TABLE school_stats (school_id INTEGER PRIMARY KEY, average REAL)');
$db->exec('INSERT INTO evaluations VALUES (7, 80), (7, 91), (7, 74)');

$bus = new CommandBus(
    [RecalculateSchoolStats::class => fn () => new RecalculateSchoolStatsHandler($db)],
    [new LogMiddleware(), new TransactionMiddleware($db)],
);

// ── The admin button, the nightly schedule and the importer all use this one line ──
$average = $bus->dispatch(new RecalculateSchoolStats(7));
echo "Average: {$average}", PHP_EOL;
