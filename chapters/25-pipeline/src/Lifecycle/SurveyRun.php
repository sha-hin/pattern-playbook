<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle;

use DateTimeImmutable;
use Evalu8\Domain\EmailAddress;

/**
 * The Context: one survey being run in one term. It has no if/else about its status:
 * it asks the current status, and only it can switch to the next one.
 *
 * It also records what happened (events), without knowing who will react to them.
 */
final class SurveyRun
{
    private RunStatus $status;
    private int $answers = 0;

    /** @var list<string> */
    private array $history = [];

    /** @var list<object> events recorded but not yet dispatched */
    private array $events = [];

    public function __construct(
        public readonly string $title,
        public readonly string $term,
        public readonly string $school,
        public readonly EmailAddress $principal,
    ) {
        $this->status = new Draft();
    }

    public function open(): void
    {
        $this->switchTo($this->status->open());
    }

    public function submitAnswer(): void
    {
        $this->ensureAcceptsAnswers();
        $this->answers++;
    }

    /** Throws unless the run is open. Lets callers check before doing any work. */
    public function ensureAcceptsAnswers(): void
    {
        $this->status->acceptAnswer();
    }

    public function close(DateTimeImmutable $at): void
    {
        $this->switchTo($this->status->close($at));
        $this->events[] = new SurveyClosed($this->title, $this->term, $this->school, $this->principal, $this->answers, $at);
    }

    /**
     * Hands over the recorded events and forgets them, so each is dispatched once.
     *
     * @return list<object>
     */
    public function releaseEvents(): array
    {
        $events = $this->events;
        $this->events = [];

        return $events;
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
