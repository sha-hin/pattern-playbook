<?php

declare(strict_types=1);

namespace Evalu8\Analysis;

use Closure;
use Ollama\Client as OllamaClient;
use OpenAI\Client as OpenAiClient;

/**
 * The Manager: hands out comment analyzers ("drivers") by name.
 *
 * - driver()          the default driver from config
 * - driver('openai')  a specific one
 * Each driver is built the first time it is asked for, then reused.
 */
final class AnalyzerManager
{
    /** @var array<string, CommentAnalyzer> drivers already built */
    private array $drivers = [];

    /** @var array<string, Closure(array<string, string>): CommentAnalyzer> drivers added with extend() */
    private array $customCreators = [];

    /**
     * @param array{default: string, drivers: array<string, array<string, string>>} $config
     */
    public function __construct(private readonly array $config)
    {
    }

    public function driver(?string $name = null): CommentAnalyzer
    {
        $name ??= $this->config['default'];

        return $this->drivers[$name] ??= $this->create($name);
    }

    /**
     * Registers another driver without editing this class.
     *
     * @param Closure(array<string, string>): CommentAnalyzer $creator receives the driver's config
     */
    public function extend(string $name, Closure $creator): void
    {
        $this->customCreators[$name] = $creator;
        unset($this->drivers[$name]);
    }

    private function create(string $name): CommentAnalyzer
    {
        $config = $this->config['drivers'][$name] ?? [];

        if (isset($this->customCreators[$name])) {
            return ($this->customCreators[$name])($config);
        }

        return match ($name) {
            'ollama' => $this->createOllama($config),
            'openai' => $this->createOpenAi($config),
            default => throw new UnknownDriver(
                "Comment analysis driver \"{$name}\" is not supported. Available: "
                . implode(', ', ['ollama', 'openai', ...array_keys($this->customCreators)]) . '.'
            ),
        };
    }

    /** @param array<string, string> $config */
    private function createOllama(array $config): CommentAnalyzer
    {
        return new OllamaCommentAnalyzer(
            new OllamaClient($this->required($config, 'host', 'ollama')),
            $this->required($config, 'model', 'ollama'),
        );
    }

    /** @param array<string, string> $config */
    private function createOpenAi(array $config): CommentAnalyzer
    {
        return new OpenAiCommentAnalyzer(
            new OpenAiClient($this->required($config, 'api_key', 'openai')),
            $this->required($config, 'model', 'openai'),
        );
    }

    /** @param array<string, string> $config */
    private function required(array $config, string $key, string $driver): string
    {
        if (!isset($config[$key]) || $config[$key] === '') {
            throw new UnknownDriver("The \"{$driver}\" driver needs \"{$key}\" in config/ai.php (or its environment variable).");
        }

        return $config[$key];
    }
}
