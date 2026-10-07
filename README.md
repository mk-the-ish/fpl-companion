# ⚽ FPL Companion

An open-source, zero-cost Fantasy Premier League (FPL) mobile companion built with **React Native**, **Expo Router**, **Tailwind CSS (NativeWind)**, and **TanStack Query**.

Designed to track live gameweek stats, manage manager squads on an interactive formation pitch, and provide underlying player intelligence (xG, xA, Form, BPS) directly from official endpoints without paid API subscriptions.

---

## ⚡ Tech Stack & Architecture

* **Framework:** React Native / Expo (Expo Router v54+ file-based routing)
* **Styling:** NativeWind v4 (Tailwind CSS)
* **Server State & Caching:** TanStack Query (React Query)
* **Client & Persistent Store:** Zustand + React Native Async Storage
* **Icons:** Expo Vector Icons (`@expo/vector-icons`)
* **Data Source:** Fantasy Premier League Official REST Endpoints (`bootstrap-static`, `live`, `entry`)

---

## 🚀 Key Features

* **Matchday Live Hub:** Displays active gameweek deadline status, live average score, highest score, and real-time gameweek top scorers.
* **Squad Pitch Visualizer:** Grouped dynamic formation render (Goalkeeper, Defenders, Midfielders, Forwards) with Captaincy, Vice-Captain badges, and bench ordering.
* **Underlying Analytics:** Inspect any player for ICT Index, expected goals (xG), expected assists (xA), and form value.
* **No Authentication Friction:** Simple 1-step team sync using your official FPL Entry ID.

---

## 🛠️ Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v18.x or newer recommended)
* [Expo Go](https://expo.dev/go) app installed on your iOS or Android device

### Installation

1. **Clone the repository:**
   git clone [https://github.com/your-username/fpl-companion.git](https://github.com/your-username/fpl-companion.git)
   cd fpl-companion

Install project dependencies:
    npm install --legacy-peer-deps

Start the Metro development bundler:
    npx expo start -c

Launch on Device:
    Scan the terminal QR code using Expo Go on Android or the Camera app on iOS.

2. **Project Structure**
├── app/
│   ├── _layout.tsx            # Global providers (React Query, Safe Area)
│   ├── setup.tsx              # FPL Entry ID onboarding sheet
│   ├── player/
│   │   └── [id].tsx           # Modal player detailed stats
│   └── (tabs)/
│       ├── _layout.tsx        # Bottom tab navigation bar
│       ├── index.tsx          # Live Hub & matchday scoring
│       ├── squad.tsx          # Pitch view & current gameweek squad
│       ├── planner.tsx        # Captain & transfer recommendation tool
│       └── leagues.tsx        # Mini-league standings
├── components/
│   └── PitchView.tsx          # Responsive formation pitch layout
├── hooks/
│   └── useFplData.ts          # Data fetching queries & polling logic
├── services/
│   └── fplApi.ts              # Typed HTTP client for FPL endpoints
├── stores/
│   └── useUserStore.ts        # Zustand persistent user settings
└── types/
    └── fpl.ts                 # Full FPL API type definitions

📄 License
MIT License. Built strictly as an educational and portfolio project.