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
 * The HTTP Kernel is a Facade over the framework itself: one call, handle($request), sets up
 * config and service providers, runs the middleware, calls the router and reports errors.
 * In your own app, "action" classes like EnrollStudent are the same idea.
 * (Laravel's Cache:: style "facades" are something else: see the Laravel Facade card.)
 */

// ── The subsystems. Each does one small thing. ──
class Users
{
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

class Classes
{
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

class Billing
{
    public function openAccount(int $studentId, string $plan): void
    {
        if ($plan !== 'monthly' && $plan !== 'yearly') {
            throw new InvalidArgumentException("Unknown plan [{$plan}].");
        }
    }
}

class Mailer
{
    public function welcome(string $name): void
    {
        echo "Welcome email sent to {$name}\n";
    }
}

// ── The Facade. One simple door that runs every step in the right order. ──
class EnrollStudent                                         // ★ Facade
{
    public function __construct(
        private Users $users,
        private Classes $classes,
        private Billing $billing,
        private Mailer $mailer,
    ) {
    }

    public function handle(string $name, string $class, string $plan): int   // ★ the one method callers use
    {
        $studentId = $this->users->create($name);           // ★ step 1

        try {
            $this->classes->assign($studentId, $class);     // ★ step 2
            $this->billing->openAccount($studentId, $plan); // ★ step 3
        } catch (Exception $e) {
            $this->classes->unassign($studentId);           // something failed: undo the earlier steps
            $this->users->delete($studentId);
            throw $e;
        }

        $this->mailer->welcome($name);                      // ★ step 4, only after everything worked

        return $studentId;
    }
}

// ── Using it: every caller is one line, and none of them can forget a step ──
$users = new Users();
$classes = new Classes();
$enroll = new EnrollStudent($users, $classes, new Billing(), new Mailer());

$enroll->handle('Mona', '3-B', 'monthly');                  // from the web form

try {
    $enroll->handle('Omar', '3-B', 'weekly');               // from the CSV import, with a bad plan
} catch (InvalidArgumentException $e) {
    echo 'Import row rejected: ' . $e->getMessage() . "\n";
}

echo 'Students: ' . implode(', ', $users->all) . ' | assigned to a class: ' . count($classes->assigned) . "\n";
