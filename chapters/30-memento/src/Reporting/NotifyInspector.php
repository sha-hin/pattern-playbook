<?php

declare(strict_types=1);

namespace Evalu8\Reporting;

use Evalu8\Bus\ShouldQueue;

/** "Tell the inspector that this export is ready." Runs in the background. */
final readonly class NotifyInspector implements ShouldQueue
{
    public function __construct(
        public string $term,
        public string $location,                            // where the storage put the file
    ) {
    }
}
