<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use PDO;

/**
 * Creates the database tables. In a real project this is a migration.
 */
final class Schema
{
    public static function create(PDO $db): void
    {
        $db->exec('CREATE TABLE teachers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            school TEXT NOT NULL
        )');

        $db->exec('CREATE TABLE responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL REFERENCES teachers (id),
            term TEXT NOT NULL,
            role TEXT NOT NULL,
            score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
            comment TEXT NOT NULL DEFAULT \'\'
        )');

        $db->exec('CREATE INDEX responses_teacher_term ON responses (teacher_id, term)');
    }
}
