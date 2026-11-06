<?php

declare(strict_types=1);

namespace Evalu8\Editor;

/** Shows the question as respondents will see it. It only displays, so it never notifies. */
final class PreviewPanel extends Field
{
    public string $html = '';

    public function show(string $html): void
    {
        $this->html = $html;
    }
}
