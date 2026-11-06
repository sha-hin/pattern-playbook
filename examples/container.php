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

class SmtpMailer implements Mailer
{
    public function __construct(private string $host)
    {
    }

    public function send(string $to, string $subject): void
    {
        echo "SMTP {$this->host}: '{$subject}' -> {$to}\n";
    }
}

class FakeMailer implements Mailer                          // for tests: remembers instead of sending
{
    public array $sent = [];

    public function send(string $to, string $subject): void
    {
        $this->sent[] = "{$to}: {$subject}";
    }
}

// ── Step 1: the service. It ASKS for a Mailer; it never creates one. ──
class InvoiceSender                                         // ★ Service
{
    public function __construct(private Mailer $mailer)    // ★ dependency injection
    {
    }

    public function send(int $invoiceId, string $email): void
    {
        $this->mailer->send($email, "Invoice #{$invoiceId}");
    }
}

// ── Step 2: the container ──
class Container                                             // ★ Container
{
    private array $factories = [];
    private array $shared = [];

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

    private function autowire(string $class): object       // ★ read the constructor, build what it needs
    {
        $constructor = (new ReflectionClass($class))->getConstructor();
        if ($constructor === null) {
            return new $class();                            // no constructor: nothing to inject
        }

        $arguments = [];
        foreach ($constructor->getParameters() as $parameter) {
            $type = $parameter->getType()->getName();       // e.g. "Mailer"
            $arguments[] = $this->make($type);              // ★ build each dependency the same way
        }

        return new $class(...$arguments);
    }
}

// ── Using it: ONE place decides what "Mailer" means ──
$app = new Container();
$app->singleton(Mailer::class, function () {
    return new SmtpMailer('smtp.example.com');
});

$sender = $app->make(InvoiceSender::class);                 // built automatically, Mailer injected
$sender->send(1001, 'school@example.com');

$same = $app->make(Mailer::class) === $app->make(Mailer::class);
echo 'Same Mailer each time? ' . ($same ? 'yes' : 'no') . "\n";

// ── In a test: no container needed, and no real email is sent ──
$fake = new FakeMailer();
$testSender = new InvoiceSender($fake);
$testSender->send(1002, 'test@example.com');
echo 'The fake mailer recorded: ' . $fake->sent[0] . "\n";
