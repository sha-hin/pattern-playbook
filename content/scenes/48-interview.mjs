// Scene 48 · The interview: a system design round and a behavioural round, answered with what this course built.

export default {
  description: 'A senior Laravel interview at a company that builds software for vacation rentals: design a channel manager on a whiteboard, defend it against pushback, then answer the behavioural questions. The method (requirements, numbers, data model, APIs, the hard parts, trade-offs) and every answer come from the incidents of this course.',
  incident: {
    channel: '#interview',
    when: 'Thursday 14:00',
    messages: [
      ['Henrik · staff engineer (interviewer)', 'We build software for holiday-rental hosts. Design a **channel manager**: a host connects each listing to Airbnb, Booking.com and Vrbo once, and from then on every booking, cancellation and price change flows between them. **The one thing that must not happen is a double booking.** You have 45 minutes. Talk me through it.'],
      ['You', 'Before I draw anything, can I ask a few questions about scale and what “must not happen” means when the channels themselves are involved?'],
      ['Henrik · staff engineer (interviewer)', 'Good. Go ahead.'],
    ],
  },
  sections: [
    {
      title: 'Minutes 0–5: requirements, out loud',
      text: ['Ask, then write the answers on the board. The interviewer is checking that you build the right thing before you build it well.'],
      blocks: [
        {
          table: [
            ['Functional', 'Non-functional'],
            ['Connect a listing to each channel (OAuth, scene 13)', '**No double bookings** we could have prevented; the rest detected within a minute and handled'],
            ['Import every reservation, change and cancellation (webhooks, polling fallback)', 'A change reaches every channel within a minute'],
            ['Push availability, minimum stays and prices to every channel after any change', 'No lost reservation: every webhook stored before it is processed'],
            ['Hosts see one calendar, live', 'Survives a channel being down or rate limiting us for an hour'],
            ['Book directly on our own site too', 'Multi-tenant: one host never sees another’s data'],
          ],
          after: ['Say the uncomfortable fact early, because it shapes everything after it: **we can’t make double bookings impossible.** Airbnb can sell a night in the same second Booking.com does; neither asks us first. What we control is how short that window is, and what happens when it closes on a clash.'],
        },
      ],
    },
    {
      title: 'Minutes 5–10: numbers',
      text: ['Round numbers, said out loud, so the design is sized for something real:'],
      blocks: [
        {
          table: [
            ['Quantity', 'Estimate', 'What it decides'],
            ['Properties', '50,000; 3 channels each → 150,000 listings', 'one MySQL primary holds this easily'],
            ['Bookings', '20,000 a day ≈ 0.25/s average, ~5/s at peak', 'writes are not the problem'],
            ['Calendar changes', 'each booking, cancellation, price or rule change → ~100,000 a day', 'each one means a push to every other channel'],
            ['Pushes', '100,000 × 2 other channels = 200,000 a day, in bursts', 'coalescing per listing (scene 17), rate limits (scene 16)'],
            ['iCal feeds (channels without an API)', '20,000 feeds every 15 minutes ≈ 22 per second', 'write only what changed (scene 41)'],
            ['Searches', '~400/s on a busy evening', 'read replicas and indexes (scene 42), a search engine for text (scene 43)'],
          ],
          after: ['The conclusion the numbers give you: this is **not** a big-data problem. It is a correctness and integration problem at moderate scale. A well-indexed MySQL with a replica, Redis and a queue is enough, and saying so is a senior answer.'],
        },
      ],
    },
    {
      title: 'Minutes 10–20: the data model and the flows',
      blocks: [
        {
          path: 'the core tables (a sketch, not every column)',
          lang: 'sql',
          code: String.raw`accounts            (id, name)                                     -- every query starts here (scene 19)
properties          (id, account_id, timezone, min_nights, rate_plan_id)
channel_listings    (id, property_id, channel, external_listing_id, last_pushed_at, last_push_error)
bookings            (id, property_id, channel NULL, external_id NULL, external_version,
                     status, check_in, check_out, total_cents, currency)
                    UNIQUE (channel, external_id)                  -- one row per channel reservation, ever (scene 15)
external_blocks     (property_id, source, uid, starts_on, ends_on) -- from iCal feeds (scene 12)
webhook_events      (provider, event_id, payload, status)          -- the inbox: stored before processing (scene 8)
outbox_messages     (uuid, account_id, type, version, payload, published_at)   -- the outbox (scene 36)
overbookings        (booking_id, conflicting_booking_id)           -- detected, never silent (scene 18)`,
        },
        {
          table: [
            ['Flow', 'Steps'],
            ['Inbound reservation', 'Webhook → verify signature → store in `webhook_events` → 200 → queued job → lock the property → upsert by `(channel, external_id)` if the version is newer → coordinator (scenes 8, 14, 15)'],
            ['The coordinator', 'One class every calendar change goes through: record clashes, plan the cleaning, push to the other channels, update screens, write the partner message (scenes 18, 26, 32, 36)'],
            ['Outbound push', 'One queued push per listing (coalesced), sending the **full calendar state**, not the change; rate limited per channel; `Retry-After` honoured (scenes 16, 17)'],
            ['Safety nets', 'Polling every 10 minutes for missed webhooks; nightly reconciliation of our calendar against each channel’s (scenes 11, 15)'],
          ],
        },
      ],
    },
    {
      title: 'Minutes 20–40: the pushback',
      text: ['This is the part that decides the interview. Each question has a short answer, a reason, and the failure it prevents.'],
      blocks: [
        {
          table: [
            ['Henrik asks', 'You answer'],
            ['“Why not just lock the calendar across all channels before accepting a booking?”', 'We can lock our own bookings (scene 4), but we can’t make Airbnb wait for our lock. So the design is: lock what we own, push fast so the channels’ windows are short, and detect clashes the moment a channel tells us (scene 18).'],
            ['“Webhooks arrive out of order. A cancellation before the booking. Now what?”', 'Every reservation carries the channel’s version or `updated_at`. We store the newest and ignore older ones, under the property lock, and a cancellation for an unknown booking is kept as a tombstone (scene 15).'],
            ['“Airbnb is down for an hour. What breaks?”', 'Nothing is lost: pushes retry with backoff until a deadline (`retryUntil`), and because each push sends the whole state, the first one that succeeds repairs everything. Inbound, the poller catches up from `updated_since` (scenes 15, 16).'],
            ['“Why push the whole calendar, not the change?”', 'A lost or reordered change leaves the channel wrong forever; a lost full push is fixed by the next one. And a burst of 200 changes becomes one push (scene 17).'],
            ['“Why MySQL and a queue, not Kafka?”', 'At ~5 writes a second there’s no throughput reason. The real risk is losing a message between the database and the queue, which the outbox solves without a new system. Kafka becomes worth it when many independent services consume the same events (scene 36).'],
            ['“How do you know it works?”', 'Contract tests per channel with recorded payloads and `Http::preventStrayRequests()`, a real concurrency test on MySQL for the lock (scene 4), load tests at a fixed arrival rate (scene 42), and the nightly reconciliation as the production check that the design holds.'],
            ['“It grows 10×. What changes first?”', 'The push volume, so more `channels` workers within each channel’s rate limit; then the replica count for reads. Sharding comes much later, and the follow-up below is what to say when he asks.'],
          ],
        },
      ],
    },
    {
      title: 'The follow-up: “Now it grows 100×”',
      text: [
        'Henrik’s last push: 5 million properties, 2 million bookings a day, 500 writes a second at peak, a few terabytes of calendars. Answer in the same order as before: what breaks first, and the smallest change that fixes it.',
        'Reads scale with replicas (scene 42) and the CDN (scene 42, part 3) for a long way. **Writes** don’t: every booking, import and push still lands on one primary, and at some point its disk, its buffer pool or its binary log can’t keep up. That is when you **shard**: split the data across several primaries, each holding a slice.',
      ],
      blocks: [
        {
          table: [
            ['Question', 'Answer'],
            ['Shard by what?', 'The **account**. Every query already starts from it (scene 19), a booking never involves two accounts, and the overlap check and its lock (scene 4) stay inside one account’s properties, so inside one shard.'],
            ['How does a request find its shard?', 'A small **directory**: `account_id → shard`, cached everywhere, owned by one service. Not `account_id % n`: with a directory a large account can move to its own shard, and adding a shard moves nobody until you say so.'],
            ['What breaks?', 'Everything that reads **across** accounts: search for guests (Meilisearch already holds every property, scene 43, and becomes the only cross-shard read path), admin reports and finance totals (go to a warehouse fed by the outbox, scene 36), unique keys across shards (`(channel, external_id)` must include which account’s shard, or be checked in the directory), and auto-increment ids (switch to ids that are unique everywhere: ULIDs, or a shard prefix).'],
            ['What about webhooks?', 'Airbnb doesn’t know our shards. The webhook lands on any server, the listing id is looked up in a global `channel_listings` directory, and the event is stored in the right shard’s inbox.'],
            ['How do you get there without downtime?', 'One account at a time: copy its rows to the new shard, replay the changes made during the copy from the binary log (or the outbox), stop its writes for seconds, switch the directory entry, resume. Big tenants first, to prove the tool on few rows that matter.'],
            ['Would you do it now?', '**No.** At today’s 5 writes a second, sharding buys nothing and costs every cross-account feature. What you do now is keep the door open: every query starts from the account, nothing joins across accounts, and ids don’t assume one database. This course already does all three.'],
          ],
          after: ['The senior answer is the last row. Interviewers ask about 100× to see whether you know the tool, and whether you know it is not for today.'],
        },
      ],
    },
    {
      title: 'Minutes 40–45: the trade-offs, summarised',
      blocks: [
        {
          table: [
            ['We chose', 'Over', 'Because', 'We pay with'],
            ['Detect and resolve clashes', 'Preventing them', 'Channels don’t ask us first', 'An overbooking process for support'],
            ['Full-state pushes', 'Change events', 'Self-healing', 'More API calls (coalesced)'],
            ['Outbox in MySQL', 'Publishing after commit', 'No lost messages', 'A relay job and up-to-a-minute delay'],
            ['At-least-once + idempotent consumers', 'Exactly-once', 'Achievable', 'Event ids everywhere'],
            ['One MySQL + replica', 'A distributed store', 'The numbers allow it', 'A known ceiling, years away'],
          ],
        },
      ],
    },
    {
      title: 'The behavioural round',
      text: ['Answer with real stories in four parts: the **situation**, what **you** did, the **result** with a number, and what you **changed** so it can’t happen again. One or two minutes each. These are written from the incidents in this course; in a real interview, use your own.'],
      blocks: [
        {
          table: [
            ['Question', 'The story', 'What it shows'],
            ['“Tell me about a production incident you led.”', 'Scene 46: the queue stalled. I read the kernel log first, saw the memory climb in a straight line, reproduced it in tinker, removed the static array, and wrote a blameless postmortem with five actions, including the alert that would have paged us at minute five instead of hour three.', 'Method under pressure; fixing the system, not the symptom'],
            ['“A time you disagreed with a decision.”', 'Scene 35: the team wanted to cache nightly rates inside the pricing class, for speed. I argued that the price a guest pays must never come from a cache, and proposed a caching proxy used only by the quote page. We shipped it with a test proving bookings read the database.', 'Disagreeing with reasons, offering an alternative'],
            ['“A trade-off you made.”', 'Scene 36: partner webhooks queued after commit were lost during a Redis failover. I chose an outbox: up to a minute of delay, and partners must ignore repeats, in exchange for never losing a message. I wrote the partner documentation for the two promises.', 'Naming what you gave up'],
            ['“How do you onboard or mentor someone?”', 'Scene 47: I walked a new developer through one booking end to end, then the rules for where code goes, then the checks before a push. The architecture test we added that week caught a real race in her first review.', 'Teaching with the real system'],
            ['“A mistake you made.”', 'Scene 40: an export I reviewed went out without the account scope. I didn’t see that it started from a different table. We reported the breach within 72 hours, and I designed the base export so a scope can’t be skipped again.', 'Owning it, and fixing the class of bug'],
          ],
          after: ['A good answer ends with what changed. "We fixed the bug" is a junior ending; "and now that kind of bug can’t ship, because…" is a senior one.'],
        },
      ],
    },
  ],
  next: 'Henrik’s last question: “We use AI coding tools a lot. Here’s a pull request one of them wrote. Review it.” That is the last scene.',
};
