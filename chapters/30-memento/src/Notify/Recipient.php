<?php

declare(strict_types=1);

namespace Evalu8\Notify;

use Evalu8\Domain\EmailAddress;

/**
 * Who receives a notification, with the contact details we have for them.
 */
final readonly class Recipient
{
    public function __construct(
        public string $userId,
        public string $name,
        public ?EmailAddress $email = null,
        public ?string $phone = null,                       // international format, e.g. +201001234567
    ) {
    }
}
