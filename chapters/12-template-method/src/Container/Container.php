<?php

declare(strict_types=1);

namespace Evalu8\Container;

use Closure;
use ReflectionClass;
use ReflectionNamedType;

/**
 * A small dependency injection container.
 *
 * - bind():      "to build X, run this function" (a new object every time)
 * - singleton(): the same, but build it once and share it for the life of the app
 * - make():      build X; classes with no binding are built automatically by reading
 *                their constructor and building each typed parameter the same way
 */
final class Container
{
    /** @var array<string, Closure(self): object> */
    private array $factories = [];

    /** @var array<string, true> ids registered with singleton() */
    private array $shared = [];

    /** @var array<string, object> singletons already built */
    private array $instances = [];

    /** @var array<string, true> what is being built right now, to catch circular dependencies */
    private array $building = [];

    /** @param Closure(self): object $factory */
    public function bind(string $id, Closure $factory): void
    {
        $this->factories[$id] = $factory;
        unset($this->shared[$id], $this->instances[$id]);
    }

    /** @param Closure(self): object $factory */
    public function singleton(string $id, Closure $factory): void
    {
        $this->bind($id, $factory);
        $this->shared[$id] = true;
    }

    /**
     * @template T of object
     * @param class-string<T> $id
     * @return T
     */
    public function make(string $id): object
    {
        if (isset($this->instances[$id])) {
            /** @var T */
            return $this->instances[$id];
        }

        if (isset($this->building[$id])) {
            $chain = implode(' → ', [...array_keys($this->building), $id]);
            throw new ContainerException("Circular dependency: {$chain}.");
        }

        $this->building[$id] = true;
        try {
            $object = isset($this->factories[$id]) ? ($this->factories[$id])($this) : $this->autowire($id);
        } finally {
            unset($this->building[$id]);
        }

        if (!$object instanceof $id) {
            throw new ContainerException("The binding for {$id} returned " . $object::class . ', which is not a ' . $id . '.');
        }

        if (isset($this->shared[$id])) {
            $this->instances[$id] = $object;
        }

        return $object;
    }

    /**
     * @template T of object
     * @param class-string<T> $class
     * @return T
     */
    private function autowire(string $class): object
    {
        if (!class_exists($class) && !interface_exists($class)) {
            throw new ContainerException("Can't build [{$class}]: no binding, and no class with that name.");
        }

        $reflection = new ReflectionClass($class);
        if (!$reflection->isInstantiable()) {
            throw new ContainerException("Can't build [{$class}]: it is an interface or abstract class. Bind it to a class first.");
        }

        $constructor = $reflection->getConstructor();
        if ($constructor === null) {
            return $reflection->newInstance();
        }

        $arguments = [];
        foreach ($constructor->getParameters() as $parameter) {
            $type = $parameter->getType();

            if ($type instanceof ReflectionNamedType && !$type->isBuiltin()) {
                /** @var class-string $dependency */
                $dependency = $type->getName();
                $arguments[] = $this->make($dependency);
            } elseif ($parameter->isDefaultValueAvailable()) {
                $arguments[] = $parameter->getDefaultValue();
            } else {
                throw new ContainerException(
                    "Can't build [{$class}]: parameter \${$parameter->getName()} has no class type and no default. Bind {$class} with a factory."
                );
            }
        }

        return $reflection->newInstanceArgs($arguments);
    }
}
