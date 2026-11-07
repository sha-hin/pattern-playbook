// Scene 38 · Load: measure with k6, read the plan, add the index, move searches to a read replica.

export default {
  description: 'On the busiest booking evening of the year, search slowed to eight seconds at the 99th percentile and bookings timed out with it: every search scanned the whole properties table, on the same database server that takes the bookings. Reproduce it with k6, find it with EXPLAIN, fix it with one composite index, and move reads to a replica with Laravel’s read/write connections, keeping the booking decisions on the primary.',
  incident: {
    channel: '#incidents',
    when: 'Sunday 20:15',
    messages: [
      ['Monitoring', '**search p99 = 8.2 s** (normal: 180 ms) · **MySQL primary CPU 96%** · 412 searches/s'],
      ['Mona · support', 'Summer opened for booking on Friday, and Sunday evening is when families book it. Guests say search hangs, and some payments time out at checkout.'],
      ['Karim · developer', 'The slow query log is full of the search query. Every one of them reads all 21,000 properties.'],
    ],
  },
  sections: [
    {
      title: 'Measure first: reproduce the load',
      text: [
        'Guessing at performance is how teams add the wrong index. The first step is to make the problem happen on purpose, somewhere safe: a staging server with a copy of production’s data (21,000 properties, 2.1 million bookings, guest names replaced). k6 sends searches at a fixed rate, like real traffic, and reports how long they took.',
      ],
      blocks: [
        {
          path: 'loadtests/search.js',
          lang: 'js',
          code: String.raw`import http from 'k6/http';
import { check } from 'k6';

export const options = {
    scenarios: {
        sunday_peak: {
            executor: 'constant-arrival-rate',    // 400 searches every second, however slow the answers get
            rate: 400,
            timeUnit: '1s',
            duration: '5m',
            preAllocatedVUs: 300,
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<300', 'p(99)<800'],   // the run fails if search is slower than this
    },
};

const cities = ['Copenhagen', 'Aarhus', 'Skagen', 'Rørvig', 'Odense', 'Bornholm'];

export default function () {
    const city = cities[Math.floor(Math.random() * cities.length)];
    const response = http.get(` + '`${__ENV.BASE_URL}/api/v1/search?city=${encodeURIComponent(city)}&check_in=2027-07-12&check_out=2027-07-19&guests=4`' + String.raw`);

    check(response, { 'status is 200': (r) => r.status === 200 });
}`,
          after: ['`constant-arrival-rate` matters: a test where each virtual user waits for its answer before the next request sends **fewer** requests as the server slows down, and hides the problem. Real guests don’t wait for each other.'],
        },
        {
          path: 'terminal',
          lang: 'shell',
          code: String.raw`k6 run -e BASE_URL=https://staging.nordicstays.com loadtests/search.js`,
        },
        {
          table: [
            ['Run', 'p50', 'p95', 'p99', 'Primary CPU'],
            ['Before', '1.9 s', '6.4 s', '8.6 s', '97%'],
          ],
          after: [
            '**p50** is the median: half the searches were faster. **p95** and **p99**: 95% and 99% were faster than this. The averages of a slow system look fine; the 99th percentile is what one guest in a hundred lives through, and on Sunday that was four guests every second.',
          ],
        },
      ],
    },
    {
      title: 'The broken code',
      text: ['The slow query log and `EXPLAIN` point at the same line. The search from scene 30 filters by city first:'],
      blocks: [
        {
          path: 'mysql',
          lang: 'sql',
          code: String.raw`EXPLAIN SELECT id, name, city, max_guests FROM properties
WHERE city = 'Copenhagen' AND max_guests >= 4
  AND NOT EXISTS (SELECT 1 FROM bookings WHERE bookings.property_id = properties.id AND status IN ('pending', 'confirmed') AND check_in < '2027-07-19' AND check_out > '2027-07-12')
  AND NOT EXISTS (SELECT 1 FROM external_blocks WHERE external_blocks.property_id = properties.id AND starts_on < '2027-07-19' AND ends_on > '2027-07-12')
ORDER BY name LIMIT 50;`,
        },
        {
          broken: true,
          table: [
            ['table', 'type', 'key', 'rows', 'Extra'],
            ['properties', '**ALL**', '(none)', '21,384', '**Using where; Using filesort**'],
            ['bookings', 'ref', 'bookings_property_id_status_check_in_check_out_index', '4', 'Using where; Using index'],
            ['external_blocks', 'ref', 'external_blocks_property_id_starts_on_ends_on_index', '2', 'Using where; Using index'],
          ],
          after: [
            '**type ALL** means MySQL reads every row of `properties` to find the ones in Copenhagen: the table has no index on `city` (the Foundation only indexed `account_id`). **Using filesort** means it then sorts the matches by name, by hand. The two subqueries are fine: they use their indexes (scene 30 and 32).',
            'At 400 searches a second that is 8.5 million rows read every second, on the server that also takes every booking, payment and iCal sync. Search didn’t just get slow; it took the CPU the bookings needed.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: one index that answers the WHERE and the ORDER BY',
      text: [
        'An index on `(city, name)` lets MySQL jump to Copenhagen and read its properties **already sorted by name**, so the sort disappears and it can stop as soon as it has 50 rows that pass the other conditions. `max_guests` stays out of it: as a range condition (`>=`), it would stop the index from also delivering the order.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_05_03_000001_add_city_index_to_properties_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->index(['city', 'name']);                            // WHERE city = ? ORDER BY name, straight from the index
        });
    }

    public function down(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->dropIndex(['city', 'name']);
        });
    }
};`,
          after: ['MySQL 8 adds an index to a live InnoDB table **online**: reads and writes continue while it builds, a few seconds for 21,000 rows. Scene 40 covers the changes that are *not* online, which is where migrations go wrong.'],
        },
        {
          table: [
            ['table', 'type', 'key', 'rows', 'Extra'],
            ['properties', 'ref', 'properties_city_name_index', '1,210', 'Using where'],
          ],
          after: ['**ref** on the new index, no filesort, and MySQL stops reading after the first 50 matches. Per search: about 120 rows read instead of 21,384.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: reads go to a replica, decisions stay on the primary',
      text: [
        'Even fast searches are 400 queries a second that have nothing to do with taking bookings. A **read replica** is a second MySQL server that copies every change from the primary, usually within a second, and can answer `SELECT`s. Laravel sends reads there and writes to the primary when the connection has a `read` and a `write` host.',
        'In `config/database.php`, replace the `mysql` entry inside `connections` with this one. The other connections stay as they are:',
      ],
      blocks: [
        {
          path: 'config/database.php (the mysql entry under connections)',
          fragment: true,
          code: String.raw`'mysql' => [
    'driver' => 'mysql',
    'read' => [
        'host' => [env('DB_READ_HOST', env('DB_HOST', '127.0.0.1'))],  // the replica; locally the same server
    ],
    'write' => [
        'host' => [env('DB_HOST', '127.0.0.1')],                         // the primary
    ],
    'sticky' => true,                       // after a write, the same request keeps reading from the primary
    'port' => env('DB_PORT', '3306'),
    'database' => env('DB_DATABASE', 'laravel'),
    'username' => env('DB_USERNAME', 'root'),
    'password' => env('DB_PASSWORD', ''),
    'unix_socket' => env('DB_SOCKET', ''),
    'charset' => env('DB_CHARSET', 'utf8mb4'),
    'collation' => env('DB_COLLATION', 'utf8mb4_unicode_ci'),
    'prefix' => '',
    'prefix_indexes' => true,
    'strict' => true,
    'engine' => null,
    'options' => extension_loaded('pdo_mysql') ? array_filter([
        PDO::MYSQL_ATTR_SSL_CA => env('MYSQL_ATTR_SSL_CA'),
    ]) : [],
],`,
        },
        {
          path: '.env (production)',
          lang: 'env',
          code: String.raw`DB_HOST=pms-primary.internal
DB_READ_HOST=pms-replica-1.internal`,
        },
        {
          title: 'Which queries must still read the primary',
          text: ['A replica is a little behind. That is fine for a search (a hint, scene 30) and wrong for anything that decides. Laravel already sends these to the primary, and the table says why each one is safe:'],
          table: [
            ['Query', 'Reads from', 'Why'],
            ['Search, quote page, properties page', 'replica', 'A second-old view is fine; the booking checks again'],
            ['The availability check in `CreateBooking`, `ChangeBookingDates`, `MoveBooking`', '**primary**', 'They run inside `DB::transaction()`: Laravel uses the write connection for every query of an open transaction'],
            ['`lockForUpdate()` reads', '**primary**', 'Always inside those transactions; a lock on a replica would lock nothing'],
            ['A read in the same request after a write', '**primary**', '`sticky: true`: the host who just saved a price sees it at once'],
            ['Queue jobs (webhooks, imports, sends)', 'replica, unless in a transaction', 'Every job here that decides something locks a row inside a transaction first (scenes 8, 15, 22)'],
          ],
          after: ['For the rare read that must be fresh outside a transaction, ask for it: `Booking::query()->useWritePdo()->find($id)`.'],
        },
        {
          table: [
            ['Run', 'p50', 'p95', 'p99', 'Primary CPU'],
            ['Before', '1.9 s', '6.4 s', '8.6 s', '97%'],
            ['Index', '38 ms', '95 ms', '210 ms', '41%'],
            ['Index + replica', '31 ms', '70 ms', '140 ms', '12%'],
          ],
          after: ['The same k6 run, with both fixes, passes its thresholds with room to spare, and the primary has its CPU back for bookings. The k6 script runs again before every peak season, against staging, so the next missing index shows up in a test instead of on a busy Sunday.'],
        },
      ],
    },
  ],
  tests: {
    summary: 'The search query uses the index and never sorts by hand',
    blocks: [
      {
        path: 'tests/Feature/SearchQueryPlanTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Property;
use Illuminate\Support\Facades\DB;

it('finds the properties of a city through the index, already sorted', function () {
    Property::factory()->count(30)->create(['city' => 'Copenhagen']);
    Property::factory()->count(30)->create(['city' => 'Aarhus']);
    DB::statement('ANALYZE TABLE properties');                                  // fresh statistics, like a production table has

    $search = Property::query()
        ->where('city', 'Copenhagen')
        ->where('max_guests', '>=', 4)
        ->availableFor(Stay::fromDates('2027-07-12', '2027-07-19'))
        ->orderBy('name')
        ->limit(50);

    $plan = collect(DB::select('EXPLAIN ' . $search->toRawSql()))->firstWhere('table', 'properties');

    expect($plan->key)->toBe('properties_city_name_index')
        ->and($plan->Extra ?? '')->not->toContain('filesort');                 // the incident: no full scan, no sort by hand
});`,
        after: ['This test reads MySQL’s plan on purpose. With 60 rows MySQL could still choose a full scan; `ANALYZE TABLE` gives it real statistics so it picks what production picks. If someone drops the index or changes the query so the index can’t serve it, this test fails long before the next busy Sunday.'],
      },
    ],
  },
  next: 'Search is fast again. Next, Hygge Homes asks for search by "sea view" and typos, search moves to Meilisearch, and one restart takes search down for ten minutes.',
};
