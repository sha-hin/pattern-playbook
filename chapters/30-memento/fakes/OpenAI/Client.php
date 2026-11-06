<?php

declare(strict_types=1);

namespace OpenAI;

use OpenAI\Resources\Chat;

/** Same entry point as openai-php/client: $client->chat()->create([...]). */
final readonly class Client
{
    public function __construct(private string $apiKey)
    {
    }

    public function chat(): Chat
    {
        return new Chat($this->apiKey);
    }
}
