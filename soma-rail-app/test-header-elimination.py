import requests

url = "https://ice3.somafm.com/groovesalad-128-mp3"

print(f"Testing which specific headers cause 403 on GET requests\n")
print("=" * 80)

# Full browser headers that cause 403
all_headers = {
    "Accept": "*/*",
    "Accept-Encoding": "identity;q=1, *;q=0",
    "Range": "bytes=0-",
    "Referer": "http://localhost:5173/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="141", "Not?A_Brand";v="8"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "audio",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site"
}

# Test removing headers one at a time
header_names = list(all_headers.keys())

for header_to_remove in header_names:
    test_headers = {k: v for k, v in all_headers.items() if k != header_to_remove}

    try:
        response = requests.get(url, headers=test_headers, stream=True, timeout=2)
        status = f"OK {response.status_code}" if response.status_code == 200 else f"FAIL {response.status_code}"
        response.close()
    except Exception as e:
        status = f"ERROR: {str(e)[:30]}"

    print(f"Without {header_to_remove:25} | {status}")

print("\n" + "=" * 80)
print("\nNow testing individual headers:\n")

# Test each header individually (with minimal base)
for header_name, header_value in all_headers.items():
    test_headers = {header_name: header_value}

    try:
        response = requests.get(url, headers=test_headers, stream=True, timeout=2)
        status = f"OK {response.status_code}" if response.status_code == 200 else f"FAIL {response.status_code}"
        response.close()
    except Exception as e:
        status = f"ERROR: {str(e)[:30]}"

    print(f"Only {header_name:25} | {status}")

print("\n" + "=" * 80)
