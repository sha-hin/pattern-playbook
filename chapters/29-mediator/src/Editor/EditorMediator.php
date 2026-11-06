<?php

declare(strict_types=1);

namespace Evalu8\Editor;

/**
 * The Mediator: fields report "I changed" here, and only the mediator decides what that
 * means for the other fields. No field knows any other field.
 */
interface EditorMediator
{
    public function changed(Field $field): void;
}
