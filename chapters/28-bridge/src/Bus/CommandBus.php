<?php

declare(strict_types=1);

namespace Evalu8\Bus;

use Closure;
use Evalu8\Logging\Logger;
use LogicException;

/**
 * The Command Bus: one door for every command. It finds the command's handler, and decides
 * whether to run it now or put it on the queue.
 */
final class CommandBus
{
    /** @var array<class-string, class-string> command class => handler class */
    private array $handlers = [];

    /**
     * @param Closure(class-string): object $resolve builds handlers (the container's make())
     */
    public function __construct(
        private readonly Closure $resolve,
        private readonly Queue $queue,
        private readonly Logger $logger,
    ) {
    }

    /**
     * @param class-string $command
     * @param class-string $handler a class with a handle($command) method
     */
    public function register(string $command, string $handler): void
    {
        $this->handlers[$command] = $handler;
    }

    /** Runs the command now, or queues it if it implements ShouldQueue. */
    public function dispatch(object $command): mixed
    {
        if ($command instanceof ShouldQueue) {
            $id = $this->queue->push($command);
            $this->logger->info('queued', ['command' => $this->shortName($command), 'job' => $id]);

            return null;
        }

        return $this->dispatchNow($command);
    }

    /** Runs the command immediately, whatever it is. The worker uses this for queued jobs. */
    public function dispatchNow(object $command): mixed
    {
        if (!isset($this->handlers[$command::class])) {
            throw new LogicException('No handler registered for ' . $command::class . '.');
        }

        $handlerClass = $this->handlers[$command::class];
        $handler = ($this->resolve)($handlerClass);
        if (!method_exists($handler, 'handle')) {
            throw new LogicException("{$handlerClass} has no handle() method.");
        }

        return $handler->handle($command);
    }

    private function shortName(object $command): string
    {
        $parts = explode('\\', $command::class);

        return end($parts);
    }
}
