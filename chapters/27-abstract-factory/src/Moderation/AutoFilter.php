<?php

declare(strict_types=1);

namespace Evalu8\Moderation;

/** Handles the obvious cases: comments with words that are never acceptable. */
final class AutoFilter extends Moderator
{
    /** @param list<string> $blockedWords */
    public function __construct(private readonly array $blockedWords)
    {
    }

    protected function canHandle(FlaggedComment $comment): bool
    {
        foreach ($this->blockedWords as $word) {
            if (preg_match('/\b' . preg_quote($word, '/') . '\b/iu', $comment->text) === 1) {
                return true;
            }
        }

        return false;
    }

    protected function handle(FlaggedComment $comment): string
    {
        return 'rejected automatically';
    }
}
