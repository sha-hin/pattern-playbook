<?php

declare(strict_types=1);

namespace Evalu8\Domain;

/**
 * A teacher being evaluated. A plain PHP object: it knows nothing about the database.
 */
final readonly class Teacher
{
    public function __construct(
        public int $id,
        public string $name,
        public ?EmailAddress $email,                        // null = no email on file yet
        public string $school,
        public bool $onLeave = false,
    ) {
    }
}
