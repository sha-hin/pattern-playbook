<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/**
 * Prints instead of sending. In production this wraps the SMS provider's SDK behind an
 * adapter (chapter 7); the rest of the bridge doesn't change.
 */
final readonly class SmsChannel implements Channel
{
    public function name(): string
    {
        return 'sms';
    }

    public function deliver(Recipient $to, Message $message): void
    {
        if ($to->phone === null) {
            throw ChannelUnavailable::missing('SMS', $to, 'phone number');
        }

        echo "[sms → {$to->phone}] {$message->short}\n";   // SMS has no subject and only 160 characters
    }
}
