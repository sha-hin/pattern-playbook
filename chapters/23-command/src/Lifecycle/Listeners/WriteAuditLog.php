<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle\Listeners;

use Evalu8\Lifecycle\SurveyClosed;
use Evalu8\Logging\Logger;

final readonly class WriteAuditLog
{
    public function __construct(private Logger $logger)
    {
    }

    public function __invoke(SurveyClosed $event): void
    {
        $this->logger->info('audit: survey closed', [
            'survey' => $event->title,
            'answers' => $event->answers,
            'at' => $event->closedAt->format('Y-m-d'),
        ]);
    }
}
