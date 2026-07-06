#!/usr/bin/env python3
"""Python port of TestHttpClient.call() — sends a queueforwarding request.

Mirrors src/main/java/org/monet/nbpl/http/client/TestHttpClient.java:
  - build urlParameters
  - URL-encode them
  - append SHA256(urlParameters + ",paysys@123") as the last path segment
  - GET the result
"""

import hashlib
import random
import urllib.parse
import urllib.request
from datetime import datetime

URL1 = "http://10.0.110.7:7033/nbpl/queueforwarding/"
SHA_SECRET = ",paysys@123"


def generate_rrn():
    now = datetime.now()
    # matches Java's SimpleDateFormat("ddHHmms"): dd, HH, mm zero-padded, s not padded
    date_time = f"{now.day:02d}{now.hour:02d}{now.minute:02d}{now.second}"
    counter = random.randint(0, 99)
    return (date_time + str(counter)).rjust(12, "0")


def sha256_hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def call(url_parameters, base_url=URL1):
    # Java's URLEncoder leaves A-Za-z0-9 - _ . * unescaped and turns space into "+"
    # then the code replaces "+" with "%20". Python's quote() already emits %20
    # for spaces, so matching the same safe-char set reproduces it exactly.
    escaped = urllib.parse.quote(url_parameters, safe="-_.*")
    digest = sha256_hex(url_parameters + SHA_SECRET)
    url = f"{base_url}{escaped}/{digest}"
    print("URL:", url)

    with urllib.request.urlopen(url) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Failed: HTTP error code : {resp.status}")
        print("Output from Server ....\n")
        print(resp.read().decode("utf-8"))


ZEROS_16 = "0000000000000000"
ZEROS_17 = "00000000000000000"


def build_authorization_message(stan, rrn):
    # Field order/names per the onusTransactionParams guide — each tuple is
    # (field_name, value). Values are joined with "," in this exact order.
    fields = [
        ("tran_type", "authorization-message"),
        ("interface_version_nr", "0371"),
        ("record_type", "2000"),
        ("remote_time_sent", "20260702140509"),
        ("remote_time_received", ZEROS_16),
        ("local_time_received", ZEROS_16),
        ("local_time_sent", ZEROS_16),
        ("stan", stan),
        ("rrn", rrn),
        ("message_type_indicator", "0200"),
        ("issuer_organisation_code", "NBP"),
        ("acquirer_organisation_code", "NBP"),
        ("pan_account_number", "4220171772395"),
        ("acquirer_bin", "979898"),
        ("authorisation_request_date", "2026-07-02-14:05:09"),
        ("merchant_request_date", "2026-07-0214:05:09"),
        ("pan_request_amount", "000000000700"),
        ("iso_pan_billing_currency", "PKR"),
        ("org_reference_request_amount", "000000000700"),
        ("iso_org_reference_currency", "586"),
        ("merchant_request_amount", "000000000700"),
        ("iso_merchant_currency", "PKR"),
        ("merchant_number", "3"),
        ("merchant_category_code", "06012"),
        ("merchant_name", "NISAR AZEEM"),
        ("merchant_city", ""),
        ("iso_merchant_nation_code", "PAK"),
        ("processing_code_transaction_type", "40"),
        ("processing_code_from_account", "00"),
        ("processing_code_to_account", "00"),
        ("response_code", "000"),
        ("authorisation_code", ""),
        ("pos_condition_code", ""),
        ("pan_entry_mode", "60"),
        ("pin_capability", ""),
        ("phase_of_authorisation", ""),
        ("phase_of_decline", ""),
        ("track_1_present_valid", "0"),
        ("track_2_present_valid", "0"),
        ("cvv2_4dbc_status", "0"),
        ("expiry_date", ""),
        ("terminal_type", ""),
        ("terminal_chip_capability", ""),
        ("chip_condition_code", ""),
        ("reserved_for_future", ""),
        ("merchant_group", ""),
        ("transaction_indicator", ""),
        ("auth_reliability", ""),
        ("ecommerce_indicator", ""),
        ("mc_pos_terminal_attendance_indicator", ""),
        ("mc_reserved_for_future_use", ""),
        ("mc_pos_terminal_location_indicator", ""),
        ("mc_pos_cardholder_presence_indicator", ""),
        ("mc_pos_card_presence_indicator", ""),
        ("mc_pos_card_capture_capabilities", ""),
        ("mc_pos_transaction_status_indicator", ""),
        ("mc_pos_transaction_security_indicator", ""),
        ("mc_reserved", ""),
        ("mc_cat_level_indicator", ""),
        ("mc_terminal_input_capability_indicator", ""),
        ("mc_pos_authorisation_life_cycle", "00"),
        ("mc_pos_country_code", ""),
        ("mc_pos_postal_code", ""),
        ("mc_transaction_encrypted_indicator", ""),
        ("mc_cryptogram_indicator", ""),
        ("mc_ucaf_indicator", ""),
        ("open_to_buy", ZEROS_17),
        ("card_confirmed_balance", ZEROS_17),
        ("card_pending_balance", ZEROS_17),
        ("product_code", ""),
        ("credit_limit", ZEROS_17),
        ("pan_status", ""),
        ("terminal_id", "00000000"),
        ("customer_status", ""),
        ("test_card_transaction", "0"),
        ("temp_credit_limit", ZEROS_17),
        ("temp_credit_limit_expiry", ""),
        ("account_number", ""),
        ("account_type", ""),
        ("region_code", ""),
        ("system_business_date", "2026-07-02"),
        ("cavv_ucaf_indicator", ""),
        ("security_block", ""),
        ("security_reason", ""),
        ("collection_block", ""),
        ("collection_reason", ""),
        ("other_block", ""),
        ("other_block_reason", ""),
        ("notification_reason_code", ""),
        ("fractals_response_override", ""),
        ("authorisation_rule_override", ""),
        ("emv_cryptogram_check_status", ""),
        ("emv_chip_enabled_card", "0"),
        ("emv_contactless_enabled_card", ""),
        ("emv_prefer_online_verify", ""),
        ("atc_rule_code", ""),
        ("atc_rule_code_1", ""),
        ("action_response_code_1", ""),
        ("atc_rule_code_2", ""),
        ("action_response_code_2", ""),
        ("atc_rule_code_3", ""),
        ("action_response_code_3", ""),
        ("atc_rule_code_4", ""),
        ("action_response_code_4", ""),
        ("product_category", ""),
        ("transaction_category_code", ""),
        ("card_verify_method", ""),
        ("advice_reason_code", ""),
        ("advice_detail_code", ""),
        ("risk_condition_code", ""),
        ("third_party_score", ""),
        ("card_pan_country_code", "PKR"),
        ("acquiring_country_code", "PKR"),
        ("destination_sort_code", ""),
        ("destination_account", ""),
        ("service_code", "000"),
        ("state_code", ""),
        ("custom_amount_1", ZEROS_17),
        ("custom_flag_1", ""),
        ("custom_text_50_1", "00023173017478"),  # from_account_no
        ("custom_text_10_1", "NBP"),              # bank_name
        ("custom_integer_1", "000"),
        ("custom_datetime_1", ""),
        ("custom_amount_2", ZEROS_17),
        ("custom_flag_2", ""),
        ("custom_text_50_2", ""),
        ("custom_text_10_2", ""),
        ("custom_integer_2", "000"),
        ("custom_datetime_2", ""),
        ("custom_amount_3", ZEROS_17),
        ("custom_flag_3", ""),
        ("custom_text_50_3", ""),
        ("custom_text_10_3", ""),
        ("custom_integer_3", "000"),
        ("custom_datetime_3", ""),
        ("correspondent_bank_account_iban_country_code", ""),
        ("correspondent_bank_account_iban_check_digits", ""),
        ("correspondent_bank_account_iban_bank_identifier", ""),
        ("correspondent_name", ""),
        ("correspondent_reference", ""),
        ("card_brand", "00"),
        ("issuing_bank", "00"),
        ("domestic_transaction_type", "000"),
        ("chip_card_indicator", ""),
        ("card_origin", "0"),
        ("authorisation_conclusion_code", "000"),
    ]
    return ",".join(value for _name, value in fields)


if __name__ == "__main__":
    rrn = generate_rrn()
    stan = rrn[-6:]

    url_parameters = build_authorization_message(stan, rrn)

    print("urlParameters:", url_parameters)
    call(url_parameters)
