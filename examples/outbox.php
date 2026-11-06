<?php

declare(strict_types=1);

/**
 * Transactional Outbox: the full pattern in plain PHP, no framework.
 * Run it: php examples/outbox.php
 *
 * Roles:
 * - Business write + outbox row: ApproveEvaluation (both in ONE database transaction)
 * - Outbox: the "outbox" table (messages waiting to be sent)
 * - Relay: OutboxRelay (a worker: sends unsent rows, retries, records failures)
 * - Idempotent receiver: MinistryApi (ignores a message it already processed)
 *
 * In Laravel:
 * Not built in. DB::afterCommit() and $afterCommit on queued jobs stop messages for
 * rolled-back data, but a crash right after the commit can still lose them. An outbox
 * table plus a scheduled worker, as below, closes that gap.
 */

final class MinistryApi                                         // the external system (unreliable)
{
    /** @var array<string, true> */
    private array $seen = [];

    private int $calls = 0;

    public function sync(array $payload, string $idempotencyKey): void
    {
        if (++$this->calls === 1) {
            throw new RuntimeException('Ministry API: 503 Service Unavailable');
        }
        if (isset($this->seen[$idempotencyKey])) {              // ★ idempotent: a repeat does nothing
            echo "Ministry: already have {$idempotencyKey}, ignored", PHP_EOL;

            return;
        }
        $this->seen[$idempotencyKey] = true;
        echo "Ministry: received evaluation {$payload['evaluation_id']}", PHP_EOL;
    }
}

final class ApproveEvaluation
{
    public function __construct(private readonly PDO $db) {}

    public function handle(int $evaluationId): void
    {
        $this->db->beginTransaction();                          // ★ ONE transaction for both writes
        try {
            $this->db->prepare("UPDATE evaluations SET status = 'approved' WHERE id = ?")->execute([$evaluationId]);
            $this->db->prepare(
                'INSERT INTO outbox (idempotency_key, payload, attempts) VALUES (?, ?, 0)'   // ★ the message, saved with the data
            )->execute(["ministry-sync:{$evaluationId}", json_encode(['evaluation_id' => $evaluationId])]);
            $this->db->commit();                                // both saved, or neither
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}

final class OutboxRelay                                         // ★ Relay: runs every minute
{
    public function __construct(
        private readonly PDO $db,
        private readonly MinistryApi $api,
        private readonly int $maxAttempts = 10,
    ) {}

    public function run(): void
    {
        $rows = $this->db->prepare('SELECT * FROM outbox WHERE sent_at IS NULL AND attempts < ? ORDER BY id LIMIT 100');
        $rows->execute([$this->maxAttempts]);

        foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $row) {
            try {
                $this->api->sync(json_decode($row['payload'], true, 8, JSON_THROW_ON_ERROR), $row['idempotency_key']);
                $this->db->prepare("UPDATE outbox SET sent_at = datetime('now') WHERE id = ?")->execute([$row['id']]);
            } catch (Throwable $e) {
                $this->db->prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?')
                    ->execute([substr($e->getMessage(), 0, 1000), $row['id']]);
                echo "Relay: will retry ({$e->getMessage()})", PHP_EOL;   // a real app logs this
            }
        }
    }
}

// ── Setup ───────────────────────────────────────────────────────────────
$db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec("CREATE TABLE evaluations (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'submitted')");
$db->exec('CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE,
           payload TEXT NOT NULL, attempts INTEGER NOT NULL, last_error TEXT, sent_at TEXT)');
$db->exec('INSERT INTO evaluations (id) VALUES (42)');

$api = new MinistryApi();
$relay = new OutboxRelay($db, $api);

// ── The request: saves both, sends nothing ──────────────────────────────
(new ApproveEvaluation($db))->handle(42);

$relay->run();                                                  // minute 1: the API is down
$relay->run();                                                  // minute 2: delivered

// A crash after sending but before marking it sent would send it again:
$db->exec('UPDATE outbox SET sent_at = NULL');
$relay->run();                                                  // the receiver ignores the repeat
