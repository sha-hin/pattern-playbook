<?php

declare(strict_types=1);

/**
 * Event Dispatcher: the full pattern in plain PHP, no framework.
 * Run it: php examples/event-dispatcher.php
 *
 * Roles:
 * - Dispatcher: EventDispatcher (the one shared middleman)
 * - Events: OrderPlaced, PaymentReceived (small data classes)
 * - Listeners: callables registered per event class
 * - Senders: OrderService, PaymentService (know only the dispatcher)
 *
 * In Laravel:
 * Illuminate\Events\Dispatcher: listen() stores listeners keyed by event class, dispatch()
 * finds them, builds class listeners through the container, and pushes listeners that
 * implement ShouldQueue onto the queue instead of running them now.
 */

final class OrderPlaced                                         // ★ Event: just data
{
    public function __construct(public readonly int $orderId, public readonly int $totalInPiastres) {}
}

final class PaymentReceived                                     // ★ Event: just data
{
    public function __construct(public readonly int $orderId, public readonly int $amountInPiastres) {}
}

final class EventDispatcher                                     // ★ Dispatcher: the middleman
{
    /** @var array<class-string, list<callable(object): void>> */
    private array $listeners = [];

    /** @param class-string $eventClass */
    public function listen(string $eventClass, callable $listener): void   // ★ register by event TYPE
    {
        $this->listeners[$eventClass][] = $listener;
    }

    public function dispatch(object $event): void              // ★ one door for every sender
    {
        foreach ($this->listeners[$event::class] ?? [] as $listener) {
            $listener($event);                                  // errors are not swallowed
        }
    }
}

final class OrderService                                        // ★ Sender: knows only the dispatcher
{
    public function __construct(private readonly EventDispatcher $events) {}

    public function place(int $orderId, int $total): void
    {
        // ... save the order ...
        $this->events->dispatch(new OrderPlaced($orderId, $total));
    }
}

final class PaymentService                                      // ★ Sender
{
    public function __construct(private readonly EventDispatcher $events) {}

    public function receive(int $orderId, int $amount): void
    {
        // ... record the payment ...
        $this->events->dispatch(new PaymentReceived($orderId, $amount));
    }
}

// ── Wiring: listeners never reference the senders ───────────────────────
$events = new EventDispatcher();

$events->listen(OrderPlaced::class, fn (OrderPlaced $e) => print("Kitchen: start order #{$e->orderId}" . PHP_EOL));
$events->listen(PaymentReceived::class, fn (PaymentReceived $e) => print("Billing: mark order #{$e->orderId} paid" . PHP_EOL));

// Analytics listens to BOTH senders without knowing either of them:
$track = fn (object $e) => print('Analytics: ' . (new ReflectionClass($e))->getShortName() . PHP_EOL);
$events->listen(OrderPlaced::class, $track);
$events->listen(PaymentReceived::class, $track);

(new OrderService($events))->place(12, 15750);
(new PaymentService($events))->receive(12, 15750);
