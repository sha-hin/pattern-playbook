<?php

declare(strict_types=1);

namespace Evalu8\Domain;

use RuntimeException;

/**
 * Thrown when a repository is asked for something that doesn't exist.
 */
final class NotFound extends RuntimeException
{
}
