<?php

declare(strict_types=1);

/**
 * Manager / Driver: the full pattern in plain PHP, no framework.
 * Run it: php examples/manager.php
 *
 * Roles:
 * - Manager: Manager (abstract: pick a driver by name, build it once, reuse it)
 * - Concrete manager: AiManager (one create{Name}Driver() method per backend)
 * - Driver contract: AiClient; Drivers: LocalLlmClient, HostedApiClient
 * - Config: decides the default driver
 *
 * In Laravel:
 * Illuminate\Support\Manager: driver($name) returns $this->drivers[$name] ??= createDriver(),
 * which calls create{Name}Driver() or a creator added with extend(). CacheManager,
 * MailManager, HashManager and FilesystemManager all work this way.
 */

interface AiClient                                              // ★ Driver contract
{
    public function summarize(string $text): string;
}

final class LocalLlmClient implements AiClient                  // Driver (local development)
{
    public function __construct(private readonly string $url) {}

    public function summarize(string $text): string
    {
        return "[local model at {$this->url}] " . mb_substr($text, 0, 30) . '…';
    }
}

final class HostedApiClient implements AiClient                 // Driver (production)
{
    public function __construct(private readonly string $apiKey) {}

    public function summarize(string $text): string
    {
        return '[hosted API, key …' . substr($this->apiKey, -4) . '] ' . mb_substr($text, 0, 30) . '…';
    }
}

abstract class Manager                                          // ★ Manager
{
    /** @var array<string, object> */
    private array $drivers = [];

    /** @var array<string, Closure(array): object> */
    private array $customCreators = [];

    /** @param array<string, mixed> $config */
    public function __construct(protected readonly array $config) {}

    abstract public function defaultDriver(): string;

    final public function driver(?string $name = null): object  // ★ pick, build once, reuse
    {
        $name ??= $this->defaultDriver();

        return $this->drivers[$name] ??= $this->create($name);
    }

    final public function extend(string $name, Closure $creator): void   // add a backend without editing the class
    {
        $this->customCreators[$name] = $creator;
        unset($this->drivers[$name]);
    }

    private function create(string $name): object
    {
        if (isset($this->customCreators[$name])) {
            return ($this->customCreators[$name])($this->config);
        }

        $method = 'create' . ucfirst($name) . 'Driver';        // 'local' → createLocalDriver()
        if (!method_exists($this, $method)) {
            throw new InvalidArgumentException("AI driver [{$name}] is not supported.");
        }

        return $this->{$method}();
    }
}

final class AiManager extends Manager                           // ★ Concrete manager
{
    public function defaultDriver(): string
    {
        return $this->config['default'] ?? throw new RuntimeException('Set ai.default in config.');
    }

    protected function createLocalDriver(): AiClient            // ★ one method per backend
    {
        return new LocalLlmClient($this->config['local']['url']);
    }

    protected function createHostedDriver(): AiClient
    {
        return new HostedApiClient($this->config['hosted']['key']);
    }
}

// ── Config differs per environment; the code does not ──────────────────
$config = [
    'default' => getenv('AI_DRIVER') ?: 'local',
    'local'   => ['url' => 'http://localhost:11434'],
    'hosted'  => ['key' => 'sk-test-9f2c'],
];

$ai = new AiManager($config);
echo $ai->driver()->summarize('Teachers rate classroom time management highest this term.'), PHP_EOL;
echo $ai->driver('hosted')->summarize('Teachers rate classroom time management highest this term.'), PHP_EOL;
echo 'Built once? ', var_export($ai->driver() === $ai->driver(), true), PHP_EOL;
