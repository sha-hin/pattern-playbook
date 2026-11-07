// Scene 38 · A changes feed partners can trust: offset vs cursor pagination, a unique order, a safety lag, and a breaking fix shipped as /api/v2.

export default {
  description: 'A cleaning company’s nightly sync missed three bookings, and no cleaner went to Villa Sol: the partner changes endpoint paged with page numbers over rows that moved while the partner read them. Fix it in Laravel with cursorPaginate() over a unique order, a safety lag for late commits, whitelisted filters, and a new /api/v2 endpoint because the response shape changes, with v1 deprecated by headers.',
  incident: {
    channel: '#partners',
    when: 'Thursday 19:30',
    messages: [
      ['Anders · Hjem Rengøring (cleaning partner)', 'Our sync pulls your booking changes every night at 20:00 and plans the cleaners from them. Three of yesterday’s bookings **never arrived**. We sent nobody to **Villa Sol**, and the next guests walked into an uncleaned house at 16:00.'],
      ['Mona · support', 'The host refunded the guests one night, €240. The three bookings exist on our side, all made or changed **during** their 20:00 sync.'],
      ['Karim · developer', 'They read `/api/v1/bookings/changes` page by page: `?page=1`, `?page=2` … While they read, guests booked and hosts changed dates. Every change moves a row to the end of the list, and everything behind it shifts up by one.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature: a changes feed for partners',
      text: [
        'Cleaning companies, accounting tools and channel managers want what changed since their last run, not the whole history. The endpoint returns the current account’s bookings updated since a time, oldest change first, 100 per page. Partners call it with an API token the host created for them (scene 39 looks at those tokens).',
      ],
      blocks: [
        {
          path: 'app/Http/Resources/BookingChangeResource.php',
          code: String.raw`<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;

/** @mixin \App\Models\Booking */
class BookingChangeResource extends BookingResource
{
    /** @return array<string, mixed> a booking, plus when it last changed */
    public function toArray(Request $request): array
    {
        return [...parent::toArray($request), 'updated_at' => $this->updated_at->toIso8601String()];
    }
}`,
        },
        {
          path: 'app/Http/Controllers/BookingChangesController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingChangeResource;
use App\Models\Account;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class BookingChangesController extends Controller
{
    public function __invoke(Request $request, Account $account): AnonymousResourceCollection
    {
        $data = $request->validate(['since' => ['required', 'date']]);

        return BookingChangeResource::collection(
            $account->bookings()
                ->where('bookings.updated_at', '>=', $data['since'])
                ->orderBy('bookings.updated_at')
                ->paginate(100),                                        // the bug: page numbers over rows that move while they are read (v1 keeps it, see part 2)
        );
    }
}`,
          after: ['The route sits in the host group with the others: `Route::get(\'/bookings/changes\', BookingChangesController::class);`, before `/bookings/{booking}` so "changes" is never read as a booking id.'],
        },
      ],
    },
    {
      title: 'The broken code: what page 2 means a minute later',
      text: [
        '`paginate()` sends `LIMIT 100 OFFSET 100` for page 2. The offset counts rows in the order **at the moment of the query**, not at the moment page 1 was read. Here is what Hjem Rengøring saw last night, with three bookings instead of a hundred per page:',
      ],
      blocks: [
        {
          table: [
            ['When', 'The list, ordered by updated_at', 'The partner reads'],
            ['20:00:01', '**A B C** · D E F · G H', 'page 1: A B C'],
            ['20:00:02', 'a guest changes **B**’s dates: B moves to the end', '—'],
            ['20:00:03', 'A C D · **E F G** · H B', 'page 2: E F G. **D was never read**'],
            ['20:00:04', 'A C D · E F G · **H B**', 'page 3: H B'],
          ],
          after: [
            'Every change during the sync skips one row and shows another twice. The duplicate is harmless; the partner’s system ignores a booking it already has. The skipped one is a lost booking. On a busy evening that is several a night, and nobody gets an error.',
            'Ordering by `id` wouldn’t save it either: a cancelled or deleted row shifts the rest the same way. The problem is the offset itself: a position in a list that keeps changing.',
          ],
        },
      ],
    },
    {
      title: 'The design: a cursor, an order that never ties, and a minute of lag',
      blocks: [
        {
          table: [
            ['Rule', 'Why'],
            ['**A cursor, not a page number.** The next page starts *after the last row you got*: `WHERE (updated_at, id) > (last_updated_at, last_id)`.', 'A row moving to the end can’t shift anything: the next page is defined by values, not by a count. Laravel builds it with `cursorPaginate()`.'],
            ['**A unique order: `updated_at`, then `id`.**', '`updated_at` has one-second precision, and the poller (scene 15) can import 200 reservations in the same second. A cursor on `updated_at` alone would skip the rest of a second that a page boundary cuts through.'],
            ['**Stop a minute short of now.**', 'A booking’s `updated_at` is set when the row is written, but other connections only see it at **commit**. A transaction that wrote at 20:00:01 and commits at 20:00:03 would land *behind* a cursor that has already passed 20:00:02. Rows younger than a minute wait for the next run.'],
            ['**Filters from a fixed list.**', 'Anything in the query string that becomes SQL is validated against a list: statuses from the enum, a bounded page size. No column names from the client.'],
          ],
        },
      ],
    },
    {
      title: 'The fix, part 1: why this is a new version',
      text: [
        'A cursor response has no `page`, `last_page` or `total`: it has `next_cursor`. Hjem Rengøring and two other partners loop on `page` until `last_page`. Changing v1 in place would break all three tonight, so the fix ships as **`/api/v2/bookings/changes`**, and v1 keeps working, unchanged, until it is switched off.',
        'Most changes don’t need a version. Adding a field, a new endpoint or an optional parameter breaks nobody. Removing or renaming a field, changing a type or a meaning, or changing pagination does: those are the changes a new version is for.',
      ],
      blocks: [
        {
          path: 'app/Http/Requests/BookingChangesRequest.php',
          code: String.raw`<?php

namespace App\Http\Requests;

use App\Enums\BookingStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BookingChangesRequest extends FormRequest
{
    public const MAX_PER_PAGE = 200;

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'since' => ['required', 'date'],
            'status' => ['sometimes', 'array'],
            'status.*' => [Rule::enum(BookingStatus::class)],                 // only real statuses reach whereIn()
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:' . self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],                               // opaque: Laravel decodes and checks it
        ];
    }

    /** @return list<string> */
    public function statuses(): array
    {
        return $this->validated('status', []);
    }
}`,
        },
        {
          path: 'app/Http/Controllers/V2/BookingChangesController.php',
          code: String.raw`<?php

namespace App\Http\Controllers\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\BookingChangesRequest;
use App\Http\Resources\BookingChangeResource;
use App\Models\Account;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class BookingChangesController extends Controller
{
    /** Rows younger than this may belong to transactions that haven't committed yet. */
    public const SAFETY_LAG_SECONDS = 60;

    public function __invoke(BookingChangesRequest $request, Account $account): AnonymousResourceCollection
    {
        $statuses = $request->statuses();

        return BookingChangeResource::collection(
            $account->bookings()
                ->where('bookings.updated_at', '>=', $request->date('since')->utc())   // a Carbon: bound as UTC, whatever offset was sent
                ->where('bookings.updated_at', '<', now()->subSeconds(self::SAFETY_LAG_SECONDS))
                ->when($statuses !== [], fn ($query) => $query->whereIn('bookings.status', $statuses))
                ->orderBy('bookings.updated_at')
                ->orderBy('bookings.id')                                    // the tie-breaker: together the order is unique
                ->cursorPaginate($request->integer('per_page', 100))
                ->withQueryString(),                                        // links.next keeps since, status and per_page
        );
    }
}`,
          after: [
            'The response carries `meta.next_cursor` and `links.next`; the partner follows `links.next` until it is `null`. For the next night’s run, `since` is the `updated_at` of the last booking it processed. `>=` returns that booking once more, which an idempotent consumer ignores (scene 36), and nothing in the same second is lost.',
          ],
        },
      ],
    },
    {
      title: 'The fix, part 2: v1 says it is going away',
      text: [
        'Partners don’t read changelogs. They do log response headers. Every v1 response now says it is deprecated (`Deprecation`, RFC 9745), when it stops working (`Sunset`, RFC 8594), and what replaces it (`Link`). We also log every v1 call with its token, so on the sunset date we know exactly who hasn’t moved and can call them first.',
      ],
      blocks: [
        {
          path: 'app/Http/Middleware/Deprecated.php',
          code: String.raw`<?php

namespace App\Http\Middleware;

use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class Deprecated
{
    /** Usage: Deprecated::class . ':2027-06-03,2027-12-01,/api/v2/bookings/changes' (since, sunset, successor). */
    public function handle(Request $request, Closure $next, string $since, string $sunset, string $successor): Response
    {
        $token = $request->user()?->currentAccessToken();
        Log::info('Deprecated endpoint called', [
            'path' => $request->path(),
            'token_id' => $token instanceof PersonalAccessToken ? $token->id : null,   // who still has to move; null for the web app
        ]);

        $response = $next($request);

        $response->headers->set('Deprecation', '@' . CarbonImmutable::parse($since)->getTimestamp());
        $response->headers->set('Sunset', CarbonImmutable::parse($sunset)->toRfc7231String());
        $response->headers->set('Link', "<{$successor}>; rel=\"successor-version\"");

        return $response;
    }
}`,
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\BookingChangesController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CalendarRulesController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\PropertyController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Controllers\V2\BookingChangesController as BookingChangesV2Controller;
use App\Http\Middleware\Deprecated;
use App\Http\Middleware\Idempotent;
use App\Http\Middleware\SetCurrentAccount;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api.

// Public: guests aren't logged in when they look at prices or search.
Route::get('/v1/properties/{property}/quote', QuoteController::class);
Route::get('/v1/search', SearchController::class);

// Everything a host does: logged in, inside one current account, every id checked by a policy, retries answered once.
Route::middleware(['auth:sanctum', SetCurrentAccount::class, Idempotent::class])->prefix('v1')->group(function (): void {
    Route::get('/properties', [PropertyController::class, 'index']);             // the current account's properties
    Route::post('/properties/{property}/bookings', [BookingController::class, 'store'])->can('createBooking', 'property');
    Route::post('/properties/{property}/duplicate', DuplicatePropertyController::class)->can('update', 'property');
    Route::patch('/properties/{property}/stay-rules', StayRulesController::class)->can('update', 'property');
    Route::put('/properties/{property}/calendar-rules', CalendarRulesController::class)->can('update', 'property');

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/changes', BookingChangesController::class)               // before {booking}: "changes" is not an id
        ->middleware(Deprecated::class . ':2027-06-03,2027-12-01,/api/v2/bookings/changes');
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');
    Route::get('/bookings/{booking}/messages', [ConversationController::class, 'index'])->can('update', 'booking');   // owners and co-hosts: not cleaners
    Route::post('/bookings/{booking}/messages', [ConversationController::class, 'store'])->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);

    Route::post('/message-templates', [MessageTemplateController::class, 'store']);

    Route::post('/api-tokens', [ApiTokenController::class, 'store']);               // Monday: tokens for partners (scene 39 shows the page)
    Route::delete('/api-tokens/{tokenId}', [ApiTokenController::class, 'destroy']);
});

// v2: only what changed in a breaking way. Everything else stays on v1, which is not going away.
Route::middleware(['auth:sanctum', SetCurrentAccount::class])->prefix('v2')->group(function (): void {
    Route::get('/bookings/changes', BookingChangesV2Controller::class);
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
          after: [
            'v2 is not a copy of v1. Copying every endpoint into a v2 folder means fixing every future bug twice. A version exists per **breaking change**, and the URL says which shape you get: `/v1/bookings` and `/v2/bookings/changes` live side by side.',
            'The Idempotent middleware (scene 37) only acts on POSTs, so the GET-only v2 group doesn’t need it.',
            'Hjem Rengøring moved to v2 the next morning. Their missed bookings were found by running v2 from the previous week, which returned all three.',
          ],
        },
      ],
    },
  ],
  laravel: {
    title: 'Laravel inside: what cursorPaginate() sends',
    text: [
      '`cursorPaginate()` reads the query’s `orderBy` columns, and for the next page adds a `WHERE` that starts after the last row’s values. The cursor in the URL is those values, base64-encoded JSON. It is opaque to the client, but not secret or signed: it holds `updated_at` and `id`, nothing private.',
      'Two rules come with it. The order must be **unique**, or rows that tie at a page boundary are skipped, exactly the incident in another form; Laravel can’t check that for you. And the order columns must be in the result, because the next cursor is read from the last row.',
    ],
    blocks: [
      {
        path: 'page 2 of /api/v2/bookings/changes (MySQL, simplified)',
        fragment: true,
        lang: 'sql',
        code: String.raw`select bookings.* from bookings
inner join properties on properties.id = bookings.property_id
where properties.account_id = 7
  and bookings.updated_at >= '2027-06-02 20:00:00'
  and bookings.updated_at <  '2027-06-03 19:58:12'
  and (bookings.updated_at > '2027-06-03 08:14:09'
       or (bookings.updated_at = '2027-06-03 08:14:09' and bookings.id > 9412))   -- after the last row of page 1
order by bookings.updated_at asc, bookings.id asc
limit 101                                                                        -- one extra row: is there a next page?`,
        after: ['No `OFFSET`: page 50 costs the same as page 1, which `paginate()` can’t say. A composite index on `(updated_at, id)` would serve this query directly; at our size the account’s properties narrow it first, and `EXPLAIN` (scene 34) says when that stops being true.'],
      },
    ],
  },
  tests: {
    summary: 'A change during the sync skips nothing, ties at a page boundary are kept, and v1 carries its deprecation headers',
    blocks: [
      {
        path: 'tests/Feature/BookingChangesTest.php',
        code: String.raw`<?php

use App\Models\Booking;
use App\Models\Property;
use Illuminate\Support\Collection;

beforeEach(function () {
    $this->villa = Property::factory()->create(['name' => 'Villa Sol']);
    $this->partner = hostOf($this->villa);
});

/** Follows links.next to the end, the way a partner's sync does, running $between after the first page. */
function readAllChanges(object $test, string $since, ?Closure $between = null): Collection
{
    $ids = collect();
    $url = '/api/v2/bookings/changes?' . http_build_query(['since' => $since, 'per_page' => 2]);

    while ($url !== null) {
        $page = $test->actingAs($test->partner)->getJson($url)->assertOk();
        $ids->push(...array_column($page->json('data'), 'id'));
        $url = $page->json('links.next');
        if ($between !== null) {
            $between();
            $between = null;
        }
    }

    return $ids;
}

it('skips nothing when a booking changes during the sync', function () {
    $bookings = collect(range(1, 5))->map(fn (int $i) => Booking::factory()->for($this->villa)->forStay("2027-07-0{$i}", 1)->create(['updated_at' => now()->subHours(6 - $i)]));

    $ids = readAllChanges($this, now()->subDay()->toDateTimeString(), function () use ($bookings): void {
        $bookings[1]->forceFill(['updated_at' => now()->subMinutes(5)])->save();  // the incident: B moves to the end
    });

    expect($ids->unique()->sort()->values()->all())->toBe($bookings->pluck('id')->sort()->values()->all());   // every booking at least once
});

it('keeps every booking that shares a second across a page boundary', function () {
    $sameSecond = now()->subHour();
    $bookings = collect(range(1, 5))->map(fn (int $i) => Booking::factory()->for($this->villa)->forStay("2027-07-0{$i}", 1)->create(['updated_at' => $sameSecond]));

    expect(readAllChanges($this, now()->subDay()->toDateTimeString())->all())->toBe($bookings->pluck('id')->all());
});

it('leaves out changes younger than the safety lag', function () {
    Booking::factory()->for($this->villa)->create(['updated_at' => now()->subSeconds(10)]);

    expect(readAllChanges($this, now()->subDay()->toDateTimeString()))->toBeEmpty();      // the next run gets it
});

it('accepts only real statuses as a filter', function () {
    $this->actingAs($this->partner)
        ->getJson('/api/v2/bookings/changes?since=2027-06-01&status[]=confirmed;drop')
        ->assertUnprocessable()
        ->assertJsonValidationErrors('status.0');
});

it('keeps v1 working, and says it is deprecated', function () {
    $this->actingAs($this->partner)
        ->getJson('/api/v1/bookings/changes?since=2027-06-01')
        ->assertOk()
        ->assertJsonStructure(['data', 'meta' => ['current_page', 'last_page']])     // partners still on v1 are not broken
        ->assertHeader('Deprecation', '@' . strtotime('2027-06-03 00:00:00 UTC'))
        ->assertHeader('Sunset', 'Wed, 01 Dec 2027 00:00:00 GMT')
        ->assertHeader('Link', '</api/v2/bookings/changes>; rel="successor-version"');
});`,
        after: [
          'Mutations: swap `cursorPaginate()` for `paginate()` in v2 and the first test fails with one booking missing, the incident reproduced. Remove `orderBy(\'bookings.id\')` and the second test fails: with two per page, the cursor jumps past the rest of the second. Remove the safety lag and the third fails.',
          'The first test edits a booking between two page requests, inside one test process. That is the whole trick: the bug only exists when data changes **between** requests, so the test has to change it there.',
        ],
      },
    ],
  },
  next: 'Partners can trust the feed now. Next morning, a host finds 14 of his bookings cancelled overnight, and the API log says he did it himself.',
};
