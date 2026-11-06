<?php

declare(strict_types=1);

namespace Evalu8\Editor;

use LogicException;

/**
 * A Colleague: one part of the question editor. It knows its mediator, nothing else.
 */
abstract class Field
{
    private ?EditorMediator $mediator = null;

    public bool $enabled = true;

    public function attach(EditorMediator $mediator): void
    {
        $this->mediator = $mediator;
    }

    /** Called by every setter after the user changes the field. */
    protected function notifyChanged(): void
    {
        if ($this->mediator === null) {
            throw new LogicException(static::class . ' is not attached to an editor.');
        }

        $this->mediator->changed($this);
    }
}
