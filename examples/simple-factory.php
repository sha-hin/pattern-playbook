<?php

declare(strict_types=1);

/**
 * Simple Factory: the full pattern in plain PHP, no framework.
 * Run it: php examples/simple-factory.php
 *
 * Roles:
 * - Factory: WebhookEventFactory (the ONE place that decides which class to build, and builds it)
 * - Product: WebhookEvent (what every built object has in common)
 * - Concrete products: PaymentSucceeded, PaymentFailed (different data, not interchangeable)
 * - Clients: the webhook endpoint and the replay script, which only call the factory
 *
 * In Laravel:
 * Illuminate\Database\Connectors\ConnectionFactory::createConnector() is a Simple Factory:
 * a match on the configured driver returns MySqlConnector, PostgresConnector, SQLiteConnector
 * or SqlServerConnector, and an unknown driver throws "Unsupported driver".
 */

interface WebhookEvent                                          // ★ Product
{
    public function summary(): string;
}

final class PaymentSucceeded implements WebhookEvent            // Concrete product
{
    public function __construct(public readonly string $paymentId, public readonly int $amountInPiastres) {}

    public function summary(): string
    {
        return sprintf('Payment %s succeeded: %.2f EGP', $this->paymentId, $this->amountInPiastres / 100);
    }
}

final class PaymentFailed implements WebhookEvent               // Concrete product
{
    public function __construct(public readonly string $paymentId, public readonly string $reason) {}

    public function summary(): string
    {
        return "Payment {$this->paymentId} failed: {$this->reason}";
    }
}

final class UnknownWebhookType extends InvalidArgumentException {}

final class WebhookEventFactory                                 // ★ Factory
{
    /** @param array<string, mixed> $payload */
    public static function fromPayload(array $payload): WebhookEvent
    {
        $data = $payload['data'] ?? throw new UnknownWebhookType('Payload has no data.');

        return match ($payload['type'] ?? null) {               // ★ the one place that decides
            'payment.succeeded' => new PaymentSucceeded(        // ★ and knows how to build each class
                (string) $data['id'],
                (int) $data['amount'],
            ),
            'payment.failed' => new PaymentFailed(
                (string) $data['id'],
                (string) ($data['failure_message'] ?? 'unknown'),
            ),
            default => throw new UnknownWebhookType(            // ★ never silently ignored
                'Unknown webhook type [' . ($payload['type'] ?? 'missing') . '].',
            ),
        };
    }
}

// ── Clients: the webhook endpoint, the replay script and the tests all use the same line ──
$incoming = [
    ['type' => 'payment.succeeded', 'data' => ['id' => 'pay_1', 'amount' => 15750]],
    ['type' => 'payment.failed', 'data' => ['id' => 'pay_2', 'failure_message' => 'card declined']],
    ['type' => 'payment.teleported', 'data' => ['id' => 'pay_3']],
];

foreach ($incoming as $payload) {
    try {
        echo WebhookEventFactory::fromPayload($payload)->summary(), PHP_EOL;
    } catch (UnknownWebhookType $e) {
        echo 'Rejected: ', $e->getMessage(), PHP_EOL;          // a real app logs it and answers 422
    }
}
