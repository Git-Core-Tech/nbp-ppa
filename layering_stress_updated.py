#!/usr/bin/env python3
"""Layering stress test (work in progress).

Stage 1: clean the existing data from evaluation/pacs002/pacs008 so every run
starts from a known-empty baseline. Runs unconditionally, as soon as the
script is executed.

Stage 2 (this version): interactively ask the user for
  1. how many layering fraud rings to embed
  2. total transaction count (rings' signal + noise combined)
  3. total time budget (minutes)
then build that dataset (same ring/noise generation as
layering_stress_scenario.py) and dispatch it at a constant 5 TPS (one every
200ms) — not a ramp-up/ramp-down burst — stopping when either the dataset is
exhausted or the time budget elapses, whichever comes first.

After sending, waits for Tazama's async pipeline (TMS -> ED -> rules ->
typology -> TADP) to finish writing evaluation rows, then generates a
self-contained HTML report (reports/layering_stress_report_<RUN_TAG>.html)
with per-transaction latency (evaluation.report.timestamp minus the pacs.002
AccptncDtTm nbp-ppa stamped on it), average/percentile latency, and
DB-observed TPS.

DB connection is read from the environment (never hardcoded, since this
script is committed to a shared repo):
  DB_HOST      default 10.0.110.120
  DB_PORT      default 15432
  DB_USER      default postgres
  DB_PASSWORD  required, no default — set it in a gitignored .env.local

Usage:
  python3 layering_stress_updated.py
"""

import hashlib
import os
import random
import socket
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

RATE_TPS = 5
INTERVAL_S = 0.2  # 1 / RATE_TPS — fixed 200ms gap between sends, not a ramp

RUN_TAG = datetime.now().strftime("%y%m%d%H%M%S")


def load_dotenv(path=".env"):
    """Minimal .env loader (stdlib only): sets os.environ from KEY=VALUE lines,
    without overriding vars already set in the real environment (so an
    explicit `export` still wins over the file)."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()


load_dotenv(".env")
load_dotenv(".env.local")  # gitignored, real secrets go here

# Postgres connection — see module docstring. Password has no default on purpose.
DB = dict(
    host=os.environ.get("DB_HOST", "10.0.110.120"),
    port=int(os.environ.get("DB_PORT", "15432")),
    user=os.environ.get("DB_USER", "postgres"),
    password=os.environ.get("DB_PASSWORD"),
)

# Tables cleared before every run — evaluation lives in the 'evaluation' database,
# pacs002/pacs008 live in 'raw_history' (postgres/migration/base/00-CREATE.sql in
# Full-Stack-Docker-Tazama). No FKs reference these tables, so plain DELETE FROM
# in any order is safe.
CLEANUP_DBS = {
    "evaluation": ["evaluation"],
    "raw_history": ["pacs002", "pacs008"],
}

RING_SPAN_DAYS = 29  # each ring's narrative runs day 0 .. 29 — a full 30-day window
DAY_ZERO = datetime(2026, 6, 6, 0, 0, 0)  # virtual day 0
NOISE_POOL_SIZE = 300
NOISE_AMOUNT_RANGE = (5000, 900000)  # deliberately below the layering amounts, to look benign

# Seeds this run's STAN/RRN numbering off the current time so it never collides
# with a previous run's already-processed (or still-queued) transactions.
RUN_OFFSET = int(time.time()) % 900000
RUN_EPOCH = int(time.time()) % 1000000

# (day_offset, src_role, dst_role, amount_range) — 1 -> 12 -> 6 -> 3 -> 1
# fan-out/consolidate topology, same as layering_scenario.py, stretched onto a
# 30-day narrative window, expressed generically so it can be instantiated on
# any account pool. Roles: ('ORIG',) is the source account, ('SINK',) is the
# destination account, ('L1'|'L2'|'L3', n) are the intermediary accounts the
# funds are layered through between them.
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


def cleanup_tables():
    """Deletes all rows from evaluation/pacs002/pacs008 so every run starts
    from a known-empty baseline."""
    if not DB["password"]:
        raise SystemExit(
            "DB_PASSWORD is not set. Put it in .env.local (gitignored) or export it "
            "before running this script — the password is deliberately not "
            "hardcoded here since this file is committed to a shared repo."
        )
    for dbname, tables in CLEANUP_DBS.items():
        conn = psycopg2.connect(dbname=dbname, **DB)
        conn.autocommit = True
        cur = conn.cursor()
        for table in tables:
            cur.execute(f"DELETE FROM {table};")
            print(f"  deleted {cur.rowcount} row(s) from '{dbname}.{table}'", flush=True)
        cur.close()
        conn.close()


def ask_int(prompt, minimum=0):
    while True:
        raw = input(prompt).strip()
        try:
            value = int(raw)
        except ValueError:
            print("  please enter a whole number.")
            continue
        if value < minimum:
            print(f"  please enter a number >= {minimum}.")
            continue
        return value


def ask_float(prompt, minimum=0.0):
    while True:
        raw = input(prompt).strip()
        try:
            value = float(raw)
        except ValueError:
            print("  please enter a number.")
            continue
        if value < minimum:
            print(f"  please enter a number >= {minimum}.")
            continue
        return value


def prompt_run_params():
    print("\n=== Layering stress test — run parameters ===")
    num_rings = ask_int("1. How many layering fraud scenarios (rings) to embed? ", minimum=0)
    total_count = ask_int(
        "2. Total number of transactions to create (layering scenario + noise combined)? ",
        minimum=1,
    )
    total_time_minutes = ask_float("3. Total time to run, in minutes? ", minimum=0.01)
    return num_rings, total_count, total_time_minutes


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


def build_dataset(total, num_rings):
    ring_txns = []
    for ring_id in range(1, num_rings + 1):
        ring_txns.append(build_ring(ring_id))

    signal_count = sum(len(r) for r in ring_txns)
    noise_count = total - signal_count
    if noise_count < 0:
        raise SystemExit(
            f"total transaction count {total} is smaller than the {signal_count} transactions "
            f"needed for {num_rings} layering ring(s) ({signal_count // num_rings if num_rings else 0} each)."
        )

    noise_pool = make_noise_accounts(NOISE_POOL_SIZE)
    noise_txns = build_noise(noise_count, noise_pool)

    all_txns = [t for ring in ring_txns for t in ring] + noise_txns
    all_txns.sort(key=lambda t: t[0])  # virtual-time order, so signal interleaves with noise

    counts = {"noise": len(noise_txns)}
    for ring_id in range(1, num_rings + 1):
        counts[f"ring{ring_id}"] = len(ring_txns[ring_id - 1])
    return all_txns, counts


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
            if self.sent % 10 == 0 or self.sent == self.total:
                wall = time.monotonic() - self.start
                rate = self.sent / wall if wall > 0 else 0
                print(f"  [{self.sent}/{self.total}] {wall:.1f}s elapsed, {rate:.1f} req/s, "
                      f"{self.failed} failed", flush=True)

    def summary(self):
        wall = time.monotonic() - self.start
        lat = sorted(self.latencies)
        p50 = lat[len(lat) // 2] if lat else 0
        p95 = lat[int(len(lat) * 0.95)] if lat else 0
        ok = self.sent - self.timed_out - self.failed
        print("\n=========== SUMMARY ===========")
        print(f"Total sent:      {self.sent}/{self.total}")
        print(f"Wall time:       {wall:.1f}s ({(self.sent / wall if wall > 0 else 0):.2f} req/s)")
        print(f"Responded 200:   {ok}")
        print(f"Timed out:       {self.timed_out} (expected if the gateway is fire-and-forget)")
        print(f"Hard failures:   {self.failed} (connection refused / DNS / etc — real problems)")
        print(f"Latency p50/p95: {p50:.2f}s / {p95:.2f}s")


def send_one(i, payload, stats):
    start = time.monotonic()
    try:
        call(payload)
        stats.record("ok", time.monotonic() - start)
    except (socket.timeout, TimeoutError):
        # socket.timeout == TimeoutError only from Python 3.10 onward; catch both
        # explicitly so this works on older interpreters too (e.g. production hosts
        # still on 3.6-3.9), where urlopen's read timeout raises socket.timeout,
        # a plain OSError subclass distinct from the builtin TimeoutError.
        stats.record("timeout", time.monotonic() - start)
    except Exception as exc:
        stats.record("failed", time.monotonic() - start)
        print(f"  [{i}] FAILED: {exc}", flush=True)


# Since this gateway is fire-and-forget and every send can block for the full
# REQUEST_TIMEOUT waiting on a response that may never come, sustaining
# RATE_TPS completions/sec needs RATE_TPS * REQUEST_TIMEOUT in-flight workers
# (Little's Law) — otherwise the worker pool is the bottleneck, not the 200ms
# schedule: e.g. concurrency=10 with a 5s timeout caps throughput at 10/5=2/s
# regardless of how fast we submit, and unsent work backs up in the pool's
# queue, blowing well past the requested time budget once submission stops
# and the run has to drain that backlog.
MIN_CONCURRENCY = int(RATE_TPS * REQUEST_TIMEOUT) + 5


def run_fixed_rate(payloads, total_time_minutes, concurrency=None):
    """Sends at a constant rate (RATE_TPS, i.e. one every INTERVAL_S=200ms) —
    not a ramp/burst. Open-loop scheduled so a slow or timed-out response
    never delays the next send. Stops when the payload list is exhausted or
    the time budget elapses, whichever comes first."""
    if concurrency is None:
        concurrency = MIN_CONCURRENCY
    stats = Stats(len(payloads))
    deadline_s = total_time_minutes * 60
    print(f"Fixed-rate mode: {len(payloads)} txns queued, {RATE_TPS} TPS "
          f"(1 every {INTERVAL_S * 1000:.0f}ms), time budget {total_time_minutes:.2f} min", flush=True)
    start_time = time.monotonic()
    sent = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for i, payload in enumerate(payloads, start=1):
            target_offset = (i - 1) * INTERVAL_S
            if target_offset > deadline_s:
                print(f"  time budget ({total_time_minutes:.2f} min) reached — "
                      f"stopping after queuing {sent}/{len(payloads)}", flush=True)
                break
            delay = (start_time + target_offset) - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            pool.submit(send_one, i, payload, stats)
            sent += 1
    stats.summary()


def wait_for_drain(poll_interval=2.0, stable_polls=3, timeout=120.0):
    """Tazama's pipeline (TMS -> ED -> rules -> typology -> TADP -> evaluation
    write) is asynchronous relative to this script's send loop finishing, so
    the evaluation table is still catching up right after run_fixed_rate()
    returns. Polls the row count until it stops changing for `stable_polls`
    consecutive polls (settled), or `timeout` elapses (whichever first)."""
    print(f"\nWaiting for evaluation pipeline to drain (poll every {poll_interval:.0f}s, "
          f"settle after {stable_polls} unchanged polls, max {timeout:.0f}s)...", flush=True)
    conn = psycopg2.connect(dbname="evaluation", **DB)
    conn.autocommit = True
    cur = conn.cursor()
    start = time.monotonic()
    last_count, unchanged = -1, 0
    while time.monotonic() - start < timeout:
        cur.execute("SELECT count(*) FROM evaluation")
        count = cur.fetchone()[0]
        if count == last_count:
            unchanged += 1
            if unchanged >= stable_polls:
                print(f"  settled at {count} evaluation row(s) after "
                      f"{time.monotonic() - start:.1f}s", flush=True)
                break
        else:
            unchanged = 0
        last_count = count
        print(f"  {count} evaluation row(s) so far...", flush=True)
        time.sleep(poll_interval)
    else:
        print(f"  timed out after {timeout:.0f}s — proceeding with {last_count} row(s) "
              f"(pipeline may still be catching up)", flush=True)
    cur.close()
    conn.close()


def fetch_latency_rows():
    """Per-transaction latency: evaluation.report.timestamp (when TADP finished
    and wrote the row) minus the pacs.002 AccptncDtTm nbp-ppa stamped on the
    message right before POSTing it to TMS. Measures Tazama's own pipeline
    time (TMS ingest -> ED -> rules -> typology -> TADP), excluding nbp-ppa's
    own parse/build time and the external gateway hop."""
    conn = psycopg2.connect(dbname="evaluation", **DB)
    cur = conn.cursor()
    cur.execute("""
        SELECT
            evaluation->'transaction'->'FIToFIPmtSts'->'GrpHdr'->>'MsgId' AS msg_id,
            evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'->>'OrgnlEndToEndId' AS orig_txn_id,
            evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'->>'AccptncDtTm' AS pacs002_time,
            evaluation->'report'->>'timestamp' AS evaluation_time,
            evaluation->'report'->>'status' AS status,
            EXTRACT(EPOCH FROM (
                (evaluation->'report'->>'timestamp')::timestamptz -
                (evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'->>'AccptncDtTm')::timestamptz
            )) * 1000 AS latency_ms
        FROM evaluation
        WHERE evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'->>'AccptncDtTm' IS NOT NULL;
    """)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    # EXTRACT(...) returns numeric in Postgres, which psycopg2 maps to
    # decimal.Decimal — cast to float so it mixes freely with plain Python
    # floats downstream (pct(), formatting, etc).
    for r in rows:
        if r["latency_ms"] is not None:
            r["latency_ms"] = float(r["latency_ms"])
    return rows


def fetch_stage_breakdown():
    """Per-rule and per-pipeline-stage processing time, straight from the
    evaluation JSON — no APM/Kibana needed for this. prcgTm fields are
    nanoseconds throughout (same convention as perf_breakpoint_test.py's
    fetch_stage_breakdown()). Ranked slowest-average-first so it directly
    answers "which rule/service should I optimize"."""
    conn = psycopg2.connect(dbname="evaluation", **DB)
    cur = conn.cursor()
    cur.execute("""
        WITH t AS (
          SELECT jsonb_array_elements(evaluation->'report'->'tadpResult'->'typologyResult') ty
          FROM evaluation),
        r AS (SELECT jsonb_array_elements(ty->'ruleResults') rr FROM t)
        SELECT rr->>'id',
               count(*),
               avg((rr->>'prcgTm')::bigint),
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (rr->>'prcgTm')::bigint),
               max((rr->>'prcgTm')::bigint),
               count(*) FILTER (WHERE rr->>'subRuleRef' = '.err')
        FROM r GROUP BY 1 ORDER BY 3 DESC;
    """)
    rules = [
        {"id": rid, "count": cnt, "avg_ns": float(avg), "p95_ns": float(p95), "max_ns": int(mx), "errors": errs}
        for rid, cnt, avg, p95, mx, errs in cur.fetchall()
    ]

    cur.execute("""
        SELECT
            avg((evaluation->'report'->'metaData'->>'prcgTmED')::bigint),
            avg((evaluation->'report'->'metaData'->>'prcgTmDP')::bigint),
            avg((evaluation->'report'->'tadpResult'->>'prcgTm')::bigint)
        FROM evaluation;
    """)
    ed_ns, dp_ns, tadp_ns = cur.fetchone()
    stages = {
        "Event Director": float(ed_ns) if ed_ns is not None else 0.0,
        "TADP (decision)": float(dp_ns) if dp_ns is not None else 0.0,
        "TADP internal": float(tadp_ns) if tadp_ns is not None else 0.0,
    }
    cur.close()
    conn.close()
    return rules, stages


def fetch_raw_history_counts():
    conn = psycopg2.connect(dbname="raw_history", **DB)
    cur = conn.cursor()
    counts = {}
    for t in ("pacs008", "pacs002"):
        cur.execute(f"SELECT count(*) FROM {t}")
        counts[t] = cur.fetchone()[0]
    cur.close()
    conn.close()
    return counts


def pct(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def parse_iso(ts):
    """Parses ISO 8601 timestamps like '2026-07-13T13:57:02.270Z'. Not using
    datetime.fromisoformat — that's Python 3.7+ only, and this host runs 3.6."""
    ts = ts.replace("Z", "+0000")
    fmt = "%Y-%m-%dT%H:%M:%S.%f%z" if "." in ts else "%Y-%m-%dT%H:%M:%S%z"
    return datetime.strptime(ts, fmt)


def latency_stats(rows):
    lat = sorted(r["latency_ms"] for r in rows if r["latency_ms"] is not None)
    alert_count = sum(1 for r in rows if r["status"] == "ALRT")
    if not lat:
        return {"count": 0, "min": 0.0, "mean": 0.0, "p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0, "tps": 0.0,
                "alert_count": alert_count, "alert_pct": 0.0}
    # evaluation_time comes back from `->>'timestamp'` as plain text, not a
    # native datetime — parse before subtracting.
    times = sorted(parse_iso(r["evaluation_time"]) for r in rows if r["evaluation_time"])
    span_s = (times[-1] - times[0]).total_seconds() if len(times) > 1 else 0.0
    return {
        "count": len(lat),
        "min": lat[0],
        "mean": sum(lat) / len(lat),
        "p50": pct(lat, 50),
        "p95": pct(lat, 95),
        "p99": pct(lat, 99),
        "max": lat[-1],
        "tps": (len(lat) / span_s) if span_s > 0 else 0.0,
        "alert_count": alert_count,
        "alert_pct": (alert_count / len(rows) * 100) if rows else 0.0,
    }


# Shared design language with the other reports in this repo, so every
# report reads as one system.
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
  .rp table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 4px; }
  .rp td, .rp th { padding: 9px 10px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; color: var(--text-secondary); text-align: left; }
  .rp th { color: var(--text-primary); font-weight: 600; position: sticky; top: 0; background: var(--surface-1); }
  .rp td.strong { color: var(--text-primary); font-weight: 600; }
  .rp tr:last-child td { border-bottom: none; }
  .rp .num { text-align: right; }
  .rp .bar-cell { position: relative; }
  .rp .bar-cell .track { position: absolute; inset: 4px 10px; background: var(--grid); border-radius: 4px; z-index: 0; }
  .rp .bar-cell .fill { position: absolute; top: 4px; bottom: 4px; left: 10px; border-radius: 4px; z-index: 1; }
  .rp .bar-cell .label { position: relative; z-index: 2; padding-left: 4px; }
  .rp .scroll-table { max-height: 560px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; }
  .rp .scroll-table table { margin-top: 0; }
  .rp .badge { display: inline-block; padding: 1px 7px; border-radius: 5px; font-size: 11.5px; font-weight: 600; }
  .rp .badge.alert { background: color-mix(in srgb, var(--status-critical) 15%, transparent); color: var(--status-critical); }
  .rp .badge.ok { background: color-mix(in srgb, var(--status-good) 15%, transparent); color: var(--status-good); }
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


def write_html_report(run_params, lat_rows, stats, raw_counts, rules, stages):
    num_rings, total_count, total_time_minutes = run_params
    lat_fields = [("min", stats["min"]), ("p50", stats["p50"]), ("mean", stats["mean"]),
                  ("p95", stats["p95"]), ("p99", stats["p99"]), ("max", stats["max"])]
    max_lat = max(v for _, v in lat_fields) or 1.0
    latency_rows = "\n".join(
        _bar_row(name.upper(), f"{v:.0f} ms", (v / max_lat) * 100,
                 color="var(--status-critical)" if name in ("p99", "max") else "var(--series-1)")
        for name, v in lat_fields
    )

    txn_rows = "\n".join(
        f'<tr><td>{r["orig_txn_id"] or r["msg_id"]}</td>'
        f'<td><span class="badge {"alert" if r["status"] == "ALRT" else "ok"}">{r["status"]}</span></td>'
        f'<td class="num">{r["latency_ms"]:.1f} ms</td></tr>'
        for r in lat_rows
    )

    max_stage_ms = max((v / 1e6 for v in stages.values()), default=1.0) or 1.0
    stage_rows = "\n".join(
        _bar_row(name, f"{v / 1e6:.2f} ms", (v / 1e6) / max_stage_ms * 100)
        for name, v in stages.items()
    )

    max_rule_avg_ms = max((r["avg_ns"] / 1e6 for r in rules), default=1.0) or 1.0
    rule_rows = "\n".join(
        f'<tr><td class="strong">{r["id"]}</td>'
        f'<td class="num">{r["count"]}</td>'
        f'<td class="num bar-cell" style="min-width:150px;">'
        f'<span class="track" style="right:{100 - min(100, (r["avg_ns"] / 1e6) / max_rule_avg_ms * 100):.1f}%"></span>'
        f'<span class="fill" style="width:{min(100, (r["avg_ns"] / 1e6) / max_rule_avg_ms * 100):.1f}%; '
        f'background:var(--series-1); opacity:0.35;"></span>'
        f'<span class="label">{r["avg_ns"] / 1e6:.2f} ms</span></td>'
        f'<td class="num">{r["p95_ns"] / 1e6:.2f} ms</td>'
        f'<td class="num">{r["max_ns"] / 1e6:.2f} ms</td>'
        f'<td class="num">{r["errors"]}</td></tr>'
        for r in rules
    )

    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Layering Stress Test -- Latency Report ({RUN_TAG})</title>
{REPORT_CSS}
</head>
<body>
<div class="rp">
<div class="rp-wrap">

  <h1>NBP Layering Stress Test &mdash; Latency Report</h1>
  <p class="subtitle">{stats['count']} transactions evaluated &middot; {num_rings} ring(s), {total_count} total, {total_time_minutes:.1f} min budget &middot; run {RUN_TAG}</p>

  <div class="stat-row">
    {_tile("Total evaluated", stats["count"])}
    {_tile("Avg latency", f"{stats['mean']:.0f} ms")}
    {_tile("P95 latency", f"{stats['p95']:.0f} ms")}
    {_tile("TPS (DB observed)", f"{stats['tps']:.2f}")}
  </div>
  <div class="stat-row">
    {_tile("pacs.008 posted", raw_counts.get("pacs008", 0))}
    {_tile("pacs.002 posted", raw_counts.get("pacs002", 0))}
    {_tile("Latency min", f"{stats['min']:.0f} ms")}
    {_tile("Latency max", f"{stats['max']:.0f} ms", cls="critical" if stats["max"] > 5000 else "")}
  </div>
  <div class="stat-row">
    {_tile("ALRT count", stats["alert_count"], delta=f"{stats['alert_pct']:.1f}% of evaluated",
           cls="critical" if stats["alert_count"] else "good")}
    {_tile("NALT count", stats["count"] - stats["alert_count"])}
  </div>

  <h2><span class="num">1</span>Run configuration</h2>
  <div class="card"><table><tbody>
    <tr><td class="strong">Rings embedded</td><td class="num">{num_rings}</td></tr>
    <tr><td class="strong">Total transactions requested</td><td class="num">{total_count}</td></tr>
    <tr><td class="strong">Time budget</td><td class="num">{total_time_minutes:.2f} min</td></tr>
    <tr><td class="strong">Send rate</td><td class="num">{RATE_TPS} TPS (1 every {INTERVAL_S * 1000:.0f}ms)</td></tr>
  </tbody></table></div>

  <h2><span class="num">2</span>Latency distribution</h2>
  <p class="section-sub">evaluation.report.timestamp (TADP finished) minus the pacs.002 AccptncDtTm
  nbp-ppa stamped right before posting to TMS &mdash; i.e. Tazama's own pipeline time
  (TMS ingest &rarr; Event Director &rarr; rules &rarr; typology &rarr; TADP), excluding nbp-ppa's
  own parse time and the external gateway hop.</p>
  <div class="card"><table><tbody>
    {latency_rows}
  </tbody></table></div>

  <h2><span class="num">3</span>Pipeline stage breakdown</h2>
  <p class="section-sub">Average time per pipeline stage (nanosecond fields from the evaluation
  report, converted to ms) — Event Director routing vs TADP's own decisioning work.</p>
  <div class="card"><table><tbody>
    {stage_rows}
  </tbody></table></div>

  <h2><span class="num">4</span>Slowest rules</h2>
  <p class="section-sub">Per-rule average/p95/max processing time across all evaluated
  transactions, slowest average first — this is the direct "which rule to optimize" answer,
  sourced from the same evaluation records Kibana APM traces (same host/rule containers).</p>
  <div class="scroll-table"><table>
    <thead><tr><th>Rule</th><th class="num">Count</th><th class="num">Avg</th>
    <th class="num">P95</th><th class="num">Max</th><th class="num">Errors</th></tr></thead>
    <tbody>
    {rule_rows}
    </tbody>
  </table></div>

  <h2><span class="num">5</span>Per-transaction latency</h2>
  <p class="section-sub">All {stats['count']} evaluated transactions.</p>
  <div class="scroll-table"><table>
    <thead><tr><th>Transaction ID</th><th>Status</th><th class="num">Latency</th></tr></thead>
    <tbody>
    {txn_rows}
    </tbody>
  </table></div>

  <footer>Generated {datetime.now().isoformat(timespec="seconds")} &middot; script: layering_stress_updated.py &middot; run tag {RUN_TAG}</footer>

</div>
</div>
</body>
</html>"""

    os.makedirs("reports", exist_ok=True)
    path = f"reports/layering_stress_report_{RUN_TAG}.html"
    with open(path, "w") as f:
        f.write(html)
    return path


def main():
    print("cleanup: deleting existing rows from evaluation/pacs002/pacs008", flush=True)
    cleanup_tables()

    num_rings, total_count, total_time_minutes = prompt_run_params()

    dataset, counts = build_dataset(total_count, num_rings)
    breakdown = ", ".join(f"{k}={v}" for k, v in counts.items())
    print(f"\nBuilt {len(dataset)} transactions ({breakdown}), virtual window "
          f"{DAY_ZERO.date()} .. {(DAY_ZERO + timedelta(days=RING_SPAN_DAYS)).date()}")

    payloads = [
        make_payload(i, ts, src_acct, src_name, dst_acct, dst_name, amount)
        for i, (ts, src_acct, src_name, dst_acct, dst_name, amount, _kind) in enumerate(dataset, start=1)
    ]

    run_fixed_rate(payloads, total_time_minutes)

    wait_for_drain()
    lat_rows = fetch_latency_rows()
    stats = latency_stats(lat_rows)
    raw_counts = fetch_raw_history_counts()
    rules, stages = fetch_stage_breakdown()
    report_path = write_html_report((num_rings, total_count, total_time_minutes), lat_rows, stats, raw_counts, rules, stages)
    print(f"\n=========== LATENCY REPORT ===========")
    print(f"Evaluated:   {stats['count']}")
    print(f"Avg latency: {stats['mean']:.1f} ms")
    print(f"P50/P95/P99: {stats['p50']:.1f} / {stats['p95']:.1f} / {stats['p99']:.1f} ms")
    print(f"TPS (DB):    {stats['tps']:.2f}")
    if rules:
        print(f"Slowest rule: {rules[0]['id']} (avg {rules[0]['avg_ns'] / 1e6:.2f} ms)")
    print(f"[{RUN_TAG}] wrote {report_path}", flush=True)


if __name__ == "__main__":
    main()
