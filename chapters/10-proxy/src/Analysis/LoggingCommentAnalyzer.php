<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Evalu8\Logging\Logger;

/**
 * Decorator: logs every call that reaches the provider, with its duration, and every failure.
 */
final readonly class LoggingCommentAnalyzer implements CommentAnalyzer
{
    public function __construct(
        private CommentAnalyzer $inner,
        private Logger $logger,
    ) {
    }

    public function summarize(array $comments): string
    {
        $start = hrtime(true);

        try {
            $summary = $this->inner->summarize($comments);
        } catch (AnalysisFailed $e) {
            $this->logger->warning('comment analysis failed', ['error' => $e->getMessage(), 'temporary' => $e->temporary]);
            throw $e;
        }

        $this->logger->info('comment analysis', [
            'comments' => count($comments),
            'ms' => intdiv(hrtime(true) - $start, 1_000_000),
        ]);

        return $summary;
    }
}
