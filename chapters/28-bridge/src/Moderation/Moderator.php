<?php

declare(strict_types=1);

namespace Evalu8\Moderation;

use LogicException;

/**
 * Chain of Responsibility: each moderator either handles a flagged comment or passes it
 * to the next one in the chain. The sender doesn't know who will handle it.
 */
abstract class Moderator
{
    private ?Moderator $next = null;

    /** Sets who comes after this moderator, and returns it so chains read left to right. */
    public function then(Moderator $next): Moderator
    {
        $this->next = $next;

        return $next;
    }

    /** @return string what happened to the comment */
    public function review(FlaggedComment $comment): string
    {
        if ($this->canHandle($comment)) {
            return $this->handle($comment);
        }

        if ($this->next === null) {
            throw new LogicException('Nobody in the moderation chain handled the comment.');   // never silent
        }

        return $this->next->review($comment);
    }

    abstract protected function canHandle(FlaggedComment $comment): bool;

    abstract protected function handle(FlaggedComment $comment): string;
}
