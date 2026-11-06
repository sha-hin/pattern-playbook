<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Closing\ClosedTerm;
use Evalu8\Persistence\Mapper;
use PDO;

final readonly class ClosedTermMapper implements Mapper
{
    public function __construct(private PDO $db)
    {
    }

    /** @param ClosedTerm $entity */
    public function insert(object $entity): void
    {
        $this->db->prepare('INSERT INTO closed_terms (term, closed_at) VALUES (?, ?)')
            ->execute([$entity->term, $entity->closedAt->format('Y-m-d H:i:s')]);
    }
}
