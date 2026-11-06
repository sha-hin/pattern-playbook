<?php

declare(strict_types=1);

namespace Evalu8\Mail;

use Evalu8\Domain\EmailAddress;

interface Mailer
{
    public function send(EmailAddress $to, string $subject, string $body): void;
}
