<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Closing\FrozenResult;
use Evalu8\Persistence\Mapper;
use PDO;

final readonly class FrozenResultMapper implements Mapper
{
    public function __construct(private PDO $db)
    {
    }

    /** @param FrozenResult $entity */
    public function insert(object $entity): void
    {
        $result = $entity->result;
        $this->db->prepare('INSERT INTO term_results (term, teacher_id, responses, method, score) VALUES (?, ?, ?, ?, ?)')
            ->execute([$entity->term, $result->teacher->id, $result->responseCount, $result->method, $result->score]);
    }
}
