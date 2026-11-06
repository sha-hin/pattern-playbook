// Scene 11 · Iterator and Generators: nightly reconciliation with Stripe.

export default {
  description: 'Stripe and Nordic Stays disagreed by €40 and nobody noticed for a month. Build a nightly reconciliation in Laravel that walks Stripe’s pages and our table with iterators, compares them in a generator, and never loads everything into memory.',
  incident: {
    channel: '#finance',
    when: 'Friday 09:05',
    messages: [
      ['Lina · finance', 'October closing. Stripe says we refunded **€40.00 more** than our system shows. I’ve been through 1,900 refunds by hand and can’t find it.'],
      ['Mona · support', 'Oh. A guest complained about a broken heater on the 12th and I refunded €40 straight from the Stripe dashboard. Was I not supposed to?'],
    ],
  },
  sections: [
    {
      title: 'What went wrong',
      text: [
        'No code is broken here. Money moved in Stripe without passing through our app, and nothing compares the two. It could just as well have been the other way round: a webhook that failed for good (scene 8) leaves a payment that succeeded in Stripe and is still pending here.',
        'The fix is a **reconciliation**: every night, compare yesterday in Stripe with yesterday in our database, and write down every difference. The first attempt at it looked like this:',
      ],
      blocks: [
        {
          path: 'app/Console/Commands/ReconcileRefunds.php (first attempt)',
          broken: true, fragment: true,
          code: String.raw`$ours = Refund::whereDate('created_at', $day)->get();                        // every row, at once
$theirs = $stripe->refunds->all(['created' => ['gte' => $from, 'lt' => $to]]);   // only the first 10!

foreach ($theirs->data as $refund) {
    if (! $ours->contains('provider_refund_id', $refund->id)) { /* ... */ }      // a full scan per refund
}`,
          after: [
            'Three problems. Stripe returns **one page** (10 by default, 100 at most), so on a busy day most refunds are never looked at, and the report says "all good". `get()` loads every row and model into memory at once. And `contains()` scans the whole collection for every Stripe refund.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: walk Stripe’s pages as one sequence',
      text: [
        'Stripe’s SDK can walk all pages for you: `autoPagingIterator()` fetches page after page as you loop. Wrapped in a **generator** (a function with `yield`), each refund comes out as our own small array with a `Money` in it, one at a time. Only one page is ever in memory.',
        'It goes into the gateway from scene 5, so the reconciliation depends on the interface and tests can hand it a plain array.',
      ],
      blocks: [
        {
          path: 'app/Payments/PaymentGateway.php (one method added)',
          fragment: true,
          code: String.raw`/** @return iterable<array{id: string, payment_intent: string, amount: Money}> every refund created in [from, to) */
public function refundsBetween(CarbonImmutable $from, CarbonImmutable $to): iterable;`,
        },
        {
          path: 'app/Payments/StripeGateway.php (added)',
          fragment: true,
          code: String.raw`public function refundsBetween(CarbonImmutable $from, CarbonImmutable $to): iterable
{
    $pages = $this->stripe->refunds->all([
        'created' => ['gte' => $from->getTimestamp(), 'lt' => $to->getTimestamp()],
        'limit' => 100,                                           // the largest page Stripe allows
    ]);

    foreach ($pages->autoPagingIterator() as $refund) {           // fetches the next page when this one runs out
        yield [
            'id' => $refund->id,
            'payment_intent' => (string) $refund->payment_intent,
            'amount' => Money::of($refund->amount, strtoupper($refund->currency)),
        ];
    }
}`,
          after: ['Because of the `yield`, calling `refundsBetween()` runs **none** of this yet. It returns a `Generator`; the code inside runs a little at a time, each time the caller’s `foreach` asks for the next item.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: compare two sequences in a generator',
      text: [
        'The comparison only needs **ids and amounts** from our side, so it keeps just those in a small array keyed by Stripe’s refund id: a key lookup is instant, where `contains()` scanned everything. Then it streams Stripe’s refunds past it and **yields** each difference as soon as it finds one.',
        'It takes `iterable` on both sides: a Stripe generator, a `LazyCollection` from Eloquent, or a plain array in a test. That’s the point of iterators: the code that loops doesn’t care where the items come from.',
      ],
      blocks: [
        {
          path: 'app/Payments/Reconciliation/Difference.php',
          code: String.raw`<?php

namespace App\Payments\Reconciliation;

final readonly class Difference
{
    public function __construct(
        public string $kind,                          // missing_here, missing_at_stripe, amount_mismatch
        public string $refundId,
        public string $details,
    ) {
    }
}`,
        },
        {
          path: 'app/Payments/Reconciliation/RefundComparison.php',
          code: String.raw`<?php

namespace App\Payments\Reconciliation;

use App\Models\Refund;
use App\Money\Money;
use Generator;

final class RefundComparison
{
    /**
     * @param iterable<array{id: string, payment_intent: string, amount: Money}> $stripe
     * @param iterable<Refund> $ours
     * @return Generator<int, Difference>
     */
    public function differences(iterable $stripe, iterable $ours): Generator
    {
        $known = [];                                                  // provider_refund_id => Money
        foreach ($ours as $refund) {
            $known[$refund->provider_refund_id] = Money::of($refund->amount_cents, $refund->currency);
        }

        foreach ($stripe as $theirs) {
            $mine = $known[$theirs['id']] ?? null;
            unset($known[$theirs['id']]);                             // whatever is left at the end, Stripe doesn't have

            if ($mine === null) {
                yield new Difference('missing_here', $theirs['id'], "Refunded {$theirs['amount']->format()} in Stripe (payment {$theirs['payment_intent']}), not recorded here.");
            } elseif (! $mine->equals($theirs['amount'])) {
                yield new Difference('amount_mismatch', $theirs['id'], "Stripe {$theirs['amount']->format()}, here {$mine->format()}.");
            }
        }

        foreach ($known as $refundId => $amount) {
            yield new Difference('missing_at_stripe', $refundId, "Recorded here as {$amount->format()}, not found in Stripe.");
        }
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: the nightly command',
      text: [
        '`lazyById()` reads our refunds 1,000 rows at a time, ordered by id, and hands them out one by one through a `LazyCollection`: the comparison sees one long sequence, while memory holds one batch. Every difference becomes a row finance can work through.',
        '"Yesterday" means yesterday in UTC, the timezone everything is stored in. Running at 03:10 leaves time for late webhooks to land first.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_02_06_000001_create_reconciliation_issues_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reconciliation_issues', function (Blueprint $table) {
            $table->id();
            $table->date('day');
            $table->string('kind');
            $table->string('provider_id');                        // the Stripe refund id
            $table->text('details');
            $table->timestamp('resolved_at')->nullable();         // set by finance once explained
            $table->timestamps();
            $table->unique(['day', 'kind', 'provider_id']);        // re-running a night adds nothing twice
        });
    }
};`,
        },
        {
          path: 'app/Console/Commands/ReconcileRefunds.php',
          code: String.raw`<?php

namespace App\Console\Commands;

use App\Models\Refund;
use App\Payments\PaymentGateway;
use App\Payments\Reconciliation\RefundComparison;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ReconcileRefunds extends Command
{
    protected $signature = 'payments:reconcile-refunds {--day= : Y-m-d, defaults to yesterday (UTC)}';

    protected $description = 'Compare one day of refunds in Stripe with the refunds table';

    public function handle(PaymentGateway $gateway, RefundComparison $comparison): int
    {
        $from = $this->option('day') ? CarbonImmutable::parse($this->option('day'), 'UTC') : now()->subDay()->startOfDay();
        $to = $from->addDay();

        $ours = Refund::query()->where('created_at', '>=', $from)->where('created_at', '<', $to)->lazyById(1_000);
        $found = 0;

        foreach ($comparison->differences($gateway->refundsBetween($from, $to), $ours) as $difference) {
            DB::table('reconciliation_issues')->insertOrIgnore([                // unique index: no duplicates on a re-run
                'day' => $from->toDateString(),
                'kind' => $difference->kind,
                'provider_id' => $difference->refundId,
                'details' => $difference->details,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $found++;
        }

        $this->info("{$found} difference(s) for {$from->toDateString()}.");

        return self::SUCCESS;                                   // differences are findings, not a failed run
    }
}`,
        },
        {
          path: 'routes/console.php (added)',
          fragment: true,
          code: String.raw`Schedule::command('payments:reconcile-refunds')->dailyAt('03:10')->withoutOverlapping();`,
          after: ['The same pattern reconciles PaymentIntents (succeeded in Stripe, still pending here) with a second generator in the gateway. And when Nordic Stays starts paying hosts their share through Stripe Connect transfers, the payouts get a reconciliation of their own: every amount that leaves is compared, every night, in its own currency.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Iterator', 'Generators'],
    rules: [
      ['Iterator', 'A way to go through a collection one item at a time without knowing how it is stored: a database table in batches, an API in pages, or an array.'],
      ['Generator', 'A function that uses yield to hand out values one by one, pausing between them. In PHP, the shortest way to write an iterator.'],
    ],
    points: [
      'Three different sources (Stripe’s pages, our table in batches, plain arrays in the tests) all reach the comparison as one `iterable`. It loops; it never paginates.',
      'Nothing runs until someone loops: a generator is **lazy**. A command that stopped at the first difference would never fetch the rest of Stripe’s pages.',
      'Memory stays flat: one Stripe page, one batch of rows, and the small id-to-amount array, whether the day has 50 refunds or 50,000.',
    ],
    whenNot: [
      'Small, bounded data (the 12 months of a year, a property’s 5 rate rules): a plain array or `get()` is simpler.',
      'A generator can be looped **once**. If two loops need the same items, collect them first.',
    ],
  },
  laravel: {
    title: 'Laravel inside: lazyById() is a generator',
    text: ['`lazyById()` builds a `LazyCollection` around a generator. The generator asks for one page after the last id it saw (`WHERE id > ? ORDER BY id LIMIT 1000`), yields its rows one by one, and stops at a short page.'],
    blocks: [
      {
        path: 'Illuminate/Database/Concerns/BuildsQueries.php (simplified)',
        fragment: true,
        code: String.raw`protected function orderedLazyById($chunkSize = 1000, $column = null, $alias = null, $descending = false)
{
    return LazyCollection::make(function () use ($chunkSize, $column, $alias, $descending) {
        $lastId = null;

        while (true) {
            $clone = clone $this;
            $results = $clone->forPageAfterId($chunkSize, $lastId, $column)->get();   // WHERE id > $lastId LIMIT 1000

            foreach ($results as $result) {
                yield $result;                                                       // one row at a time
            }

            if ($results->count() < $chunkSize) {
                return;                                                              // a short page: the end
            }

            $lastId = $results->last()->{$alias};
        }
    });
}`,
      },
      {
        title: 'Which one to use',
        table: [
          ['Method', 'Memory', 'Watch out for'],
          ['`get()`', 'Every row at once', 'Fine for small results only'],
          ['`chunkById(1000, fn)`', 'One batch', 'You work in batches inside a closure'],
          ['`lazyById(1000)`', 'One batch', 'Nothing: one row at a time, by id. Safe when rows change while you loop'],
          ['`cursor()`', 'One model at a time in PHP', 'MySQL’s PDO buffers the **whole result** in the driver by default, so memory still grows with the table'],
          ['`chunk()` / `lazy()` (by offset)', 'One batch', 'Skips or repeats rows if the loop updates the column it filters on'],
        ],
      },
    ],
  },
  tests: {
    summary: 'The comparison with plain arrays, and the command end to end',
    blocks: [
      {
        path: 'tests/Unit/RefundComparisonTest.php',
        code: String.raw`<?php

use App\Models\Refund;
use App\Money\Money;
use App\Payments\Reconciliation\Difference;
use App\Payments\Reconciliation\RefundComparison;

function ourRefund(string $id, int $cents): Refund
{
    return new Refund(['provider_refund_id' => $id, 'amount_cents' => $cents, 'currency' => 'EUR']);
}

function stripeRefund(string $id, int $cents): array
{
    return ['id' => $id, 'payment_intent' => 'pi_1', 'amount' => Money::of($cents, 'EUR')];
}

it('finds every kind of difference', function () {
    $differences = iterator_to_array((new RefundComparison())->differences(
        stripe: [stripeRefund('re_same', 5_000), stripeRefund('re_dashboard', 4_000), stripeRefund('re_changed', 2_000)],
        ours: [ourRefund('re_same', 5_000), ourRefund('re_changed', 2_500), ourRefund('re_lost', 900)],
    ), preserve_keys: false);

    expect(array_map(fn (Difference $d): array => [$d->kind, $d->refundId], $differences))->toBe([
        ['missing_here', 're_dashboard'],                     // the incident: refunded in the Stripe dashboard
        ['amount_mismatch', 're_changed'],
        ['missing_at_stripe', 're_lost'],
    ]);
});

it('finds nothing when both sides agree', function () {
    $differences = (new RefundComparison())->differences([stripeRefund('re_1', 100)], [ourRefund('re_1', 100)]);

    expect(iterator_to_array($differences))->toBe([]);
});`,
      },
      {
        path: 'tests/Feature/ReconcileRefundsTest.php',
        code: String.raw`<?php

use App\Money\Money;
use App\Payments\PaymentGateway;
use Illuminate\Support\Facades\DB;
use Tests\Fakes\FakePaymentGateway;

it('records the dashboard refund as an issue, once, however often it runs', function () {
    $gateway = new FakePaymentGateway();
    $gateway->stripeRefunds = [['id' => 're_dashboard', 'payment_intent' => 'pi_1', 'amount' => Money::of(4_000, 'EUR')]];
    $this->app->instance(PaymentGateway::class, $gateway);

    $this->artisan('payments:reconcile-refunds')->expectsOutput('1 difference(s) for 2027-05-31.')->assertSuccessful();
    $this->artisan('payments:reconcile-refunds')->assertSuccessful();

    expect(DB::table('reconciliation_issues')->pluck('provider_id')->all())->toBe(['re_dashboard']);
});`,
        after: ['The fake gains a public `$stripeRefunds` array and returns it from `refundsBetween()`. An array is an `iterable`, which is all the command asks for.'],
      },
    ],
  },
  next: 'Day 2 is done: prices, webhooks, the booking lifecycle, refunds and reconciliation. Day 3 starts on Monday, when dates a host blocked on Airbnb never reach Nordic Stays.',
};
