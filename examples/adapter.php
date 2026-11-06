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
 * Storage::put() works on S3, local disk or FTP because of adapters. Laravel's
 * FilesystemAdapter translates Laravel's put() / exists() into the Flysystem library's
 * write() / has(), and each Flysystem adapter translates those into one storage SDK.
 */

// ── The third-party class (pretend it came from Composer). You can't change it. ──
class AcmeSmsClient                                         // ★ Adaptee
{
    public function dispatch(array $payload): array
    {
        if (!str_starts_with($payload['msisdn'], '+')) {
            return ['status' => 'rejected', 'error' => 'invalid msisdn'];
        }

        return ['status' => 'queued', 'id' => 'acme_' . rand(1000, 9999)];
    }
}

// ── Step 1: the Target. The simple interface YOUR code wants. ──
interface SmsSender                                         // ★ Target
{
    public function send(string $phone, string $text): string;   // returns the message id
}

// ── Step 2: the Adapter. Your interface outside, their class inside. ──
class AcmeSmsAdapter implements SmsSender                   // ★ Adapter
{
    public function __construct(private AcmeSmsClient $client)   // ★ holds the third-party object
    {
    }

    public function send(string $phone, string $text): string
    {
        $phone = str_replace(' ', '', $phone);
        if (str_starts_with($phone, '0')) {
            $phone = '+2' . $phone;                          // Egyptian 0100... becomes +20100...
        }

        $result = $this->client->dispatch([                 // ★ translate YOUR call into THEIR call
            'msisdn' => $phone,
            'text' => $text,
        ]);

        if ($result['status'] !== 'queued') {               // ★ turn their "status" array into an exception
            throw new RuntimeException("SMS to {$phone} failed: {$result['error']}");
        }

        return $result['id'];
    }
}

// ── Step 3: the Client. It only knows SmsSender. ──
class OrderNotifier                                         // ★ Client
{
    public function __construct(private SmsSender $sms)
    {
    }

    public function orderReady(string $phone, int $orderId): string
    {
        return $this->sms->send($phone, "Order #{$orderId} is ready.");
    }
}

// ── Using it ──
$notifier = new OrderNotifier(new AcmeSmsAdapter(new AcmeSmsClient()));

$id = $notifier->orderReady('0100 123 4567', 42);
echo 'Sent, id starts with: ' . substr($id, 0, 5) . "\n";

try {
    $notifier->orderReady('12', 43);
} catch (RuntimeException $e) {
    echo $e->getMessage() . "\n";
}

// Switching provider = one new adapter class. OrderNotifier never changes.
