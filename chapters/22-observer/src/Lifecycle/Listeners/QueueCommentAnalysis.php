<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle\Listeners;

use Evalu8\Lifecycle\SurveyClosed;
use Evalu8\Logging\Logger;

/** Chapter 23 turns this into a real background job. */
final readonly class QueueCommentAnalysis
{
    public function __construct(private Logger $logger)
    {
    }

    public function __invoke(SurveyClosed $event): void
    {
        $this->logger->info('comment analysis requested', ['school' => $event->school]);
    }
}
