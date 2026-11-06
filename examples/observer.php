<?php

declare(strict_types=1);

/**
 * Observer: the full pattern in plain PHP, no framework.
 * Run it: php examples/observer.php
 *
 * Roles:
 * - Subject: Registration (keeps a list of observers and notifies them)
 * - Observer: RegistrationObserver (the interface every reaction must follow)
 * - Concrete observers: SendWelcomeEmail, StartFreeTrial, SyncToCrm
 * PHP has the same two interfaces built in: SplSubject and SplObserver.
 *
 * In Laravel:
 * Eloquent model observers: User::observe(UserObserver::class) attaches an object whose
 * created(), updated()... methods run when the model is saved. Laravel registers them on
 * its event dispatcher (see the Event Dispatcher card).
 */

class User
{
    public function __construct(public int $id, public string $email)
    {
    }
}

// ── Step 1: the Observer interface. Every reaction follows it. ──
interface RegistrationObserver                              // ★ Observer
{
    public function userRegistered(User $user): void;
}

// ── Step 2: the Subject. Keeps a list of observers and notifies them. ──
class Registration                                          // ★ Subject
{
    private array $observers = [];

    public function attach(RegistrationObserver $observer): void   // ★ subscribe
    {
        $this->observers[] = $observer;
    }

    public function register(string $email): User
    {
        $user = new User(1, $email);                        // the real work (saving the user)
        $this->notify($user);

        return $user;
    }

    private function notify(User $user): void
    {
        foreach ($this->observers as $observer) {
            try {
                $observer->userRegistered($user);           // ★ ring the bell, don't care who listens
            } catch (Exception $e) {
                // One broken reaction must not stop the others, but it must not be silent.
                echo '[error log] ' . get_class($observer) . ' failed: ' . $e->getMessage() . "\n";
            }
        }
    }
}

// ── Step 3: concrete observers. One class per reaction. ──
class SendWelcomeEmail implements RegistrationObserver
{
    public function userRegistered(User $user): void
    {
        echo "Welcome email sent to {$user->email}\n";
    }
}

class StartFreeTrial implements RegistrationObserver
{
    public function userRegistered(User $user): void
    {
        echo "14-day trial started for user {$user->id}\n";
    }
}

class SyncToCrm implements RegistrationObserver
{
    public function userRegistered(User $user): void
    {
        throw new RuntimeException('CRM API timed out');    // broken today, on purpose
    }
}

// ── Using it ──
$registration = new Registration();
$registration->attach(new SendWelcomeEmail());
$registration->attach(new SyncToCrm());
$registration->attach(new StartFreeTrial());                // a new reaction = attach one more

$registration->register('ali@example.com');
