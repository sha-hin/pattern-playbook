<?php

declare(strict_types=1);

namespace Ollama;

use FakeLlm\Model;

/**
 * Shaped like Ollama's HTTP API (POST /api/generate): an array in, an array out.
 * Errors come back as ['error' => '...'] instead of an exception.
 */
final readonly class Client
{
    /** @param list<string> $installedModels */
    public function __construct(private string $host, private array $installedModels = ['llama3.2'])
    {
    }

    /**
     * @param array{model: string, prompt: string, stream?: bool} $request
     * @return array{model?: string, response?: string, done?: bool, error?: string}
     */
    public function generate(array $request): array
    {
        if (!in_array($request['model'], $this->installedModels, true)) {
            return ['error' => "model \"{$request['model']}\" not found, try pulling it first"];
        }

        return ['model' => $request['model'], 'response' => Model::reply($request['prompt']), 'done' => true];
    }
}
