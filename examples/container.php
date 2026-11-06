<?php

declare(strict_types=1);

/**
 * Dependency Injection Container: the full idea in plain PHP, no framework.
 * Run it: php examples/container.php
 *
 * Roles:
 * - Container: Container (knows how to build things; keeps shared instances)
 * - Bindings: bind() = new object every time, singleton() = one shared object
 * - Autowiring: make() reads constructor types with Reflection and builds them
 * - Service: InvoiceSender (asks for what it needs; never builds it)
 *
 * In Laravel:
 * Illuminate\Container\Container: bind() and singleton() store closures; make() calls
 * build(), which uses ReflectionClass to read the constructor and resolve each typed
 * parameter recursively. That is why type-hinting a class in a controller just works.
 */

interface Mailer
{
    public function send(string $to, string $subject): void;
}

final class SmtpMailer implements Mailer
{
    public function __construct(private readonly string $host) {}

    public function send(string $to, string $subject): void
    {
        echo "SMTP {$this->host}: '{$subject}' → {$to}", PHP_EOL;
    }
}

final class FakeMailer implements Mailer                        // for tests: records instead of sending
{
    /** @var list<string> */
    public array $sent = [];

    public function send(string $to, string $subject): void
    {
        $this->sent[] = "{$to}: {$subject}";
    }
}

final class InvoiceSender                                       // ★ Service: asks, never builds
{
    public function __construct(private readonly Mailer $mailer) {}

    public function send(int $invoiceId, string $email): void
    {
        $this->mailer->send($email, "Invoice #{$invoiceId}");
    }
}

final class Container                                           // ★ Container
{
    /** @var array<string, array{factory: Closure(self): object, shared: bool}> */
    private array $bindings = [];

    /** @var array<string, object> */
    private array $instances = [];

    public function bind(string $id, Closure $factory): void    // ★ new object every time
    {
        $this->bindings[$id] = ['factory' => $factory, 'shared' => false];
    }

    public function singleton(string $id, Closure $factory): void   // ★ one shared object, visibly
    {
        $this->bindings[$id] = ['factory' => $factory, 'shared' => true];
    }

    public function make(string $id): object
    {
        if (isset($this->instances[$id])) {
            return $this->instances[$id];
        }

        $binding = $this->bindings[$id] ?? null;
        $object = $binding !== null ? ($binding['factory'])($this) : $this->autowire($id);

        if ($binding !== null && $binding['shared']) {
            $this->instances[$id] = $object;
        }

        return $object;
    }

    private function autowire(string $class): object            // ★ read the constructor, build each dependency
    {
        if (!class_exists($class)) {
            throw new RuntimeException("Cannot build [{$class}]: bind it first (is it an interface?).");
        }

        $constructor = (new ReflectionClass($class))->getConstructor();
        if ($constructor === null) {
            return new $class();
        }

        $arguments = array_map(function (ReflectionParameter $p) use ($class): mixed {
            $type = $p->getType();
            if ($type instanceof ReflectionNamedType && !$type->isBuiltin()) {
                return $this->make($type->getName());           // ★ recursion: dependencies of dependencies
            }
            if ($p->isDefaultValueAvailable()) {
                return $p->getDefaultValue();
            }
            throw new RuntimeException("Cannot guess \${$p->getName()} for [{$class}]: register a factory.");
        }, $constructor->getParameters());

        return new $class(...$arguments);
    }
}

// ── The ONE place that decides what Mailer means ───────────────────────
$app = new Container();
$app->singleton(Mailer::class, fn () => new SmtpMailer('smtp.example.com'));

$app->make(InvoiceSender::class)->send(1001, 'school@example.com');   // InvoiceSender built automatically
echo 'Same Mailer each time? ', var_export($app->make(Mailer::class) === $app->make(Mailer::class), true), PHP_EOL;

// ── In a test: no container, no real email ──────────────────────────────
$fake = new FakeMailer();
(new InvoiceSender($fake))->send(1002, 'test@example.com');
echo 'Fake recorded: ', $fake->sent[0], PHP_EOL;
