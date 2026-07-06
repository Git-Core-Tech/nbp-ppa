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

print("Auth Token:", auth_token)
print("IBAN:", iban)


# ======================================
# 2. TITLE FETCH
# ======================================
print("\n=========== API 2 TITLE FETCH ===========")

title_url = f"{BASE_URL}/api/v1/transfer/titlefetch?channel=MOBILE_APP"

title_headers = {
    "accept": "*/*",
    "Content-Type": "application/json",
    "X-Auth-Token": auth_token
}

title_payload = {
    "titleFetchAccount": "03943039129011",
    "fromAccount": iban,
    "imd": "979898",
    "cnic": "",
    "benefiType": "1",
    "amount": "2",
    "purposeOfPayment": "0251",
    "walletPayment": False
}

title_response = requests.post(
    title_url,
    headers=title_headers,
    json=title_payload
)

print("Status:", title_response.status_code)
print(json.dumps(title_response.json(), indent=4))

title_data = title_response.json()

transfer_token = title_data.get("data", {}).get("token")
otp_header_token = title_response.headers.get("X-Auth-Next-Token")

print("Transfer Token:", transfer_token)
print("OTP Header Token:", otp_header_token)


# ======================================
# 3. OTP
# ======================================
print("\n=========== API 3 OTP ===========")

otp_url = f"{BASE_URL}/api/v1/my/otp?channel=MOBILE_APP"

otp_headers = {
    "accept": "*/*",
    "Content-Type": "application/json",
    "X-Auth-Token": otp_header_token
}

otp_payload = {
    "benefType": "1",
    "accountNumber": "03943039129011",
    "imd": "979898",
    "tranType": "FundTransfer",
    "walletPayment": False,
    "benef": False
}

otp_response = requests.post(
    otp_url,
    headers=otp_headers,
    json=otp_payload
)

print("Status:", otp_response.status_code)
print(json.dumps(otp_response.json(), indent=4))

transfer_header_token = otp_response.headers.get("X-Auth-Next-Token")

print("Transfer Header Token:", transfer_header_token)


# ======================================
# 4. THREE PFT TRANSFER
# ======================================
print("\n=========== API 4 TRANSFER ===========")

transfer_url = f"{BASE_URL}/api/v1/transfer/threepft?channel=MOBILE_APP"

transfer_headers = {
    "accept": "*/*",
    "Content-Type": "application/json",
    "X-Auth-Token": transfer_header_token
}

transfer_payload = {
    "fromAccount": iban,
    "toAccount": "03943039129011",
    "benefID": "14673",
    "amount": "7",
    "isOwnAccountTransfer": "0",
    "comments": "",
    "imd": "979898",
    "isBenef": True,
    
    "otp": "1234",
    "validateOTP": True,
    "purposeOfPayment": "0251",
    "rcvrEmailAddress": "",
    "rcvrMobileNumber": "",
    "token": transfer_token,
    "benefiAlias": "",
    "addBenef": False,
    "qrPayment": False,
    "rtpId": "",
    "benef": True,
    "rtpID": ""
}

transfer_response = requests.post(
    transfer_url,
    headers=transfer_headers,
    json=transfer_payload
)

print("Status:", transfer_response.status_code)

print("\n=========== FINAL RESPONSE ===========")
print(json.dumps(transfer_response.json(), indent=4))