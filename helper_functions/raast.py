import requests
import json

BASE_URL = "http://10.0.110.2:8082"

# ======================================
# 1. AUTHENTICATE
# ======================================
print("\n=========== API 1 AUTHENTICATE ===========")

auth_url = f"{BASE_URL}/api/v1/authenticate"

auth_headers = {
    "accept": "*/*",
    "X-Auth-Username": "Solecheck3",
    "X-Auth-Password": "Abcd@4321",
    "IS_FP": "false",
    "X-Device-Token": "abcd",
    "X-Device-Type": "android",
    "X-Device-ID": "abcd",
    "X-Device-Version": "samsung SM-A325F|4.8.8| Android SDK: 33 (13)"
}

auth_response = requests.post(auth_url, headers=auth_headers)

print("Status:", auth_response.status_code)
print(json.dumps(auth_response.json(), indent=4))

auth_data = auth_response.json()

auth_token = auth_data.get("data", {}).get("token")
iban = auth_data.get("data", {}).get("details", {}).get("ibanNo")

print("\n========== TOKENS ==========")
print("Auth Token:", auth_token)
print("IBAN:", iban)

# ======================================
# 2. TITLE FETCH
# ======================================
print("\n=========== API 2 RAAST TITLE FETCH ===========")

title_url = f"{BASE_URL}/api/v1/raast/payment/titlefetch2?channel=MOBILE_APP"

title_headers = {
    "accept": "*/*",
    "Content-Type": "application/json",
    "X-Auth-Token": auth_token
}

title_payload = {
    "receiveriban": "PK61ABPA0010000019474073",
    "idType": "CNIC",
    "idValue": "4210187689933",
    "memberid": "ABPAPKKA",
    "amount": "3",
    "benefType": "",
    "walletPayment": True
}

title_response = requests.post(
    title_url,
    headers=title_headers,
    json=title_payload
)

print("Status:", title_response.status_code)
print(json.dumps(title_response.json(), indent=4))

title_header_token = title_response.headers.get("X-Auth-Next-Token")

print("\n========== TOKENS ==========")
print("TitleFetch Header Token:", title_header_token)

# ======================================
# 3. OTP
# ======================================
print("\n=========== API 3 OTP ===========")

otp_url = f"{BASE_URL}/api/v1/my/otp?channel=MOBILE_APP"

otp_headers = {
    "accept": "*/*",
    "Content-Type": "application/json",
    "X-Auth-Token": title_header_token
}

otp_payload = {
    "benefType": "1",
    "accountNumber": "PK61ABPA0010000019474073",
    "imd": "589430",
    "tranType": "RAAST",
    "benef": False,
    "walletPayment": False
}

otp_response = requests.post(
    otp_url,
    headers=otp_headers,
    json=otp_payload
)

print("Status:", otp_response.status_code)
print(json.dumps(otp_response.json(), indent=4))

payment_header_token = otp_response.headers.get("X-Auth-Next-Token")

print("\n========== TOKENS ==========")
print("OTP Header Token:", payment_header_token)

# ======================================
# 4. PAYMENT REQUEST
# ======================================
print("\n=========== API 4 PAYMENT REQUEST ===========")

payment_url = f"{BASE_URL}/api/v1/raast/payment/paymentrequest?channel=MOBILE_APP"

payment_headers = {
    "accept": "*/*",
    "Content-Type": "application/json",
    "X-Auth-Token": payment_header_token
}

payment_payload = {
    "otp": "1234",
    "iban": iban,
    "idType": "CNIC",
    "idValue": "4210187689933",
    "senderName": "Haris Siddiqui",
    "receiveriban": "PK61ABPA0010000019474073",
    "receiverName": "Shafiq sahab",
    "amount": "5",
    "fee": "0",
    "receiverParticipantCode": "ABPAPKKA",
    "narration": "NBP RAAST PAYMENTS",
    "paymentPurpose": "005",
    "isBenef": False,
    "rcvrEmailAddress": "",
    "rcvrMobileNumber": "",
    "paymentMethod": "paybyaccount",
    "receiverAlias": "0010000019474073",
    "benefiAlias": "",
    "bankName": "",
    "comments": "",
    "accountNo": "03122674501",
    "transactionDate": "2026-06-30",
    "transactionTime": "08:06:96",
    "addBenef": False,
    "qrPayment": False
}

payment_response = requests.post(
    payment_url,
    headers=payment_headers,
    json=payment_payload
)

print("Status:", payment_response.status_code)

print("\n=========== FINAL RESPONSE ===========")
print(json.dumps(payment_response.json(), indent=4))

print("\n========== RESPONSE TOKENS ==========")
print("Payment Next Token:", payment_response.headers.get("X-Auth-Next-Token"))