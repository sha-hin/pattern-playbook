<?php

declare(strict_types=1);

namespace Evalu8\Notify;

use InvalidArgumentException;

/**
 * Finds a channel by the name a user picked in their preferences ("sms", "email"...).
 */
final readonly class Channels
{
    /** @var array<string, Channel> */
    private array $byName;

    public function __construct(Channel ...$channels)
    {
        $byName = [];
        foreach ($channels as $channel) {
            $byName[$channel->name()] = $channel;
        }
        $this->byName = $byName;
    }

    public function named(string $name): Channel
    {
        return $this->byName[$name] ?? throw new InvalidArgumentException(
            "Unknown channel \"{$name}\". Available: " . implode(', ', array_keys($this->byName)) . '.'
        );
    }
}
