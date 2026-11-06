<?php

declare(strict_types=1);

namespace Evalu8\Infrastructure\Sqlite;

use Evalu8\Outbox\OutboxMessage;
use Evalu8\Persistence\Mapper;
use PDO;

final readonly class OutboxMessageMapper implements Mapper
{
    public function __construct(private PDO $db)
    {
    }

    /** @param OutboxMessage $entity */
    public function insert(object $entity): void
    {
        $this->db->prepare('INSERT INTO outbox (type, message_key, payload) VALUES (?, ?, ?)')
            ->execute([$entity->type, $entity->key, json_encode($entity->payload, JSON_THROW_ON_ERROR)]);
    }
}
