# qrcoder

Two static, offline-capable web apps (PWAs) for QR bookmark cards:

- **`qrbookmark/`** — QR Bookmark: create a card.
- **`qrreader/`** — QR Bookmark Reader: scan and read.

No build step. Serve the repository root with any static file server, e.g.:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/qrbookmark/> to make a card and
<http://localhost:8000/qrreader/> to read one.

Keep the two folders side by side under the same parent path. The creator links
to the reader as `../qrreader/`, and each card's QR panels encode the reader's
URL resolved against wherever the creator is hosted. Cards therefore point back
to your own deployment, so print them from the address you intend to keep
serving. The service workers need HTTPS or `localhost` for offline use.

## License

MIT — see [LICENSE](LICENSE).

### Third-party components

Bundled files keep their own licenses:

- `zxing.js`, `zxing_reader.wasm` — [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT) / [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (Apache-2.0)
- `jsqr.js` — [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)
- `qrcode.js` — [node-qrcode](https://github.com/soldair/node-qrcode) (MIT)
- `fonts/` — IBM Plex Sans, IBM Plex Mono, Oswald (SIL Open Font License 1.1)
