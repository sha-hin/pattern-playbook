<?php

declare(strict_types=1);

namespace Evalu8\Outbox;

use Evalu8\Logging\Logger;
use Ministry\Client;
use PDO;
use Throwable;

/**
 * The relay: a worker (run every minute by the scheduler) that sends pending outbox messages,
 * retries failures, and raises an alert when it gives up. Messages are never lost or silent.
 *
 * Delivery is "at least once": if the relay crashes after sending but before marking the row
 * as sent, the message is sent again. The receiver must ignore repeats (by message key).
 */
final readonly class OutboxRelay
{
    public function __construct(
        private PDO $db,
        private Client $ministry,
        private Logger $logger,
        private int $maxAttempts = 5,
    ) {
    }

    public function run(): void
    {
        $pending = $this->db->query("SELECT * FROM outbox WHERE status = 'pending' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);

        foreach ($pending as $row) {
            try {
                /** @var array<string, mixed> $payload */
                $payload = json_decode((string) $row['payload'], true, flags: JSON_THROW_ON_ERROR);
                $this->ministry->publishResults((string) $row['message_key'], $payload);

                $this->db->prepare("UPDATE outbox SET status = 'sent', attempts = attempts + 1 WHERE id = ?")->execute([$row['id']]);
                $this->logger->info('outbox message sent', ['key' => $row['message_key']]);
            } catch (Throwable $e) {
                $attempts = (int) $row['attempts'] + 1;
                $status = $attempts >= $this->maxAttempts ? 'failed' : 'pending';
                $this->db->prepare('UPDATE outbox SET status = ?, attempts = ?, last_error = ? WHERE id = ?')
                    ->execute([$status, $attempts, $e->getMessage(), $row['id']]);

                $status === 'failed'
                    ? $this->logger->warning('ALERT outbox message failed for good', ['key' => $row['message_key'], 'error' => $e->getMessage()])
                    : $this->logger->warning('outbox message failed, will retry', ['key' => $row['message_key'], 'attempt' => $attempts, 'error' => $e->getMessage()]);
            }
        }
    }
}
