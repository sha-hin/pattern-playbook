<?php

declare(strict_types=1);

namespace Evalu8\Lifecycle\Listeners;

use Evalu8\Lifecycle\SurveyClosed;
use Evalu8\Mail\Mailer;

final readonly class EmailThePrincipal
{
    public function __construct(private Mailer $mailer)
    {
    }

    public function __invoke(SurveyClosed $event): void
    {
        $this->mailer->send($event->principal, "Survey closed: {$event->title}", "{$event->answers} answers were collected.");
    }
}
