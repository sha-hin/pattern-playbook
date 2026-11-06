<?php

declare(strict_types=1);

namespace Evalu8\Bus;

use Evalu8\Logging\Logger;
use Throwable;

/**
 * Runs queued commands in the background, retrying failures, and raising an alert when a
 * job fails for good. In production it runs forever under a process manager (systemd, Supervisor).
 */
final readonly class Worker
{
    public function __construct(
        private Queue $queue,
        private CommandBus $bus,
        private Logger $logger,
        private int $maxAttempts = 3,
    ) {
    }

    /** Works until the queue is empty. Returns how many jobs were handled (done or failed). */
    public function runUntilEmpty(): int
    {
        $handled = 0;

        while (($job = $this->queue->reserve()) !== null) {
            $attempt = $job->attempts + 1;

            try {
                $this->bus->dispatchNow($job->command);
                $this->queue->complete($job);
                $this->logger->info('job done', ['job' => $job->id, 'attempt' => $attempt]);
                $handled++;
            } catch (Throwable $e) {
                $final = $attempt >= $this->maxAttempts;
                $this->queue->release($job, $e, $final);

                if ($final) {
                    $this->logger->warning('ALERT job failed for good', ['job' => $job->id, 'attempts' => $attempt, 'error' => $e->getMessage()]);
                    $handled++;
                } else {
                    $this->logger->warning('job failed, will retry', ['job' => $job->id, 'attempt' => $attempt, 'error' => $e->getMessage()]);
                }
            }
        }

        return $handled;
    }
}
