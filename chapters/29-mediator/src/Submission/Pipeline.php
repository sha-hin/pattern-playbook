<?php

declare(strict_types=1);

namespace Evalu8\Submission;

use Closure;

/**
 * Pipeline: passes a submission through a list of stages in order, then to the final action.
 * The stages are wrapped around each other like layers; each one decides whether to continue.
 */
final readonly class Pipeline
{
    /**
     * @param list<SubmissionStage> $stages in the order they run
     * @param Closure(Submission): Receipt $destination what happens when every stage lets it through
     */
    public function __construct(
        private array $stages,
        private Closure $destination,
    ) {
    }

    public function process(Submission $submission): Receipt
    {
        // Build from the inside out: the last stage wraps the destination, the first stage wraps everything.
        $next = $this->destination;
        foreach (array_reverse($this->stages) as $stage) {
            $next = fn (Submission $s): Receipt => $stage->handle($s, $next);
        }

        return $next($submission);
    }
}
