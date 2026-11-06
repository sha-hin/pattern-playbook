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
 *
 * In Laravel:
 * Collection implements IteratorAggregate: its getIterator() returns a new ArrayIterator over
 * its items, which is why foreach works on collections. Paginators do the same with the
 * items of the current page.
 */

// ── A fake API that returns customers 3 at a time (like a real paginated API) ──
class FakeCrmApi
{
    public int $requests = 0;

    public function page(int $page): array
    {
        $this->requests++;
        $all = ['ali@x.com', 'mona@x.com', 'omar@x.com', 'laila@x.com', 'sara@x.com', 'adam@x.com', 'nour@x.com'];

        return array_slice($all, ($page - 1) * 3, 3);       // 3 customers per page
    }
}

// ── Step 1: the concrete iterator. PHP calls these 5 methods for you in foreach. ──
class CustomerIterator implements Iterator                  // ★ Concrete iterator
{
    private int $page = 1;
    private array $current = [];                            // the customers of the current page
    private int $index = 0;                                 // position inside the current page
    private int $position = 0;                              // position overall

    public function __construct(private FakeCrmApi $api)
    {
    }

    public function rewind(): void                          // ★ 1. start from the beginning
    {
        $this->page = 1;
        $this->current = $this->api->page(1);
        $this->index = 0;
        $this->position = 0;
    }

    public function valid(): bool                           // ★ 2. is there a customer here?
    {
        if ($this->index >= count($this->current) && count($this->current) === 3) {
            $this->page++;                                  // page used up: fetch the next one now
            $this->current = $this->api->page($this->page);
            $this->index = 0;
        }

        return $this->index < count($this->current);
    }

    public function current(): mixed                        // ★ 3. give me the customer
    {
        return $this->current[$this->index];
    }

    public function key(): mixed                            // ★ 4. give me its position
    {
        return $this->position;
    }

    public function next(): void                            // ★ 5. move forward
    {
        $this->index++;
        $this->position++;
    }
}

// ── Step 2: the aggregate. What the caller loops over. ──
class CrmCustomers implements IteratorAggregate             // ★ Concrete aggregate
{
    public function __construct(private FakeCrmApi $api)
    {
    }

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
