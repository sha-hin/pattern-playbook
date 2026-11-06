<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Reporting\TermResultStore;
use PDO;

final readonly class SqliteTermResultStore implements TermResultStore
{
    public function __construct(private PDO $db)
    {
    }

    public function isClosed(string $term): bool
    {
        $select = $this->db->prepare('SELECT 1 FROM closed_terms WHERE term = ?');
        $select->execute([$term]);

        return $select->fetchColumn() !== false;
    }
}
