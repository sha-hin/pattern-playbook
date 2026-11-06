<?php

declare(strict_types=1);

/*
 * Which language model analyses comments, per environment. Changing provider is a config change.
 *
 *   AI_DRIVER=openai OPENAI_API_KEY=sk-... php bin/evaluations.php
 */

return [
    'default' => getenv('AI_DRIVER') ?: 'ollama',

    'drivers' => [
        'ollama' => [
            'host' => getenv('OLLAMA_HOST') ?: 'http://localhost:11434',
            'model' => getenv('OLLAMA_MODEL') ?: 'llama3.2',
        ],
        'openai' => [
            'api_key' => getenv('OPENAI_API_KEY') ?: '',
            'model' => getenv('OPENAI_MODEL') ?: 'gpt-4o-mini',
        ],
    ],
];
