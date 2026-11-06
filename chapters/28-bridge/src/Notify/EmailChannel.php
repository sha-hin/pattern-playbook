<?php

declare(strict_types=1);

namespace Evalu8\Notify;

use Evalu8\Mail\Mailer;

final readonly class EmailChannel implements Channel
{
    public function __construct(private Mailer $mailer)
    {
    }

    public function name(): string
    {
        return 'email';
    }

    public function deliver(Recipient $to, Message $message): void
    {
        if ($to->email === null) {
            throw ChannelUnavailable::missing('email', $to, 'email address');
        }

        $this->mailer->send($to->email, $message->subject, $message->body);
    }
}
