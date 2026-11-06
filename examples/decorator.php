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
 * $app->extend(SchoolStats::class, fn ($stats) => new CachedSchoolStats($stats)) tells the
 * container to wrap a service every time it is built. Guzzle, under Laravel's Http client,
 * builds retry() and logging the same way: each middleware wraps the next handler.
 */

interface SchoolStats                                           // ★ Component
{
    /** @return array{school: int, average: int} */
    public function forSchool(int $schoolId): array;
}

final class DbSchoolStats implements SchoolStats                // ★ Concrete component: never edited
{
    public int $queries = 0;

    public function forSchool(int $schoolId): array
    {
        $this->queries++;                                       // imagine 3 seconds of SQL here
        usleep(20_000);

        return ['school' => $schoolId, 'average' => 70 + $schoolId % 20];
    }
}

final class CachedSchoolStats implements SchoolStats            // ★ Decorator #1: same interface...
{
    /** @var array<int, array{value: array{school: int, average: int}, expires: int}> */
    private array $cache = [];

    public function __construct(
        private readonly SchoolStats $inner,                    // ★ ...wraps another SchoolStats
        private readonly int $ttlSeconds = 600,
    ) {}

    public function forSchool(int $schoolId): array
    {
        $hit = $this->cache[$schoolId] ?? null;

        if ($hit !== null && $hit['expires'] > time()) {
            return $hit['value'];                               // ★ added behaviour: served from cache
        }

        $value = $this->inner->forSchool($schoolId);            // ★ otherwise pass the call inside
        $this->cache[$schoolId] = ['value' => $value, 'expires' => time() + $this->ttlSeconds];

        return $value;
    }
}

final class LoggedSchoolStats implements SchoolStats            // ★ Decorator #2
{
    /** @var list<string> */
    public array $log = [];

    public function __construct(private readonly SchoolStats $inner) {}

    public function forSchool(int $schoolId): array
    {
        $start = hrtime(true);
        $result = $this->inner->forSchool($schoolId);
        $this->log[] = sprintf('school %d answered in %.1f ms', $schoolId, (hrtime(true) - $start) / 1e6);

        return $result;
    }
}

// ── Stack the layers: log → cache → database ────────────────────────────
$db = new DbSchoolStats();
$stats = new LoggedSchoolStats(new CachedSchoolStats($db));    // ★ any combination, any order

$stats->forSchool(7);
$stats->forSchool(7);                                           // served by the cache layer
$stats->forSchool(9);

echo "Database queries: {$db->queries} (not 3)", PHP_EOL;
echo implode(PHP_EOL, $stats->log), PHP_EOL;

// In local development, skip the cache by simply not wrapping: new LoggedSchoolStats($db).
