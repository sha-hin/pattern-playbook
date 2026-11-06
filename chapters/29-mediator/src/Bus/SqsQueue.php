<?php

declare(strict_types=1);

namespace Evalu8\Bus;

use Aws\SqsClient;
use LogicException;
use Throwable;

/**
 * The same Queue interface on Amazon SQS, for workers running on other servers.
 * (Attempt counting is left to SQS's redrive policy and dead-letter queue.)
 */
final class SqsQueue implements Queue
{
    /** @var array<int, string> job id => SQS receipt handle */
    private array $handles = [];
    private int $nextId = 1;

    public function __construct(
        private readonly SqsClient $sqs,
        private readonly string $queueUrl,
    ) {
    }

    public function push(ShouldQueue $command): int
    {
        $this->sqs->sendMessage([
            'QueueUrl' => $this->queueUrl,
            'MessageBody' => json_encode(['command' => $command::class, 'payload' => get_object_vars($command)], JSON_THROW_ON_ERROR),
        ]);

        return $this->nextId++;
    }

    public function reserve(): ?Job
    {
        $messages = $this->sqs->receiveMessage(['QueueUrl' => $this->queueUrl])['Messages'] ?? [];
        if (count($messages) === 0) {
            return null;
        }

        /** @var array{command: string, payload: array<string, mixed>} $body */
        $body = json_decode($messages[0]['Body'], true, flags: JSON_THROW_ON_ERROR);
        $class = $body['command'];
        if (!class_exists($class) || !is_subclass_of($class, ShouldQueue::class)) {
            throw new LogicException("Refusing to rebuild [{$class}]: it is not a queueable command.");
        }

        $id = $this->nextId++;
        $this->handles[$id] = $messages[0]['ReceiptHandle'];

        return new Job($id, new $class(...$body['payload']), 0);
    }

    public function complete(Job $job): void
    {
        $this->sqs->deleteMessage(['QueueUrl' => $this->queueUrl, 'ReceiptHandle' => $this->handles[$job->id]]);
        unset($this->handles[$job->id]);
    }

    public function release(Job $job, Throwable $error, bool $final): void
    {
        if ($final) {
            $this->complete($job);                          // SQS would move it to the dead-letter queue
        }
        // otherwise do nothing: SQS makes the message visible again after its timeout
    }
}
