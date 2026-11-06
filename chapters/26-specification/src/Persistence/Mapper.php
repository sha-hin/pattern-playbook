<?php

declare(strict_types=1);

namespace Evalu8\Persistence;

/**
 * Writes one kind of object to the database. The Unit of Work picks the mapper by class.
 */
interface Mapper
{
    public function insert(object $entity): void;
}
