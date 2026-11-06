<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/** To a teacher: your result for the term is available. */
final class ResultsPublished extends Notification
{
    public function __construct(Channel $channel, private readonly string $term, private readonly string $score)
    {
        parent::__construct($channel);
    }

    protected function message(Recipient $to): Message
    {
        return new Message(
            "Your {$this->term} evaluation result",
            "Dear {$to->name},\n\nYour evaluation result for {$this->term} is {$this->score}. "
                . 'The full report, with comments, is in Evalu8 under "My results".',
            "{$to->name}, your {$this->term} result is {$this->score}. Details in Evalu8.",
        );
    }
}
