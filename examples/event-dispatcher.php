<?php

declare(strict_types=1);

/**
 * Event Dispatcher: the full pattern in plain PHP, no framework.
 * Run it: php examples/event-dispatcher.php
 *
 * Roles:
 * - Dispatcher: EventDispatcher (the one shared middleman)
 * - Events: OrderPlaced, PaymentReceived (small classes that only carry data)
 * - Listeners: functions registered for an event class
 * - Senders: OrderService, PaymentService (know only the dispatcher)
 *
 * In Laravel:
 * Laravel's event Dispatcher: listen() stores listeners under the event's class name,
 * dispatch() finds and calls them. Listener classes are built by the container, and
 * listeners that implement ShouldQueue are pushed onto the queue instead of running now.
 */

// ── Step 1: events. Small classes that only carry data. ──
class OrderPlaced                                           // ★ Event
{
    public function __construct(public int $orderId)
    {
    }
}

class PaymentReceived                                       // ★ Event
{
    public function __construct(public int $orderId, public int $amount)
    {
    }
}

// ── Step 2: the dispatcher. The one middleman everybody talks to. ──
class EventDispatcher                                       // ★ Dispatcher
{
    private array $listeners = [];

    public function listen(string $eventClass, callable $listener): void   // ★ register by event class
    {
        $this->listeners[$eventClass][] = $listener;
    }

    public function dispatch(object $event): void          // ★ one door for every sender
    {
        $eventClass = get_class($event);
        $listeners = $this->listeners[$eventClass] ?? [];

        foreach ($listeners as $listener) {
            $listener($event);
        }
    }
}

// ── Step 3: senders. They only know the dispatcher, never the listeners. ──
class OrderService                                          // ★ Sender
{
    public function __construct(private EventDispatcher $events)
    {
    }

    public function place(int $orderId): void
    {
        // ... save the order ...
        $this->events->dispatch(new OrderPlaced($orderId));
    }
}

class PaymentService                                        // ★ Sender
{
    public function __construct(private EventDispatcher $events)
    {
    }

    public function receive(int $orderId, int $amount): void
    {
        // ... record the payment ...
        $this->events->dispatch(new PaymentReceived($orderId, $amount));
    }
}

// ── Using it: listeners are registered in one place ──
$events = new EventDispatcher();

$events->listen(OrderPlaced::class, function (OrderPlaced $event) {
    echo "Kitchen: start order #{$event->orderId}\n";
});

$events->listen(PaymentReceived::class, function (PaymentReceived $event) {
    echo "Billing: mark order #{$event->orderId} as paid\n";
});

// Analytics listens to BOTH senders without knowing either of them:
$track = function (object $event) {
    echo 'Analytics: ' . get_class($event) . "\n";
};
$events->listen(OrderPlaced::class, $track);
$events->listen(PaymentReceived::class, $track);

$orders = new OrderService($events);
$payments = new PaymentService($events);

$orders->place(12);
$payments->receive(12, 15750);
