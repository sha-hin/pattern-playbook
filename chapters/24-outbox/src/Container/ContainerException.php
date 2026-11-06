<?php

declare(strict_types=1);

namespace Evalu8\Container;

use LogicException;

/**
 * Thrown when the container can't build what was asked for, always with the reason.
 */
final class ContainerException extends LogicException
{
}
