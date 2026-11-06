<?php

declare(strict_types=1);

/**
 * Bridge: the full pattern in plain PHP, no framework.
 * Run it: php examples/bridge.php
 *
 * Roles:
 * - Abstraction: Notification (WHAT to say; holds a Channel, which is the bridge)
 * - Refined abstractions: InvoicePaid, OrderDelayed
 * - Implementor: Channel (HOW to deliver)
 * - Concrete implementors: EmailChannel, SmsChannel
 * Result: 2 + 2 classes cover all 4 combinations, instead of 2 × 2 classes.
 *
 * In Laravel:
 * Notifications: a Notification class (the abstraction) says what to send; via() names the
 * channels, and Illuminate\Notifications\ChannelManager resolves channel classes
 * (MailChannel, DatabaseChannel...) that each call send() and the matching toMail(),
 * toArray()... method. Any notification works on any channel.
 */

interface Channel                                               // ★ Implementor: HOW
{
    public function deliver(string $to, string $subject, string $body): void;
}

final class EmailChannel implements Channel                     // ★ Concrete implementor
{
    public function deliver(string $to, string $subject, string $body): void
    {
        echo "EMAIL to {$to}" . PHP_EOL . "  Subject: {$subject}" . PHP_EOL . "  {$body}" . PHP_EOL;
    }
}

final class SmsChannel implements Channel                       // ★ Concrete implementor
{
    public function deliver(string $to, string $subject, string $body): void
    {
        $text = mb_strlen($body) > 70 ? mb_substr($body, 0, 69) . '…' : $body;   // SMS: no subject, short text
        echo "SMS to {$to}: {$text}" . PHP_EOL;
    }
}

abstract class Notification                                     // ★ Abstraction: WHAT
{
    public function __construct(protected readonly Channel $channel) {}   // ★ the bridge: has-a Channel

    final public function send(string $to): void
    {
        $this->channel->deliver($to, $this->subject(), $this->body());
    }

    abstract protected function subject(): string;

    abstract protected function body(): string;
}

final class InvoicePaid extends Notification                    // ★ Refined abstraction
{
    public function __construct(Channel $channel, private readonly string $invoiceNo)
    {
        parent::__construct($channel);
    }

    protected function subject(): string
    {
        return "Invoice {$this->invoiceNo} paid";
    }

    protected function body(): string
    {
        return "Thank you. We received the payment for invoice {$this->invoiceNo}.";
    }
}

final class OrderDelayed extends Notification                   // ★ Refined abstraction
{
    public function __construct(Channel $channel, private readonly int $orderId, private readonly int $minutes)
    {
        parent::__construct($channel);
    }

    protected function subject(): string
    {
        return "Order #{$this->orderId} is running late";
    }

    protected function body(): string
    {
        return "Sorry, order #{$this->orderId} will be about {$this->minutes} minutes late. A driver is on the way.";
    }
}

// ── Any message × any channel, with no class per combination ───────────
(new InvoicePaid(new EmailChannel(), 'INV-2026-114'))->send('school@example.com');
(new InvoicePaid(new SmsChannel(), 'INV-2026-114'))->send('+201001234567');
(new OrderDelayed(new SmsChannel(), 42, 15))->send('+201001234567');

// A WhatsApp channel = 1 new class, and every existing notification can use it.
