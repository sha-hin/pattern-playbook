<?php

declare(strict_types=1);

namespace Evalu8\Notify;

use InvalidArgumentException;

/**
 * What to say, in two lengths: a full version (email, in-app) and a short one (SMS, WhatsApp).
 */
final readonly class Message
{
    public const SHORT_LIMIT = 160;                         // one SMS segment

    public function __construct(
        public string $subject,
        public string $body,
        public string $short,
    ) {
        if (mb_strlen($short) > self::SHORT_LIMIT) {
            throw new InvalidArgumentException('The short text is ' . mb_strlen($short) . ' characters; the limit is ' . self::SHORT_LIMIT . '.');
        }
    }
}
