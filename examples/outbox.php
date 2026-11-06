<?php

declare(strict_types=1);

/**
 * Transactional Outbox: the full pattern in plain PHP, no framework.
 * Run it: php examples/outbox.php
 *
 * Roles:
 * - Business write + outbox row: ApproveEvaluation (both saved in ONE database transaction)
 * - Outbox: the "outbox" table (messages waiting to be sent)
 * - Relay: OutboxRelay (a worker that sends waiting messages and retries failures)
 * - Idempotent receiver: MinistryApi (ignores a message it has already processed)
 *
 * In Laravel:
 * With the "database" queue driver, a queued job is just a row in the jobs table. Dispatch a
 * job inside DB::transaction() on the same connection, and the job row is saved in the SAME
 * transaction as your data: the jobs table becomes your outbox, and queue:work is the relay.
 */

// ── The external system. Unreliable, like real APIs. ──
class MinistryApi
{
    private array $alreadyReceived = [];
    private int $calls = 0;

    public function sync(int $evaluationId, string $key): void
    {
        $this->calls++;
        if ($this->calls === 1) {
            throw new RuntimeException('Ministry API: 503 Service Unavailable');
        }

        if (isset($this->alreadyReceived[$key])) {          // ★ idempotent: a repeat does nothing
            echo "Ministry: already have {$key}, ignored\n";

            return;
        }

        $this->alreadyReceived[$key] = true;
        echo "Ministry: received evaluation {$evaluationId}\n";
    }
}

// ── Step 1: save the data AND the message in one transaction ──
class ApproveEvaluation
{
    public function __construct(private PDO $db)
    {
    }

    public function handle(int $evaluationId): void
    {
        $this->db->beginTransaction();                      // ★ ONE transaction for both writes

        try {
            $approve = $this->db->prepare("UPDATE evaluations SET status = 'approved' WHERE id = ?");
            $approve->execute([$evaluationId]);

            $message = $this->db->prepare('INSERT INTO outbox (message_key, evaluation_id) VALUES (?, ?)');
            $message->execute(["ministry-sync:{$evaluationId}", $evaluationId]);   // ★ the message, saved with the data

            $this->db->commit();                            // both are saved, or neither is
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}

// ── Step 2: the relay. A worker that runs every minute. ──
class OutboxRelay                                           // ★ Relay
{
    public function __construct(private PDO $db, private MinistryApi $api)
    {
    }

    public function run(): void
    {
        $rows = $this->db->query('SELECT * FROM outbox WHERE sent_at IS NULL AND attempts < 10')->fetchAll();

        foreach ($rows as $row) {
            try {
                $this->api->sync((int) $row['evaluation_id'], $row['message_key']);

                $sent = $this->db->prepare("UPDATE outbox SET sent_at = datetime('now') WHERE id = ?");
                $sent->execute([$row['id']]);
            } catch (Exception $e) {
                $failed = $this->db->prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?');
                $failed->execute([$e->getMessage(), $row['id']]);
                echo "Relay: will retry next minute ({$e->getMessage()})\n";
            }
        }
    }
}

// ── Setup: an in-memory SQLite database ──
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->exec("CREATE TABLE evaluations (id INTEGER PRIMARY KEY, status TEXT DEFAULT 'submitted')");
$db->exec('CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_key TEXT NOT NULL UNIQUE,
    evaluation_id INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT
)');
$db->exec('INSERT INTO evaluations (id) VALUES (42)');

$relay = new OutboxRelay($db, new MinistryApi());

// ── Using it ──
(new ApproveEvaluation($db))->handle(42);                   // the request saves both, sends nothing

$relay->run();                                              // minute 1: the API is down
$relay->run();                                              // minute 2: delivered

// If the worker crashed after sending but before marking it sent, it would send it again:
$db->exec('UPDATE outbox SET sent_at = NULL');
$relay->run();                                              // the receiver ignores the repeat
