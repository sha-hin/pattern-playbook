<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Ollama\Client;
use Ollama\ConnectionException;

/**
 * Adapter: makes a self-hosted Ollama server look like a CommentAnalyzer.
 * Ollama's API is shaped differently (arrays, and errors returned instead of thrown);
 * all of that difference stays inside this class.
 */
final readonly class OllamaCommentAnalyzer implements CommentAnalyzer
{
    public function __construct(
        private Client $client,
        private string $model = 'llama3.2',
    ) {
    }

    public function summarize(array $comments): string
    {
        if (count($comments) === 0) {
            return 'no written comments';
        }

        try {
            $result = $this->client->generate([             // our call → their call
                'model' => $this->model,
                'prompt' => CommentPrompt::for($comments),
                'stream' => false,
            ]);
        } catch (ConnectionException $e) {                  // a timeout is temporary: worth a retry
            throw AnalysisFailed::temporary("Ollama did not answer: {$e->getMessage()}", $e);
        }

        if (isset($result['error'])) {                      // their error array → our exception
            throw new AnalysisFailed("Ollama could not analyse the comments: {$result['error']}");
        }

        if (!isset($result['response'])) {
            throw new AnalysisFailed('Ollama returned no response text.');
        }

        return trim($result['response']);                   // their result → our string
    }
}
