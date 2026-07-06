#!/usr/bin/env python3
"""Stepped-TPS performance test for the NBP-PPA -> Tazama FRMS pipeline.

Sequence: truncate the evaluation/event_history/raw_history tables for a
clean baseline, send TMI1910 fixed-width messages straight to the nbp-ppa
TCP listener (localhost:3004, newline-delimited mode) through fixed TPS
steps (5/10/15/20/25 by default), each shaped as ramp-up -> steady ->
ramp-down, then write a report and truncate again to leave a clean slate.
Sends are open-loop (scheduled on a clock, never gated on completions) so
queue buildup is visible instead of hidden.

Two latency definitions are computed per transaction, both ending at the
`inserted_at` column of the row TADP writes into the Tazama `evaluation`
Postgres table (same host, same clock):

  lat_ms      client send -> Eval response (includes network + PPA queueing)
  tms_lat_ms  TMS recv -> Eval response (the primary metric for this test —
              TMS recv is approximated by the PPA's own ppa_tms_call
              timestamp for the pacs.002.001.12 call, read back from
              nbp-ppa's PERF_TIMING log lines, since that's the message
              whose OrgnlEndToEndId the evaluation row actually correlates
              on; see src/tmi/tmi.service.ts).

Transactions are correlated by trs_txnid_1, which the adapter copies into
the pacs.002 OrgnlEndToEndId and which the evaluation row stores verbatim.

Output: reports/data/run_<ts>.json with per-step aggregates, per-txn
samples, stage breakdowns, and docker CPU samples.

Usage:
  python3 perf_breakpoint_test.py                              # full run
  python3 perf_breakpoint_test.py --steps 5,10 --steady 30 --ramp-up 5 --ramp-down 5   # quick
  python3 perf_breakpoint_test.py --skip-cleanup-before --skip-cleanup-after  # keep DB state
"""

import argparse
import json
import math
import os
import re
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone

import psycopg2

ADAPTER = ("127.0.0.1", 3004)
DB = dict(host="localhost", port=15432, user="postgres", dbname="evaluation")
TEMPLATE_FILE = "payload.txt"
ADAPTER_LOG = "adapter.log"
RUN_TAG = datetime.now().strftime("%y%m%d%H%M%S")

# Databases + tables truncated for a clean baseline (postgres/migration/base/00-CREATE.sql
# in Full-Stack-Docker-Tazama). event_history's tables have FK dependencies on each other;
# CASCADE handles that regardless of listed order.
CLEANUP_DBS = {
    "evaluation": ["evaluation"],
    "event_history": [
        "transaction", "governed_as_creditor_account_by", "governed_as_creditor_by",
        "governed_as_debtor_account_by", "governed_as_debtor_by", "account_holder",
        "condition", "account", "entity",
    ],
    "raw_history": ["pacs002", "pacs008", "pain001", "pain013"],
}

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# TMI1910 field positions (from src/tcp/tmi-parser.ts)
POS = {
    "remote_time_sent": (6, 16),     # YYYYMMDDHHMMSS zero-padded to 16
    "trs_txnid_1": (70, 20),         # -> pacs.002 OrgnlEndToEndId
    "trs_account": (134, 48),        # sender account
    "trs_amount_pan": (239, 17),     # integer * 100
    "trs_amount_local": (259, 17),
    "trs_amount_orig": (279, 17),
    "custom_text_50_1": (982, 50),   # receiver account (adapter fallback)
    "correspondent_name": (1272, 50) # receiver name
}

ACCOUNT_POOL = 200  # reused round-robin: per-account history grows uniformly


def cleanup_tables(host=DB["host"], port=DB["port"], user=DB["user"]):
    """Truncate evaluation/event_history/raw_history so the run starts (and
    ends) from a known-empty baseline — Rule 021's velocity check otherwise
    accumulates per-account history across runs and skews TPS comparisons."""
    for dbname, tables in CLEANUP_DBS.items():
        conn = psycopg2.connect(host=host, port=port, user=user, dbname=dbname)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE;")
        cur.close()
        conn.close()
        print(f"  truncated {len(tables)} table(s) in '{dbname}'", flush=True)


def parse_perf_line(line):
    idx = line.find("PERF_TIMING")
    if idx == -1:
        return None
    fields = {}
    for tok in line[idx + len("PERF_TIMING"):].split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            fields[k] = v
    return fields


def parse_adapter_log(path, txn_prefix=None):
    """Reads nbp-ppa's PERF_TIMING log lines and returns, per transaction id,
    the ppa_recv timestamp and the pacs.002.001.12 call/reply timestamps
    (epoch seconds) — pacs.002 is the message the evaluation row correlates
    on, so its ppa_tms_call timestamp is used as the TMS-recv reference."""
    out = {}
    try:
        f = open(path, "r", errors="replace")
    except FileNotFoundError:
        return out
    with f:
        for line in f:
            if "PERF_TIMING" not in line:
                continue
            fields = parse_perf_line(ANSI_RE.sub("", line))
            if not fields:
                continue
            txn_id = fields.get("txnId")
            if not txn_id or (txn_prefix and not txn_id.startswith(txn_prefix)):
                continue
            ts_raw = fields.get("ts")
            if not ts_raw:
                continue
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).timestamp()
            rec = out.setdefault(txn_id, {})
            stage, tx_type = fields.get("stage"), fields.get("txType")
            if stage == "ppa_recv":
                rec["ppa_recv"] = ts
            elif stage == "ppa_tms_call" and tx_type == "pacs.002.001.12":
                rec["tms_call_002"] = ts
            elif stage == "tms_reply" and tx_type == "pacs.002.001.12":
                rec["tms_reply_002"] = ts
    return out


def load_template():
    with open(TEMPLATE_FILE) as f:
        raw = f.read().replace("\n", "")
    assert len(raw) == 1365, f"template is {len(raw)} bytes, expected 1365"
    return raw


def splice(base, field, value, align="left", pad="."):
    pos, ln = POS[field]
    v = value[:ln]
    v = v.ljust(ln, pad) if align == "left" else v.rjust(ln, pad)
    return base[:pos] + v + base[pos + ln:]


def make_message(template, seq):
    txnid = f"LT{RUN_TAG}{seq:06d}"  # 20 chars max: LT + 12 + 6
    sender = str(30000000000000 + (seq % ACCOUNT_POOL)).zfill(14)
    receiver = str(60000000000000 + ((seq * 7) % ACCOUNT_POOL)).zfill(14)
    amount = 500000 + (seq % 400000)  # 5000.00 - 9000.00 PKR
    now = datetime.now()  # local (PKT) — adapter appends +05:00 offset
    msg = template
    msg = splice(msg, "remote_time_sent", now.strftime("%Y%m%d%H%M%S").zfill(16), "right", "0")
    msg = splice(msg, "trs_txnid_1", txnid, "right")
    msg = splice(msg, "trs_account", sender, "right")
    amt = str(amount * 100).zfill(17)
    for f in ("trs_amount_pan", "trs_amount_local", "trs_amount_orig"):
        msg = splice(msg, f, amt, "right", "0")
    msg = splice(msg, "custom_text_50_1", receiver, "right")
    msg = splice(msg, "correspondent_name", f"RCVR {receiver[-5:]}", "left")
    assert len(msg) == 1365
    return txnid, msg.encode() + b"\n"


class ConnPool:
    def __init__(self, n=8):
        self.socks = []
        for _ in range(n):
            s = socket.create_connection(ADAPTER)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.socks.append(s)
        self.i = 0
        self.lock = threading.Lock()

    def send(self, data):
        with self.lock:
            s = self.socks[self.i % len(self.socks)]
            self.i += 1
        s.sendall(data)

    def close(self):
        for s in self.socks:
            try:
                s.close()
            except OSError:
                pass


class DockerStatsSampler(threading.Thread):
    def __init__(self, interval=8.0):
        super().__init__(daemon=True)
        self.interval = interval
        self.samples = []
        self.stop_flag = threading.Event()

    def run(self):
        while not self.stop_flag.is_set():
            t0 = time.time()
            try:
                out = subprocess.run(
                    ["docker", "stats", "--no-stream", "--format",
                     "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"],
                    capture_output=True, text=True, timeout=15).stdout
                snap = {}
                for line in out.strip().splitlines():
                    name, cpu, mem = line.split("\t")
                    snap[name] = float(cpu.rstrip("%"))
                self.samples.append({"t": t0, "cpu": snap})
            except Exception:
                pass
            self.stop_flag.wait(max(0.5, self.interval - (time.time() - t0)))


def db_conn():
    return psycopg2.connect(**DB)


def eval_count(cur, like):
    cur.execute("""SELECT count(*) FROM evaluation
                   WHERE evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'
                         ->>'OrgnlEndToEndId' LIKE %s""", (like,))
    return cur.fetchone()[0]


def build_ramp_offsets(rate, ramp_up, steady, ramp_down):
    """Send offsets (seconds from step start) for a linear ramp-up -> flat
    steady -> linear ramp-down load shape, built second-by-second so the
    instantaneous rate in each second matches the ramp shape."""
    total = int(round(ramp_up + steady + ramp_down))
    offsets = []
    for sec in range(total):
        mid = sec + 0.5
        if mid < ramp_up:
            inst_rate = rate * (mid / ramp_up) if ramp_up > 0 else rate
        elif mid < ramp_up + steady:
            inst_rate = rate
        else:
            into_down = mid - (ramp_up + steady)
            inst_rate = rate * max(0.0, 1 - into_down / ramp_down) if ramp_down > 0 else 0.0
        n = round(inst_rate)
        for j in range(n):
            offsets.append(sec + (j + 0.5) / n)
    return offsets


def run_step(pool, template, rate, ramp_up, steady, ramp_down, seq_start, sent_log):
    """Open-loop: schedule sends at exact times regardless of pipeline state."""
    offsets = build_ramp_offsets(rate, ramp_up, steady, ramp_down)
    n = len(offsets)
    t0 = time.perf_counter()
    wall0 = time.time()
    sent = []
    for k, offset in enumerate(offsets):
        target = t0 + offset
        lag = target - time.perf_counter()
        if lag > 0:
            time.sleep(lag)
        txnid, data = make_message(template, seq_start + k)
        ts = time.time()
        pool.send(data)
        sent.append((txnid, ts))
    wall1 = time.time()
    sent_log.extend(sent)
    return {
        "offered_tps": rate,
        "ramp_up_s": ramp_up,
        "steady_s": steady,
        "ramp_down_s": ramp_down,
        "planned": n,
        "sent": len(sent),
        "send_window_s": wall1 - wall0,
        "achieved_send_tps": len(sent) / (wall1 - wall0) if wall1 > wall0 else 0,
        "wall_start": wall0,
        "wall_end": wall1,
        "txn_range": [sent[0][0], sent[-1][0]] if sent else [None, None],
        "seq_range": [seq_start, seq_start + n - 1],
    }


def wait_drain(cur, like, expected, timeout, poll=1.0):
    """Wait until all sent txns have evaluation rows, or count stalls."""
    t0 = time.time()
    last, last_change = -1, time.time()
    while time.time() - t0 < timeout:
        c = eval_count(cur, like)
        if c >= expected:
            return c, time.time() - t0, True
        if c != last:
            last, last_change = c, time.time()
        elif time.time() - last_change > 30:  # stalled 30s with backlog
            return c, time.time() - t0, False
        time.sleep(poll)
    return last, time.time() - t0, False


def fetch_results(cur, like):
    cur.execute("""
        SELECT evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'->>'OrgnlEndToEndId',
               extract(epoch from inserted_at),
               evaluation->'report'->>'timestamp',
               evaluation->'transaction'->'FIToFIPmtSts'->'GrpHdr'->>'CreDtTm',
               (evaluation->'report'->'metaData'->>'prcgTmED')::bigint,
               (evaluation->'report'->'metaData'->>'prcgTmDP')::bigint,
               evaluation->'report'->>'status'
        FROM evaluation
        WHERE evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'
              ->>'OrgnlEndToEndId' LIKE %s""", (like,))
    out = {}
    for txnid, ins_epoch, report_ts, credttm, ed_ns, dp_ns, status in cur.fetchall():
        rts = datetime.fromisoformat(report_ts.replace("Z", "+00:00")).timestamp()
        out[txnid] = {"inserted": float(ins_epoch), "report_ts": rts,
                      "credttm": credttm, "ed_ns": ed_ns, "dp_ns": dp_ns,
                      "status": status}
    return out


def fetch_stage_breakdown(cur, like):
    """Mean/p95 per rule id and typology processing time across the run."""
    cur.execute("""
        WITH t AS (
          SELECT jsonb_array_elements(evaluation->'report'->'tadpResult'->'typologyResult') ty
          FROM evaluation
          WHERE evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'
                ->>'OrgnlEndToEndId' LIKE %s),
        r AS (SELECT jsonb_array_elements(ty->'ruleResults') rr, (ty->>'prcgTm')::bigint tp_ns FROM t)
        SELECT rr->>'id',
               count(*),
               avg((rr->>'prcgTm')::bigint)::bigint,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (rr->>'prcgTm')::bigint)::bigint,
               max((rr->>'prcgTm')::bigint),
               count(*) FILTER (WHERE rr->>'subRuleRef' = '.err')
        FROM r GROUP BY 1 ORDER BY 3 DESC""", (like,))
    rules = [{"rule": a, "n": b, "avg_ns": c, "p95_ns": d, "max_ns": e, "errors": f}
             for a, b, c, d, e, f in cur.fetchall()]
    cur.execute("""
        SELECT avg((ty->>'prcgTm')::bigint)::bigint,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (ty->>'prcgTm')::bigint)::bigint
        FROM (SELECT jsonb_array_elements(evaluation->'report'->'tadpResult'->'typologyResult') ty
              FROM evaluation
              WHERE evaluation->'transaction'->'FIToFIPmtSts'->'TxInfAndSts'
                    ->>'OrgnlEndToEndId' LIKE %s) s""", (like,))
    tp_avg, tp_p95 = cur.fetchone()
    return {"rules": rules, "typology_avg_ns": tp_avg, "typology_p95_ns": tp_p95}


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p / 100.0
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def lat_stats(vals_sorted):
    if not vals_sorted:
        return {"mean": None, "p50": None, "p90": None, "p95": None, "p99": None, "max": None, "min": None}
    return {
        "mean": round(sum(vals_sorted) / len(vals_sorted), 2),
        "p50": round(pct(vals_sorted, 50), 2),
        "p90": round(pct(vals_sorted, 90), 2),
        "p95": round(pct(vals_sorted, 95), 2),
        "p99": round(pct(vals_sorted, 99), 2),
        "max": round(vals_sorted[-1], 2),
        "min": round(vals_sorted[0], 2),
    }


def summarize(step, sent, results, ppa_timing):
    lats, tms_lats, insert_ts, tms_recv_ts = [], [], [], []
    missing, missing_tms, statuses = 0, 0, {}
    samples = []
    for txnid, ts in sent:
        r = results.get(txnid)
        if r is None:
            missing += 1
            continue
        lat = (r["inserted"] - ts) * 1000.0
        lats.append(lat)
        insert_ts.append(r["inserted"])
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1

        pt = ppa_timing.get(txnid)
        tms_lat = None
        if pt and "tms_call_002" in pt:
            tms_recv = pt["tms_call_002"]
            tms_lat = (r["inserted"] - tms_recv) * 1000.0
            tms_lats.append(tms_lat)
            tms_recv_ts.append(tms_recv)
        else:
            missing_tms += 1

        samples.append({
            "t": ts, "lat_ms": round(lat, 2),
            "tms_lat_ms": round(tms_lat, 2) if tms_lat is not None else None,
        })

    lats_sorted = sorted(lats)
    tms_lats_sorted = sorted(tms_lats)
    dur_out = (max(insert_ts) - min(insert_ts)) if len(insert_ts) > 1 else 0
    dur_tms = (max(tms_recv_ts) - min(tms_recv_ts)) if len(tms_recv_ts) > 1 else 0
    step.update({
        "completed": len(lats),
        "missing": missing,
        "missing_tms_timing": missing_tms,  # completed in DB but no matching adapter-log PERF_TIMING line
        "statuses": statuses,
        "output_tps": round(len(lats) / dur_out, 2) if dur_out > 0 else None,
        "tms_tps": round(len(tms_lats) / dur_tms, 2) if dur_tms > 0 else None,
        "lat_ms": lat_stats(lats_sorted),
        "tms_lat_ms": lat_stats(tms_lats_sorted),
        "samples": samples,
    })
    return step


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--steps", default="5,10,15,20,25",
                    help="comma-separated offered TPS levels (default 5,10,15,20,25)")
    ap.add_argument("--ramp-up", type=float, default=60.0, help="seconds to ramp 0 -> target TPS (default 60)")
    ap.add_argument("--steady", type=float, default=480.0, help="seconds held at target TPS (default 480)")
    ap.add_argument("--ramp-down", type=float, default=60.0, help="seconds to ramp target TPS -> 0 (default 60)")
    ap.add_argument("--drain-timeout", type=float, default=300.0)
    ap.add_argument("--settle", type=float, default=10.0,
                    help="pause between steps after drain")
    ap.add_argument("--warmup", type=int, default=30)
    ap.add_argument("--conns", type=int, default=8)
    ap.add_argument("--adapter-log", default=ADAPTER_LOG,
                    help="path to nbp-ppa's stdout/stderr log, for the PPA/TMS-side PERF_TIMING lines")
    ap.add_argument("--skip-cleanup-before", action="store_true",
                    help="don't truncate evaluation/event_history/raw_history before the run")
    ap.add_argument("--skip-cleanup-after", action="store_true",
                    help="don't truncate evaluation/event_history/raw_history after the run")
    args = ap.parse_args()

    if not args.skip_cleanup_before:
        print(f"[{RUN_TAG}] cleanup: truncating evaluation/event_history/raw_history", flush=True)
        cleanup_tables()

    template = load_template()
    like = f"LT{RUN_TAG}%"
    pool = ConnPool(args.conns)
    conn = db_conn()
    conn.autocommit = True
    cur = conn.cursor()

    sampler = DockerStatsSampler()
    sampler.start()

    all_sent = []
    seq = 0
    steps_out = []
    step_total_s = args.ramp_up + args.steady + args.ramp_down
    run_meta = {
        "run_tag": RUN_TAG,
        "started_iso": datetime.now(timezone.utc).isoformat(),
        "ramp_up_s": args.ramp_up,
        "steady_s": args.steady,
        "ramp_down_s": args.ramp_down,
        "step_total_s": step_total_s,
        "warmup": args.warmup,
        "conns": args.conns,
        "account_pool": ACCOUNT_POOL,
        "adapter_log": args.adapter_log,
        "latency_definition": "tms_lat_ms = evaluation.inserted_at - ppa_tms_call(pacs.002.001.12); "
                               "lat_ms = evaluation.inserted_at - client send time",
    }

    # warmup (excluded from analysis) — flat rate, no ramp
    print(f"[{RUN_TAG}] warmup: {args.warmup} txns @ 5 TPS", flush=True)
    w_sent = []
    run_step(pool, template, 5, 0, args.warmup / 5.0, 0, seq, w_sent)
    seq += len(w_sent)
    all_sent.extend(w_sent)
    wait_drain(cur, like, len(all_sent), 60)

    warnings = []
    for rate in [float(x) for x in args.steps.split(",")]:
        print(f"[{RUN_TAG}] step: {rate} TPS, ramp {args.ramp_up:.0f}s / steady {args.steady:.0f}s / "
              f"ramp {args.ramp_down:.0f}s ({step_total_s:.0f}s total)", flush=True)
        sent = []
        step = run_step(pool, template, rate, args.ramp_up, args.steady, args.ramp_down, seq, sent)
        seq += step["sent"]
        all_sent.extend(sent)
        backlog_at_send_end = len(all_sent) - eval_count(cur, like)
        c, drain_s, drained = wait_drain(cur, like, len(all_sent), args.drain_timeout)
        step["backlog_at_send_end"] = backlog_at_send_end
        step["drain_s"] = round(drain_s, 1)
        step["drained"] = drained
        results = fetch_results(cur, like)
        ppa_timing = parse_adapter_log(args.adapter_log, txn_prefix=f"LT{RUN_TAG}")
        step = summarize(step, sent, results, ppa_timing)
        steps_out.append(step)
        p95 = step["lat_ms"]["p95"]
        tms_p95 = step["tms_lat_ms"]["p95"]
        print(f"    sent={step['sent']} completed={step['completed']} "
              f"missing={step['missing']} p50={step['lat_ms']['p50']}ms p95={p95}ms "
              f"tms_p50={step['tms_lat_ms']['p50']}ms tms_p95={tms_p95}ms tms_tps={step['tms_tps']} "
              f"backlog@end={backlog_at_send_end} drain={drain_s:.0f}s drained={drained}", flush=True)
        # Fixed step plan — always run every step regardless of outcome, just record what happened.
        if not drained:
            warnings.append(f"backlog failed to fully drain within {args.drain_timeout:.0f}s at {rate} TPS")
            print(f"    warning: {warnings[-1]}", flush=True)
        time.sleep(args.settle)

    # final drain + stage breakdown over the whole run
    wait_drain(cur, like, len(all_sent), 60)
    breakdown = fetch_stage_breakdown(cur, like)
    results = fetch_results(cur, like)

    # per-txn ED/DP stage stats over analysed steps
    ed = sorted(r["ed_ns"] for r in results.values() if r["ed_ns"])
    dp = sorted(r["dp_ns"] for r in results.values() if r["dp_ns"])
    run_meta.update({
        "finished_iso": datetime.now(timezone.utc).isoformat(),
        "total_sent": len(all_sent),
        "total_evaluated": eval_count(cur, like),
        "warnings": warnings,
        "ed_ns": {"avg": int(sum(ed) / len(ed)) if ed else None,
                  "p95": int(pct(ed, 95)) if ed else None},
        "dp_ns": {"avg": int(sum(dp) / len(dp)) if dp else None,
                  "p95": int(pct(dp, 95)) if dp else None},
    })

    sampler.stop_flag.set()
    out = {"meta": run_meta, "steps": steps_out, "stage_breakdown": breakdown,
           "docker_cpu": sampler.samples}
    os.makedirs("reports/data", exist_ok=True)
    path = f"reports/data/run_{RUN_TAG}.json"
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"[{RUN_TAG}] wrote {path}", flush=True)
    pool.close()
    conn.close()

    if not args.skip_cleanup_after:
        print(f"[{RUN_TAG}] cleanup: truncating evaluation/event_history/raw_history", flush=True)
        cleanup_tables()


if __name__ == "__main__":
    main()
