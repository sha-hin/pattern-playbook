<?php

declare(strict_types=1);

/**
 * Laravel-style Facade (a static proxy): how Cache::get() works, in plain PHP.
 * Run it: php examples/static-proxy.php
 *
 * Roles:
 * - Real object: ArrayCache (the actual service that does the work)
 * - Container: Services (where the one real object is kept)
 * - Proxy base: Facade (turns a static call into a normal method call)
 * - Concrete proxy: Cache (says which service it stands for)
 *
 * In Laravel:
 * The Facade base class has a __callStatic() method. It asks the container for the object
 * named by getFacadeAccessor() (for Cache that is 'cache'), remembers it, and forwards the
 * call. Cache::shouldReceive() in tests swaps that object for a mock.
 */

// ── Step 1: the real object ──
class ArrayCache                                            // ★ Real object
{
    private array $items = [];

    public function put(string $key, mixed $value): void
    {
        $this->items[$key] = $value;
    }

    public function get(string $key): mixed
    {
        return $this->items[$key] ?? null;
    }
}

// ── Step 2: a tiny container that keeps one object per name ──
class Services
{
    public static array $objects = [];
}

// ── Step 3: the proxy base. Turns Cache::get() into $realObject->get(). ──
abstract class Facade                                       // ★ Proxy base
{
    abstract protected static function accessor(): string; // which service am I a shortcut for?

    public static function __callStatic(string $method, array $arguments): mixed   // ★ PHP calls this for Cache::anything()
    {
        $name = static::accessor();

        if (!isset(Services::$objects[$name])) {
            throw new RuntimeException("No service called [{$name}].");
        }

        $realObject = Services::$objects[$name];            // ★ find the ONE real object

        return $realObject->$method(...$arguments);         // ★ forward the call, unchanged
    }
}

// ── Step 4: a concrete proxy. It only names its service. ──
class Cache extends Facade                                  // ★ Concrete proxy
{
    protected static function accessor(): string
    {
        return 'cache';
    }
}

// ── Using it ──
Services::$objects['cache'] = new ArrayCache();             // the framework does this at startup

Cache::put('menu', 'Margherita, Pepperoni');                // looks static...
echo Cache::get('menu') . "\n";                             // ...but is a normal call on one object

// In a test, replace the real object. No static code to fight with:
Services::$objects['cache'] = new ArrayCache();
echo 'After swapping in a fresh cache: ' . var_export(Cache::get('menu'), true) . "\n";
