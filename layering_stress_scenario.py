#!/usr/bin/env python3
"""Stress test: 5000 transactions over a 30-day window, with 2 layering fraud
rings buried in random noise.

Builds two structurally-identical layering scenarios — each one a single
source account moving a large amount to a single destination account through
a series of intermediary accounts (1 -> 12 -> 6 -> 3 -> 1 fan-out/consolidate,
same topology as layering_scenario.py, stretched across 30 days instead of 11)
— each on its own disjoint account pool so the two rings don't overlap, then
fills the rest of the run with random one-hop "background" transactions
between an unrelated pool of noise accounts, scattered across the same 30-day
window. Every transaction carries a virtual narrative timestamp (which day of
the story it represents, embedded in the payload) that is independent of when
it is actually sent — all transactions are merged and sorted into virtual-time
order so the two fraud rings arrive interleaved with the noise instead of as
an obvious isolated burst, then dispatched with the same burst/tapered stress
harness as load_test_scenario.py.

Usage:
  python3 layering_stress_scenario.py --count 5000 --mode burst
  python3 layering_stress_scenario.py --count 5000 --mode tapered --duration 20 --concurrency 30
"""

import argparse
import hashlib
import random
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

URL1 = "http://10.0.110.7:7033/nbpl/queueforwarding/"
SHA_SECRET = ",paysys@123"
REQUEST_TIMEOUT = 5  # fire-and-forget; the gateway may never send a response

NUM_RINGS = 2
RING_SPAN_DAYS = 29  # each ring's narrative runs day 0 .. 29 — a full 30-day window
DAY_ZERO = datetime(2026, 6, 6, 0, 0, 0)  # virtual day 0; day 29 lands the day before "today"
NOISE_POOL_SIZE = 300
NOISE_AMOUNT_RANGE = (5000, 900000)  # deliberately below the layering amounts, to look benign

# Seeds this run's STAN/RRN numbering off the current time so it never collides
# with a previous run's already-processed (or still-queued) transactions.
RUN_OFFSET = int(time.time()) % 900000
RUN_EPOCH = int(time.time()) % 1000000

# (day_offset, src_role, dst_role, amount_range) — same 1 -> 12 -> 6 -> 3 -> 1
# fan-out/consolidate topology as layering_scenario.py, stretched from its
# original 11-day narrative onto a 30-day one, expressed generically so it can
# be instantiated on any account pool. Roles: ('ORIG',) is the source account,
# ('SINK',) is the destination account, ('L1'|'L2'|'L3', n) are the
# intermediary accounts the funds are layered through between them.
HOP_TEMPLATE = [
    (0, ("ORIG",), ("L1", 1), (7600000, 9700000)),
    (0, ("ORIG",), ("L1", 2), (7600000, 9700000)),
    (0, ("ORIG",), ("L1", 3), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 4), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 5), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 6), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 7), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 8), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 9), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 10), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 11), (7600000, 9700000)),
    (3, ("ORIG",), ("L1", 12), (7600000, 9700000)),

    (6, ("L1", 1), ("L2", 1), (7600000, 8700000)),
    (6, ("L1", 2), ("L2", 1), (7600000, 8700000)),
    (9, ("L1", 3), ("L2", 2), (7600000, 8700000)),
    (9, ("L1", 4), ("L2", 2), (7600000, 8700000)),
    (9, ("L1", 5), ("L2", 3), (7600000, 8700000)),
    (12, ("L1", 6), ("L2", 3), (7600000, 8700000)),
    (12, ("L1", 7), ("L2", 4), (7600000, 8700000)),
    (12, ("L1", 8), ("L2", 4), (7600000, 8700000)),
    (12, ("L1", 9), ("L2", 5), (7600000, 8700000)),
    (15, ("L1", 10), ("L2", 5), (7600000, 8700000)),
    (15, ("L1", 11), ("L2", 6), (7600000, 8700000)),
    (15, ("L1", 12), ("L2", 6), (7600000, 8700000)),

    (17, ("L2", 1), ("L3", 1), (16000000, 17900000)),
    (17, ("L2", 2), ("L3", 1), (16000000, 17900000)),
    (20, ("L2", 3), ("L3", 2), (16000000, 17900000)),
    (20, ("L2", 4), ("L3", 2), (16000000, 17900000)),
    (23, ("L2", 5), ("L3", 3), (16000000, 17900000)),
    (23, ("L2", 6), ("L3", 3), (16000000, 17900000)),

    (26, ("L3", 1), ("SINK",), (32000000, 34500000)),
    (26, ("L3", 2), ("SINK",), (32000000, 34500000)),
    (29, ("L3", 3), ("SINK",), (32000000, 34500000)),
]


def amt(n):
    return str(n).zfill(12)


def stan_rrn_for(i):
    stan = str((RUN_OFFSET + i) % 900000 + 100000)
    rrn = f"{RUN_EPOCH:06d}{i:06d}"
    return stan, rrn


def make_ring_accounts(ring_id):
    """Disjoint account pool for one layering ring — same shape as layering_scenario.py's
    A/B/C/D/Z accounts, but keyed off ring_id so multiple rings never collide."""
    tag = f"RING{ring_id}"
    accounts = {
        ("ORIG",): (f"42201717723{ring_id:02d}", f"{tag} ORIGINATOR"),
        ("SINK",): (f"000231730{ring_id}7999", f"{tag} SINK"),
    }
    for n in range(1, 13):
        accounts[("L1", n)] = (f"000231730{ring_id}74{n:02d}", f"{tag} L1-{n:02d}")
    for n in range(1, 7):
        accounts[("L2", n)] = (f"000231730{ring_id}75{n:02d}", f"{tag} L2-{n:02d}")
    for n in range(1, 4):
        accounts[("L3", n)] = (f"000231730{ring_id}76{n:02d}", f"{tag} L3-{n:02d}")
    return accounts


def random_virtual_ts(day_offset):
    return DAY_ZERO + timedelta(days=day_offset, minutes=random.randint(0, 1439), seconds=random.randint(0, 59))


def build_ring(ring_id):
    accounts = make_ring_accounts(ring_id)
    txns = []
    for day_offset, src_role, dst_role, amount_range in HOP_TEMPLATE:
        src_acct, src_name = accounts[src_role]
        dst_acct, dst_name = accounts[dst_role]
        amount = random.randint(*amount_range)
        txns.append((random_virtual_ts(day_offset), src_acct, src_name, dst_acct, dst_name, amount, f"ring{ring_id}"))
    return txns


def make_noise_accounts(n):
    return [(f"00099173{i:06d}", f"CUST {i:05d}") for i in range(1, n + 1)]


def build_noise(count, pool):
    txns = []
    for _ in range(count):
        src_acct, src_name = random.choice(pool)
        dst_acct, dst_name = random.choice(pool)
        while dst_acct == src_acct:
            dst_acct, dst_name = random.choice(pool)
        amount = random.randint(*NOISE_AMOUNT_RANGE)
        day_offset = random.randint(0, RING_SPAN_DAYS)
        txns.append((random_virtual_ts(day_offset), src_acct, src_name, dst_acct, dst_name, amount, "noise"))
    return txns


def make_payload(i, ts, src_acct, src_name, dst_acct, dst_name, amount):
    stan, rrn = stan_rrn_for(i)
    t1 = ts.strftime("%Y%m%d%H%M%S")
    t2 = ts.strftime("%Y-%m-%d-%H:%M:%S")
    t3 = ts.strftime("%Y-%m-%d%H:%M:%S")
    d1 = ts.strftime("%Y-%m-%d")

    return (
        f'authorization-message,0371,2000,{t1},'
        '0000000000000000,0000000000000000,0000000000000000,'
        f'{stan},{rrn},0200,NBP,NBP,{src_acct},979898,'
        f'{t2},{t3},{amt(amount)},PKR,'
        f'{amt(amount)},586,{amt(amount)},PKR,3,06012,{src_name},,{dst_name},'
        '40,00,00,000,,,60,,,,0,0,0,,,,,,,,,,,,,,,,,,,,,00,,,,,,'
        '00000000000000000,00000000000000000,00000000000000000,,'
        '00000000000000000,,00000000,,0,00000000000000000,,,,,'
        f'{d1},,,,,,,,,,,,0,,,,,,,,,,,,,,,,,,,PKR,PKR,,,000,,'
        f'00000000000000000,,{dst_acct},NBP,000,,00000000000000000,,,,'
        '000,,00000000000000000,,,,000,,,,,,,00,00,000,,0,000'
    )


def sha256_hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def call(url_parameters, base_url=URL1):
    escaped = urllib.parse.quote(url_parameters, safe="-_.*")
    digest = sha256_hex(url_parameters + SHA_SECRET)
    url = f"{base_url}{escaped}/{digest}"
    with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as resp:
        return resp.status, resp.read().decode("utf-8")


class Stats:
    def __init__(self, total):
        self.total = total
        self.lock = threading.Lock()
        self.sent = 0
        self.timed_out = 0
        self.failed = 0
        self.latencies = []
        self.start = time.monotonic()

    def record(self, kind, elapsed):
        with self.lock:
            self.sent += 1
            if kind == "timeout":
                self.timed_out += 1
            elif kind == "failed":
                self.failed += 1
            self.latencies.append(elapsed)
            if self.sent % max(1, self.total // 20) == 0 or self.sent == self.total:
                wall = time.monotonic() - self.start
                rate = self.sent / wall if wall > 0 else 0
                print(f"  [{self.sent}/{self.total}] {wall:.1f}s elapsed, {rate:.1f} req/s, "
                      f"{self.timed_out} timed out, {self.failed} failed", flush=True)

    def summary(self):
        wall = time.monotonic() - self.start
        lat = sorted(self.latencies)
        p50 = lat[len(lat) // 2] if lat else 0
        p95 = lat[int(len(lat) * 0.95)] if lat else 0
        p99 = lat[int(len(lat) * 0.99)] if lat else 0
        ok = self.sent - self.timed_out - self.failed
        print("\n=========== SUMMARY ===========")
        print(f"Total sent:      {self.sent}/{self.total}")
        print(f"Wall time:       {wall:.1f}s ({self.sent / wall:.1f} req/s)" if wall > 0 else "Wall time: n/a")
        print(f"Responded 200:   {ok}")
        print(f"Timed out:       {self.timed_out} (expected if the gateway is fire-and-forget)")
        print(f"Hard failures:   {self.failed} (connection refused / DNS / etc — real problems)")
        print(f"Latency p50/p95/p99: {p50:.2f}s / {p95:.2f}s / {p99:.2f}s")


def send_one(i, payload, stats):
    start = time.monotonic()
    try:
        call(payload)
        stats.record("ok", time.monotonic() - start)
    except TimeoutError:
        stats.record("timeout", time.monotonic() - start)
    except Exception as exc:
        stats.record("failed", time.monotonic() - start)
        print(f"  [{i}] FAILED: {exc}", flush=True)


def run_burst(payloads, concurrency):
    stats = Stats(len(payloads))
    print(f"Burst mode: {len(payloads)} txns, concurrency={concurrency}")
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for i, payload in enumerate(payloads, start=1):
            pool.submit(send_one, i, payload, stats)
    stats.summary()


def run_tapered(payloads, duration_minutes, concurrency):
    stats = Stats(len(payloads))
    interval = (duration_minutes * 60) / len(payloads)
    print(f"Tapered mode: {len(payloads)} txns over {duration_minutes} min "
          f"(~1 every {interval:.2f}s), concurrency={concurrency}")
    start_time = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for i, payload in enumerate(payloads, start=1):
            target = start_time + (i - 1) * interval
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            pool.submit(send_one, i, payload, stats)
    stats.summary()


def build_dataset(total, num_rings, seed):
    if seed is not None:
        random.seed(seed)

    ring_txns = []
    for ring_id in range(1, num_rings + 1):
        ring_txns.append(build_ring(ring_id))

    signal_count = sum(len(r) for r in ring_txns)
    noise_count = total - signal_count
    if noise_count < 0:
        raise SystemExit(f"--count {total} is smaller than the {signal_count} transactions "
                          f"needed for {num_rings} layering rings ({signal_count // num_rings} each).")

    noise_pool = make_noise_accounts(NOISE_POOL_SIZE)
    noise_txns = build_noise(noise_count, noise_pool)

    all_txns = [t for ring in ring_txns for t in ring] + noise_txns
    all_txns.sort(key=lambda t: t[0])  # virtual-time order, so signal interleaves with noise

    counts = {"noise": len(noise_txns)}
    for ring_id in range(1, num_rings + 1):
        counts[f"ring{ring_id}"] = len(ring_txns[ring_id - 1])
    return all_txns, counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=5000, help="total transactions across both rings + noise (default 5000)")
    parser.add_argument("--rings", type=int, default=NUM_RINGS, help="number of independent layering rings to embed (default 2)")
    parser.add_argument("--mode", choices=["burst", "tapered"], default="burst")
    parser.add_argument("--duration", type=float, default=20, help="minutes to spread transactions over (tapered mode only, default 20)")
    parser.add_argument("--concurrency", type=int, default=50, help="max concurrent in-flight requests (default 50)")
    parser.add_argument("--seed", type=int, default=None, help="random seed, for a reproducible noise/amount draw")
    args = parser.parse_args()

    dataset, counts = build_dataset(args.count, args.rings, args.seed)
    breakdown = ", ".join(f"{k}={v}" for k, v in counts.items())
    print(f"Built {len(dataset)} transactions ({breakdown}), virtual window "
          f"{DAY_ZERO.date()} .. {(DAY_ZERO + timedelta(days=RING_SPAN_DAYS)).date()}")

    payloads = [
        make_payload(i, ts, src_acct, src_name, dst_acct, dst_name, amount)
        for i, (ts, src_acct, src_name, dst_acct, dst_name, amount, _kind) in enumerate(dataset, start=1)
    ]

    if args.mode == "burst":
        run_burst(payloads, args.concurrency)
    else:
        run_tapered(payloads, args.duration, args.concurrency)
