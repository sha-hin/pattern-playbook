<?php

declare(strict_types=1);

namespace Evalu8\Moderation;

/** The end of the chain: the central quality team reviews whatever is left. */
final class QualityTeam extends Moderator
{
    protected function canHandle(FlaggedComment $comment): bool
    {
        return true;
    }

    protected function handle(FlaggedComment $comment): string
    {
        return 'sent to the quality team';
    }
}
