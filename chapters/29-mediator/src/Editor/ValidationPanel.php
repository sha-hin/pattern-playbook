<?php

declare(strict_types=1);

namespace Evalu8\Editor;

/** The list of problems under the form. The Save button is disabled while it is not empty. */
final class ValidationPanel extends Field
{
    /** @var list<string> */
    public array $problems = [];

    /** @param list<string> $problems */
    public function show(array $problems): void
    {
        $this->problems = $problems;
    }
}
