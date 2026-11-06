<?php

declare(strict_types=1);

namespace Evalu8\Notify;

/** To a respondent: the survey closes soon. */
final class SurveyReminder extends Notification
{
    public function __construct(Channel $channel, private readonly string $survey, private readonly string $closesOn)
    {
        parent::__construct($channel);
    }

    protected function message(Recipient $to): Message
    {
        return new Message(
            "Reminder: {$this->survey} closes on {$this->closesOn}",
            "Hello {$to->name},\n\nThe survey \"{$this->survey}\" closes on {$this->closesOn}. It takes about three minutes.",
            "Reminder: \"{$this->survey}\" closes {$this->closesOn}. About 3 minutes.",
        );
    }
}
