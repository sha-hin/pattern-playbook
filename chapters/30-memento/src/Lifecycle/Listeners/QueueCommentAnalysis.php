<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle\Listeners;

use Evalu8\Analysis\AnalyzeTeacherComments;
use Evalu8\Bus\CommandBus;
use Evalu8\Domain\TeacherRepository;
use Evalu8\Lifecycle\SurveyClosed;

/** Queues one analysis job per teacher of the school. Returns immediately. */
final readonly class QueueCommentAnalysis
{
    public function __construct(
        private TeacherRepository $teachers,
        private CommandBus $bus,
    ) {
    }

    public function __invoke(SurveyClosed $event): void
    {
        foreach ($this->teachers->all() as $teacher) {
            if ($teacher->school === $event->school) {
                $this->bus->dispatch(new AnalyzeTeacherComments($teacher->id, $event->term));
            }
        }
    }
}
