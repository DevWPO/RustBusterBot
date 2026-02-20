#  Discord Anti-Cheat Bot (BattleMetrics Integration)

A Discord bot that monitors live players across multiple servers using the BattleMetrics API and flags suspicious behavior based on activity metrics.

This project combines **API integration, real-time data processing, and detection logic** to simulate a lightweight anti-cheat / monitoring system.

---

##  Links
- [Othmen's GitHub](https://github.com/othmen27)
- [Othmen's Portfolio](https://othmen27.github.io/othmenmhiri/)
- [Anas's GitHub](https://github.com/DevAnasWPO)
---
##  Features

-  Streams players from multiple servers in real-time
-  Fetches player activity (K/D, kills, deaths, reports)
-  Calculates a **hacker probability score**
-  Flags suspicious players automatically
-  Sends alerts to Discord with rich embeds
-  Includes ban history + last ban tracking
-  Works across multiple servers in an organization

---

##  How It Works

1. Fetch all servers from an organization (BattleMetrics)
2. Filter only **online servers**
3. Stream players using pagination
4. For each player:
   - Fetch bans
   - Fetch activity stats
   - Fetch detailed player info
5. Calculate **hacker probability**
6. If threshold is exceeded:
   - Send alert to Discord
   - Tag moderators for high-risk players

---

##  Detection Logic

Suspicion is based on:

- K/D ratio (24h + total)
- Total playtime
- Reports
- Ban history

Example:
- High K/D + low playtime → suspicious
- Recent bans → higher risk
- Combined metrics → probability %

---

##  Tech Stack

- **Node.js**
- **discord.js**
- **BattleMetrics API**
- Modular architecture (custom utility modules)

---

##  Project Structure

```
├── bmFetch.js # API requests
├── bmUtils.js # Ban + date calculations
├── GetActivity.js # Player stats
├── getPlayerInfo.js # Detailed player data
├── getOrgServer.js # Organization servers
├── other/
│ └── calculateHackerPercent.js
```

---
##  Setup

### 1. Install dependencies

```bash
npm install
```
### 2. Environment variables
Create a ```.env``` or set environment variables:
```code
TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id
BESTRUSTID=your_battlemetrics_org_id
BMTOKEN=your_battlemetrics_token
```
### 3. Run the bot
```bash
node index.js
```

---

## Usage
In Discord:
```code
!start
```
The bot will:

- Stream players
- Analyze them
- Send alerts for suspicious profiles

---

## Alert System

- 🟡 Medium risk → embed message
- 🔴 High risk (80%+) → role ping + alert

---

## Limitations

- Heuristic-based (not a real anti-cheat)
- Depends on BattleMetrics API accuracy
- Rate-limited → uses delay between requests

---

## Ethics & Scope

- Uses public API data only
- No intrusive or client-side detection
- Designed for monitoring and analysis, not banning automation

## Future Improvements

- Dashboard (web interface)
- Persistent database (store flagged players)
- Machine learning-based detection
- Real-time streaming via websockets
- Better anomaly detection models

---

## Author

### Co-founder and Main Dev:
Othmen Mhiri
IT Student | DevOps & Cybersecurity
[GitHub](https://github.com/othmen27)

### Co-founder:
Anas Souheil
IOT Student
[GitHub](https://github.com/DevAnasWPO)
