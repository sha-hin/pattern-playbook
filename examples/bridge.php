<?php

declare(strict_types=1);

/**
 * Bridge: the full pattern in plain PHP, no framework.
 * Run it: php examples/bridge.php
 *
 * Roles:
 * - Abstraction: Notification (WHAT to say; it holds a Channel, and that link is the "bridge")
 * - Refined abstractions: InvoicePaid, OrderDelayed
 * - Implementor: Channel (HOW to deliver)
 * - Concrete implementors: EmailChannel, SmsChannel
 * 2 notifications + 2 channels = 4 classes cover all 4 combinations.
 *
 * In Laravel:
 * Notifications. Your notification class says WHAT to send; via() lists the channels.
 * Laravel looks up each channel class (mail, database, SMS...) and calls its send(), which
 * asks your notification for toMail(), toArray()... Any notification works on any channel.
 */

// ── Step 1: the Implementor. HOW to deliver. ──
interface Channel                                           // ★ Implementor
{
    public function deliver(string $to, string $subject, string $body): void;
}

class EmailChannel implements Channel                       // ★ Concrete implementor
{
    public function deliver(string $to, string $subject, string $body): void
    {
        echo "EMAIL to {$to}\n  Subject: {$subject}\n  {$body}\n";
    }
}

class SmsChannel implements Channel                         // ★ Concrete implementor
{
    public function deliver(string $to, string $subject, string $body): void
    {
        echo "SMS to {$to}: {$body}\n";                    // SMS has no subject line
    }
}

// ── Step 2: the Abstraction. WHAT to say. It HAS a channel. ──
abstract class Notification                                 // ★ Abstraction
{
    public function __construct(protected Channel $channel) // ★ the bridge between the two sides
    {
    }

    public function send(string $to): void
    {
        $this->channel->deliver($to, $this->subject(), $this->body());
    }

    abstract protected function subject(): string;

    abstract protected function body(): string;
}

// ── Step 3: refined abstractions. One class per message. ──
class InvoicePaid extends Notification                      // ★ Refined abstraction
{
    public function __construct(Channel $channel, private string $invoiceNo)
    {
        parent::__construct($channel);
    }

    protected function subject(): string
    {
        return "Invoice {$this->invoiceNo} paid";
    }

    protected function body(): string
    {
        return "Thank you, invoice {$this->invoiceNo} is paid.";
    }
}

class OrderDelayed extends Notification                     // ★ Refined abstraction
{
    public function __construct(Channel $channel, private int $orderId, private int $minutes)
    {
        parent::__construct($channel);
    }

    protected function subject(): string
    {
        return "Order #{$this->orderId} is late";
    }

    protected function body(): string
    {
        return "Sorry, order #{$this->orderId} is about {$this->minutes} minutes late.";
    }
}

// ── Using it: any message x any channel, with no class per combination ──
$invoiceByEmail = new InvoicePaid(new EmailChannel(), 'INV-114');
$invoiceBySms = new InvoicePaid(new SmsChannel(), 'INV-114');
$delayBySms = new OrderDelayed(new SmsChannel(), 42, 15);

$invoiceByEmail->send('school@example.com');
$invoiceBySms->send('+201001234567');
$delayBySms->send('+201001234567');

// A WhatsApp channel = 1 new class, and every existing notification can use it.
