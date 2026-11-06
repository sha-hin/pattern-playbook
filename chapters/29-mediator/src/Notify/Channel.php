<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/**
 * The Implementor side of the Bridge: HOW a message is delivered.
 * A channel knows nothing about which notification it carries.
 */
interface Channel
{
    public function name(): string;

    /**
     * @throws ChannelUnavailable when the recipient can't be reached on this channel
     */
    public function deliver(Recipient $to, Message $message): void;
}
