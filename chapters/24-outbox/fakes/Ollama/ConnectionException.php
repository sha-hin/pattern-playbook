<?php

declare(strict_types=1);

namespace Ollama;

use RuntimeException;

/** What the HTTP client throws when the Ollama server doesn't answer in time. */
final class ConnectionException extends RuntimeException
{
}
