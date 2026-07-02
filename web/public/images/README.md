# Static images (served at `/images/...`)

## chrome-profile-automator.png

Screenshot used by the Browser Profile Guide page (`/user/browser-profile-guide`,
linked from the Team OAuth sign-in panel). It shows the macOS Automator
"Application" with a **Run Shell Script** action that launches an isolated Chrome
profile:

```
mkdir -p /tmp/chrome/isolate_2
open -na "Google Chrome" --args \
  --user-data-dir="/tmp/chrome/isolate_2"
```

Save the screenshot here as `chrome-profile-automator.png`. The guide page renders
it via `<img src="/images/chrome-profile-automator.png">` and **gracefully hides it
if the file is absent** (the text steps stand on their own), so the page never
breaks whether or not this asset is shipped.
