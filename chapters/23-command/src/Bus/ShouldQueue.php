<?php

declare(strict_types=1);

namespace Evalu8\Bus;

/**
 * Marks a command that must run in the background: the bus queues it instead of running it now.
 * A queued command must hold only plain data (ints, strings...), because it is stored as JSON.
 */
interface ShouldQueue
{
}
