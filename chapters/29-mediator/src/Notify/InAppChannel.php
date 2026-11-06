<?php

declare(strict_types=1);

namespace Evalu8\Notify;

use PDO;

/**
 * Saves the message to the user's inbox in the app (the bell icon).
 */
final readonly class InAppChannel implements Channel
{
    public function __construct(private PDO $db)
    {
    }

    public function name(): string
    {
        return 'in-app';
    }

    public function deliver(Recipient $to, Message $message): void
    {
        $insert = $this->db->prepare('INSERT INTO inbox (user_id, subject, body) VALUES (?, ?, ?)');
        $insert->execute([$to->userId, $message->subject, $message->body]);
    }
}
