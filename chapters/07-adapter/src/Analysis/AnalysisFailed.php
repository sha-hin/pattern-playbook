<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use RuntimeException;

/**
 * The one error type the app sees when comment analysis fails, whichever provider is behind it.
 */
final class AnalysisFailed extends RuntimeException
{
}
