<?php

declare(strict_types=1);

namespace Evalu8\Editor;

/** "Count this question in the teacher's score." */
final class ScoredCheckbox extends Field
{
    public bool $checked = true;

    public function toggle(bool $checked): void
    {
        $this->checked = $checked;
        $this->notifyChanged();
    }
}
