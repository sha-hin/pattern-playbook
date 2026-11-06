<?php

declare(strict_types=1);

namespace Ollama;

use FakeLlm\Model;

/**
 * Shaped like Ollama's HTTP API (POST /api/generate): an array in, an array out.
 * Errors come back as ['error' => '...'] instead of an exception.
 */
final class Client
{
    /**
     * @param list<string> $installedModels
     * @param int $timeoutsBeforeAnswering simulate a busy server: the first N calls time out
     */
    public function __construct(
        private readonly string $host,
        private readonly array $installedModels = ['llama3.2'],
        private int $timeoutsBeforeAnswering = 0,
    ) {
    }

    /**
     * @param array{model: string, prompt: string, stream?: bool} $request
     * @return array{model?: string, response?: string, done?: bool, error?: string}
     */
    public function generate(array $request): array
    {
        if ($this->timeoutsBeforeAnswering > 0) {
            $this->timeoutsBeforeAnswering--;
            throw new ConnectionException("cURL error 28: Operation timed out after 30000 ms ({$this->host})");
        }

        if (!in_array($request['model'], $this->installedModels, true)) {
            return ['error' => "model \"{$request['model']}\" not found, try pulling it first"];
        }

        return ['model' => $request['model'], 'response' => Model::reply($request['prompt']), 'done' => true];
    }
}
