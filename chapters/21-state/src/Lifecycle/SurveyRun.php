<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

use DateTimeImmutable;

/**
 * The Context: one survey being run in one term. It has no if/else about its status:
 * it asks the current status, and only it can switch to the next one.
 */
final class SurveyRun
{
    private RunStatus $status;
    private int $answers = 0;

    /** @var list<string> */
    private array $history = [];

    public function __construct(public readonly string $title)
    {
        $this->status = new Draft();
    }

    public function open(): void
    {
        $this->switchTo($this->status->open());
    }

    public function submitAnswer(): void
    {
        $this->status->acceptAnswer();                      // throws unless the run is open
        $this->answers++;
    }

    public function close(DateTimeImmutable $at): void
    {
        $this->switchTo($this->status->close($at));
    }

    public function reopen(DateTimeImmutable $at): void
    {
        $this->switchTo($this->status->reopen($at));
    }

    public function archive(): void
    {
        $this->switchTo($this->status->archive());
    }

    public function status(): string
    {
        return $this->status->name();
    }

    public function answers(): int
    {
        return $this->answers;
    }

    /** @return list<string> */
    public function history(): array
    {
        return $this->history;
    }

    private function switchTo(RunStatus $next): void
    {
        $this->history[] = "{$this->status->name()} → {$next->name()}";
        $this->status = $next;
    }
}
