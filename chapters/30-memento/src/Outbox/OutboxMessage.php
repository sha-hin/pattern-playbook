<?php

declare(strict_types=1);

namespace Evalu8\Outbox;

/**
 * A message to another system, saved in OUR database first, in the same transaction as the
 * data it describes. A relay sends it later.
 */
final readonly class OutboxMessage
{
    /**
     * @param string $key unique per message; the receiver uses it to ignore duplicates
     * @param array<string, mixed> $payload
     */
    public function __construct(
        public string $type,
        public string $key,
        public array $payload,
    ) {
    }
}
