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
}
