<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle\Listeners;

use Evalu8\Lifecycle\SurveyClosed;
use RuntimeException;

/** Calls the Ministry's API, which is down today. Chapter 24 makes this delivery reliable. */
final readonly class NotifyMinistry
{
    public function __invoke(SurveyClosed $event): void
    {
        throw new RuntimeException('Ministry API: 503 Service Unavailable');
    }
}
