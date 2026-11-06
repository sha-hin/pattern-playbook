<?php

declare(strict_types=1);

/**
 * Iterator: the full pattern in plain PHP, no framework.
 * Run it: php examples/iterator.php
 *
 * Roles:
 * - Iterator: PHP's built-in Iterator interface (rewind, valid, current, key, next)
 * - Concrete iterator: CustomerIterator (walks a paginated API, one customer at a time)
 * - Aggregate: PHP's IteratorAggregate (an object that can hand out an iterator)
 * - Concrete aggregate: CrmCustomers (the collection the caller loops over)
 *
 * In Laravel:
 * Illuminate\Support\Collection implements IteratorAggregate and hands out an
 * ArrayIterator; LengthAwarePaginator does the same. LazyCollection wraps a generator
 * (see the Generators card) so huge sources are walked one item at a time.
 */

final class FakeCrmApi                                          // stands in for an HTTP API with pages
{
    public int $requests = 0;

    /** @return array{data: list<array{id: int, email: string}>, has_more: bool} */
    public function customers(int $page, int $perPage): array
    {
        $this->requests++;
        $total = 7;
        $start = ($page - 1) * $perPage;
        $ids = range($start + 1, min($start + $perPage, $total));

        return [
            'data' => array_map(fn (int $id): array => ['id' => $id, 'email' => "customer{$id}@example.com"], $ids),
            'has_more' => $start + $perPage < $total,
        ];
    }
}

final class CustomerIterator implements Iterator               // ★ Concrete iterator: the 5 methods
{
    private int $page = 1;
    private int $index = 0;
    private int $position = 0;
    /** @var list<array{id: int, email: string}> */
    private array $buffer = [];
    private bool $hasMore = true;

    public function __construct(private readonly FakeCrmApi $api, private readonly int $perPage = 3) {}

    public function rewind(): void                              // ★ start from the beginning
    {
        $this->page = 1;
        $this->position = 0;
        $this->load();
    }

    public function valid(): bool                               // ★ is there an item here?
    {
        if ($this->index < count($this->buffer)) {
            return true;
        }
        if (!$this->hasMore) {
            return false;
        }
        $this->page++;                                          // buffer used up: fetch the next page now
        $this->load();

        return $this->buffer !== [];
    }

    public function current(): array                           // ★ the item
    {
        return $this->buffer[$this->index];
    }

    public function key(): int                                  // ★ its position
    {
        return $this->position;
    }

    public function next(): void                                // ★ move forward
    {
        $this->index++;
        $this->position++;
    }

    private function load(): void
    {
        $response = $this->api->customers($this->page, $this->perPage);
        $this->buffer = $response['data'];
        $this->hasMore = $response['has_more'];
        $this->index = 0;
    }
}

final class CrmCustomers implements IteratorAggregate          // ★ Concrete aggregate
{
    public function __construct(private readonly FakeCrmApi $api) {}

    public function getIterator(): Iterator                     // ★ a fresh iterator for each foreach
    {
        return new CustomerIterator($this->api);
    }
}

// ── The caller never sees pages ─────────────────────────────────────────
$api = new FakeCrmApi();

foreach (new CrmCustomers($api) as $i => $customer) {
    echo "{$i}: {$customer['email']}", PHP_EOL;
}
echo "API requests: {$api->requests} (pages of 3)", PHP_EOL;

// Lazy: stopping early fetches fewer pages.
$api->requests = 0;
foreach (new CrmCustomers($api) as $customer) {
    if ($customer['id'] === 2) {
        break;
    }
}
echo "Stopped at customer 2 after {$api->requests} request", PHP_EOL;
