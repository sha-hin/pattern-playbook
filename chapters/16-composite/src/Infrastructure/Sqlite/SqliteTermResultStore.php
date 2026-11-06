<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Reporting\TermResultStore;
use PDO;
use Throwable;

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

    public function saveAndClose(string $term, array $results): void
    {
        $this->db->beginTransaction();                      // the snapshot and the "closed" mark: both or neither

        try {
            $insert = $this->db->prepare(
                'INSERT INTO term_results (term, teacher_id, responses, method, score) VALUES (?, ?, ?, ?, ?)'
            );
            foreach ($results as $result) {
                $insert->execute([$term, $result->teacher->id, $result->responseCount, $result->method, $result->score]);
            }

            $close = $this->db->prepare("INSERT INTO closed_terms (term, closed_at) VALUES (?, datetime('now'))");
            $close->execute([$term]);

            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}
