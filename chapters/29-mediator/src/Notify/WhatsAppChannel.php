<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/**
 * Prints instead of sending. WhatsApp Business messages start with a pre-approved template;
 * the short text fills it.
 */
final readonly class WhatsAppChannel implements Channel
{
    public function name(): string
    {
        return 'whatsapp';
    }

    public function deliver(Recipient $to, Message $message): void
    {
        if ($to->phone === null) {
            throw ChannelUnavailable::missing('WhatsApp', $to, 'phone number');
        }

        echo "[whatsapp → {$to->phone}] Evalu8: {$message->short}\n";
    }
}
