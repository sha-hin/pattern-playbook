// Scene 36 · Template Method: one base export runs the steps every CSV export needs; each export fills in its columns.

export default {
  description: 'An agency downloaded its tax report and found 2,140 rows of other hosts’ bookings: the tax export was copied from the payouts export, started its query from a different model, and lost the account scope. Fix it in Laravel with a base export whose fixed steps scope to the account, read in chunks and stream the file, and three small exports that only say which bookings and which columns.',
  incident: {
    channel: '#incidents',
    when: 'Friday 08:45',
    messages: [
      ['Jonas · Hygge Homes', 'Our accountant opened the **2026 tax report** from your Exports page. It has **2,140 rows** for properties that aren’t ours, with other hosts’ guest names.'],
      ['Sara · tech lead', 'That is a personal data breach: other hosts’ guests’ names, sent to the wrong company. The export is switched off. We have **72 hours** to report it to the data protection authority, and I’m starting the report now.'],
      ['Karim · developer', 'The tax export shipped last week, copied from the payouts export. Payouts starts from `$account->bookings()`. Tax starts from the line items table, and nothing limits it to the account.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['There are three exports. Payouts and occupancy have existed since the spring; tax was added last week, by copying payouts and changing what it reads:'],
      blocks: [
        {
          path: 'app/Http/Controllers/PayoutExportController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\BookingStatus;
use App\Models\Account;
use App\Models\Booking;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PayoutExportController extends Controller
{
    public function __invoke(Request $request, Account $account): StreamedResponse
    {
        $dates = $request->validate(['from' => ['required', 'date_format:Y-m-d'], 'to' => ['required', 'date_format:Y-m-d', 'after:from']]);

        $bookings = $account->bookings()                                // scoped: only this account's bookings
            ->where('status', BookingStatus::Confirmed)
            ->where('check_out', '>=', $dates['from'])
            ->where('check_out', '<', $dates['to'])
            ->with('property:id,name')
            ->get();                                                    // every row in memory at once

        return response()->streamDownload(function () use ($bookings): void {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Booking', 'Property', 'Check-out', 'Total', 'Currency']);
            foreach ($bookings as $booking) {
                /** @var Booking $booking */
                fputcsv($out, [$booking->id, $booking->property->name, $booking->check_out->toDateString(), $booking->total->amount / 100, $booking->total->currency->value]);
            }
            fclose($out);
        }, "payouts-{$dates['from']}.csv", ['Content-Type' => 'text/csv']);
    }
}`,
        },
        {
          path: 'app/Http/Controllers/OccupancyExportController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\BookingStatus;
use App\Models\Account;
use App\Models\Booking;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class OccupancyExportController extends Controller
{
    public function __invoke(Request $request, Account $account): StreamedResponse
    {
        $dates = $request->validate(['from' => ['required', 'date_format:Y-m-d'], 'to' => ['required', 'date_format:Y-m-d', 'after:from']]);

        $bookings = $account->bookings()
            ->where('status', BookingStatus::Confirmed)
            ->where('check_in', '<', $dates['to'])
            ->where('check_out', '>', $dates['from'])
            ->with('property:id,name')
            ->get();

        return response()->streamDownload(function () use ($bookings): void {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Property', 'Check-in', 'Check-out', 'Nights', 'Guests']);
            foreach ($bookings as $booking) {
                /** @var Booking $booking */
                fputcsv($out, [$booking->property->name, $booking->check_in->toDateString(), $booking->check_out->toDateString(), $booking->stay->nights(), $booking->guests]);
            }
            fclose($out);
        }, "occupancy-{$dates['from']}.csv", ['Content-Type' => 'text/csv']);
    }
}`,
        },
        {
          path: 'app/Http/Controllers/TaxExportController.php',
          broken: true,
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Enums\BookingStatus;
use App\Enums\LineItemType;
use App\Models\Account;
use App\Models\BookingLineItem;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TaxExportController extends Controller
{
    public function __invoke(Request $request, Account $account): StreamedResponse
    {
        $dates = $request->validate(['from' => ['required', 'date_format:Y-m-d'], 'to' => ['required', 'date_format:Y-m-d', 'after:from']]);

        $lines = BookingLineItem::query()                               // the bug: starts from every line item in the database
            ->where('type', LineItemType::Tax)
            ->whereHas('booking', fn (Builder $booking) => $booking
                ->where('status', BookingStatus::Confirmed)
                ->where('check_out', '>=', $dates['from'])
                ->where('check_out', '<', $dates['to']))
            ->with('booking.property:id,name')
            ->get();                                                    // and loads them all at once

        return response()->streamDownload(function () use ($lines): void {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Booking', 'Property', 'Guest', 'Check-out', 'Tax', 'Currency']);
            foreach ($lines as $line) {
                /** @var BookingLineItem $line */
                fputcsv($out, [$line->booking_id, $line->booking->property->name, $line->booking->guest_name, $line->booking->check_out->toDateString(), $line->amount->amount / 100, $line->amount->currency->value]);
            }
            fclose($out);
        }, "tax-{$dates['from']}.csv", ['Content-Type' => 'text/csv']);
    }
}`,
          after: [
            'The `$account` parameter is right there and never used. Every export repeats the same steps (validate the dates, scope to the account, read, write a header, write rows, stream), and each copy is a chance to drop one. Tax dropped the most important.',
            'All three also call `->get()`. For Hygge Homes’ three years of bookings that is 60,000 models in memory before the first line is written; the occupancy export already fails with "Allowed memory size exhausted" for them.',
          ],
        },
        {
          path: 'routes/api.php (the export routes, before)',
          broken: true,
          fragment: true,
          code: String.raw`Route::get('/exports/payouts', PayoutExportController::class);      // inside the host group, like every route there
Route::get('/exports/occupancy', OccupancyExportController::class);
Route::get('/exports/tax', TaxExportController::class);`,
        },
      ],
    },
    {
      title: 'The fix, part 1: the steps, written once',
      text: [
        '`AccountExport::download()` is the only way an export runs. It is `final`: no export can change the order or skip a step. The steps that differ between exports are left to the export, as small methods it must write: which bookings, which columns, which file name.',
        'The scope can’t be forgotten because the export never builds its own query: it receives `$account->bookings()` and may only **add** conditions to it. Reading is `lazyById()`: 1,000 rows at a time, written to the browser as they are read.',
      ],
      blocks: [
        {
          path: 'app/Exports/AccountExport.php',
          code: String.raw`<?php

namespace App\Exports;

use App\Models\Account;
use App\Models\Booking;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Symfony\Component\HttpFoundation\StreamedResponse;

abstract class AccountExport
{
    /** The template method: every export runs these steps, in this order. */
    final public function download(Account $account, CarbonImmutable $from, CarbonImmutable $to): StreamedResponse
    {
        $bookings = $account->bookings()->getQuery()->select('bookings.*');   // step 1: the account's bookings, nothing else
        $this->filter($bookings, $from, $to);                            // step 2: the export narrows them

        return response()->streamDownload(function () use ($bookings): void {
            $out = fopen('php://output', 'w');
            fputcsv($out, $this->headers());                             // step 3: the header row

            $bookings->lazyById(1_000, 'bookings.id', 'id')               // step 4: 1,000 rows at a time, never all at once
                ->each(fn (Booking $booking) => fputcsv($out, $this->row($booking)));

            fclose($out);
        }, "{$this->name()}-{$from->toDateString()}-{$to->toDateString()}.csv", ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** "payouts", "occupancy", "tax": the file name, and the {type} in the URL. */
    abstract public function name(): string;

    /** Narrow the account's bookings. Add conditions and eager loads; never start a new query. */
    abstract protected function filter(Builder $bookings, CarbonImmutable $from, CarbonImmutable $to): void;

    /** @return list<string> */
    abstract protected function headers(): array;

    /** @return list<string|int|float> one CSV line */
    abstract protected function row(Booking $booking): array;
}`,
          after: ['The account’s bookings go through its properties, so the query joins `properties`. `select(\'bookings.*\')` keeps the property’s columns (its own `id`, `name`, `status`…) from overwriting the booking’s, and `lazyById(1_000, \'bookings.id\', \'id\')` pages by the booking id.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: each export fills in its part',
      blocks: [
        {
          path: 'app/Exports/PayoutExport.php',
          code: String.raw`<?php

namespace App\Exports;

use App\Enums\BookingStatus;
use App\Models\Booking;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

final class PayoutExport extends AccountExport
{
    public function name(): string
    {
        return 'payouts';
    }

    protected function filter(Builder $bookings, CarbonImmutable $from, CarbonImmutable $to): void
    {
        $bookings->where('bookings.status', BookingStatus::Confirmed)
            ->where('bookings.check_out', '>=', $from->toDateString())     // paid out after the guest leaves
            ->where('bookings.check_out', '<', $to->toDateString())
            ->with('property:id,name');
    }

    protected function headers(): array
    {
        return ['Booking', 'Property', 'Check-out', 'Total', 'Currency'];
    }

    protected function row(Booking $booking): array
    {
        return [$booking->id, $booking->property->name, $booking->check_out->toDateString(), $booking->total->amount / 100, $booking->total->currency->value];
    }
}`,
        },
        {
          path: 'app/Exports/OccupancyExport.php',
          code: String.raw`<?php

namespace App\Exports;

use App\Enums\BookingStatus;
use App\Models\Booking;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

final class OccupancyExport extends AccountExport
{
    public function name(): string
    {
        return 'occupancy';
    }

    protected function filter(Builder $bookings, CarbonImmutable $from, CarbonImmutable $to): void
    {
        $bookings->where('bookings.status', BookingStatus::Confirmed)
            ->where('bookings.check_in', '<', $to->toDateString())        // any night inside the period
            ->where('bookings.check_out', '>', $from->toDateString())
            ->with('property:id,name');
    }

    protected function headers(): array
    {
        return ['Property', 'Check-in', 'Check-out', 'Nights', 'Guests'];
    }

    protected function row(Booking $booking): array
    {
        return [$booking->property->name, $booking->check_in->toDateString(), $booking->check_out->toDateString(), $booking->stay->nights(), $booking->guests];
    }
}`,
        },
        {
          path: 'app/Exports/TaxExport.php',
          code: String.raw`<?php

namespace App\Exports;

use App\Enums\BookingStatus;
use App\Enums\LineItemType;
use App\Models\Booking;
use App\Models\BookingLineItem;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class TaxExport extends AccountExport
{
    public function name(): string
    {
        return 'tax';
    }

    protected function filter(Builder $bookings, CarbonImmutable $from, CarbonImmutable $to): void
    {
        $bookings->where('bookings.status', BookingStatus::Confirmed)
            ->where('bookings.check_out', '>=', $from->toDateString())
            ->where('bookings.check_out', '<', $to->toDateString())
            ->with(['property:id,name', 'lineItems' => fn (HasMany $lines) => $lines->where('type', LineItemType::Tax)]);   // one query per 1,000 bookings
    }

    protected function headers(): array
    {
        return ['Booking', 'Property', 'Guest', 'Check-out', 'Tax', 'Currency'];
    }

    protected function row(Booking $booking): array
    {
        $tax = $booking->lineItems->sum(fn (BookingLineItem $line): int => $line->amount->amount);

        return [$booking->id, $booking->property->name, $booking->guest_name, $booking->check_out->toDateString(), $tax / 100, $booking->total->currency->value];
    }
}`,
          after: ['Tax now starts from bookings like the other two, and reads each booking’s tax lines through the relation. Eager loads apply to every chunk of 1,000, so the export runs three queries per chunk, not one per booking.'],
        },
      ],
    },
    {
      title: 'The fix, part 3: one route and one controller for all three',
      blocks: [
        {
          path: 'app/Http/Controllers/ExportController.php',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Exports\AccountExport;
use App\Exports\OccupancyExport;
use App\Exports\PayoutExport;
use App\Exports\TaxExport;
use App\Models\Account;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExportController extends Controller
{
    public function __invoke(Request $request, Account $account, string $type): StreamedResponse
    {
        Gate::authorize('export', $account);                             // the current account: owners only (403 for others)

        $dates = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after:from', 'before_or_equal:' . now()->addYear()->toDateString()],
        ]);

        $export = match ($type) {
            'payouts' => new PayoutExport(),
            'occupancy' => new OccupancyExport(),
            'tax' => new TaxExport(),
            default => abort(404),
        };

        /** @var AccountExport $export */
        return $export->download($account, CarbonImmutable::parse($dates['from']), CarbonImmutable::parse($dates['to']));
    }
}`,
          after: ['`$account` is the current account from `SetCurrentAccount` (scene 19), never an id from the URL. The permission is checked here and not with `->can()` on the route, because the route has no `{account}` parameter for `->can()` to find.'],
        },
        {
          title: 'Exports are owners only',
          path: 'app/Policies/AccountPolicy.php',
          code: String.raw`<?php

namespace App\Policies;

use App\Models\Account;
use App\Models\User;

class AccountPolicy
{
    /** Only owners, who are let through by Gate::before. Everyone else: no. */
    public function manageMembers(User $user, Account $account): bool
    {
        return false;
    }

    /** Money and guests' names: owners only, through Gate::before. */
    public function export(User $user, Account $account): bool
    {
        return false;
    }
}`,
        },
        {
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\AccountMemberController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\CancelBookingController;
use App\Http\Controllers\ChangeDatesController;
use App\Http\Controllers\ChannelWebhookController;
use App\Http\Controllers\DuplicatePropertyController;
use App\Http\Controllers\ExportController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\MessageTemplateController;
use App\Http\Controllers\PropertyController;
use App\Http\Controllers\QuoteController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StayRulesController;
use App\Http\Controllers\StripeWebhookController;
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

    Route::get('/bookings', [BookingController::class, 'index']);
    Route::get('/bookings/{booking}', [BookingController::class, 'show'])->can('view', 'booking');
    Route::patch('/bookings/{booking}/property', [BookingController::class, 'move'])->can('update', 'booking');
    Route::post('/bookings/{booking}/payment', BookingPaymentController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/cancel', CancelBookingController::class)->can('update', 'booking');
    Route::patch('/bookings/{booking}/dates', ChangeDatesController::class)->can('update', 'booking');
    Route::post('/bookings/{booking}/mark-paid', MarkBookingPaidController::class)->can('update', 'booking');

    Route::post('/members', [AccountMemberController::class, 'store']);         // invite someone to the current account
    Route::delete('/members/{user}', [AccountMemberController::class, 'destroy']);

    Route::post('/message-templates', [MessageTemplateController::class, 'store']);

    Route::get('/exports/{type}', ExportController::class);                    // payouts, occupancy, tax; owners only (the controller checks)
});

// Called by Stripe and by the channels, not by a browser. API routes have no CSRF check, which they couldn't pass.
Route::post('/webhooks/stripe', StripeWebhookController::class);
Route::post('/webhooks/channels/{channel}', ChannelWebhookController::class);   // {channel} is the Channel enum: vrbo is a 404`,
          after: ['The three old routes are replaced by this one.'],
        },
        {
          title: 'The old controllers go',
          path: 'terminal',
          lang: 'shell',
          code: String.raw`rm app/Http/Controllers/PayoutExportController.php app/Http/Controllers/OccupancyExportController.php app/Http/Controllers/TaxExportController.php`,
          after: ['The breach report lists who received what: the 2,140 rows, the hosts and guests they belong to, and the one company that got them. Hygge Homes confirms in writing that the file is deleted. The export goes back on once these tests pass.'],
        },
      ],
    },
  ],
  reveal: {
    names: ['Template Method'],
    rules: [['Template Method', 'A base class fixes the steps of an operation in one method, and leaves some steps to subclasses. The subclasses fill in those steps, but can’t change the order or skip the others.']],
    points: [
      '`download()` is the template method: scope, filter, header, chunked rows, stream. It is `final`, so the rules every export must follow live in one place.',
      '`name()`, `filter()`, `headers()` and `row()` are the steps left open. A fourth export (cleanings per cleaner, say) is one small class with those four methods.',
      'The base class decides **what an export is given**: a query that already belongs to the account. The safest step to leave open is one that can only narrow what it receives.',
    ],
    whenNot: [
      'When the "steps" are a single call: a base class with one abstract method is just an interface with extra coupling.',
      'When subclasses need to change the order. Then the steps aren’t really fixed, and composing small objects (a Strategy, scene 10) fits better.',
    ],
  },
  laravel: {
    title: 'Laravel does the same: you fill in its template methods every day',
    text: [
      'A Form Request is a template method: Laravel’s `validateResolved()` runs prepare, authorize, validate, then your `after()` hooks, in that order, and you only write `rules()` and `authorize()`. An Artisan command’s `run()` parses input and calls your `handle()`. A job is called by the queue worker’s fixed steps, which call your `handle()`, `middleware()` and `failed()`.',
    ],
    blocks: [
      {
        path: 'Illuminate/Foundation/Http/FormRequest.php (simplified)',
        fragment: true,
        code: String.raw`public function validateResolved()                 // the template method: same order for every request class
{
    $this->prepareForValidation();                    // a hook you may override

    if (! $this->passesAuthorization()) {             // calls your authorize()
        $this->failedAuthorization();
    }

    $validator = $this->getValidatorInstance();       // builds it from your rules(), then adds your after()

    if ($validator->fails()) {
        $this->failedValidation($validator);
    }

    $this->passedValidation();                         // another hook
}`,
      },
    ],
  },
  tests: {
    summary: 'The incident for every export, the right columns, chunked reads, and owners only',
    blocks: [
      {
        path: 'tests/Feature/ExportTest.php',
        code: String.raw`<?php

use App\Enums\LineItemType;
use App\Enums\MembershipRole;
use App\Models\Account;
use App\Models\Booking;
use App\Models\Property;
use App\Money\Money;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->hygge = Account::factory()->create();
    $this->owner = memberOf($this->hygge);
    $ours = Property::factory()->for($this->hygge)->create(['name' => 'Cottage 2']);
    $theirs = Property::factory()->create(['name' => 'Someone else’s flat']);     // another account

    foreach ([$ours, $theirs] as $property) {
        $booking = Booking::factory()->for($property)->forStay('2026-07-10', 3)->create(['guest_name' => "Guest at {$property->name}"]);
        $booking->lineItems()->create(['type' => LineItemType::Tax, 'description' => 'Accommodation tax', 'amount' => Money::of(4_500, 'EUR')]);
    }
});

function exportCsv(string $type): string
{
    return test()->actingAs(test()->owner)
        ->get("/api/v1/exports/{$type}?from=2026-01-01&to=2027-01-01")
        ->assertOk()
        ->streamedContent();
}

it('contains only the account’s own bookings, in every export', function (string $type) {
    $csv = exportCsv($type);

    expect($csv)->toContain('Cottage 2')
        ->not->toContain('Someone else');                                       // the incident
})->with(['payouts', 'occupancy', 'tax']);

it('writes the tax of each booking', function () {
    expect(exportCsv('tax'))->toContain('"Guest at Cottage 2",2026-07-13,45,EUR');
});

it('reads the bookings in chunks, not all at once', function () {
    DB::enableQueryLog();
    exportCsv('payouts');

    $chunked = collect(DB::getQueryLog())->pluck('query')->contains(fn (string $sql): bool => str_contains($sql, 'limit 1000'));
    expect($chunked)->toBeTrue();                                               // lazyById(1_000): never one query for everything
});

it('lets owners export, and nobody else', function () {
    $coHost = memberOf($this->hygge, MembershipRole::CoHost);

    $this->actingAs($coHost)->get('/api/v1/exports/tax?from=2026-01-01&to=2027-01-01')->assertForbidden();
    $this->actingAs($this->owner)->get('/api/v1/exports/vat?from=2026-01-01&to=2027-01-01')->assertNotFound();
});`,
        after: ['The dataset runs the incident test once per export, so a fourth export added to the controller without a row here is the only way to skip it, and a code review sees that.'],
      },
    ],
  },
  next: 'Exports are safe and stream in chunks. Next: Hygge Homes’ 140 iCal calendars are hours out of date, and the sync queue never empties.',
};
