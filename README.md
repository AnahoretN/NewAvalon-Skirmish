<div align="center">
<img src="https://res.cloudinary.com/dxxh6meej/image/upload/v1773422881/DamanakiPreview2_ixyh0u.webp" alt="New Avalon: Skirmish" />
</div>

# New Avalon: Skirmish

A dynamic tactical duel card game played on a limited grid field. Deploy Units and Commands to capture control over key battle lines.

## Play Online

The game is available at: **[anahoretN.github.io/NewAvalon-Skirmish](https://anahoretN.github.io/NewAvalon-Skirmish/)**

## Quick Start (P2P Multiplayer)

The game uses **WebRTC Peer-to-Peer** architecture - no server required for gameplay!

### Host a Game

1. Open the game
2. Click **"Create Game"**
3. Share your **Peer ID** or the **Invite Link** with friends

### Join a Game

1. Open the game
2. Click **"Join Game"**
3. Enter the host's **Peer ID** (or use the invite link)

## Running Locally (Development)

```bash
# Install dependencies
npm install

# Development mode (with Hot Module Replacement)
npm run dev
```

The game will be available at `http://localhost:8080`

## Build for GitHub Pages

```bash
# Build for GitHub Pages
npm run build:gh-pages

# Deploy the 'dist' folder to GitHub Pages
# Via GitHub UI: Settings > Pages > Source > Deploy from a branch
```

## Features

- **Tactical Grid Combat**: Position-based card game on dynamic board sizes (4x4, 5x5, 6x6, 7x7)
- **P2P Multiplayer**: WebRTC peer-to-peer gameplay for 2-4 players without central server
- **Multiple Game Modes**: Free-for-all, 2v2 team battles, and 3v1
- **Card Abilities**: Deploy, Setup, Commit, and Passive abilities
- **Dynamic Status System**: Support, Threat, Aim, Shield, Exploit, and more
- **Multi-language Support**: English, Russian, Serbian
- **Custom Decks**: Build and customize your own decks
- **Responsive Design**: Works on desktop and mobile

## Game Modes

- **Free-For-All**: Every player competes individually
- **2v2**: Two teams of two players each
- **3v1**: Three players vs one (asymmetric gameplay)

## How to Play

1. **Setup Phase**: Place units from your hand onto the battlefield (face-up or face-down)
2. **Main Phase**: Activate card abilities to attack, defend, and manipulate the board
3. **Commit Phase**: Add counters/statuses to cards and prepare for scoring
4. **Scoring Phase**: Count completed lines on the battlefield to earn points
5. **Turn End**: Play passes to the next player

First player to win 2 rounds wins the match!

## Project Structure

```text
/
├── client/                   # React frontend
│   ├── components/          # UI components
│   ├── hooks/               # Custom React hooks
│   ├── p2p/                 # WebRTC P2P system
│   ├── locales/             # Translation files
│   └── utils/               # Client utilities
├── server/                  # Development server only
│   ├── handlers/            # WebSocket handlers
│   └── services/            # Core services
├── shared/                  # Shared code between client/server
│   ├── content/             # Game content data
│   ├── abilities/           # Ability system
│   └── utils/               # Shared utilities
├── CLAUDE.md                # Development guide
└── DEPLOYMENT.md            # Deployment instructions
```

## License

[MIT License](LICENSE)

## Support

For issues and questions, please use the GitHub issue tracker.
