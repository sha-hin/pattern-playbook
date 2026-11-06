<?php

declare(strict_types=1);

/**
 * State: the full pattern in plain PHP, no framework.
 * Run it: php examples/state.php
 *
 * Roles:
 * - Context: Report (holds its current state; ONLY the report can change it)
 * - State: ReportState (base class: every action is refused unless a child allows it)
 * - Concrete states: Draft, Submitted, Approved (each allows only its own moves)
 * Each action on a state returns the NEXT state, and the report switches to it.
 * Nothing outside the report can jump to a state directly, so the rules can't be skipped.
 *
 * In Laravel:
 * Laravel's core has no State class: a status is usually a string or enum column. When each
 * status also needs its own behaviour, the spatie/laravel-model-states package adds exactly
 * this structure: it saves the state class in the column, gives each state its own class,
 * and only allows the transitions you register.
 */

final class TransitionNotAllowed extends LogicException
{
}

// ── Step 1: the State base class. Everything is refused by default. ──
abstract class ReportState                                  // ★ State
{
    abstract public function name(): string;

    public function submit(): ReportState
    {
        throw $this->refuse('submit');
    }

    public function approve(): ReportState
    {
        throw $this->refuse('approve');
    }

    public function reject(): ReportState
    {
        throw $this->refuse('reject');
    }

    private function refuse(string $action): TransitionNotAllowed
    {
        return new TransitionNotAllowed("Cannot {$action} a report that is {$this->name()}.");
    }
}

// ── Step 2: concrete states. Each one allows only its own moves. ──
final class Draft extends ReportState                       // ★ Concrete state
{
    public function name(): string
    {
        return 'draft';
    }

    public function submit(): ReportState                   // a draft CAN be submitted
    {
        return new Submitted();                             // ★ the state decides what comes next
    }
}

final class Submitted extends ReportState                   // ★ Concrete state
{
    public function name(): string
    {
        return 'submitted';
    }

    public function approve(): ReportState
    {
        return new Approved();
    }

    public function reject(): ReportState
    {
        return new Draft();                                 // rejected reports go back to draft
    }
}

final class Approved extends ReportState                    // ★ Concrete state: allows nothing more
{
    public function name(): string
    {
        return 'approved';
    }
}

// ── Step 3: the Context. No if statements, and no public way to set the state. ──
final class Report                                          // ★ Context
{
    private ReportState $state;
    private ?string $rejectionReason = null;

    /** @var list<string> */
    private array $history = [];

    public function __construct()
    {
        $this->state = new Draft();                         // every report starts as a draft
    }

    public function submit(): void
    {
        $this->switchTo($this->state->submit());            // ★ ask the current state for the next one
    }

    public function approve(): void
    {
        $this->switchTo($this->state->approve());
    }

    public function reject(string $reason): void
    {
        $this->switchTo($this->state->reject());
        $this->rejectionReason = $reason;                   // only saved if the move was allowed
    }

    public function status(): string
    {
        return $this->state->name();
    }

    public function rejectionReason(): ?string
    {
        return $this->rejectionReason;
    }

    /** @return list<string> */
    public function history(): array
    {
        return $this->history;
    }

    private function switchTo(ReportState $next): void      // ★ private: the only place the state changes
    {
        $this->history[] = $this->state->name() . ' -> ' . $next->name();
        $this->state = $next;
    }
}

// ── Using it ──
$report = new Report();
$report->submit();
$report->reject('Missing the science scores.');
$report->submit();
$report->approve();

echo implode("\n", $report->history()) . "\n";
echo "Status: {$report->status()}\n";

try {
    $report->submit();                                      // approved reports are locked
} catch (TransitionNotAllowed $e) {
    echo 'Refused: ' . $e->getMessage() . "\n";
}
