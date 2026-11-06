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
 * The database layer picks its connector with a Simple Factory: a match on the configured
 * driver ('mysql', 'pgsql', 'sqlite'...) builds the right connector class, and an unknown
 * driver throws "Unsupported driver".
 */

// ── Step 1: the Product. What every object the factory builds has in common. ──
interface WebhookEvent                                      // ★ Product
{
    public function summary(): string;
}

// ── Step 2: concrete products. Different classes with different data. ──
class PaymentSucceeded implements WebhookEvent
{
    public function __construct(public string $paymentId, public int $amountInPiastres)
    {
    }

    public function summary(): string
    {
        return "Payment {$this->paymentId} succeeded: " . ($this->amountInPiastres / 100) . ' EGP';
    }
}

class PaymentFailed implements WebhookEvent
{
    public function __construct(public string $paymentId, public string $reason)
    {
    }

    public function summary(): string
    {
        return "Payment {$this->paymentId} failed: {$this->reason}";
    }
}

// ── Step 3: the Factory. The ONE place that reads the input and builds the right object. ──
class WebhookEventFactory                                   // ★ Factory
{
    public static function fromPayload(array $payload): WebhookEvent
    {
        $type = $payload['type'] ?? 'missing';
        $data = $payload['data'] ?? [];

        if ($type === 'payment.succeeded') {                // ★ decide which class...
            return new PaymentSucceeded($data['id'], (int) $data['amount']);   // ★ ...and build it
        }

        if ($type === 'payment.failed') {
            return new PaymentFailed($data['id'], $data['failure_message'] ?? 'unknown');
        }

        throw new InvalidArgumentException("Unknown webhook type [{$type}].");   // ★ never silently ignored
    }
}

// ── Using it: the webhook endpoint, the replay script and the tests all use the same line ──
$incoming = [
    ['type' => 'payment.succeeded', 'data' => ['id' => 'pay_1', 'amount' => 15750]],
    ['type' => 'payment.failed', 'data' => ['id' => 'pay_2', 'failure_message' => 'card declined']],
    ['type' => 'payment.teleported', 'data' => ['id' => 'pay_3']],
];

foreach ($incoming as $payload) {
    try {
        $event = WebhookEventFactory::fromPayload($payload);
        echo $event->summary() . "\n";
    } catch (InvalidArgumentException $e) {
        echo 'Rejected: ' . $e->getMessage() . "\n";       // a real app logs it and answers 422
    }
}
