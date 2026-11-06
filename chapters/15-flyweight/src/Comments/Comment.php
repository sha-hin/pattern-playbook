<?php

declare(strict_types=1);

namespace Evalu8\Comments;

use Evalu8\Domain\RespondentRole;

/**
 * One written comment. $role is null when it has been hidden from the viewer.
 */
final readonly class Comment
{
    public function __construct(
        public ?RespondentRole $role,
        public string $text,
    ) {
    }

    public function withoutRole(): self
    {
        return new self(null, $this->text);
    }
}
