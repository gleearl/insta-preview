# insta-preview

A personal iOS app for planning your Instagram feed. Preview how your upcoming posts will look in your grid before you publish them — alongside your existing posts.

## Features

- **Grid preview** — 3-column, 4:5 portrait layout matching Instagram's profile grid
- **Online mode** — connect your Instagram account via the Graph API to automatically load your published posts
- **Offline mode** — manually add your posted photos and drafts from your camera roll, no Instagram account needed
- **Multi-account** — switch between multiple accounts, each with their own grid and drafts
- **Drag to reorder** — long press a draft to pick it up and drag it to a new position
- **Full-screen viewer** — tap any photo to view it full size; move or remove drafts from the viewer
- **Reels filtered out** — hidden Reels are excluded automatically
- **Expired URL refresh** — pull down or tap ↻ to re-fetch fresh Instagram CDN URLs
- **Secure token storage** — Instagram access tokens are stored on-device only using `expo-secure-store`

## Stack

- [Expo](https://expo.dev) SDK 54 (React Native 0.81)
- TypeScript
- `expo-image-picker` — camera roll access
- `expo-secure-store` — encrypted token storage
- `react-native-gesture-handler` — touch handling
- Instagram Graph API — media fetching

## Getting Started

### Prerequisites

- Node.js 20+
- [Expo Go](https://expo.dev/go) installed on your iPhone

### Run locally

```bash
git clone https://github.com/gleearl/insta-preview.git
cd insta-preview
npm install
npx expo start
```

Scan the QR code with your iPhone camera to open in Expo Go.

## Connecting Instagram

To load your real posts you need an Instagram access token:

1. Go to [developers.facebook.com](https://developers.facebook.com) and create an app (type: Business)
2. Add the **Instagram** product
3. Go to **Instagram → API setup with Instagram login**
4. Connect your account and click **Generate token**
5. Paste the token into the app via **your account name → Add Account → Online**

> Your Instagram account must be a **Professional account** (Business or Creator) for the media API to work. You can switch for free in the Instagram app under Settings → Account type and tools.

Tokens are stored securely on-device and never sent anywhere except Instagram's API.

## Deploying to Your iPhone (no App Store)

### Option A — EAS Build + TestFlight (recommended, $99/year)

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios
```

Submit the resulting build to TestFlight and install on your device.

### Option B — EAS Build + AltStore (free, 7-day auto-refresh)

1. Install [AltStore](https://altstore.io) on your iPhone
2. Build with EAS: `eas build --platform ios --profile preview`
3. Download the `.ipa` and install it via AltStore

### Option C — Expo Go (already works, no build needed)

Keep using Expo Go with `npx expo start`. Requires your Mac to be running.

## Roadmap

- [ ] Follower tracking — new followers, unfollowers
- [ ] Drag-to-reorder with spring animations
- [ ] Caption drafts per post
- [ ] Export grid as image
