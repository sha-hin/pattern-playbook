<?php

declare(strict_types=1);

namespace Evalu8\Submission\Stages;

use Closure;
use Evalu8\Submission\Receipt;
use Evalu8\Submission\Submission;
use Evalu8\Submission\SubmissionStage;

/** At most N submissions per device; stops scripts that try invitation tokens. (Production: Redis.) */
final class LimitRate implements SubmissionStage
{
    /** @var array<string, int> */
    private array $counts = [];

    public function __construct(private readonly int $maxPerDevice = 3)
    {
    }

    public function handle(Submission $submission, Closure $next): Receipt
    {
        $count = ($this->counts[$submission->ipAddress] ?? 0) + 1;
        $this->counts[$submission->ipAddress] = $count;

        if ($count > $this->maxPerDevice) {
            return new Receipt(false, 'Too many submissions from this device. Try again later.');
        }

        return $next($submission);
    }
}
