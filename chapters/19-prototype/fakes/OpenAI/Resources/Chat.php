<?php

declare(strict_types=1);

namespace OpenAI\Resources;

use FakeLlm\Model;
use OpenAI\Exceptions\ErrorException;
use OpenAI\Responses\CreateResponse;

final readonly class Chat
{
    public function __construct(private string $apiKey)
    {
    }

    /**
     * @param array{model: string, messages: list<array{role: string, content: string}>} $parameters
     */
    public function create(array $parameters): CreateResponse
    {
        if (!str_starts_with($this->apiKey, 'sk-')) {
            throw new ErrorException('Incorrect API key provided.');
        }

        $prompt = $parameters['messages'][count($parameters['messages']) - 1]['content'];

        return new CreateResponse(Model::reply($prompt));
    }
}
