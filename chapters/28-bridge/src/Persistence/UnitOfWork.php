<?php

declare(strict_types=1);

namespace Evalu8\Persistence;

use LogicException;
use PDO;
use Throwable;

/**
 * Unit of Work: collects every change of one business operation, then writes them all
 * in ONE database transaction on commit(). Either everything is saved, or nothing is.
 */
final class UnitOfWork
{
    /** @var list<object> */
    private array $new = [];

    /**
     * @param array<class-string, Mapper> $mappers which mapper writes which class
     */
    public function __construct(
        private readonly PDO $db,
        private readonly array $mappers,
    ) {
    }

    public function registerNew(object $entity): void
    {
        if (!isset($this->mappers[$entity::class])) {
            throw new LogicException('No mapper for ' . $entity::class . '.');   // fail now, not at commit
        }

        $this->new[] = $entity;
    }

    public function commit(): void
    {
        $this->db->beginTransaction();

        try {
            foreach ($this->new as $entity) {
                $this->mappers[$entity::class]->insert($entity);
            }
            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollBack();                          // nothing from this operation is kept
            throw $e;
        } finally {
            $this->new = [];
        }
    }
}
