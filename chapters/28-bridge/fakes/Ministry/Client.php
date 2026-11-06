<?php

declare(strict_types=1);

namespace Ministry;

use RuntimeException;

/**
 * Stand-in for the Ministry of Education's results API. It is down for its first N calls,
 * and it ignores a message key it has already received (it is idempotent).
 */
final class Client
{
    /** @var array<string, true> */
    private array $received = [];

    public function __construct(private int $outagesLeft = 1)
    {
    }

    /** @param array<string, mixed> $payload */
    public function publishResults(string $idempotencyKey, array $payload): void
    {
        if ($this->outagesLeft > 0) {
            $this->outagesLeft--;
            throw new RuntimeException('503 Service Unavailable');
        }

        if (isset($this->received[$idempotencyKey])) {
            echo "  Ministry: already have {$idempotencyKey}, ignored\n";

            return;
        }

        $this->received[$idempotencyKey] = true;
        echo '  Ministry: received ' . count($payload['results']) . " results for {$payload['term']}\n";
    }
}
