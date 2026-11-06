<?php

declare(strict_types=1);

/**
 * Dependency Injection Container: the full idea in plain PHP, no framework.
 * Run it: php examples/container.php
 *
 * Roles:
 * - Service: InvoiceSender (asks for what it needs in its constructor; never builds it)
 * - Container: Container (knows how to build things and keeps shared instances)
 * - singleton(): "build it once, then always give the same object"
 * - Autowiring: make() reads the constructor and builds each dependency automatically
 *
 * In Laravel:
 * The service container. singleton() stores how to build something; make() uses PHP's
 * ReflectionClass to read a class's constructor and builds every typed parameter, one level
 * deeper each time. That is why type-hinting a class in a controller just works.
 */

interface Mailer
{
    public function send(string $to, string $subject): void;
}

final class SmtpMailer implements Mailer
{
    public function __construct(private readonly string $host)
    {
    }

    public function send(string $to, string $subject): void
    {
        echo "SMTP {$this->host}: '{$subject}' -> {$to}\n";
    }
}

final class FakeMailer implements Mailer                    // for tests: remembers instead of sending
{
    /** @var list<string> */
    public array $sent = [];

    public function send(string $to, string $subject): void
    {
        $this->sent[] = "{$to}: {$subject}";
    }
}

// ── Step 1: the service. It ASKS for a Mailer; it never creates one. ──
final class InvoiceSender                                   // ★ Service
{
    public function __construct(private readonly Mailer $mailer)  // ★ dependency injection
    {
    }

    public function send(int $invoiceId, string $email): void
    {
        $this->mailer->send($email, "Invoice #{$invoiceId}");
    }
}

// ── Step 2: the container ──
final class Container                                       // ★ Container
{
    /** @var array<string, callable(): object> */
    private array $factories = [];

    /** @var array<string, object> */
    private array $shared = [];

    /** @param callable(): object $factory */
    public function singleton(string $name, callable $factory): void   // ★ "build once, share it"
    {
        $this->factories[$name] = $factory;
    }

    public function make(string $name): object
    {
        if (isset($this->shared[$name])) {
            return $this->shared[$name];                    // already built: give the same object
        }

        if (isset($this->factories[$name])) {
            $this->shared[$name] = ($this->factories[$name])();

            return $this->shared[$name];
        }

        return $this->autowire($name);
    }

    /** @param class-string $class */
    private function autowire(string $class): object       // ★ read the constructor, build what it needs
    {
        if (!class_exists($class) && !interface_exists($class)) {
            throw new LogicException("Nothing registered for [{$class}], and it is not a class that can be built.");
        }

        $reflection = new ReflectionClass($class);
        if (!$reflection->isInstantiable()) {               // an interface or abstract class needs a binding
            throw new LogicException("[{$class}] is an interface or abstract class: bind it with singleton() first.");
        }

        $constructor = $reflection->getConstructor();
        if ($constructor === null) {
            return new $class();                            // no constructor: nothing to inject
        }

        $arguments = [];
        foreach ($constructor->getParameters() as $parameter) {
            $type = $parameter->getType();

            if (!$type instanceof ReflectionNamedType || $type->isBuiltin()) {
                // a string, an int or a union type can't be guessed: it must be registered by hand
                throw new LogicException("Cannot autowire \${$parameter->getName()} of {$class}: register {$class} with singleton().");
            }

            $arguments[] = $this->make($type->getName());   // ★ build each dependency the same way
        }

        return new $class(...$arguments);
    }
}

// ── Using it: ONE place decides what "Mailer" means ──
$app = new Container();
$app->singleton(Mailer::class, function (): Mailer {
    return new SmtpMailer('smtp.example.com');
});

$sender = $app->make(InvoiceSender::class);                 // built automatically, Mailer injected
$sender->send(1001, 'school@example.com');

$same = $app->make(Mailer::class) === $app->make(Mailer::class);
echo 'Same Mailer each time? ' . ($same ? 'yes' : 'no') . "\n";

// ── A clear error instead of a crash when something can't be built ──
try {
    (new Container())->make(InvoiceSender::class);          // nobody said which Mailer to use
} catch (LogicException $e) {
    echo 'Error: ' . $e->getMessage() . "\n";
}

// ── In a test: no container needed, and no real email is sent ──
$fake = new FakeMailer();
$testSender = new InvoiceSender($fake);
$testSender->send(1002, 'test@example.com');
echo 'The fake mailer recorded: ' . $fake->sent[0] . "\n";
