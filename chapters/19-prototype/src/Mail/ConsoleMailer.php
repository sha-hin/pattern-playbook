<?php

declare(strict_types=1);

namespace Evalu8\Mail;

use Evalu8\Domain\EmailAddress;

/**
 * Prints emails instead of sending them: for local development and demos.
 * Production binds an SMTP or API mailer to the same interface.
 */
final readonly class ConsoleMailer implements Mailer
{
    public function send(EmailAddress $to, string $subject, string $body): void
    {
        echo "  mail to <{$to}>: {$subject}\n";
    }
}
