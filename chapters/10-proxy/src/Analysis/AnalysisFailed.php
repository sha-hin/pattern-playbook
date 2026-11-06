<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use RuntimeException;
use Throwable;

/**
 * The one error type the app sees when comment analysis fails, whichever provider is behind it.
 */
final class AnalysisFailed extends RuntimeException
{
    /**
     * @param bool $temporary true for problems worth retrying (a timeout, a busy server);
     *                        false for problems a retry can't fix (a wrong key, a missing model)
     */
    public function __construct(string $message, public readonly bool $temporary = false, ?Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }

    public static function temporary(string $message, ?Throwable $previous = null): self
    {
        return new self($message, true, $previous);
    }
}
