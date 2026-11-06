<?php

declare(strict_types=1);

namespace Evalu8\Domain;

use InvalidArgumentException;

/**
 * Thrown when a value object is given something it refuses to hold.
 */
final class InvalidValue extends InvalidArgumentException
{
}
