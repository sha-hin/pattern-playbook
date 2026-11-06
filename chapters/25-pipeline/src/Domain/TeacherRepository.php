<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * Where teachers come from. The rest of the app depends on this interface,
 * never on SQL or on a specific database.
 */
interface TeacherRepository
{
    /** @return list<Teacher> */
    public function all(): array;

    /** @throws NotFound when there is no teacher with that id */
    public function get(int $id): Teacher;
}
