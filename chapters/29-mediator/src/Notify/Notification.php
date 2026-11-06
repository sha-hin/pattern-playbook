<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/**
 * The Abstraction side of the Bridge: WHAT to say. It holds a Channel, and that reference
 * is the bridge: any notification can travel over any channel.
 */
abstract class Notification
{
    public function __construct(protected readonly Channel $channel)
    {
    }

    final public function send(Recipient $to): void
    {
        $this->channel->deliver($to, $this->message($to));
    }

    abstract protected function message(Recipient $to): Message;
}
