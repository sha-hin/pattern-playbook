<?php

declare(strict_types=1);

namespace Evalu8\Domain;

interface SchoolRepository
{
    /** @throws NotFound when there is no school with that name */
    public function get(string $name): School;
}
