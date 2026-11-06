<?php

declare(strict_types=1);

/**
 * Facade: the full pattern in plain PHP, no framework.
 * Run it: php examples/facade.php
 *
 * Roles:
 * - Facade: EnrollStudent (one simple method that runs the whole job)
 * - Subsystems: Users, Classes, Billing, Mailer (still usable on their own)
 * - Clients: the web form, the API and the CSV import (all call the facade)
 *
 * In Laravel:
 * Illuminate\Foundation\Http\Kernel::handle() is a Facade over the framework itself: one call
 * bootstraps config, providers, middleware and routing in the right order. In your own app,
 * "action" or service classes like EnrollStudent are the same idea.
 * (Laravel's Cache:: style "facades" are something else: see the Laravel Facade card.)
 */

// ── Subsystems ──────────────────────────────────────────────────────────
final class Users
{
    /** @var array<int, string> */
    public array $all = [];

    public function create(string $name): int
    {
        $id = count($this->all) + 1;
        $this->all[$id] = $name;

        return $id;
    }

    public function delete(int $id): void
    {
        unset($this->all[$id]);
    }
}

final class Classes
{
    /** @var array<int, string> */
    public array $assigned = [];

    public function assign(int $studentId, string $class): void
    {
        $this->assigned[$studentId] = $class;
    }

    public function unassign(int $studentId): void
    {
        unset($this->assigned[$studentId]);
    }
}

final class Billing
{
    public function openAccount(int $studentId, string $plan): void
    {
        if (!in_array($plan, ['monthly', 'yearly'], true)) {
            throw new InvalidArgumentException("Unknown plan [{$plan}].");
        }
    }
}

final class Mailer
{
    public function welcome(string $name): void
    {
        echo "Welcome email sent to {$name}", PHP_EOL;
    }
}

// ── The facade ──────────────────────────────────────────────────────────
final class EnrollStudent                                       // ★ Facade
{
    public function __construct(
        private readonly Users $users,
        private readonly Classes $classes,
        private readonly Billing $billing,
        private readonly Mailer $mailer,
    ) {}

    public function handle(string $name, string $class, string $plan): int   // ★ one simple door
    {
        $studentId = $this->users->create($name);              // ★ step 1
        try {
            $this->classes->assign($studentId, $class);         // ★ step 2
            $this->billing->openAccount($studentId, $plan);     // ★ step 3
        } catch (Throwable $e) {
            $this->classes->unassign($studentId);               // undo what was done: all or nothing
            $this->users->delete($studentId);
            throw $e;
        }
        $this->mailer->welcome($name);                          // ★ step 4, only after everything saved

        return $studentId;
    }
}

// ── Every client is one line, and none can forget a step ────────────────
$users = new Users();
$classes = new Classes();
$enroll = new EnrollStudent($users, $classes, new Billing(), new Mailer());

$enroll->handle('Mona', '3-B', 'monthly');                      // from the web form

try {
    $enroll->handle('Omar', '3-B', 'weekly');                   // from the CSV import, with bad data
} catch (InvalidArgumentException $e) {
    echo 'Import row rejected: ', $e->getMessage(), PHP_EOL;
}

echo 'Students: ', implode(', ', $users->all), ' | assigned: ', count($classes->assigned), PHP_EOL;
