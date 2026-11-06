<?php

declare(strict_types=1);

/**
 * Manager / Driver: the full pattern in plain PHP, no framework.
 * Run it: php examples/manager.php
 *
 * Roles:
 * - Driver contract: AiClient (what every backend can do)
 * - Drivers: LocalLlmClient, HostedApiClient (one per backend)
 * - Manager: Manager (picks a driver by name, builds it once, reuses it)
 * - Concrete manager: AiManager (one create...Driver() method per backend)
 * - Config: decides which driver is the default
 *
 * In Laravel:
 * Laravel's Manager class: driver($name) builds the driver the first time (by calling
 * create{Name}Driver()) and returns the same object after that. Hashing and sessions use it,
 * and Cache, Mail and Storage use the same idea.
 */

// ── Step 1: the driver contract and two drivers ──
interface AiClient                                          // ★ Driver contract
{
    public function summarize(string $text): string;
}

final class LocalLlmClient implements AiClient              // ★ Driver for local development
{
    public function __construct(private readonly string $url)
    {
    }

    public function summarize(string $text): string
    {
        return "[local model at {$this->url}] " . substr($text, 0, 30) . '...';
    }
}

final class HostedApiClient implements AiClient             // ★ Driver for production
{
    public function __construct(private readonly string $apiKey)
    {
    }

    public function summarize(string $text): string
    {
        return '[hosted API] ' . substr($text, 0, 30) . '...';
    }
}

// ── Step 2: the Manager. Pick by name, build once, reuse. ──
abstract class Manager                                      // ★ Manager
{
    /** @var array<string, object> driver name => built driver */
    private array $drivers = [];

    /** @param array<string, string> $config */
    public function __construct(protected readonly array $config)
    {
    }

    abstract protected function defaultDriver(): string;

    public function driver(?string $name = null): object
    {
        if ($name === null) {
            $name = $this->defaultDriver();                 // no name given: use the config
        }

        if (!isset($this->drivers[$name])) {
            $method = 'create' . ucfirst($name) . 'Driver'; // ★ 'local' becomes createLocalDriver()

            if (!method_exists($this, $method)) {
                throw new InvalidArgumentException('Driver [' . $name . '] is not supported by ' . static::class . '.');
            }

            $this->drivers[$name] = $this->$method();       // ★ build it the first time...
        }

        return $this->drivers[$name];                       // ★ ...then always reuse it
    }
}

// ── Step 3: the concrete manager. One small method per backend. ──
final class AiManager extends Manager                       // ★ Concrete manager
{
    public function driver(?string $name = null): AiClient  // narrows the return type: callers get an AiClient
    {
        $driver = parent::driver($name);

        if (!$driver instanceof AiClient) {
            throw new LogicException('AI drivers must implement AiClient.');
        }

        return $driver;
    }

    protected function defaultDriver(): string
    {
        return $this->config['default'];
    }

    protected function createLocalDriver(): AiClient
    {
        return new LocalLlmClient($this->config['local_url']);
    }

    protected function createHostedDriver(): AiClient
    {
        return new HostedApiClient($this->config['hosted_key']);
    }
}

// ── Using it: config changes per environment, the code never does ──
$config = [
    'default' => 'local',                                   // 'hosted' in production
    'local_url' => 'http://localhost:11434',
    'hosted_key' => 'secret-key',
];

$ai = new AiManager($config);
$text = 'Teachers rate classroom time management highest this term.';

echo $ai->driver()->summarize($text) . "\n";               // the default from config
echo $ai->driver('hosted')->summarize($text) . "\n";       // or a named one

$same = $ai->driver() === $ai->driver();
echo 'Built only once? ' . ($same ? 'yes' : 'no') . "\n";
