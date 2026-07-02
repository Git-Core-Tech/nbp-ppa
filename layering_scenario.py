#!/usr/bin/env python3
"""Sends a structuring/layering test scenario through the queueforwarding endpoint.

Builds the same comma-joined authorization-message payloads as
build_authorization_message() in send_fractal.py, then POSTs each one
sequentially (not concurrently) so downstream TMS evaluation sees the
transactions in the same order the scenario implies.
"""

import hashlib
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

URL1 = "http://10.0.110.7:7033/nbpl/queueforwarding/"
SHA_SECRET = ",paysys@123"
DELAY_SECONDS = 2  # pace sends so we don't pile requests up on the gateway's single connection
# The gateway may never send an HTTP response at all — treat it as fire-and-forget. We only
# wait long enough to hand the request off; a timeout here is expected, not a failure signal.
REQUEST_TIMEOUT = 2

base = datetime(2026, 7, 2, 9, 5, 9)

accounts = {
    "A001": ("4220171772395", "ORIGINATOR A001"),
    "B001": ("00023173017401", "L1 B001"),
    "B002": ("00023173017402", "L1 B002"),
    "B003": ("00023173017403", "L1 B003"),
    "B004": ("00023173017404", "L1 B004"),
    "B005": ("00023173017405", "L1 B005"),
    "B006": ("00023173017406", "L1 B006"),
    "B007": ("00023173017407", "L1 B007"),
    "B008": ("00023173017408", "L1 B008"),
    "B009": ("00023173017409", "L1 B009"),
    "B010": ("00023173017410", "L1 B010"),
    "B011": ("00023173017411", "L1 B011"),
    "B012": ("00023173017412", "L1 B012"),
    "C001": ("00023173017501", "L2 C001"),
    "C002": ("00023173017502", "L2 C002"),
    "C003": ("00023173017503", "L2 C003"),
    "C004": ("00023173017504", "L2 C004"),
    "C005": ("00023173017505", "L2 C005"),
    "C006": ("00023173017506", "L2 C006"),
    "D001": ("00023173017601", "L3 D001"),
    "D002": ("00023173017602", "L3 D002"),
    "D003": ("00023173017603", "L3 D003"),
    "Z999": ("00023173017999", "FINAL Z999"),
}

txns = [
    # Day 1-2: A001 splits 100M into 12 accounts
    (0, "A001", "B001", 8500000), (0, "A001", "B002", 7900000),
    (0, "A001", "B003", 8200000), (1, "A001", "B004", 8700000),
    (1, "A001", "B005", 7600000), (1, "A001", "B006", 8400000),
    (1, "A001", "B007", 8100000), (1, "A001", "B008", 8300000),
    (1, "A001", "B009", 7700000), (1, "A001", "B010", 8600000),
    (1, "A001", "B011", 8000000), (1, "A001", "B012", 9700000),

    # Day 3-5: B accounts forward to C accounts
    (2, "B001", "C001", 8500000), (2, "B002", "C001", 7900000),
    (3, "B003", "C002", 8200000), (3, "B004", "C002", 8700000),
    (3, "B005", "C003", 7600000), (4, "B006", "C003", 8400000),
    (4, "B007", "C004", 8100000), (4, "B008", "C004", 8300000),
    (4, "B009", "C005", 7700000), (5, "B010", "C005", 8600000),
    (5, "B011", "C006", 8000000), (5, "B012", "C006", 9700000),

    # Day 6-8: C accounts forward to D accounts
    (6, "C001", "D001", 16400000), (6, "C002", "D001", 16900000),
    (7, "C003", "D002", 16000000), (7, "C004", "D002", 16400000),
    (8, "C005", "D003", 16300000), (8, "C006", "D003", 17700000),

    # Day 9-10: D accounts consolidate to Z999
    (9, "D001", "Z999", 33300000),
    (9, "D002", "Z999", 32400000),
    (10, "D003", "Z999", 34000000),
]


def amt(n):
    return str(n).zfill(12)


def make_payload(i, day_offset, src, dst, amount):
    ts = base + timedelta(days=day_offset, minutes=i * 7)
    stan = str(371000 + i)
    rrn = str(202607020000 + i)
    src_acct, src_name = accounts[src]
    dst_acct, dst_name = accounts[dst]

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
        status = resp.status
        body = resp.read().decode("utf-8")
        return status, body


payloads = [
    (i, src, dst, make_payload(i, day, src, dst, amount))
    for i, (day, src, dst, amount) in enumerate(txns, start=1)
]

if __name__ == "__main__":
    results = []
    for i, src, dst, payload in payloads:
        print(f"[{i}/{len(payloads)}] {src} -> {dst}", flush=True)
        start = time.monotonic()
        try:
            status, body = call(payload)
            elapsed = time.monotonic() - start
            print(f"  HTTP {status} in {elapsed:.2f}s: {body.strip()[:200]}", flush=True)
            results.append((i, src, dst, "sent", None))
        except TimeoutError:
            # Expected — the gateway is fire-and-forget and may never send a response.
            elapsed = time.monotonic() - start
            print(f"  sent (no response after {elapsed:.2f}s, as expected)", flush=True)
            results.append((i, src, dst, "sent", None))
        except Exception as exc:
            elapsed = time.monotonic() - start
            print(f"  FAILED after {elapsed:.2f}s: {exc}", flush=True)
            results.append((i, src, dst, None, str(exc)))
        time.sleep(DELAY_SECONDS)

    print("\n=========== SUMMARY ===========")
    for i, src, dst, status, err in results:
        outcome = status if err is None else f"ERROR: {err}"
        print(f"{i:>2}. {src} -> {dst}: {outcome}")

    failed = [r for r in results if r[3] is None]
    if failed:
        print(f"\n{len(failed)} of {len(results)} transactions failed to send.")
    else:
        print(f"\nAll {len(results)} transactions sent. Check server-side logs to confirm processing.")

    failed = [r for r in results if r[3] != 200]
    if failed:
        print(f"\n{len(failed)} of {len(results)} transactions did not return HTTP 200.")
    else:
        print(f"\nAll {len(results)} transactions submitted successfully.")
