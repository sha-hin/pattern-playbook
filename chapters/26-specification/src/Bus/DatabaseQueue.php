<?php

declare(strict_types=1);

namespace Evalu8\Bus;

use LogicException;
use PDO;
use Throwable;

/**
 * A queue in a database table. Commands are stored as JSON: their class and their constructor values.
 */
final readonly class DatabaseQueue implements Queue
{
    public function __construct(private PDO $db)
    {
    }

    public function push(ShouldQueue $command): int
    {
        $insert = $this->db->prepare('INSERT INTO jobs (command, payload) VALUES (?, ?)');
        $insert->execute([$command::class, json_encode(get_object_vars($command), JSON_THROW_ON_ERROR)]);

        return (int) $this->db->lastInsertId();
    }

    public function reserve(): ?Job
    {
        $row = $this->db->query("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return null;
        }

        // A real multi-worker queue marks the row as reserved in the same statement (UPDATE ... RETURNING
        // or SELECT ... FOR UPDATE SKIP LOCKED) so two workers never take the same job.
        $this->db->prepare("UPDATE jobs SET status = 'running' WHERE id = ?")->execute([$row['id']]);

        return new Job((int) $row['id'], $this->rebuild((string) $row['command'], (string) $row['payload']), (int) $row['attempts']);
    }

    public function complete(Job $job): void
    {
        $this->db->prepare("UPDATE jobs SET status = 'done', attempts = attempts + 1 WHERE id = ?")->execute([$job->id]);
    }

    public function release(Job $job, Throwable $error, bool $final): void
    {
        $update = $this->db->prepare('UPDATE jobs SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?');
        $update->execute([$final ? 'failed' : 'pending', $error->getMessage(), $job->id]);
    }

    private function rebuild(string $class, string $payload): object
    {
        if (!class_exists($class) || !is_subclass_of($class, ShouldQueue::class)) {
            throw new LogicException("Refusing to rebuild [{$class}]: it is not a queueable command.");
        }

        /** @var array<string, mixed> $values */
        $values = json_decode($payload, true, flags: JSON_THROW_ON_ERROR);

        return new $class(...$values);                      // named arguments: payload keys = constructor parameters
    }
}
