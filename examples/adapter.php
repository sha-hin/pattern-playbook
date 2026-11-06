<?php

declare(strict_types=1);

/**
 * Adapter: the full pattern in plain PHP, no framework.
 * Run it: php examples/adapter.php
 *
 * Roles:
 * - Target: SmsSender (the ONE interface your app uses to send an SMS)
 * - Adaptees: FakeTwilioClient, FakeVonageClient (third-party SDKs: different method names, different results, can't be edited)
 * - Adapters: TwilioSmsSender, VonageSmsSender (each implements SmsSender and translates to one SDK)
 * - Client: OrderNotifier (only knows SmsSender, so it never changes when the provider changes)
 * The two fake SDKs are shaped like the real Twilio and Vonage SDKs, simplified so the file runs on its own.
 * Adapter vs Decorator: both wrap an object, but a Decorator wraps something that ALREADY has your
 * interface and adds behaviour. An Adapter wraps something that does NOT have your interface and
 * adds nothing: it only translates, so the object fits where it otherwise couldn't.
 *
 * In Laravel:
 * Storage::put() works on S3, local disk or FTP because of adapters. Laravel's
 * FilesystemAdapter translates Laravel's put() / exists() into the Flysystem library's
 * write() / fileExists(), and each Flysystem adapter translates those into one storage SDK.
 */

// ═══ Part 1: two third-party SDKs (pretend they came from Composer). You can't edit them. ═══

/** What Twilio's SDK gives back: an object with a sid. */
final class TwilioMessage
{
    public function __construct(public readonly string $sid)
    {
    }
}

/** What Twilio's SDK throws when the API refuses a message. */
final class TwilioException extends Exception
{
}

final class FakeTwilioClient                                // ★ Adaptee #1
{
    private int $sent = 0;

    /** @param array{from: string, body: string} $options */
    public function createMessage(string $to, array $options): TwilioMessage
    {
        if (!str_starts_with($to, '+')) {
            throw new TwilioException("The 'To' number {$to} is not a valid phone number.");
        }

        $this->sent++;

        return new TwilioMessage('SM' . $this->sent);
    }
}

final class FakeVonageClient                                // ★ Adaptee #2: a completely different shape
{
    private int $sent = 0;

    /** @return array{status: string, message-id?: string, error-text?: string} */
    public function sendText(string $from, string $to, string $text): array
    {
        if (strlen($to) < 10) {
            return ['status' => '3', 'error-text' => 'Invalid to number'];   // Vonage: "0" means success
        }

        $this->sent++;

        return ['status' => '0', 'message-id' => 'VN-' . $this->sent];
    }
}

// ═══ Part 2: YOUR side ═══

// ── Step 1: the Target. The one simple interface your app uses. ──
interface SmsSender                                         // ★ Target
{
    /**
     * @return string the provider's message id
     * @throws SmsFailed when the provider refuses the message
     */
    public function send(string $to, string $text): string;
}

final class SmsFailed extends RuntimeException              // one error type, whatever the provider
{
}

// ── Step 2: one adapter per SDK. Same interface outside, different SDK inside. ──
final class TwilioSmsSender implements SmsSender            // ★ Adapter #1
{
    public function __construct(
        private readonly FakeTwilioClient $twilio,          // ★ holds the third-party object
        private readonly string $from,
    ) {
    }

    public function send(string $to, string $text): string
    {
        try {
            $message = $this->twilio->createMessage($to, [  // ★ your call → their call
                'from' => $this->from,
                'body' => $text,
            ]);
        } catch (TwilioException $e) {                      // ★ their exception → your exception
            throw new SmsFailed("Twilio refused SMS to {$to}: {$e->getMessage()}", 0, $e);
        }

        return $message->sid;                               // ★ their result → your result
    }
}

final class VonageSmsSender implements SmsSender            // ★ Adapter #2
{
    public function __construct(
        private readonly FakeVonageClient $vonage,
        private readonly string $from,
    ) {
    }

    public function send(string $to, string $text): string
    {
        $response = $this->vonage->sendText($this->from, $to, $text);   // ★ different method, different argument order

        if ($response['status'] !== '0') {                  // ★ their status code → your exception
            $error = $response['error-text'] ?? 'unknown error';
            throw new SmsFailed("Vonage refused SMS to {$to}: {$error}");
        }

        return $response['message-id'] ?? '';
    }
}

// ── Step 3: the Client. It only knows SmsSender. ──
final class OrderNotifier                                   // ★ Client
{
    public function __construct(private readonly SmsSender $sms)
    {
    }

    public function orderReady(string $phone, int $orderId): string
    {
        return $this->sms->send($phone, "Order #{$orderId} is ready.");
    }
}

// ═══ Using it ═══

// ── The problem: the SDK doesn't fit. OrderNotifier needs an SmsSender, and the SDK isn't one. ──
try {
    new OrderNotifier(new FakeTwilioClient());              // ✗ wrong shape: no send() method, different everything
} catch (TypeError) {
    echo "Without an adapter: TypeError, FakeTwilioClient is not an SmsSender\n";
}

// ── The fix: wrap each SDK in its adapter. Now the SAME OrderNotifier works with either provider. ──
$withTwilio = new OrderNotifier(new TwilioSmsSender(new FakeTwilioClient(), '+15550001111'));
$withVonage = new OrderNotifier(new VonageSmsSender(new FakeVonageClient(), 'PizzaShop'));

echo 'Twilio message id: ' . $withTwilio->orderReady('+201001234567', 42) . "\n";
echo 'Vonage message id: ' . $withVonage->orderReady('+201001234567', 42) . "\n";

// Each SDK fails in its own way (an exception vs a status code), but the caller catches ONE type:
foreach ([$withTwilio, $withVonage] as $notifier) {
    try {
        $notifier->orderReady('12345', 43);
    } catch (SmsFailed $e) {
        echo 'Caught SmsFailed: ' . $e->getMessage() . "\n";
    }
}

// Switching provider = pass a different adapter. OrderNotifier never changes.
