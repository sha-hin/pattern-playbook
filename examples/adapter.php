<?php

declare(strict_types=1);

/**
 * Adapter: the full pattern in plain PHP, no framework.
 * Run it: php examples/adapter.php
 *
 * Roles:
 * - Target: SmsSender (the interface YOUR code wants)
 * - Adaptee: AcmeSmsClient (a third-party class with the wrong shape, which you cannot edit)
 * - Adapter: AcmeSmsAdapter (implements the Target, holds the Adaptee, translates between them)
 * - Client: OrderNotifier (only knows the Target)
 *
 * In Laravel:
 * Storage::put() works on S3, local disk or FTP because of adapters. Each Flysystem adapter
 * (AwsS3V3Adapter, LocalFilesystemAdapter...) translates one storage SDK into Flysystem's
 * interface, and Laravel's own Illuminate\Filesystem\FilesystemAdapter adapts Flysystem
 * to Laravel's Filesystem contract.
 */

// ── Third-party code (pretend it came from Composer). You cannot change it. ──
final class AcmeSmsClient                                       // ★ Adaptee
{
    /**
     * @param array{msisdn: string, text: string} $payload
     * @return array{status: string, id?: string, error?: string}
     */
    public function dispatch(array $payload): array
    {
        if (preg_match('/^\+\d{8,15}$/', $payload['msisdn']) !== 1) {
            return ['status' => 'rejected', 'error' => 'invalid msisdn'];
        }

        return ['status' => 'queued', 'id' => 'acme_' . substr(md5($payload['text']), 0, 8)];
    }
}

// ── Your code ───────────────────────────────────────────────────────────
interface SmsSender                                             // ★ Target
{
    /** @return string the provider's message id */
    public function send(string $phone, string $text): string;
}

final class SmsFailed extends RuntimeException {}

final class AcmeSmsAdapter implements SmsSender                 // ★ Adapter: the Target outside...
{
    public function __construct(private readonly AcmeSmsClient $client) {}   // ★ ...the Adaptee inside

    public function send(string $phone, string $text): string
    {
        $result = $this->client->dispatch([                     // ★ translate the call
            'msisdn' => $this->toInternational($phone),
            'text'   => $text,
        ]);

        if ($result['status'] !== 'queued') {                   // ★ translate a status array into an exception
            throw new SmsFailed("SMS to {$phone} failed: " . ($result['error'] ?? $result['status']));
        }

        return $result['id'] ?? throw new SmsFailed('Provider accepted the SMS but returned no id.');
    }

    private function toInternational(string $phone): string    // Egyptian "010..." becomes "+2010..."
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';

        return str_starts_with($digits, '0') ? '+2' . $digits : '+' . $digits;
    }
}

final class OrderNotifier                                       // ★ Client: knows only the Target
{
    public function __construct(private readonly SmsSender $sms) {}

    public function orderReady(string $phone, int $orderId): string
    {
        return $this->sms->send($phone, "Order #{$orderId} is ready.");
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$notifier = new OrderNotifier(new AcmeSmsAdapter(new AcmeSmsClient()));

echo 'Sent, id: ', $notifier->orderReady('0100 123 4567', 42), PHP_EOL;

try {
    $notifier->orderReady('12', 43);
} catch (SmsFailed $e) {
    echo $e->getMessage(), PHP_EOL;
}

// Switching provider = one new adapter class. OrderNotifier never changes.
