<?php

declare(strict_types=1);

/**
 * Command: the full pattern in plain PHP, no framework.
 * Run it: php examples/command.php
 *
 * Roles:
 * - Command: Command (interface: one method, execute())
 * - Concrete command: AnalyzeSurvey (the action as an object: only data, so it can be stored)
 * - Receiver: AiAnalyzer (the object that does the real work)
 * - Invoker: CommandQueue (stores commands now, runs them later, retries failures)
 *
 * In Laravel:
 * Jobs are commands. dispatch(new AnalyzeSurvey($id)) serializes the job object
 * (SerializesModels keeps only model ids) into the queue; a worker unserializes it, calls
 * handle() with dependencies from the container, and retries using $tries and $backoff.
 */

interface Command                                               // ★ Command
{
    public function execute(Container $services): void;
}

final class Container                                           // gives commands their receivers at run time
{
    /** @param array<class-string, object> $services */
    public function __construct(private readonly array $services) {}

    /** @template T of object @param class-string<T> $class @return T */
    public function get(string $class): object
    {
        return $this->services[$class] ?? throw new RuntimeException("No service [{$class}].");
    }
}

final class AiAnalyzer                                          // ★ Receiver: does the real work
{
    private int $calls = 0;

    public function analyze(int $surveyId): string
    {
        if (++$this->calls === 1) {
            throw new RuntimeException('AI service timeout');   // fails once, like real APIs do
        }

        return "Survey {$surveyId}: teachers rate classroom time highest";
    }
}

final class AnalyzeSurvey implements Command                    // ★ Concrete command: just data...
{
    public function __construct(public readonly int $surveyId) {}

    public function execute(Container $services): void          // ...plus how to run it
    {
        echo $services->get(AiAnalyzer::class)->analyze($this->surveyId), PHP_EOL;
    }
}

final class CommandQueue                                        // ★ Invoker
{
    /** @var list<array{payload: string, attempts: int}> */
    private array $queue = [];

    public function __construct(private readonly int $maxAttempts = 3) {}

    public function push(Command $command): void                // ★ store it now...
    {
        $this->queue[] = ['payload' => serialize($command), 'attempts' => 0];   // an object can be stored
    }

    public function work(Container $services): void            // ★ ...run it later
    {
        while (($job = array_shift($this->queue)) !== null) {
            $command = unserialize($job['payload'], ['allowed_classes' => [AnalyzeSurvey::class]]);
            try {
                $command->execute($services);
            } catch (Throwable $e) {
                $attempts = $job['attempts'] + 1;
                echo "Attempt {$attempts} failed: {$e->getMessage()}", PHP_EOL;
                if ($attempts < $this->maxAttempts) {
                    $this->queue[] = ['payload' => $job['payload'], 'attempts' => $attempts];   // retry
                } else {
                    echo 'Gave up, moved to failed jobs.', PHP_EOL;        // never silent
                }
            }
        }
    }
}

// ── The web request: answers at once ────────────────────────────────────
$queue = new CommandQueue();
$queue->push(new AnalyzeSurvey(42));
echo 'HTTP 202: analysis started', PHP_EOL;

// ── The worker process: runs it later, retries on failure ──────────────
$queue->work(new Container([AiAnalyzer::class => new AiAnalyzer()]));
