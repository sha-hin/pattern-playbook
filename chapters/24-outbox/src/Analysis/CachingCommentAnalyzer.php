<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Evalu8\Cache\Cache;

/**
 * Decorator: remembers summaries, so the same comments are never analysed twice.
 * Failures are not cached: they throw before anything is stored.
 */
final readonly class CachingCommentAnalyzer implements CommentAnalyzer
{
    public function __construct(
        private CommentAnalyzer $inner,                     // the analyzer being wrapped
        private Cache $cache,
        private int $ttlSeconds = 7 * 24 * 3600,
    ) {
    }

    public function summarize(array $comments): string
    {
        $key = 'comment-summary:' . hash('sha256', implode("\n", $comments));

        $cached = $this->cache->get($key);
        if ($cached !== null) {
            return $cached;                                 // added behaviour: answer from the cache
        }

        $summary = $this->inner->summarize($comments);      // otherwise pass the call through
        $this->cache->set($key, $summary, $this->ttlSeconds);

        return $summary;
    }
}
