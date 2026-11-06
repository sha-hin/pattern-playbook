<?php

declare(strict_types=1);

/**
 * Transactional Outbox: the full pattern in plain PHP, no framework.
 * Run it: php examples/outbox.php
 *
 * Roles:
 * - Business write + outbox row: ApproveEvaluation (both saved in ONE database transaction)
 * - Outbox: the "outbox" table (messages waiting to be sent: pending → sent, or → failed)
 * - Relay: OutboxRelay (a worker that sends pending messages, retries, and raises an alert when it gives up)
 * - Idempotent receiver: MinistryApi (ignores a message it has already processed)
 * Delivery is "at least once": a message can arrive twice, never zero times, so the receiver must
 * ignore repeats. With several workers on MySQL 8 / PostgreSQL, pick rows with
 * SELECT ... FOR UPDATE SKIP LOCKED inside a transaction so two workers never take the same row.
 *
 * In Laravel:
 * With the "database" queue driver, a queued job is just a row in the jobs table. Dispatch a
 * job inside DB::transaction() on the same connection, and the job row is saved in the SAME
 * transaction as your data: the jobs table becomes your outbox, queue:work is the relay, and
 * jobs that run out of $tries land in failed_jobs (watch it, or alert on the JobFailed event).
 */

/** Stands in for a real alert channel (Slack, Sentry, PagerDuty...). */
final class Alerts
{
    public function critical(string $message): void
    {
        echo "[ALERT] {$message}\n";
    }
}

// ── The external system. Unreliable, like real APIs. ──
final class MinistryApi
{
    /** @var array<string, true> */
    private array $alreadyReceived = [];

    /** @var array<int, int> evaluation id => how many calls fail before it works */
    private array $failuresLeft = [42 => 1, 43 => 99];

    public function sync(int $evaluationId, string $key): void
    {
        if (($this->failuresLeft[$evaluationId] ?? 0) > 0) {
            $this->failuresLeft[$evaluationId]--;
            throw new RuntimeException('503 Service Unavailable');
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
final class ApproveEvaluation
{
    public function __construct(private readonly PDO $db)
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
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}

// ── Step 2: the relay. A worker that runs every minute. ──
final class OutboxRelay                                     // ★ Relay
{
    public const MAX_ATTEMPTS = 3;

    public function __construct(
        private readonly PDO $db,
        private readonly MinistryApi $api,
        private readonly Alerts $alerts,
    ) {
    }

    public function run(): void
    {
        $rows = $this->db->query("SELECT * FROM outbox WHERE status = 'pending' ORDER BY id")->fetchAll();

        foreach ($rows as $row) {
            try {
                $this->api->sync((int) $row['evaluation_id'], (string) $row['message_key']);
                $this->markSent((int) $row['id']);
            } catch (Throwable $e) {
                $this->recordFailure($row, $e);
            }
        }
    }

    private function markSent(int $id): void
    {
        $sent = $this->db->prepare("UPDATE outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?");
        $sent->execute([$id]);
    }

    /** @param array<string, mixed> $row */
    private function recordFailure(array $row, Throwable $e): void
    {
        $attempts = (int) $row['attempts'] + 1;
        $status = $attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending';   // ★ give up after N tries...

        $update = $this->db->prepare('UPDATE outbox SET attempts = ?, last_error = ?, status = ? WHERE id = ?');
        $update->execute([$attempts, $e->getMessage(), $status, $row['id']]);

        if ($status === 'failed') {                         // ★ ...but NEVER silently
            $this->alerts->critical("Outbox message {$row['message_key']} failed {$attempts} times: {$e->getMessage()}");

            return;
        }

        echo "Relay: {$row['message_key']} attempt {$attempts} failed, will retry ({$e->getMessage()})\n";
    }
}

// ── Setup: an in-memory SQLite database ──
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->exec("CREATE TABLE evaluations (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'submitted')");
$db->exec("CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_key TEXT NOT NULL UNIQUE,
    evaluation_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT
)");
$db->exec('INSERT INTO evaluations (id) VALUES (42), (43)');

$relay = new OutboxRelay($db, new MinistryApi(), new Alerts());
$approve = new ApproveEvaluation($db);

// ── Using it ──
$approve->handle(42);                                       // the request saves both, sends nothing
$approve->handle(43);                                       // this one will never get through

$relay->run();                                              // minute 1: the API is down for both
$relay->run();                                              // minute 2: 42 delivered, 43 fails again
$relay->run();                                              // minute 3: 43 gives up and raises an alert

// If the worker crashed after sending 42 but before marking it sent, it would send it again:
$db->exec("UPDATE outbox SET status = 'pending' WHERE evaluation_id = 42");
$relay->run();                                              // the receiver ignores the repeat
