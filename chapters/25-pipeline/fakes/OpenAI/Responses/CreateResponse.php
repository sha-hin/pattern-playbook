<?php

declare(strict_types=1);

namespace OpenAI\Responses;

/** Mirrors the real response object: $response->choices[0]->message->content */
final readonly class CreateResponse
{
    /** @var list<object{message: object{role: string, content: string}}> */
    public array $choices;

    public function __construct(string $content)
    {
        $this->choices = [(object) ['message' => (object) ['role' => 'assistant', 'content' => $content]]];
    }
}
