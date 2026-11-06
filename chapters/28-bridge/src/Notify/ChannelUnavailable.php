<?php

declare(strict_types=1);

namespace Evalu8\Notify;

use RuntimeException;

final class ChannelUnavailable extends RuntimeException
{
    public static function missing(string $channel, Recipient $to, string $detail): self
    {
        return new self("Can't send {$channel} to {$to->name}: no {$detail} on file.");
    }
}
