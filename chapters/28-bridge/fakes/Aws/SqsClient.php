<?php

declare(strict_types=1);

namespace Aws;

/**
 * Shaped like the AWS SDK's SqsClient::sendMessage() / receiveMessage() / deleteMessage().
 * Messages are kept in memory.
 */
final class SqsClient
{
    /** @var array<string, array<string, string>> queue URL => receipt handle => body */
    private array $queues = [];
    private int $sequence = 0;

    /** @param array{QueueUrl: string, MessageBody: string} $args */
    public function sendMessage(array $args): array
    {
        $this->sequence++;
        $this->queues[$args['QueueUrl']]["rh-{$this->sequence}"] = $args['MessageBody'];

        return ['MessageId' => "msg-{$this->sequence}"];
    }

    /**
     * @param array{QueueUrl: string} $args
     * @return array{Messages?: list<array{ReceiptHandle: string, Body: string}>}
     */
    public function receiveMessage(array $args): array
    {
        foreach ($this->queues[$args['QueueUrl']] ?? [] as $handle => $body) {
            return ['Messages' => [['ReceiptHandle' => $handle, 'Body' => $body]]];
        }

        return [];
    }

    /** @param array{QueueUrl: string, ReceiptHandle: string} $args */
    public function deleteMessage(array $args): void
    {
        unset($this->queues[$args['QueueUrl']][$args['ReceiptHandle']]);
    }
}
