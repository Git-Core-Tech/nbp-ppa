#!/usr/bin/env python3
"""Breaking-point performance test for the NBP-PPA -> Tazama FRMS pipeline.

Sends TMI1910 fixed-width messages straight to the nbp-ppa TCP listener
(localhost:3004, newline-delimited mode) in stepped offered-load levels
(open-loop pacing: send times are scheduled, never gated on completions,
so queue buildup is visible instead of hidden).

Per-transaction end-to-end latency is measured from the client send
timestamp to the `inserted_at` column of the row TADP writes into the
Tazama `evaluation` Postgres table (same host, same clock). Transactions
are correlated by trs_txnid_1, which the adapter copies into the pacs.002
OrgnlEndToEndId and which the evaluation row stores verbatim. The pacs.002
CreDtTm (second precision, from remote_time_sent) and the per-stage
nanosecond timings Tazama records (prcgTmED, prcgTmDP, per-rule prcgTm)
are collected as well.

Output: reports/data/run_<ts>.json with per-step aggregates, per-txn
samples, stage breakdowns, and docker CPU samples.

Usage:
  python3 perf_breakpoint_test.py                    # full stepped run
  python3 perf_breakpoint_test.py --steps 5,10 --step-duration 10   # quick
"""

import argparse
import json
import math
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone

import psycopg2

ADAPTER = ("127.0.0.1", 3004)
DB = dict(host="localhost", port=15432, user="postgres", dbname="evaluation")
TEMPLATE_FILE = "payload.txt"
RUN_TAG = datetime.now().strftime("%y%m%d%H%M%S")

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


def run_step(pool, template, rate, duration, seq_start, sent_log):
    """Open-loop: schedule sends at exact times regardless of pipeline state."""
    n = int(rate * duration)
    interval = 1.0 / rate
    t0 = time.perf_counter()
    wall0 = time.time()
    sent = []
    for k in range(n):
        target = t0 + k * interval
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
        "planned": n,
        "sent": len(sent),
        "send_window_s": wall1 - wall0,
        "achieved_send_tps": len(sent) / (wall1 - wall0) if wall1 > wall0 else 0,
        "wall_start": wall0,
        "wall_end": wall1,
        "txn_range": [sent[0][0], sent[-1][0]],
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


def summarize(step, sent, results):
    lats, insert_ts, missing, statuses = [], [], 0, {}
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
        samples.append({"t": ts, "lat_ms": round(lat, 2)})
    lats_sorted = sorted(lats)
    dur_out = (max(insert_ts) - min(insert_ts)) if len(insert_ts) > 1 else 0
    step.update({
        "completed": len(lats),
        "missing": missing,
        "statuses": statuses,
        "output_tps": round(len(lats) / dur_out, 2) if dur_out > 0 else None,
        "lat_ms": {
            "mean": round(sum(lats) / len(lats), 2) if lats else None,
            "p50": round(pct(lats_sorted, 50), 2) if lats else None,
            "p90": round(pct(lats_sorted, 90), 2) if lats else None,
            "p95": round(pct(lats_sorted, 95), 2) if lats else None,
            "p99": round(pct(lats_sorted, 99), 2) if lats else None,
            "max": round(lats_sorted[-1], 2) if lats else None,
            "min": round(lats_sorted[0], 2) if lats else None,
        },
        "samples": samples,
    })
    return step


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", default="1,2,5,10,20,30,50,75,100,150,200",
                    help="comma-separated offered TPS levels")
    ap.add_argument("--step-duration", type=float, default=20.0)
    ap.add_argument("--drain-timeout", type=float, default=180.0)
    ap.add_argument("--settle", type=float, default=5.0,
                    help="pause between steps after drain")
    ap.add_argument("--warmup", type=int, default=30)
    ap.add_argument("--conns", type=int, default=8)
    ap.add_argument("--stop-p95-ms", type=float, default=20000.0,
                    help="stop escalating when p95 exceeds this")
    args = ap.parse_args()

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
    run_meta = {
        "run_tag": RUN_TAG,
        "started_iso": datetime.now(timezone.utc).isoformat(),
        "step_duration_s": args.step_duration,
        "warmup": args.warmup,
        "conns": args.conns,
        "account_pool": ACCOUNT_POOL,
    }

    # warmup (excluded from analysis)
    print(f"[{RUN_TAG}] warmup: {args.warmup} txns @ 5 TPS", flush=True)
    w_sent = []
    run_step(pool, template, 5, args.warmup / 5.0, seq, w_sent)
    seq += len(w_sent)
    all_sent.extend(w_sent)
    wait_drain(cur, like, len(all_sent), 60)

    stopped_early = None
    for rate in [float(x) for x in args.steps.split(",")]:
        print(f"[{RUN_TAG}] step: {rate} TPS x {args.step_duration}s "
              f"({int(rate * args.step_duration)} txns)", flush=True)
        sent = []
        step = run_step(pool, template, rate, args.step_duration, seq, sent)
        seq += step["sent"]
        all_sent.extend(sent)
        backlog_at_send_end = len(all_sent) - eval_count(cur, like)
        c, drain_s, drained = wait_drain(cur, like, len(all_sent), args.drain_timeout)
        step["backlog_at_send_end"] = backlog_at_send_end
        step["drain_s"] = round(drain_s, 1)
        step["drained"] = drained
        results = fetch_results(cur, like)
        step = summarize(step, sent, results)
        step["step_sent_list_idx"] = None  # samples embedded
        steps_out.append(step)
        p95 = step["lat_ms"]["p95"]
        print(f"    sent={step['sent']} completed={step['completed']} "
              f"missing={step['missing']} p50={step['lat_ms']['p50']}ms "
              f"p95={p95}ms backlog@end={backlog_at_send_end} "
              f"drain={drain_s:.0f}s drained={drained}", flush=True)
        if not drained:
            stopped_early = f"backlog failed to drain at {rate} TPS"
            print(f"    stopping: {stopped_early}", flush=True)
            break
        if p95 is not None and p95 > args.stop_p95_ms:
            stopped_early = f"p95 {p95}ms exceeded cap at {rate} TPS"
            print(f"    stopping: {stopped_early}", flush=True)
            break
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
        "stopped_early": stopped_early,
        "ed_ns": {"avg": int(sum(ed) / len(ed)) if ed else None,
                  "p95": int(pct(ed, 95)) if ed else None},
        "dp_ns": {"avg": int(sum(dp) / len(dp)) if dp else None,
                  "p95": int(pct(dp, 95)) if dp else None},
    })

    sampler.stop_flag.set()
    out = {"meta": run_meta, "steps": steps_out, "stage_breakdown": breakdown,
           "docker_cpu": sampler.samples}
    import os
    os.makedirs("reports/data", exist_ok=True)
    path = f"reports/data/run_{RUN_TAG}.json"
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"[{RUN_TAG}] wrote {path}", flush=True)
    pool.close()
    conn.close()


if __name__ == "__main__":
    main()
