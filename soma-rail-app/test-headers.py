import requests
import sys

url = "https://ice3.somafm.com/groovesalad-128-mp3"

# Test combinations of headers
test_cases = [
    ("No headers", {}),
    ("Just Range", {"Range": "bytes=0-"}),
    ("Range + Accept", {"Range": "bytes=0-", "Accept": "*/*"}),
    ("Range + User-Agent", {
        "Range": "bytes=0-",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }),
    ("Range + Referer (localhost)", {
        "Range": "bytes=0-",
        "Referer": "http://localhost:5173/"
    }),
    ("Range + Referer (somafm)", {
        "Range": "bytes=0-",
        "Referer": "https://somafm.com/"
    }),
    ("Browser-like headers (no GPC)", {
        "Accept": "*/*",
        "Accept-Encoding": "identity;q=1, *;q=0",
        "Range": "bytes=0-",
        "Referer": "http://localhost:5173/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    }),
    ("Browser-like + GPC", {
        "Accept": "*/*",
        "Accept-Encoding": "identity;q=1, *;q=0",
        "Range": "bytes=0-",
        "Referer": "http://localhost:5173/",
        "Sec-GPC": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
    }),
    ("Chrome without GPC", {
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
    }),
]

print(f"Testing: {url}\n")
print("=" * 80)

for name, headers in test_cases:
    try:
        response = requests.head(url, headers=headers, timeout=5, allow_redirects=False)
        status = f"OK {response.status_code}"
        if response.status_code >= 400:
            status = f"FAIL {response.status_code}"
        print(f"{name:40} | {status}")

        # Print CORS headers if present
        if "access-control-allow-origin" in response.headers:
            print(f"{'':40} | CORS: {response.headers['access-control-allow-origin']}")

    except requests.exceptions.RequestException as e:
        print(f"{name:40} | ERROR: {str(e)[:40]}")

    print()

print("=" * 80)
print("\nKey Findings:")
print("   - Compare which headers cause failures")
print("   - If 'No headers' works but browser headers fail, we found the issue")
