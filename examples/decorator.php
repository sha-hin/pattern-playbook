<?php

declare(strict_types=1);

/**
 * Decorator: the full pattern in plain PHP, no framework.
 * Run it: php examples/decorator.php
 *
 * Roles:
 * - Component: SchoolStats (the interface)
 * - Concrete component: DbSchoolStats (the real, slow work; never edited)
 * - Decorators: CachedSchoolStats, LoggedSchoolStats (same interface, each wraps another SchoolStats)
 *
 * In Laravel:
 * $this->app->extend(SchoolStats::class, fn ($stats) => new CachedSchoolStats($stats)) tells the
 * container to wrap a service every time it is built. Each extend() adds one more layer.
 */

// ── Step 1: the Component interface ──
interface SchoolStats                                       // ★ Component
{
    /** @return array{school: int, average: int} */
    public function forSchool(int $schoolId): array;
}

// ── Step 2: the real work. We never edit this class. ──
final class DbSchoolStats implements SchoolStats            // ★ Concrete component
{
    public int $queries = 0;

    /** @return array{school: int, average: int} */
    public function forSchool(int $schoolId): array
    {
        $this->queries++;
        usleep(20000);                                      // pretend this is a slow SQL query

        return ['school' => $schoolId, 'average' => 70 + $schoolId];
    }
}

// ── Step 3: a decorator. Same interface, wraps another SchoolStats, adds caching. ──
final class CachedSchoolStats implements SchoolStats        // ★ Decorator #1
{
    /** @var array<int, array{school: int, average: int}> */
    private array $cache = [];

    public function __construct(private readonly SchoolStats $inner)  // ★ wraps another SchoolStats
    {
    }

    /** @return array{school: int, average: int} */
    public function forSchool(int $schoolId): array
    {
        if (isset($this->cache[$schoolId])) {
            return $this->cache[$schoolId];                 // ★ added behaviour: answer from the cache
        }

        $result = $this->inner->forSchool($schoolId);       // ★ otherwise pass the call inside
        $this->cache[$schoolId] = $result;                  // a real cache also sets an expiry time

        return $result;
    }
}

// ── Step 4: another decorator. Adds timing logs. ──
final class LoggedSchoolStats implements SchoolStats        // ★ Decorator #2
{
    /** @var list<string> */
    public array $log = [];

    public function __construct(private readonly SchoolStats $inner)
    {
    }

    /** @return array{school: int, average: int} */
    public function forSchool(int $schoolId): array
    {
        $start = microtime(true);
        $result = $this->inner->forSchool($schoolId);
        $ms = round((microtime(true) - $start) * 1000, 1);

        $this->log[] = "school {$schoolId} answered in {$ms} ms";

        return $result;
    }
}

// ── Using it: stack the layers like a phone in a case in a pouch ──
$db = new DbSchoolStats();
$stats = new LoggedSchoolStats(new CachedSchoolStats($db));    // ★ log → cache → database

$stats->forSchool(7);
$stats->forSchool(7);                                       // the cache layer answers this one
$stats->forSchool(9);

echo "Database queries: {$db->queries} (not 3)\n";
echo implode("\n", $stats->log) . "\n";

// No cache in local development? Simply don't wrap it: new LoggedSchoolStats($db).
