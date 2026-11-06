<?php

declare(strict_types=1);

namespace Evalu8\Survey;

use InvalidArgumentException;

final class InvalidSurvey extends InvalidArgumentException
{
    /** @param list<string> $problems */
    public function __construct(public readonly array $problems)
    {
        parent::__construct("The survey can't be built:\n  - " . implode("\n  - ", $problems));
    }
}
