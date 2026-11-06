<?php

declare(strict_types=1);

/**
 * State: the full pattern in plain PHP, no framework.
 * Run it: php examples/state.php
 *
 * Roles:
 * - Context: Report (holds its current state and hands every action to it)
 * - State: ReportState (base class: every action forbidden by default)
 * - Concrete states: Draft, Submitted, Approved (each allows only its own moves)
 *
 * In Laravel:
 * Not built in. The popular package spatie/laravel-model-states stores the state class
 * name in a model column, and each state class declares which transitions are allowed:
 * the same structure as below, with persistence added.
 */

final class IllegalTransition extends LogicException {}

abstract class ReportState                                      // ★ State: forbidden unless a child allows it
{
    abstract public function name(): string;

    public function submit(Report $report): void { $this->deny('submit'); }

    public function approve(Report $report): void { $this->deny('approve'); }

    public function reject(Report $report, string $reason): void { $this->deny('reject'); }

    private function deny(string $action): never
    {
        throw new IllegalTransition("Cannot {$action} a report that is {$this->name()}.");
    }
}

final class Draft extends ReportState                           // ★ Concrete state
{
    public function name(): string { return 'draft'; }

    public function submit(Report $report): void
    {
        $report->moveTo(new Submitted());                       // ★ the state decides what comes next
    }
}

final class Submitted extends ReportState                       // ★ Concrete state
{
    public function name(): string { return 'submitted'; }

    public function approve(Report $report): void
    {
        $report->moveTo(new Approved());
    }

    public function reject(Report $report, string $reason): void
    {
        if (trim($reason) === '') {
            throw new InvalidArgumentException('A rejection needs a reason.');
        }
        $report->rejectionReason = $reason;
        $report->moveTo(new Draft());
    }
}

final class Approved extends ReportState                        // ★ Concrete state: final, allows nothing
{
    public function name(): string { return 'approved'; }
}

final class Report                                              // ★ Context
{
    public ?string $rejectionReason = null;

    /** @var list<string> */
    public array $history = [];

    public function __construct(private ReportState $state = new Draft()) {}

    public function submit(): void { $this->state->submit($this); }        // ★ no if anywhere

    public function approve(): void { $this->state->approve($this); }

    public function reject(string $reason): void { $this->state->reject($this, $reason); }

    public function status(): string { return $this->state->name(); }

    /** @internal called only by the state objects */
    public function moveTo(ReportState $next): void
    {
        $this->history[] = $this->state->name() . ' → ' . $next->name();
        $this->state = $next;
    }
}

// ── Using it ────────────────────────────────────────────────────────────
$report = new Report();
$report->submit();
$report->reject('Missing the science scores.');
$report->submit();
$report->approve();

echo implode(PHP_EOL, $report->history), PHP_EOL;

try {
    $report->submit();                                          // approved reports are locked
} catch (IllegalTransition $e) {
    echo 'Refused: ', $e->getMessage(), PHP_EOL;
}
