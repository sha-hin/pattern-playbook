<?php

declare(strict_types=1);

/**
 * Laravel-style Facade (a static proxy): how Cache::get() works, in plain PHP.
 * Run it: php examples/static-proxy.php
 *
 * Roles:
 * - Proxy base: Facade (turns a static call into a call on a real object)
 * - Concrete proxy: Cache (names which service it stands for)
 * - Real subject: ArrayCache (the one real object, living in the container)
 * - Container: ServiceContainer (where the real object comes from)
 *
 * In Laravel:
 * Illuminate\Support\Facades\Facade::__callStatic() calls getFacadeRoot(), which resolves
 * getFacadeAccessor() from the container (and caches it), then forwards the call.
 * Facade::swap() and Cache::shouldReceive() replace that object in tests.
 */

final class ArrayCache                                          // ★ Real subject: the actual service
{
    /** @var array<string, mixed> */
    private array $items = [];

    public function put(string $key, mixed $value): void
    {
        $this->items[$key] = $value;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->items[$key] ?? $default;
    }
}

final class ServiceContainer                                    // a tiny container (see the DI Container card)
{
    /** @var array<string, Closure(): object> */
    private array $factories = [];

    /** @var array<string, object> */
    private array $instances = [];

    public function singleton(string $id, Closure $factory): void
    {
        $this->factories[$id] = $factory;
    }

    public function make(string $id): object
    {
        return $this->instances[$id] ??= ($this->factories[$id] ?? throw new RuntimeException("Nothing bound for [{$id}]."))();
    }

    public function swap(string $id, object $instance): void   // used by tests
    {
        $this->instances[$id] = $instance;
    }
}

abstract class Facade                                           // ★ Proxy base
{
    private static ?ServiceContainer $container = null;

    public static function setContainer(ServiceContainer $container): void
    {
        self::$container = $container;
    }

    /** The container id of the real object behind this shortcut. */
    abstract protected static function accessor(): string;

    /** @param list<mixed> $arguments */
    public static function __callStatic(string $method, array $arguments): mixed   // ★ PHP calls this for Cache::anything()
    {
        $container = self::$container ?? throw new RuntimeException('Facade container not set.');
        $target = $container->make(static::accessor());        // ★ find the ONE real object

        if (!method_exists($target, $method)) {
            throw new BadMethodCallException(static::class . "::{$method}() does not exist.");
        }

        return $target->{$method}(...$arguments);               // ★ forward the call, unchanged
    }
}

final class Cache extends Facade                                // ★ Concrete proxy
{
    protected static function accessor(): string
    {
        return 'cache';
    }
}

// ── Bootstrapping (what the framework does for you) ─────────────────────
$container = new ServiceContainer();
$container->singleton('cache', fn () => new ArrayCache());
Facade::setContainer($container);

// ── The static-looking call is a normal method call on one object ──────
Cache::put('menu', ['Margherita', 'Pepperoni']);
echo implode(', ', Cache::get('menu')), PHP_EOL;
echo 'Same object? ', var_export($container->make('cache')->get('menu') === Cache::get('menu'), true), PHP_EOL;

// In a test, swap the real object for a fake one: no static code to fight with.
$container->swap('cache', new ArrayCache());
echo 'After swap: ', var_export(Cache::get('menu'), true), PHP_EOL;
