<?php

declare(strict_types=1);

namespace Evalu8\Submission;

/** One answer sent from the online survey form. */
final readonly class Submission
{
    public function __construct(
        public string $invitationToken,
        public int $teacherId,
        public string $role,
        public string $score,
        public string $comment,
        public string $ipAddress,
    ) {
    }
}
