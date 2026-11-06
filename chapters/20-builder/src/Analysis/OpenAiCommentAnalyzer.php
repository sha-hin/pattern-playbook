<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use OpenAI\Client;
use OpenAI\Exceptions\ErrorException;

/**
 * Adapter: makes the OpenAI SDK look like a CommentAnalyzer.
 */
final readonly class OpenAiCommentAnalyzer implements CommentAnalyzer
{
    public function __construct(
        private Client $client,                             // the SDK object we adapt
        private string $model = 'gpt-4o-mini',
    ) {
    }

    public function summarize(array $comments): string
    {
        if (count($comments) === 0) {
            return 'no written comments';
        }

        try {
            $response = $this->client->chat()->create([      // our call → their call
                'model' => $this->model,
                'messages' => [
                    ['role' => 'user', 'content' => CommentPrompt::for($comments)],
                ],
            ]);
        } catch (ErrorException $e) {                       // their exception → ours
            throw new AnalysisFailed("OpenAI could not analyse the comments: {$e->getMessage()}", previous: $e);
        }

        return trim($response->choices[0]->message->content);    // their result → our string
    }
}
