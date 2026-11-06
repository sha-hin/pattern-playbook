<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/** To a principal: a teacher has too few answers for a meaningful score. */
final class LowResponseRate extends Notification
{
    public function __construct(
        Channel $channel,
        private readonly string $teacherName,
        private readonly int $responses,
        private readonly int $needed,
    ) {
        parent::__construct($channel);
    }

    protected function message(Recipient $to): Message
    {
        return new Message(
            "Low response rate: {$this->teacherName}",
            "Dear {$to->name},\n\n{$this->teacherName} has {$this->responses} answers so far; "
                . "at least {$this->needed} are needed for a meaningful score. Please remind the classes.",
            "{$this->teacherName}: {$this->responses} of {$this->needed} answers needed. Please remind the classes.",
        );
    }
}
