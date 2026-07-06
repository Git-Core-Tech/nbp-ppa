#!/usr/bin/env python3
"""Load/stream test harness for the queueforwarding gateway.

Generates a configurable number of synthetic "layering" transactions — one
originator account splits funds out to N accounts, half of which consolidate
back into a single sink account — and sends them either:

  burst   — fire everything concurrently, as fast as possible, to see where
            the pipeline chokes (single-connection gateway, TMS latency, etc).
  tapered — spread the same batch evenly across a fixed duration (e.g. 5000
            txns over 30 minutes) to simulate steady real-world traffic
            instead of a spike.

Each transaction gets a unique STAN/RRN seeded from the run's start time —
earlier testing showed that reusing STANs across runs makes the gateway
choke on duplicate detection, so this must never repeat one from a prior run.

Usage:
  python load_test_scenario.py --count 1000 --mode burst
  python load_test_scenario.py --count 2500 --mode burst --concurrency 50
  python load_test_scenario.py --count 5000 --mode tapered --duration 30
"""

import argparse
import hashlib
import random
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

URL1 = "http://10.0.110.7:7033/nbpl/queueforwarding/"
SHA_SECRET = ",paysys@123"
REQUEST_TIMEOUT = 5  # fire-and-forget; the gateway may never send a response

ORIGINATOR = ("4220171772395", "ORIGINATOR A001")
SINK = ("00023173019999", "FINAL SINK")

# Seeds this run's STAN/RRN numbering off the current time so it never collides
# with a previous run's already-processed (or still-queued) transactions.
RUN_OFFSET = int(time.time()) % 900000
RUN_EPOCH = int(time.time()) % 1000000


def amt(n):
    return str(n).zfill(12)


def stan_rrn_for(i):
    stan = str((RUN_OFFSET + i) % 900000 + 100000)
    rrn = f"{RUN_EPOCH:06d}{i:06d}"
    return stan, rrn


def make_mid_accounts(n):
    return {f"M{i:05d}": (str(20000000 + i).zfill(14), f"MID {i:05d}") for i in range(1, n + 1)}


def build_dataset(count):
    """Hop 1: originator -> ~count/2 mid accounts. Hop 2: those mid accounts -> sink.
    Roughly `count` transactions total, generated programmatically for any size."""
    half = max(1, count // 2)
    mid_accounts = list(make_mid_accounts(half).values())

    txns = []
    for acct, label in mid_accounts:
        amount = random.randint(700000, 999999)
        txns.append((ORIGINATOR[0], ORIGINATOR[1], acct, label, amount))

    remaining = count - len(txns)
    for i in range(remaining):
        acct, label = mid_accounts[i % len(mid_accounts)]
        amount = random.randint(700000, 999999)
        txns.append((acct, label, SINK[0], SINK[1], amount))

    return txns[:count]


def make_payload(i, src_acct, src_name, dst_acct, dst_name, amount):
    stan, rrn = stan_rrn_for(i)
    ts = datetime.now()
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


def send_one(i, txn, stats):
    src_acct, src_name, dst_acct, dst_name, amount = txn
    payload = make_payload(i, src_acct, src_name, dst_acct, dst_name, amount)
    start = time.monotonic()
    try:
        call(payload)
        stats.record("ok", time.monotonic() - start)
    except TimeoutError:
        stats.record("timeout", time.monotonic() - start)
    except Exception as exc:
        stats.record("failed", time.monotonic() - start)
        print(f"  [{i}] FAILED: {exc}", flush=True)


def run_burst(txns, concurrency):
    stats = Stats(len(txns))
    print(f"Burst mode: {len(txns)} txns, concurrency={concurrency}")
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for i, txn in enumerate(txns, start=1):
            pool.submit(send_one, i, txn, stats)
    stats.summary()


def run_tapered(txns, duration_minutes, concurrency):
    stats = Stats(len(txns))
    interval = (duration_minutes * 60) / len(txns)
    print(f"Tapered mode: {len(txns)} txns over {duration_minutes} min "
          f"(~1 every {interval:.2f}s), concurrency={concurrency}")
    start_time = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for i, txn in enumerate(txns, start=1):
            target = start_time + (i - 1) * interval
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            pool.submit(send_one, i, txn, stats)
    stats.summary()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, required=True, help="number of transactions to generate (e.g. 1000, 2500, 5000)")
    parser.add_argument("--mode", choices=["burst", "tapered"], required=True)
    parser.add_argument("--duration", type=float, default=30, help="minutes to spread transactions over (tapered mode only, default 30)")
    parser.add_argument("--concurrency", type=int, default=50, help="max concurrent in-flight requests (default 50)")
    args = parser.parse_args()

    dataset = build_dataset(args.count)
    print(f"Generated {len(dataset)} transactions "
          f"({args.count // 2} hop-1 splits, {len(dataset) - args.count // 2} hop-2 consolidations)")

    if args.mode == "burst":
        run_burst(dataset, args.concurrency)
    else:
        run_tapered(dataset, args.duration, args.concurrency)
