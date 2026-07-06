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
import os
import random
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import psycopg2

URL1 = "http://10.0.110.7:7033/nbpl/queueforwarding/"
SHA_SECRET = ",paysys@123"
REQUEST_TIMEOUT = 5  # fire-and-forget; the gateway may never send a response

RUN_TAG = datetime.now().strftime("%y%m%d%H%M%S")

# Same Postgres the evaluation row lands in for the rest of this repo's load
# tests (see perf_breakpoint_test.py) — overridable via env for other hosts.
DB = dict(
    host=os.environ.get("DB_HOST", "localhost"),
    port=int(os.environ.get("DB_PORT", "15432")),
    user=os.environ.get("DB_USER", "postgres"),
    dbname=os.environ.get("DB_NAME", "evaluation"),
)
if os.environ.get("DB_PASSWORD"):
    DB["password"] = os.environ["DB_PASSWORD"]


def cleanup_evaluation_table():
    """Truncate the evaluation table so each run starts from a clean baseline
    (mirrors perf_breakpoint_test.py's cleanup_tables)."""
    conn = psycopg2.connect(**DB)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("TRUNCATE evaluation RESTART IDENTITY CASCADE;")
    cur.close()
    conn.close()
    print("  truncated 'evaluation' table", flush=True)


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

    def summary_dict(self):
        wall = time.monotonic() - self.start
        lat = sorted(self.latencies)
        p50 = lat[len(lat) // 2] if lat else 0
        p95 = lat[int(len(lat) * 0.95)] if lat else 0
        p99 = lat[int(len(lat) * 0.99)] if lat else 0
        ok = self.sent - self.timed_out - self.failed
        return {
            "total": self.total, "sent": self.sent, "ok": ok,
            "timed_out": self.timed_out, "failed": self.failed,
            "wall_s": wall, "req_per_s": (self.sent / wall) if wall > 0 else 0.0,
            "lat_min": lat[0] if lat else 0.0, "lat_mean": (sum(lat) / len(lat)) if lat else 0.0,
            "lat_p50": p50, "lat_p95": p95, "lat_p99": p99, "lat_max": lat[-1] if lat else 0.0,
        }

    def summary(self):
        d = self.summary_dict()
        print("\n=========== SUMMARY ===========")
        print(f"Total sent:      {d['sent']}/{d['total']}")
        print(f"Wall time:       {d['wall_s']:.1f}s ({d['req_per_s']:.1f} req/s)" if d["wall_s"] > 0 else "Wall time: n/a")
        print(f"Responded 200:   {d['ok']}")
        print(f"Timed out:       {d['timed_out']} (expected if the gateway is fire-and-forget)")
        print(f"Hard failures:   {d['failed']} (connection refused / DNS / etc — real problems)")
        print(f"Latency p50/p95/p99: {d['lat_p50']:.2f}s / {d['lat_p95']:.2f}s / {d['lat_p99']:.2f}s")
        return d


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
    return stats.summary()


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
    return stats.summary()


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


# Shared design language with reports/performance_report.html, so every
# report in this repo reads as one system.
REPORT_CSS = """<style>
  .rp {
    --surface-1: #fcfcfb; --page: #f9f9f7; --text-primary: #0b0b0b; --text-secondary: #52514e;
    --text-muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6; --series-2: #1baf7a; --series-3: #eda100; --series-5: #4a3aa7; --series-6: #e34948;
    --status-good: #0ca30c; --status-warning: #fab219; --status-critical: #d03b3b;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text-primary);
    background: var(--page); line-height: 1.5;
  }
  @media (prefers-color-scheme: dark) {
    .rp {
      --surface-1: #1a1a19; --page: #0d0d0d; --text-primary: #ffffff; --text-secondary: #c3c2b7;
      --text-muted: #898781; --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
      --series-1: #3987e5; --series-2: #199e70; --series-3: #c98500; --series-5: #9085e9; --series-6: #e66767;
    }
  }
  :root[data-theme="dark"] .rp {
    --surface-1: #1a1a19; --page: #0d0d0d; --text-primary: #ffffff; --text-secondary: #c3c2b7;
    --text-muted: #898781; --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --series-1: #3987e5; --series-2: #199e70; --series-3: #c98500; --series-5: #9085e9; --series-6: #e66767;
  }
  :root[data-theme="light"] .rp {
    --surface-1: #fcfcfb; --page: #f9f9f7; --text-primary: #0b0b0b; --text-secondary: #52514e;
    --text-muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6; --series-2: #1baf7a; --series-3: #eda100; --series-5: #4a3aa7; --series-6: #e34948;
  }
  .rp * { box-sizing: border-box; }
  .rp-wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 96px; }
  .rp h1 { font-size: 26px; font-weight: 650; margin: 0 0 4px; letter-spacing: -0.01em; }
  .rp .subtitle { color: var(--text-secondary); font-size: 14px; margin: 0 0 32px; }
  .rp h2 { font-size: 18px; font-weight: 650; margin: 48px 0 4px; }
  .rp h2 .num { color: var(--text-muted); font-weight: 500; margin-right: 8px; }
  .rp .section-sub { color: var(--text-secondary); font-size: 13.5px; margin: 0 0 20px; max-width: 720px; }
  .rp code { background: var(--grid); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
  .rp .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; }
  .rp .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 8px; }
  .rp .stat-tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .rp .stat-tile .label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
  .rp .stat-tile .value { font-size: 26px; font-weight: 650; letter-spacing: -0.01em; }
  .rp .stat-tile .value.critical { color: var(--status-critical); }
  .rp .stat-tile .value.good { color: var(--status-good); }
  .rp .stat-tile .delta { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .rp .callout { border-radius: 10px; padding: 14px 16px; font-size: 13.5px; margin: 16px 0; border: 1px solid; }
  .rp .callout.critical { background: color-mix(in srgb, var(--status-critical) 10%, var(--surface-1)); border-color: color-mix(in srgb, var(--status-critical) 35%, transparent); }
  .rp .callout.good { background: color-mix(in srgb, var(--status-good) 10%, var(--surface-1)); border-color: color-mix(in srgb, var(--status-good) 35%, transparent); }
  .rp .callout .tag { font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; display: block; margin-bottom: 4px; }
  .rp .callout.critical .tag { color: var(--status-critical); }
  .rp .callout.good .tag { color: var(--status-good); }
  .rp table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 4px; }
  .rp td { padding: 9px 10px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .rp td.strong { color: var(--text-primary); font-weight: 600; }
  .rp tr:last-child td { border-bottom: none; }
  .rp .num { text-align: right; }
  .rp .bar-cell { position: relative; }
  .rp .bar-cell .track { position: absolute; inset: 4px 10px; background: var(--grid); border-radius: 4px; z-index: 0; }
  .rp .bar-cell .fill { position: absolute; top: 4px; bottom: 4px; left: 10px; border-radius: 4px; z-index: 1; }
  .rp .bar-cell .label { position: relative; z-index: 2; padding-left: 4px; }
  .rp footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
  @media (max-width: 720px) { .rp .stat-row { grid-template-columns: repeat(2, 1fr); } }
</style>"""


def _tile(label, value, delta="", cls=""):
    return (f'<div class="stat-tile"><div class="label">{label}</div>'
            f'<div class="value {cls}">{value}</div><div class="delta">{delta}</div></div>')


def _bar_row(label, value_label, pct_of_max, color="var(--series-1)"):
    pct_of_max = max(0.0, min(100.0, pct_of_max))
    return (f'<tr><td class="strong">{label}</td>'
            f'<td class="num bar-cell" style="min-width:160px;">'
            f'<span class="track" style="right:{100 - pct_of_max:.1f}%"></span>'
            f'<span class="fill" style="width:{pct_of_max:.1f}%; background:{color}; opacity:0.35;"></span>'
            f'<span class="label">{value_label}</span></td></tr>')


def write_html_report(args, counts, result, started, finished):
    """Renders a timestamped, self-contained HTML performance report for this
    run (send throughput, outcome breakdown, latency distribution) to
    reports/layering_stress_report_<RUN_TAG>.html."""
    sent, total = result["sent"], result["total"]
    ok, timed_out, failed = result["ok"], result["timed_out"], result["failed"]

    if failed > 0:
        callout = (f'<div class="callout critical"><span class="tag">Hard failures detected</span>'
                    f'{failed} of {sent} requests hit a hard failure (connection refused / DNS / etc.) '
                    f'&mdash; see the console log for per-request errors. Timeouts are expected for this '
                    f'fire-and-forget gateway and are not counted here.</div>')
    elif timed_out > 0:
        callout = (f'<div class="callout good"><span class="tag">No hard failures</span>'
                    f'{timed_out} of {sent} requests timed out client-side after {REQUEST_TIMEOUT}s &mdash; '
                    f'expected for a fire-and-forget gateway that does not always reply in time, and not '
                    f'counted as a failure.</div>')
    else:
        callout = ('<div class="callout good"><span class="tag">Clean run</span>'
                    'Every request completed without a client-side timeout or hard failure.</div>')

    max_kind = max(counts.values()) if counts else 1
    breakdown_rows = "\n".join(
        _bar_row(kind, f"{n} ({n / total * 100:.1f}%)", (n / max_kind) * 100,
                 color="var(--status-critical)" if kind.startswith("ring") else "var(--series-1)")
        for kind, n in sorted(counts.items(), key=lambda kv: -kv[1])
    )

    lat_fields = [("min", result["lat_min"]), ("p50", result["lat_p50"]), ("mean", result["lat_mean"]),
                  ("p95", result["lat_p95"]), ("p99", result["lat_p99"]), ("max", result["lat_max"])]
    max_lat = max(v for _, v in lat_fields) or 1.0
    latency_rows = "\n".join(
        _bar_row(name.upper(), f"{v * 1000:.0f} ms", (v / max_lat) * 100,
                 color="var(--status-critical)" if name in ("p99", "max") else "var(--series-1)")
        for name, v in lat_fields
    )

    duration_note = f"{args.duration:.0f} min tapered" if args.mode == "tapered" else "burst (no pacing)"
    window_end = (DAY_ZERO + timedelta(days=RING_SPAN_DAYS)).date()

    if args.mode == "tapered":
        target_tps = total / (args.duration * 60)
        target_tps_display = f"{target_tps:.2f}"
        target_tps_delta = "paced by --duration/--count"
    else:
        target_tps_display = "unpaced"
        target_tps_delta = f"burst, concurrency={args.concurrency}"

    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Layering Stress Test -- Performance Report ({RUN_TAG})</title>
{REPORT_CSS}
</head>
<body>
<div class="rp">
<div class="rp-wrap">

  <h1>NBP Layering Stress Test &mdash; Performance Report</h1>
  <p class="subtitle">{args.mode} run &middot; {total} txns ({args.rings} ring(s) + noise) &rarr; {URL1} &middot; run {RUN_TAG}</p>

  <div class="stat-row">
    {_tile("Sent", f"{sent}/{total}")}
    {_tile("TPS (achieved)", f"{result['req_per_s']:.2f}", delta=f"wall time {result['wall_s']:.1f}s")}
    {_tile("TPS (target)", target_tps_display, delta=target_tps_delta)}
    {_tile("Responded 200", ok, cls="good")}
  </div>
  <div class="stat-row">
    {_tile("Timed out", timed_out)}
    {_tile("Hard failures", failed, cls="critical" if failed else "good")}
    {_tile("Latency p50", f"{result['lat_p50'] * 1000:.0f} ms")}
    {_tile("Latency p95", f"{result['lat_p95'] * 1000:.0f} ms")}
  </div>

  {callout}

  <h2><span class="num">1</span>Run configuration</h2>
  <div class="card"><table><tbody>
    <tr><td class="strong">Mode</td><td class="num">{duration_note}</td></tr>
    <tr><td class="strong">Concurrency</td><td class="num">{args.concurrency}</td></tr>
    <tr><td class="strong">Rings embedded</td><td class="num">{args.rings}</td></tr>
    <tr><td class="strong">Seed</td><td class="num">{args.seed if args.seed is not None else "random"}</td></tr>
    <tr><td class="strong">Virtual narrative window</td><td class="num">{DAY_ZERO.date()} &rarr; {window_end}</td></tr>
    <tr><td class="strong">Target endpoint</td><td class="num">{URL1}</td></tr>
    <tr><td class="strong">Started</td><td class="num">{started.isoformat(timespec="seconds")}</td></tr>
    <tr><td class="strong">Finished</td><td class="num">{finished.isoformat(timespec="seconds")}</td></tr>
  </tbody></table></div>

  <h2><span class="num">2</span>Dataset breakdown</h2>
  <p class="section-sub">Signal (layering rings) vs. background noise transactions dispatched this run.</p>
  <div class="card"><table><tbody>
    {breakdown_rows}
  </tbody></table></div>

  <h2><span class="num">3</span>Latency distribution</h2>
  <p class="section-sub">Client-observed round-trip latency to the queueforwarding gateway (fire-and-forget --
  this is request latency, not downstream fraud-evaluation latency).</p>
  <div class="card"><table><tbody>
    {latency_rows}
  </tbody></table></div>

  <footer>Generated {datetime.now().isoformat(timespec="seconds")} &middot; script: layering_stress_scenario.py &middot; run tag {RUN_TAG}</footer>

</div>
</div>
</body>
</html>"""

    os.makedirs("reports", exist_ok=True)
    path = f"reports/layering_stress_report_{RUN_TAG}.html"
    with open(path, "w") as f:
        f.write(html)
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=5000, help="total transactions across both rings + noise (default 5000)")
    parser.add_argument("--rings", type=int, default=NUM_RINGS, help="number of independent layering rings to embed (default 2)")
    parser.add_argument("--mode", choices=["burst", "tapered"], default="burst")
    parser.add_argument("--duration", type=float, default=20, help="minutes to spread transactions over (tapered mode only, default 20)")
    parser.add_argument("--concurrency", type=int, default=50, help="max concurrent in-flight requests (default 50)")
    parser.add_argument("--seed", type=int, default=None, help="random seed, for a reproducible noise/amount draw")
    parser.add_argument("--skip-cleanup", action="store_true",
                        help="don't truncate the evaluation table before the run")
    args = parser.parse_args()

    if not args.skip_cleanup:
        print(f"[{RUN_TAG}] cleanup: truncating evaluation table", flush=True)
        cleanup_evaluation_table()

    dataset, counts = build_dataset(args.count, args.rings, args.seed)
    breakdown = ", ".join(f"{k}={v}" for k, v in counts.items())
    print(f"Built {len(dataset)} transactions ({breakdown}), virtual window "
          f"{DAY_ZERO.date()} .. {(DAY_ZERO + timedelta(days=RING_SPAN_DAYS)).date()}")

    payloads = [
        make_payload(i, ts, src_acct, src_name, dst_acct, dst_name, amount)
        for i, (ts, src_acct, src_name, dst_acct, dst_name, amount, _kind) in enumerate(dataset, start=1)
    ]

    started = datetime.now()
    if args.mode == "burst":
        result = run_burst(payloads, args.concurrency)
    else:
        result = run_tapered(payloads, args.duration, args.concurrency)
    finished = datetime.now()

    report_path = write_html_report(args, counts, result, started, finished)
    print(f"[{RUN_TAG}] wrote {report_path}", flush=True)
