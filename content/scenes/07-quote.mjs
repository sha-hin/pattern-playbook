// Scene 7 · Builder: one price, built step by step, used by the quote and the booking.

export default {
  description: 'A guest was quoted €1,098.90 and charged €1,105.50 because the quote page and the booking code calculated the price differently. Fix it with a Builder in Laravel: one quote, built step by step, saved as line items.',
  incident: {
    channel: '#support',
    when: 'Monday 10:02',
    messages: [
      ['Mona · support', 'A guest booked the Nyhavn flat for 7 nights. The price page said **€1,098.90**. Her card was charged **€1,105.50**. She has a screenshot, and in the EU the price you show is the price you must charge.'],
    ],
  },
  sections: [
    {
      title: 'The broken code',
      text: ['Since launch, the price grew a weekly discount, a cleaning fee and a 10% accommodation tax. They were added in two places, by two people:'],
      blocks: [
        {
          path: 'app/Http/Controllers/QuoteController.php (before)',
          broken: true, fragment: true,
          code: String.raw`// the price page
$price = $nightly * $nights + $cleaningFee;
if ($nights >= 7) {
    $price = $price * 0.9;                       // 10% off... the nights AND the cleaning fee
}
$price = $price * 1.10;                          // tax`,
        },
        {
          text: ['And the booking, which decides what the card is charged:'],
          path: 'app/Bookings/CreateBooking.php (before)',
          broken: true,
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Money\Money;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if ($property->bookings()->overlapping($stay)->exists()) {
                throw BookingConflict::for($stay);
            }

            $nights = $property->nightly_rate->times($stay->nights());
            if ($stay->nights() >= 7) {
                $nights = Money::of((int) round($nights->amount * 0.9), $nights->currency);   // 10% off the nights only
            }
            $total = Money::of((int) round(($nights->amount + $property->cleaning_fee_cents) * 1.10), 'EUR');

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $total;                                     // one number; the parts are gone
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
          after: ['The house rule is "10% off the nights for stays of 7 nights or more". The booking code follows it; the price page also discounts the cleaning fee. Same inputs, two answers: €1,098.90 and €1,105.50.', 'And neither one can explain itself. The guest’s receipt, the host’s payout and the tax report all need the parts (nights, discount, fee, tax), but all the code keeps is one final number.'],
        },
      ],
    },
    {
      title: 'The fix, part 1: Money learns percentages',
      text: ['Discounts and taxes are percentages, stored as **basis points** (1/100 of a percent) so they stay integers: 10% is `1000`. Three methods join scene 1’s `Money`:'],
      blocks: [
        {
          path: 'app/Money/Money.php',
          code: String.raw`<?php

namespace App\Money;

use Illuminate\Support\Number;
use LogicException;

final readonly class Money
{
    private function __construct(
        public int $amount,                                     // in minor units: cents, piastres, yen
        public Currency $currency,
    ) {
    }

    public static function of(int $amount, Currency|string $currency): self
    {
        return new self($amount, $currency instanceof Currency ? $currency : Currency::from($currency));
    }

    public function add(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount + $other->amount, $this->currency);   // a new object; $this never changes
    }

    public function times(int $factor): self
    {
        return new self($this->amount * $factor, $this->currency);
    }

    public static function zero(Currency $currency): self
    {
        return new self(0, $currency);
    }

    /** 1000 basis points = 10%. Rounded half up, away from zero: 10050.5 cents becomes 10051. */
    public function percent(int $basisPoints): self
    {
        $product = $this->amount * $basisPoints;
        $rounded = intdiv(abs($product) + 5_000, 10_000);

        return new self($product < 0 ? -$rounded : $rounded, $this->currency);
    }

    /** A discount or a refund is a negative amount on the bill. */
    public function negate(): self
    {
        return new self(-$this->amount, $this->currency);
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount && $this->currency === $other->currency;
    }

    /** For people only (emails, screens). Never feed this back into a calculation. */
    public function format(): string
    {
        return Number::currency($this->amount / 10 ** $this->currency->minorUnits(), $this->currency->value);
    }

    private function assertSameCurrency(self $other): void
    {
        if ($other->currency !== $this->currency) {
            throw new LogicException("Can't combine {$this->currency->value} with {$other->currency->value}.");
        }
    }
}`,
          after: ['All integer math, so the rounding happens exactly once, in one place.'],
        },
      ],
    },
    {
      title: 'The fix, part 2: a price made of lines',
      blocks: [
        {
          title: 'One line of the bill',
          path: 'app/Pricing/LineItem.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Enums\LineItemType;
use App\Money\Money;

final readonly class LineItem
{
    public function __construct(
        public LineItemType $type,
        public string $description,                   // what the guest reads: "7 nights × €150.00"
        public Money $amount,                         // negative for a discount
    ) {
    }
}`,
        },
        {
          path: 'app/Enums/LineItemType.php',
          code: String.raw`<?php

namespace App\Enums;

enum LineItemType: string
{
    case Nights = 'nights';
    case Discount = 'discount';
    case CleaningFee = 'cleaning_fee';
    case Tax = 'tax';
}`,
        },
        {
          title: 'The finished quote',
          text: ['A value object (scene 1): the lines, in order, and a total that is always their sum. Nothing can be added once it exists.'],
          path: 'app/Pricing/Quote.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Money\Money;

final readonly class Quote
{
    /** @param non-empty-list<LineItem> $lines */
    public function __construct(public array $lines)
    {
    }

    public function total(): Money
    {
        $total = Money::zero($this->lines[0]->amount->currency);

        foreach ($this->lines as $line) {
            $total = $total->add($line->amount);       // add() refuses a line in another currency
        }

        return $total;
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 3: the Builder',
      text: [
        'A quote has an order that matters: discounts apply to the nights, the fee comes after, and tax is calculated on everything before it. The builder adds one kind of line per method and **enforces that order**, so a quote can’t be built wrong.',
        'Two different recipes need it today: the **standard price** every guest sees, and the **custom offer** a host sends one guest (a lower nightly rate for a returning family, say). Both must put lines in the same order and tax last.',
      ],
      blocks: [
        {
          path: 'app/Pricing/QuoteBuilder.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Enums\LineItemType;
use App\Money\Money;
use LogicException;

final class QuoteBuilder
{
    /** @var list<LineItem> */
    private array $lines = [];

    private ?Money $nights = null;                     // what discounts apply to

    private bool $taxed = false;

    public function nights(Stay $stay, Money $nightlyRate): self
    {
        if ($this->lines !== []) {
            throw new LogicException('Nights come first.');
        }

        $this->nights = $nightlyRate->times($stay->nights());
        $this->lines[] = new LineItem(LineItemType::Nights, "{$stay->nights()} nights × {$nightlyRate->format()}", $this->nights);

        return $this;                                   // returning $this is what lets the calls chain
    }

    public function discount(string $description, int $basisPoints): self
    {
        $this->assertOpen();

        $this->lines[] = new LineItem(LineItemType::Discount, $description, $this->nightsTotal()->percent($basisPoints)->negate());

        return $this;
    }

    public function cleaningFee(Money $fee): self
    {
        $this->assertOpen();

        $this->lines[] = new LineItem(LineItemType::CleaningFee, 'Cleaning fee', $fee);

        return $this;
    }

    public function tax(string $description, int $basisPoints): self
    {
        $this->assertOpen();

        $subtotal = (new Quote($this->lines))->total();             // everything so far
        $this->lines[] = new LineItem(LineItemType::Tax, $description, $subtotal->percent($basisPoints));
        $this->taxed = true;                                         // nothing may be added after tax

        return $this;
    }

    public function build(): Quote
    {
        $this->nightsTotal();                                        // a quote without nights is a bug

        return new Quote($this->lines);
    }

    private function nightsTotal(): Money
    {
        return $this->nights ?? throw new LogicException('Add the nights first.');
    }

    private function assertOpen(): void
    {
        $this->nightsTotal();

        if ($this->taxed) {
            throw new LogicException('Tax is the last line; nothing can be added after it.');
        }
    }
}`,
        },
      ],
    },
    {
      title: 'The fix, part 4: the house rules in one place',
      text: [
        'The builder knows *how* to put a quote together. Which steps Nordic Stays uses, and when, are house rules, and they go in one class that both the price page and the booking call.',
        'Two columns join the [properties](F#table-properties) table: the weekly discount and the tax rate, in basis points.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_02_02_000001_add_pricing_to_properties_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('properties', function (Blueprint $table) {
            $table->unsignedSmallInteger('weekly_discount_bps')->default(0);   // 1000 = 10% off 7+ nights
            $table->unsignedSmallInteger('tax_rate_bps')->default(0);          // 1000 = 10% accommodation tax
        });
    }
};`,
        },
        {
          path: 'app/Pricing/PriceQuoter.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Money\Money;

final class PriceQuoter
{
    public const WEEKLY_NIGHTS = 7;

    public function quote(Property $property, Stay $stay): Quote
    {
        $quote = (new QuoteBuilder())->nights($stay, $property->nightly_rate);

        if ($stay->nights() >= self::WEEKLY_NIGHTS && $property->weekly_discount_bps > 0) {
            $quote->discount('Weekly discount', $property->weekly_discount_bps);
        }

        if ($property->cleaning_fee_cents !== null) {
            $quote->cleaningFee(Money::of($property->cleaning_fee_cents, $property->currency));
        }

        if ($property->tax_rate_bps > 0) {
            $quote->tax('Accommodation tax', $property->tax_rate_bps);
        }

        return $quote->build();
    }

    /** The host's offer to one guest: their own nightly rate and discount. The tax rule is not theirs to change. */
    public function customOffer(Property $property, Stay $stay, Money $nightlyRate, int $discountBps): Quote
    {
        $quote = (new QuoteBuilder())->nights($stay, $nightlyRate);

        if ($discountBps > 0) {
            $quote->discount('Host discount', $discountBps);                  // instead of the weekly discount, never on top of it
        }

        if ($property->cleaning_fee_cents !== null) {
            $quote->cleaningFee(Money::of($property->cleaning_fee_cents, $property->currency));
        }

        if ($property->tax_rate_bps > 0) {
            $quote->tax('Accommodation tax', $property->tax_rate_bps);
        }

        return $quote->build();
    }
}`,
          after: ['The host’s offer screen calls `customOffer()`. Two recipes, one builder: neither can put the tax before the fee, or forget it.',
            'For the incident’s stay: 7 × €150.00 = €1,050.00, minus 10% of the nights (€105.00), plus €60.00 cleaning = €1,005.00, plus 10% tax (€100.50) = **€1,105.50**. One answer, for the page and for the card.'],
        },
      ],
    },
    {
      title: 'The fix, part 5: the booking keeps its lines',
      text: ['The receipt, the host statement and the tax report all need the parts, so the booking stores every line, not just the total.'],
      blocks: [
        {
          path: 'database/migrations/2026_02_02_000002_create_booking_line_items_table.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('booking_line_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('booking_id')->constrained()->cascadeOnDelete();
            $table->string('type');                                   // LineItemType
            $table->string('description');
            $table->integer('amount_cents');                          // signed: discounts are negative
            $table->char('currency', 3);
            $table->timestamps();
        });
    }
};`,
        },
        {
          path: 'app/Models/BookingLineItem.php',
          code: String.raw`<?php

namespace App\Models;

use App\Casts\MoneyCast;
use App\Enums\LineItemType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BookingLineItem extends Model
{
    protected $fillable = ['type', 'description', 'amount'];          // written by our code only

    protected function casts(): array
    {
        return [
            'type' => LineItemType::class,
            'amount' => MoneyCast::class . ':amount_cents',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }
}`,
        },
        {
          text: ['The booking gets a relation to its lines:'],
          path: 'app/Models/Booking.php',
          code: String.raw`<?php

namespace App\Models;

use App\Bookings\Stay;
use App\Casts\MoneyCast;
use App\Casts\StayCast;
use App\Enums\BookingStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    use HasFactory;

    protected $fillable = ['guest_name', 'guest_email', 'check_in', 'check_out', 'guests'];

    protected function casts(): array
    {
        return [
            'check_in' => 'date:Y-m-d',
            'check_out' => 'date:Y-m-d',
            'status' => BookingStatus::class,
            'expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'total' => MoneyCast::class . ':total_cents',          // Money from total_cents + currency
            'stay' => StayCast::class,                             // Stay from check_in + check_out
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(BookingLineItem::class);
    }

    /** Bookings that share at least one night with $stay: $property->bookings()->overlapping($stay). */
    public function scopeOverlapping(Builder $query, Stay $stay): void
    {
        $query->whereIn('status', BookingStatus::blocking())
            ->where('check_in', '<', $stay->checkOut->toDateString())     // starts before the new stay ends
            ->where('check_out', '>', $stay->checkIn->toDateString());    // ends after the new stay starts
    }
}`,
        },
        {
          title: 'CreateBooking asks the quoter',
          text: ['Inside scene 4’s transaction, the price comes from the same `PriceQuoter` the price page uses, and every line is saved with the booking.'],
          path: 'app/Bookings/CreateBooking.php',
          code: String.raw`<?php

namespace App\Bookings;

use App\Enums\BookingStatus;
use App\Models\Booking;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Support\Facades\DB;

final class CreateBooking
{
    public const HOLD_MINUTES = 30;

    public function __construct(private PriceQuoter $quoter)
    {
    }

    /** @param array{guest_name: string, guest_email: string, guests: int} $guest */
    public function handle(Property $property, Stay $stay, array $guest): Booking
    {
        return DB::transaction(function () use ($property, $stay, $guest): Booking {
            Property::whereKey($property->id)->lockForUpdate()->firstOrFail();   // others wait here

            if ($property->bookings()->overlapping($stay)->exists()) {
                throw BookingConflict::for($stay);
            }

            $quote = $this->quoter->quote($property, $stay);              // the same price the page showed

            $booking = new Booking($guest);
            $booking->stay = $stay;
            $booking->total = $quote->total();
            $booking->status = BookingStatus::Pending;
            $booking->expires_at = now()->addMinutes(self::HOLD_MINUTES);
            $property->bookings()->save($booking);

            $booking->lineItems()->createMany(array_map(fn (LineItem $line): array => [
                'type' => $line->type,
                'description' => $line->description,
                'amount' => $line->amount,
            ], $quote->lines));                                           // every line of the bill, kept

            return $booking;
        }, attempts: 3);                                                   // retried on a deadlock
    }
}`,
        },
        {
          title: 'The price page asks the same quoter',
          path: 'app/Http/Controllers/QuoteController.php (after)',
          code: String.raw`<?php

namespace App\Http\Controllers;

use App\Bookings\Stay;
use App\Models\Property;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QuoteController extends Controller
{
    public function __invoke(Request $request, Property $property, PriceQuoter $quoter): JsonResponse
    {
        $dates = $request->validate([
            'check_in' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
            'check_out' => ['required', 'date_format:Y-m-d', 'after:check_in'],
        ]);

        $quote = $quoter->quote($property, Stay::fromDates($dates['check_in'], $dates['check_out']));

        return response()->json([
            'lines' => array_map(fn (LineItem $line): array => [
                'type' => $line->type->value,
                'description' => $line->description,
                'amount' => $line->amount->amount,
            ], $quote->lines),
            'total' => ['amount' => $quote->total()->amount, 'currency' => $quote->total()->currency->value],
        ]);
    }
}`,
        },
        {
          text: ['The price page’s route is public, because guests aren’t logged in when they look at prices:'],
          path: 'routes/api.php',
          code: String.raw`<?php

use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingPaymentController;
use App\Http\Controllers\MarkBookingPaidController;
use App\Http\Controllers\QuoteController;
use Illuminate\Support\Facades\Route;

// Laravel serves this file under /api: the full URL is /api/v1/properties/{property}/bookings.
Route::get('/v1/properties/{property}/quote', QuoteController::class);   // public: guests aren't logged in

Route::post('/v1/properties/{property}/bookings', [BookingController::class, 'store'])
    ->middleware('auth:sanctum')
    ->can('createBooking', 'property');

Route::post('/v1/bookings/{booking}/payment', BookingPaymentController::class)
    ->middleware('auth:sanctum');

Route::post('/v1/bookings/{booking}/mark-paid', MarkBookingPaidController::class)
    ->middleware('auth:sanctum');                                       // who may: scenes 19 and 20`,
        },
      ],
    },
  ],
  reveal: {
    names: ['Builder'],
    rules: [['Builder', 'Builds a complex object step by step through small methods, then hands over the finished object with build(). The steps can vary; the finished object is always valid.']],
    points: [
      '**The builder** (`QuoteBuilder`) knows how to add each kind of line and refuses a wrong order.',
      '**The director** (`PriceQuoter`) decides which steps each recipe uses: the standard price and the host’s custom offer are two directors’ methods over one builder.',
      '**The product** (`Quote`) is immutable once built. Code that receives a `Quote` never wonders whether tax has been added yet.',
    ],
    whenNot: [
      'An object with two or three fields and no ordering rules. A constructor with named arguments is clearer: `new LineItem(type: ..., description: ..., amount: ...)`.',
      'Don’t let the builder hold business decisions ("is this stay long enough for a discount?"). That belongs to the director.',
    ],
  },
  laravel: {
    title: 'Laravel is full of builders',
    text: [
      'Every Eloquent query you write is a builder: each `where()` only records a piece of the query and returns `$this`, and nothing reaches the database until a finishing method like `get()` or `exists()` turns the pieces into SQL. `MailMessage` in scene 6 works the same way.',
    ],
    blocks: [
      {
        path: 'Illuminate/Database/Query/Builder.php (simplified)',
        fragment: true,
        code: String.raw`public function where($column, $operator = null, $value = null, $boolean = 'and')
{
    $type = 'Basic';

    $this->wheres[] = compact('type', 'column', 'operator', 'value', 'boolean');   // record one step

    $this->addBinding($value, 'where');

    return $this;                                                     // so the next call can chain
}

public function get($columns = ['*'])
{
    return collect($this->onceWithColumns(Arr::wrap($columns), function () {
        return $this->processor->processSelect($this, $this->runSelect());   // build(): compile to SQL and run it
    }));
}`,
      },
    ],
  },
  tests: {
    summary: 'The incident’s numbers, the order rules, and the page matching the booking',
    blocks: [
      {
        path: 'tests/Unit/QuoteBuilderTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Money\Money;
use App\Pricing\LineItem;
use App\Pricing\QuoteBuilder;

function sevenNights(): QuoteBuilder
{
    return (new QuoteBuilder())->nights(Stay::fromDates('2027-07-01', '2027-07-08'), Money::of(15_000, 'EUR'));
}

it('discounts the nights only, then taxes everything', function () {
    $quote = sevenNights()
        ->discount('Weekly discount', 1_000)
        ->cleaningFee(Money::of(6_000, 'EUR'))
        ->tax('Accommodation tax', 1_000)
        ->build();

    expect(array_map(fn (LineItem $line): int => $line->amount->amount, $quote->lines))->toBe([105_000, -10_500, 6_000, 10_050])
        ->and($quote->total()->amount)->toBe(110_550);                 // €1,105.50, the incident
});

it('refuses anything after tax', function () {
    sevenNights()->tax('Accommodation tax', 1_000)->cleaningFee(Money::of(6_000, 'EUR'));
})->throws(LogicException::class, 'Tax is the last line');

it('refuses a quote without nights', function () {
    (new QuoteBuilder())->cleaningFee(Money::of(6_000, 'EUR'));
})->throws(LogicException::class, 'Add the nights first.');

it('rounds percentages half up', function () {
    expect(Money::of(100_505, 'EUR')->percent(1_000)->amount)->toBe(10_051);   // 10050.5 → 10051
});`,
      },
      {
        path: 'tests/Feature/PriceQuoterTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Property;
use App\Money\Money;
use App\Pricing\LineItem;
use App\Pricing\PriceQuoter;

beforeEach(function () {
    $this->property = Property::factory()->create([
        'nightly_rate_cents' => 15_000, 'cleaning_fee_cents' => 6_000, 'weekly_discount_bps' => 1_000, 'tax_rate_bps' => 1_000,
    ]);
    $this->host = hostOf($this->property);
});

it('gives the weekly discount from 7 nights, not before', function (string $checkOut, int $total) {
    $this->getJson("/api/v1/properties/{$this->property->id}/quote?check_in=2027-07-01&check_out={$checkOut}")
        ->assertOk()
        ->assertJsonPath('total.amount', $total);
})->with([
    '6 nights' => ['2027-07-07', 105_600],      // (90000 + 6000) + 10% tax
    '7 nights' => ['2027-07-08', 110_550],
]);

it('charges exactly what the price page showed', function () {
    $shown = $this->getJson("/api/v1/properties/{$this->property->id}/quote?check_in=2027-07-01&check_out=2027-07-08")->json('total.amount');

    $this->actingAs($this->host)->postJson("/api/v1/properties/{$this->property->id}/bookings", [
        'check_in' => '2027-07-01', 'check_out' => '2027-07-08', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com',
    ])->assertCreated()->assertJsonPath('data.total.amount', $shown);
});

it('builds a host’s custom offer with the same order and the same tax', function () {
    $quote = app(PriceQuoter::class)->customOffer($this->property, Stay::fromDates('2027-07-01', '2027-07-08'), Money::of(13_000, 'EUR'), discountBps: 500);

    expect(array_map(fn (LineItem $line): int => $line->amount->amount, $quote->lines))->toBe([91_000, -4_550, 6_000, 9_245])
        ->and($quote->total()->amount)->toBe(101_695);               // no weekly discount on top of the host's own
});

it('stores every line with the booking', function () {
    $this->actingAs($this->host)->postJson("/api/v1/properties/{$this->property->id}/bookings", [
        'check_in' => '2027-07-01', 'check_out' => '2027-07-08', 'guests' => 2,
        'guest_name' => 'Mona Adel', 'guest_email' => 'mona@example.com',
    ]);

    expect($this->property->bookings()->sole()->lineItems()->orderBy('id')->pluck('amount_cents')->all())->toBe([105_000, -10_500, 6_000, 10_050]);
});`,
      },
    ],
  },
  next: 'Prices now match. Tuesday: a guest pays, Stripe shows the payment, and her booking still says pending.',
};
