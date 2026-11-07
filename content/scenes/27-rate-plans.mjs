// Scene 27 · Rate plans: seasons and a weekend rule, each night priced on its own, rules in the right order.

export default {
  description: 'After the summer season went live, every July Saturday was cheaper than a May Saturday: the season code returned the season’s price before the weekend rule ran. Fix it in Laravel by pricing each night in a fixed order: choose the base price, then apply the adjustments.',
  incident: {
    channel: '#support',
    when: 'Wednesday 14:30',
    messages: [
      ['Ingrid · host, Skagen cottages', 'I set **€160** a night, **+20% on Fridays and Saturdays**, and a summer season at **€180** for July and August. A guest just booked Saturday 3 July for **€180**. Saturday 8 May costs **€192**. My busiest weekends are cheaper than May.'],
      ['Mona · support', 'Three other hosts with summer seasons say the same.'],
      ['Karim · developer', 'Seasons shipped last week. Inside a season we return the season price and never get to the weekend rule.'],
    ],
  },
  sections: [
    {
      title: 'Last week’s feature',
      text: [
        'Until last week a property had one price per night (scene 1). Now a host can give it a **rate plan**: a base price, a weekend uplift for Friday and Saturday nights, and seasons with their own nightly price. A plan belongs to the account and several listings can use the same one: a host with three identical studios keeps one plan for all three.',
      ],
      blocks: [
        {
          path: 'database/migrations/2026_04_20_000001_create_rate_plans_tables.php',
          code: String.raw`<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rate_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained();
            $table->string('name');
            $table->unsignedInteger('nightly_rate_cents');
            $table->char('currency', 3);
            $table->unsignedSmallInteger('weekend_uplift_bps')->default(0);   // 2000 = +20% on Friday and Saturday nights
            $table->timestamps();
        });

        Schema::create('rate_plan_seasons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rate_plan_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->date('starts_on');                                     // the first night of the season
            $table->date('ends_on');                                       // the last night, included
            $table->unsignedInteger('nightly_rate_cents');
            $table->timestamps();
        });

        Schema::table('properties', function (Blueprint $table) {
            $table->foreignId('rate_plan_id')->nullable()->constrained();  // null: the property's own nightly_rate
        });
    }
};`,
        },
        {
          path: 'app/Models/RatePlan.php',
          code: String.raw`<?php

namespace App\Models;

use App\Money\Money;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RatePlan extends Model
{
    protected $fillable = ['name', 'nightly_rate_cents', 'currency', 'weekend_uplift_bps'];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function seasons(): HasMany
    {
        return $this->hasMany(RatePlanSeason::class)->orderBy('starts_on');
    }

    public function baseRate(): Money
    {
        return Money::of($this->nightly_rate_cents, $this->currency);
    }
}`,
        },
        {
          path: 'app/Models/RatePlanSeason.php',
          code: String.raw`<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RatePlanSeason extends Model
{
    protected $fillable = ['name', 'starts_on', 'ends_on', 'nightly_rate_cents'];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date:Y-m-d',
            'ends_on' => 'date:Y-m-d',
        ];
    }

    public function ratePlan(): BelongsTo
    {
        return $this->belongsTo(RatePlan::class);
    }

    /** True for every night from starts_on to ends_on, both included. */
    public function covers(string $night): bool
    {
        return $night >= $this->starts_on->toDateString() && $night <= $this->ends_on->toDateString();   // Y-m-d compares as text
    }
}`,
        },
        {
          title: 'The property points at its plan',
          path: 'app/Models/Property.php',
          code: String.raw`<?php

namespace App\Models;

use App\Casts\MoneyCast;
use App\Enums\CancellationPolicy;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Property extends Model
{
    use HasFactory;

    protected $fillable = [
        'name', 'city', 'country', 'timezone', 'check_in_time', 'check_out_time',
        'max_guests', 'nightly_rate_cents', 'cleaning_fee_cents', 'currency',
    ];

    protected function casts(): array
    {
        return [
            'nightly_rate' => MoneyCast::class . ':nightly_rate_cents',   // Money from nightly_rate_cents + currency
            'cancellation_policy' => CancellationPolicy::class,          // the terms for new bookings
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function ratePlan(): BelongsTo
    {
        return $this->belongsTo(RatePlan::class);                      // shared: several listings can use one plan
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function icalFeeds(): HasMany
    {
        return $this->hasMany(IcalFeed::class);
    }

    public function externalBlocks(): HasMany
    {
        return $this->hasMany(ExternalBlock::class);
    }

    public function channelListings(): HasMany
    {
        return $this->hasMany(ChannelListing::class);
    }
}`,
          after: ['`rate_plan_id` is not fillable: the host picks a plan through the property settings, which checks the plan belongs to the same account (scene 19) and sets it with `forceFill()`.'],
        },
        {
          title: 'The quote takes one price per night',
          text: ['Nights no longer all cost the same, so the builder from scene 7 learns to take a list of nightly prices. Its old method stays, for the host’s custom offer with one price for every night.'],
          path: 'app/Pricing/QuoteBuilder.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Enums\LineItemType;
use App\Money\Money;
use Illuminate\Support\Str;
use LogicException;

final class QuoteBuilder
{
    /** @var list<LineItem> */
    private array $lines = [];

    private ?Money $nights = null;                     // what discounts apply to

    private bool $taxed = false;

    public function nights(Stay $stay, Money $nightlyRate): self
    {
        return $this->nightsAt(array_fill(0, $stay->nights(), $nightlyRate));   // the same price every night
    }

    /** @param list<Money> $prices one price per night, in order */
    public function nightsAt(array $prices): self
    {
        if ($this->lines !== []) {
            throw new LogicException('Nights come first.');
        }

        if ($prices === []) {
            throw new LogicException('A stay has at least one night.');
        }

        $this->nights = array_reduce(array_slice($prices, 1), fn (Money $sum, Money $price): Money => $sum->add($price), $prices[0]);

        $count = count($prices) . ' ' . Str::plural('night', count($prices));
        $samePrice = count(array_unique(array_map(fn (Money $price): int => $price->amount, $prices))) === 1;

        $this->lines[] = new LineItem(
            LineItemType::Nights,
            $samePrice ? "{$count} × {$prices[0]->format()}" : "{$count}, {$this->nights->format()} in total",
            $this->nights,
        );

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

    public function __construct(private NightlyRates $rates)
    {
    }

    public function quote(Property $property, Stay $stay): Quote
    {
        $quote = (new QuoteBuilder())->nightsAt($this->rates->for($property, $stay));   // each night at its own price

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
          after: ['Every caller already gets `PriceQuoter` from the container (the quote endpoint, `CreateBooking`, `ChangeBookingDates`), so the new constructor argument is filled in for them.'],
        },
      ],
    },
    {
      title: 'The broken code',
      blocks: [
        {
          path: 'app/Pricing/NightlyRates.php',
          broken: true,
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Models\RatePlan;
use App\Money\Money;
use Carbon\CarbonImmutable;

final class NightlyRates
{
    /** @return list<Money> one price per night of the stay */
    public function for(Property $property, Stay $stay): array
    {
        $plan = $property->ratePlan;
        $prices = [];

        for ($night = $stay->checkIn; $night->lessThan($stay->checkOut); $night = $night->addDay()) {
            $prices[] = $plan === null ? $property->nightly_rate : $this->priceOf($plan, $night);
        }

        return $prices;
    }

    private function priceOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        foreach ($plan->seasons as $season) {
            if ($season->covers($night->toDateString())) {
                return Money::of($season->nightly_rate_cents, $plan->currency);   // the bug: returns before the weekend rule
            }
        }

        $base = $plan->baseRate();

        return $night->isFriday() || $night->isSaturday()
            ? $base->add($base->percent($plan->weekend_uplift_bps))
            : $base;
    }
}`,
          after: [
            'The season’s `return` ends the method, so the weekend rule only ever runs outside a season. A July Saturday costs €180; a May Saturday costs €160 + 20% = €192.',
            'The code mixes two different things: the **base price** of a night (the plan’s, or a season’s instead) and the **adjustments** on top of it (the weekend uplift). A season replaces the base. It must never replace the adjustments.',
          ],
        },
      ],
    },
    {
      title: 'The fix: choose the base, then adjust it',
      text: [
        'Every night goes through the same two steps, in this order. **1. The base:** the season that covers the night, or the plan’s own price. **2. The adjustments:** the weekend uplift, applied to whichever base step 1 chose. A rule added later (a last-minute discount, say) goes into step 2, and works inside and outside seasons alike.',
      ],
      blocks: [
        {
          path: 'app/Pricing/NightlyRates.php',
          code: String.raw`<?php

namespace App\Pricing;

use App\Bookings\Stay;
use App\Models\Property;
use App\Models\RatePlan;
use App\Models\RatePlanSeason;
use App\Money\Money;
use Carbon\CarbonImmutable;

final class NightlyRates
{
    /** @return list<Money> one price per night of the stay */
    public function for(Property $property, Stay $stay): array
    {
        $plan = $property->ratePlan;
        $prices = [];

        for ($night = $stay->checkIn; $night->lessThan($stay->checkOut); $night = $night->addDay()) {
            $prices[] = $plan === null ? $property->nightly_rate : $this->priceOf($plan, $night);
        }

        return $prices;
    }

    private function priceOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        $price = $this->baseOf($plan, $night);                          // 1. what the night costs before adjustments

        if ($night->isFriday() || $night->isSaturday()) {                 // 2. adjustments, on whichever base step 1 chose
            $price = $price->add($price->percent($plan->weekend_uplift_bps));
        }

        return $price;
    }

    /** A season replaces the plan's base price for its nights. Only the base. */
    private function baseOf(RatePlan $plan, CarbonImmutable $night): Money
    {
        $season = $plan->seasons->first(fn (RatePlanSeason $season): bool => $season->covers($night->toDateString()));

        return $season === null
            ? $plan->baseRate()
            : Money::of($season->nightly_rate_cents, $plan->currency);
    }
}`,
          after: [
            'A Friday or Saturday night in July is now €180 + 20% = **€216**, and a summer weekday stays €180.',
            '`$plan->seasons` is loaded once per quote and searched in memory, not queried once per night. The seasons are ordered by `starts_on`, so if two ever overlap, the earlier one wins, every time.',
          ],
        },
      ],
    },
  ],
  tests: {
    summary: 'The incident, both rules on their own, a stay across the season’s first night, and a property without a plan',
    blocks: [
      {
        path: 'tests/Feature/NightlyRatesTest.php',
        code: String.raw`<?php

use App\Bookings\Stay;
use App\Models\Property;
use App\Models\RatePlan;
use App\Money\Money;
use App\Pricing\NightlyRates;

beforeEach(function () {
    $this->property = Property::factory()->create(['nightly_rate_cents' => 15_000]);
    $plan = RatePlan::forceCreate([
        'account_id' => $this->property->account_id, 'name' => 'Skagen cottages',
        'nightly_rate_cents' => 16_000, 'currency' => 'EUR', 'weekend_uplift_bps' => 2_000,
    ]);
    $plan->seasons()->create(['name' => 'Summer', 'starts_on' => '2027-07-01', 'ends_on' => '2027-08-31', 'nightly_rate_cents' => 18_000]);
    $this->property->forceFill(['rate_plan_id' => $plan->id])->save();
});

/** @return list<int> the price of each night, in cents */
function nightly(Property $property, string $checkIn, string $checkOut): array
{
    return array_map(fn (Money $price): int => $price->amount, app(NightlyRates::class)->for($property->fresh(), Stay::fromDates($checkIn, $checkOut)));
}

it('adds the weekend uplift on top of the summer price', function () {
    expect(nightly($this->property, '2027-07-02', '2027-07-04'))->toBe([21_600, 21_600]);   // Friday and Saturday in July
});

it('charges the plain season price on a summer weekday', function () {
    expect(nightly($this->property, '2027-07-05', '2027-07-06'))->toBe([18_000]);          // a Monday
});

it('keeps the weekend uplift outside the season', function () {
    expect(nightly($this->property, '2027-05-07', '2027-05-09'))->toBe([19_200, 19_200]);   // Friday and Saturday in May
});

it('prices each night on its own when a stay starts before the season', function () {
    expect(nightly($this->property, '2027-06-29', '2027-07-02'))->toBe([16_000, 16_000, 18_000]);   // Tue, Wed, then 1 July
});

it('uses the property’s own price when it has no plan', function () {
    $this->property->forceFill(['rate_plan_id' => null])->save();

    expect(nightly($this->property, '2027-07-02', '2027-07-04'))->toBe([15_000, 15_000]);
});`,
        after: ['2 July 2027 is a Friday and 7 May 2027 is a Friday: the weekend tests use real calendar days, not a mocked "is it the weekend".'],
      },
      {
        path: 'tests/Unit/QuoteNightsTest.php',
        code: String.raw`<?php

use App\Money\Money;
use App\Pricing\QuoteBuilder;

it('adds up nights with different prices in one line', function () {
    $quote = (new QuoteBuilder())->nightsAt([Money::of(16_000, 'EUR'), Money::of(16_000, 'EUR'), Money::of(18_000, 'EUR')])->build();

    expect($quote->lines[0]->amount->amount)->toBe(50_000)
        ->and($quote->lines[0]->description)->toBe('3 nights, €500.00 in total');
});

it('still describes equal nights as a rate', function () {
    $quote = (new QuoteBuilder())->nightsAt([Money::of(15_000, 'EUR')])->build();

    expect($quote->lines[0]->description)->toBe('1 night × €150.00');
});`,
      },
    ],
  },
  next: 'Prices are right inside seasons too. Next, a host duplicates one of her cottages, lowers the copy’s prices, and the original gets cheaper as well.',
};
