<?php

declare(strict_types=1);

/**
 * Iterator: the full pattern in plain PHP, no framework.
 * Run it: php examples/iterator.php
 *
 * Roles:
 * - Iterator: PHP's built-in Iterator interface (5 methods: rewind, valid, current, key, next)
 * - Concrete iterator: CustomerIterator (walks a paginated API one customer at a time)
 * - Aggregate: PHP's built-in IteratorAggregate (an object that hands out an iterator)
 * - Concrete aggregate: CrmCustomers (what the caller loops over with foreach)
 * foreach calls them in this order: rewind() → valid() → current() / key() → next() → valid() ...
 *
 * In Laravel:
 * Collection implements IteratorAggregate: its getIterator() returns a new ArrayIterator over
 * its items, which is why foreach works on collections. Paginators do the same with the
 * items of the current page.
 */

// ── A fake API that returns customers one page at a time (like a real paginated API) ──
final class FakeCrmApi
{
    public const PAGE_SIZE = 3;

    public int $requests = 0;

    /** @return list<string> an empty list when there are no more customers */
    public function page(int $page): array
    {
        $this->requests++;
        $all = ['ali@x.com', 'mona@x.com', 'omar@x.com', 'laila@x.com', 'sara@x.com', 'adam@x.com', 'nour@x.com'];

        return array_slice($all, ($page - 1) * self::PAGE_SIZE, self::PAGE_SIZE);
    }
}

// ── Step 1: the concrete iterator. PHP calls these 5 methods for you in foreach. ──
/** @implements Iterator<int, string> */
final class CustomerIterator implements Iterator            // ★ Concrete iterator
{
    private int $page = 1;

    /** @var list<string> */
    private array $items = [];                              // the customers of the current page

    private int $index = 0;                                 // position inside the current page
    private int $position = 0;                              // position overall

    public function __construct(private readonly FakeCrmApi $api)
    {
    }

    public function rewind(): void                          // ★ 1. start from the beginning
    {
        $this->page = 1;
        $this->items = $this->api->page($this->page);
        $this->index = 0;
        $this->position = 0;
    }

    public function valid(): bool                           // ★ 2. is there a customer here? (only answers, never fetches)
    {
        return $this->index < count($this->items);
    }

    public function current(): string                       // ★ 3. give me the customer
    {
        return $this->items[$this->index];
    }

    public function key(): int                              // ★ 4. give me its position
    {
        return $this->position;
    }

    public function next(): void                            // ★ 5. move forward, fetching the next page when needed
    {
        $this->index++;
        $this->position++;

        $pageUsedUp = $this->index >= count($this->items);
        $pageWasFull = count($this->items) === FakeCrmApi::PAGE_SIZE;   // a short page means it was the last one

        if ($pageUsedUp && $pageWasFull) {
            $this->page++;
            $this->items = $this->api->page($this->page);
            $this->index = 0;
        }
    }
}

// ── Step 2: the aggregate. What the caller loops over. ──
/** @implements IteratorAggregate<int, string> */
final class CrmCustomers implements IteratorAggregate       // ★ Concrete aggregate
{
    public function __construct(private readonly FakeCrmApi $api)
    {
    }

    /** @return Iterator<int, string> */
    public function getIterator(): Iterator                 // ★ a fresh iterator for every foreach
    {
        return new CustomerIterator($this->api);
    }
}

// ── Using it: the caller never sees pages ──
$api = new FakeCrmApi();

foreach (new CrmCustomers($api) as $number => $email) {
    echo "{$number}: {$email}\n";
}
echo "API requests: {$api->requests}\n";

// It's lazy: stopping early means fewer requests.
$api->requests = 0;
foreach (new CrmCustomers($api) as $email) {
    if ($email === 'mona@x.com') {
        break;
    }
}
echo "Stopped at Mona after {$api->requests} request\n";
