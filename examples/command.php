<?php

declare(strict_types=1);

/**
 * Command: the full pattern in plain PHP, no framework.
 * Run it: php examples/command.php
 *
 * Roles:
 * - Command: Command (an interface with one method: execute())
 * - Concrete command: AnalyzeSurvey (one action, packed into an object)
 * - Receiver: AiAnalyzer (the object that does the real work)
 * - Invoker: CommandQueue (keeps commands now, runs them later, retries failures)
 *
 * In Laravel:
 * Queued jobs are commands. dispatch(new AnalyzeSurvey($id)) turns the job object into text
 * with serialize() and stores it in the queue. A worker process later turns it back into an
 * object and calls handle(), retrying as many times as $tries allows.
 */

// ── Step 1: the Command interface ──
interface Command                                           // ★ Command
{
    public function execute(): void;
}

// ── Step 2: the Receiver. Does the real work. ──
final class AiAnalyzer                                      // ★ Receiver
{
    private int $calls = 0;

    public function analyze(int $surveyId): string
    {
        $this->calls++;
        if ($this->calls === 1) {
            throw new RuntimeException('AI service timeout');   // fails the first time, like real APIs
        }

        return "Survey {$surveyId}: teachers rate classroom time highest";
    }
}

// ── Step 3: a concrete command. The action, as an object. ──
final class AnalyzeSurvey implements Command                // ★ Concrete command
{
    public function __construct(private readonly AiAnalyzer $analyzer, private readonly int $surveyId)
    {
    }

    public function execute(): void
    {
        echo $this->analyzer->analyze($this->surveyId) . "\n";
    }
}

// ── Step 4: the Invoker. Because the action is an object, it can wait in a list. ──
final class CommandQueue                                    // ★ Invoker
{
    /** @var list<array{command: Command, attempts: int}> */
    private array $waiting = [];

    public function push(Command $command): void            // ★ keep it now...
    {
        $this->waiting[] = ['command' => $command, 'attempts' => 0];
    }

    public function work(int $maxAttempts = 3): void        // ★ ...run it later
    {
        while (count($this->waiting) > 0) {
            $job = array_shift($this->waiting);

            try {
                $job['command']->execute();
            } catch (Exception $e) {
                $job['attempts']++;
                echo "Attempt {$job['attempts']} failed: {$e->getMessage()}\n";

                if ($job['attempts'] < $maxAttempts) {
                    $this->waiting[] = $job;                // put it back to retry
                } else {
                    echo "Gave up after {$maxAttempts} attempts.\n";   // never silent
                }
            }
        }
    }
}

// ── Using it ──
$queue = new CommandQueue();

// The web request: queue the slow work and answer immediately.
$queue->push(new AnalyzeSurvey(new AiAnalyzer(), 42));
echo "HTTP 202: analysis started\n";

// The worker process (later): run it, retrying on failure.
$queue->work();
