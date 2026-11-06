<?php

declare(strict_types=1);

namespace Evalu8\Editor;

final class ScaleField extends Field
{
    public int $max = 5;                                    // the scale always starts at 1

    public function setMax(int $max): void
    {
        $this->max = $max;
        $this->notifyChanged();
    }
}
