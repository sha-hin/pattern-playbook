<?php

declare(strict_types=1);

/**
 * Observer: the full pattern in plain PHP, no framework.
 * Run it: php examples/observer.php
 *
 * Roles:
 * - Subject: Registration (keeps a list of observers and notifies them)
 * - Observer: RegistrationObserver (the interface every reaction signs)
 * - Concrete observers: SendWelcomeEmail, StartFreeTrial, SyncToCrm
 * PHP has the same two interfaces built in: SplSubject and SplObserver.
 *
 * In Laravel:
 * Eloquent model observers: User::observe(UserObserver::class) attaches an object whose
 * created(), updated()... methods run when the model fires those events. Under the hood
 * Laravel registers them on its event dispatcher (see the Event Dispatcher card).
 */

final class User
{
    public function __construct(public readonly int $id, public readonly string $email) {}
}

interface RegistrationObserver                                  // ★ Observer
{
    public function userRegistered(User $user): void;
}

final class Registration                                        // ★ Subject
{
    /** @var array<int, RegistrationObserver> */
    private array $observers = [];

    private int $nextId = 1;

    /** @param Closure(string): void $report  where failed reactions are reported (a logger) */
    public function __construct(private readonly Closure $report) {}

    public function attach(RegistrationObserver $observer): void     // ★ subscribe
    {
        $this->observers[spl_object_id($observer)] = $observer;
    }

    public function detach(RegistrationObserver $observer): void     // ★ unsubscribe
    {
        unset($this->observers[spl_object_id($observer)]);
    }

    public function register(string $email): User
    {
        $user = new User($this->nextId++, $email);              // the real work
        $this->notify($user);

        return $user;
    }

    private function notify(User $user): void
    {
        foreach ($this->observers as $observer) {
            try {
                $observer->userRegistered($user);               // ★ ring the bell; don't care who listens
            } catch (Throwable $e) {
                // One broken reaction must not undo the registration or stop the others,
                // but it must never be silent either.
                ($this->report)($observer::class . ' failed for user ' . $user->id . ': ' . $e->getMessage());
            }
        }
    }
}

final class SendWelcomeEmail implements RegistrationObserver    // Concrete observer
{
    public function userRegistered(User $user): void
    {
        echo "Welcome email sent to {$user->email}", PHP_EOL;
    }
}

final class StartFreeTrial implements RegistrationObserver      // Concrete observer
{
    public function userRegistered(User $user): void
    {
        echo "14-day trial started for user {$user->id}", PHP_EOL;
    }
}

final class SyncToCrm implements RegistrationObserver           // Concrete observer (broken today)
{
    public function userRegistered(User $user): void
    {
        throw new RuntimeException('CRM API timed out');
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$registration = new Registration(fn (string $error) => print("[error log] {$error}" . PHP_EOL));
$registration->attach(new SendWelcomeEmail());
$registration->attach(new SyncToCrm());
$registration->attach(new StartFreeTrial());                    // a new reaction = attach one more

$registration->register('ali@example.com');
