<?php

declare(strict_types=1);

namespace Evalu8\Moderation;

/** Schools that appointed their own moderator review their own comments. */
final class SchoolModerator extends Moderator
{
    /** @param list<string> $schoolsWithModerator */
    public function __construct(private readonly array $schoolsWithModerator)
    {
    }

    protected function canHandle(FlaggedComment $comment): bool
    {
        return in_array($comment->school, $this->schoolsWithModerator, true);
    }

    protected function handle(FlaggedComment $comment): string
    {
        return "sent to {$comment->school}'s moderator";
    }
}
