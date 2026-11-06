<?php

declare(strict_types=1);

namespace Evalu8\Moderation;

final readonly class FlaggedComment
{
    public function __construct(
        public string $school,
        public string $text,
    ) {
    }
}
