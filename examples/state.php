<?php

declare(strict_types=1);

/**
 * State: the full pattern in plain PHP, no framework.
 * Run it: php examples/state.php
 *
 * Roles:
 * - Context: Report (holds its current state and passes every action to it)
 * - State: ReportState (base class: every action is refused unless a child allows it)
 * - Concrete states: Draft, Submitted, Approved (each allows only its own moves)
 *
 * In Laravel:
 * Laravel's core has no State class: a status is usually a string or enum column. When each
 * status also needs its own behaviour, the spatie/laravel-model-states package adds exactly
 * this structure: it saves the state class in the column and gives each state its own class.
 */

// ── Step 1: the State base class. Everything is refused by default. ──
abstract class ReportState                                  // ★ State
{
    abstract public function name(): string;

    public function submit(Report $report): void
    {
        throw new LogicException("Cannot submit a report that is {$this->name()}.");
    }

    public function approve(Report $report): void
    {
        throw new LogicException("Cannot approve a report that is {$this->name()}.");
    }

    public function reject(Report $report, string $reason): void
    {
        throw new LogicException("Cannot reject a report that is {$this->name()}.");
    }
}

// ── Step 2: concrete states. Each one allows only its own moves. ──
final class Draft extends ReportState                       // ★ Concrete state
{
    public function name(): string
    {
        return 'draft';
    }

    public function submit(Report $report): void            // a draft CAN be submitted
    {
        $report->moveTo(new Submitted());                   // ★ the state decides what comes next
    }
}

final class Submitted extends ReportState                   // ★ Concrete state
{
    public function name(): string
    {
        return 'submitted';
    }

    public function approve(Report $report): void
    {
        $report->moveTo(new Approved());
    }

    public function reject(Report $report, string $reason): void
    {
        $report->rejectionReason = $reason;
        $report->moveTo(new Draft());                       // rejected reports go back to draft
    }
}

final class Approved extends ReportState                    // ★ Concrete state: allows nothing more
{
    public function name(): string
    {
        return 'approved';
    }
}

// ── Step 3: the Context. It has no if statements at all. ──
final class Report                                          // ★ Context
{
    private ReportState $state;
    public ?string $rejectionReason = null;
    /** @var list<string> */
    public array $history = [];

    public function __construct()
    {
        $this->state = new Draft();                         // every report starts as a draft
    }

    public function submit(): void
    {
        $this->state->submit($this);                        // ★ just ask the current state
    }

    public function approve(): void
    {
        $this->state->approve($this);
    }

    public function reject(string $reason): void
    {
        $this->state->reject($this, $reason);
    }

    public function moveTo(ReportState $next): void         // called by the state classes
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

echo implode("\n", $report->history) . "\n";

try {
    $report->submit();                                      // approved reports are locked
} catch (LogicException $e) {
    echo 'Refused: ' . $e->getMessage() . "\n";
}
