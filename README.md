# qrcoder

Print a bookmark that carries a few thousand words of text entirely inside its
QR codes, then scan it and read that text on a phone with no internet
connection.

Two static web apps, both installable as offline PWAs:

- **`qrbookmark/`** — create a card: paste an excerpt, get a printable
  2.6 × 9.3 in bookmark (PNG, exact-size PDF, or browser print).
- **`qrreader/`** — scan a card with the camera and read the recovered text.
  Scanned texts are kept in an on-device library.

## Demo

Try the hosted version:

- **Creator:** <https://apps.keithbphillips.com/qrbookmark-vfkm8biz72q4qe78/>
- **Reader:** <https://apps.keithbphillips.com/qrreader-17a85b49/>

Open both on a phone and add them to the home screen to use them offline.
Cards made with the hosted creator link back to the hosted reader.

## How it works

- **The text is on the card, not on a server.** The creator compresses the
  excerpt, splits it into three data shards plus one XOR parity shard, and
  encodes each as a QR panel. Any three of the four panels rebuild the text.
- **Capacity is about 3,000 words.** The built-in sample (2,992 words) compresses
  to 7,180 B against a 7,917 B budget. Actual room depends on how well the text
  compresses; the creator's gauge shows it live.
- **Decoding happens on the device.** The reader decodes panels in the browser
  (ZXing via WebAssembly, jsQR as a fallback). Neither app makes network
  requests; every script, font and the wasm decoder are bundled.
- **Any reader reads any card.** Each panel is a URL of the form
  `<reader address>#<panel data>`. The reader app uses only the part after `#`,
  so it reads cards made on any host.

## Offline use

Open each app once over HTTPS and install it (Add to Home Screen). The service
worker caches everything, and from then on creating and reading cards works in
airplane mode. Over plain HTTP, including `http://localhost`, the apps run but
the service worker is not registered, so they are not cached for offline use.

The reader address at the front of each panel is only for a fallback: scanning
a panel with a phone's stock camera shows a tappable link. Tapping it opens the
reader at that address, which must be installed or reachable on that phone.
The panel data stays in the URL fragment, which browsers never send to a server.
Three taps assemble the text. With the reader app itself, the address doesn't
matter.

## Running it

No build step. Serve the repository root with any static file server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/qrbookmark/> and
<http://localhost:8000/qrreader/>. For offline install on a phone, host the
same files anywhere that serves HTTPS.

Keep the two folders side by side. The creator links to `../qrreader/` and
builds the panel address from wherever it is served.

## License

MIT — see [LICENSE](LICENSE).

### Third-party components

Bundled files keep their own licenses:

- `zxing.js`, `zxing_reader.wasm` — [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT) / [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (Apache-2.0)
- `jsqr.js` — [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)
- `qrcode.js` — [node-qrcode](https://github.com/soldair/node-qrcode) (MIT)
- `fonts/` — IBM Plex Sans, IBM Plex Mono, Oswald (SIL Open Font License 1.1)
