<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Closure;
use InvalidArgumentException;

/**
 * Decorator: retries temporary failures, waiting a little longer each time.
 * Permanent failures, and the last temporary one, are thrown as they are.
 */
final readonly class RetryingCommentAnalyzer implements CommentAnalyzer
{
    /** @var Closure(int): void */
    private Closure $sleep;

    /**
     * @param Closure(int): void|null $sleep receives milliseconds; replaceable so demos don't wait
     */
    public function __construct(
        private CommentAnalyzer $inner,
        private int $attempts = 3,
        private int $firstDelayMs = 500,
        ?Closure $sleep = null,
    ) {
        if ($attempts < 1) {
            throw new InvalidArgumentException('At least one attempt is needed.');
        }

        $this->sleep = $sleep ?? static function (int $ms): void {
            usleep($ms * 1000);
        };
    }

    public function summarize(array $comments): string
    {
        for ($attempt = 1; ; $attempt++) {
            try {
                return $this->inner->summarize($comments);
            } catch (AnalysisFailed $e) {
                if (!$e->temporary || $attempt >= $this->attempts) {
                    throw $e;                               // not worth retrying, or out of attempts
                }

                ($this->sleep)($this->firstDelayMs * 2 ** ($attempt - 1));   // 500 ms, 1 s, 2 s...
            }
        }
    }
}
