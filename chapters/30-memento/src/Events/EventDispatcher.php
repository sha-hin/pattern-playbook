<?php

declare(strict_types=1);

namespace Evalu8\Events;

use Closure;
use Evalu8\Logging\Logger;
use Throwable;

/**
 * The shared subject: listeners subscribe to an event class, senders dispatch events,
 * and neither side knows the other.
 *
 * A failing listener never stops the others, and it is never silent: it is logged and
 * returned to the caller.
 */
final class EventDispatcher
{
    /** @var array<class-string, list<class-string|Closure(object): void>> */
    private array $listeners = [];

    /**
     * @param Closure(class-string): object $resolve builds listener classes on demand (the container's make())
     */
    public function __construct(
        private readonly Closure $resolve,
        private readonly Logger $logger,
    ) {
    }

    /**
     * @param class-string $eventClass
     * @param class-string|Closure(object): void $listener an invokable class (built when needed) or a closure
     */
    public function listen(string $eventClass, string|Closure $listener): void
    {
        $this->listeners[$eventClass][] = $listener;
    }

    /**
     * @return list<string> one line per listener that failed (empty when all succeeded)
     */
    public function dispatch(object $event): array
    {
        $failures = [];

        foreach ($this->listeners[$event::class] ?? [] as $listener) {
            $name = is_string($listener) ? $listener : 'closure';
            try {
                $callable = is_string($listener) ? ($this->resolve)($listener) : $listener;
                $callable($event);
            } catch (Throwable $e) {
                $failures[] = "{$name}: {$e->getMessage()}";
                $this->logger->warning('listener failed', ['event' => $event::class, 'listener' => $name, 'error' => $e->getMessage()]);
            }
        }

        return $failures;
    }
}
