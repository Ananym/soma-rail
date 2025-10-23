import requests
import sys

url = "https://ice3.somafm.com/groovesalad-128-mp3"

print(f"Testing GET requests to: {url}\n")
print("=" * 80)

# Test 1: Minimal GET (like curl)
print("Test 1: Minimal GET request (no special headers)")
try:
    response = requests.get(url, stream=True, timeout=3)
    print(f"  Status: {response.status_code}")
    print(f"  Content-Type: {response.headers.get('content-type')}")
    # Read just a bit to confirm it's streaming
    chunk = next(response.iter_content(1024), None)
    print(f"  Data received: {len(chunk) if chunk else 0} bytes")
    response.close()
except Exception as e:
    print(f"  ERROR: {e}")

print()

# Test 2: Browser-like GET
print("Test 2: Full browser-like headers (Chrome)")
headers = {
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

try:
    response = requests.get(url, headers=headers, stream=True, timeout=3)
    print(f"  Status: {response.status_code}")
    print(f"  Content-Type: {response.headers.get('content-type')}")
    chunk = next(response.iter_content(1024), None)
    print(f"  Data received: {len(chunk) if chunk else 0} bytes")
    response.close()
except Exception as e:
    print(f"  ERROR: {e}")

print()

# Test 3: Just User-Agent (the problematic case)
print("Test 3: Only User-Agent + Range")
headers = {
    "Range": "bytes=0-",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

try:
    response = requests.get(url, headers=headers, stream=True, timeout=3)
    print(f"  Status: {response.status_code}")
    print(f"  Content-Type: {response.headers.get('content-type')}")
    chunk = next(response.iter_content(1024), None)
    print(f"  Data received: {len(chunk) if chunk else 0} bytes")
    response.close()
except Exception as e:
    print(f"  ERROR: {e}")

print("\n" + "=" * 80)
