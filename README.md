# Torn Build Planner

A Tampermonkey userscript that lives on the Torn gym page and tells you what to train next for your chosen build. Auto-pulls your current stats from the Torn API after every training session.

## What it shows

- **Train next** - the single stat furthest behind its target, with the exact gap in millions
- **Per-stat progress bars** - filling orange to green as each stat approaches its target ratio
- **Current vs target distribution** - your actual stat split compared to the build's ideal split
- **Milestone table** - what each stat should be at 100M, 250M, 500M, 1B, 2.5B, 5B, and 10B total, with checkmarks as you pass each one

## Builds

**Juggernaut ⚔️** - 50% STR / 25% SPD / 25% DEF

Hits hard, survives long enough to keep fighting. Recommended for war and chaining. The reliable, low-complexity choice for newer players.

**Phantom 🥷** - 50% STR / 25% SPD / 25% DEX

Relies on Dexterity to make opponents miss rather than absorbing damage. Can punch above its weight against slower opponents but less forgiving if hits land.

**Sentinel ⚖️** - 25% STR / 25% SPD / 25% DEF / 25% DEX

The traditional balanced build. No obvious weakness, strong long-term, but each stat grows slower early on.

## How the planning works

You cannot remove stats, only add them. If one stat is already over-represented for your chosen build, it becomes the anchor and the script calculates how much every other stat needs to grow to match the target ratio.

Example: if your DEF is at 80M but the build only wants 25%, the script sets the implied total at 320M and tells you STR needs +110M and SPD needs +30M to catch up - rather than pretending you can reduce DEF.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Click the raw link below and Tampermonkey will prompt to install:

```
https://raw.githubusercontent.com/mat-mcc-uk/torn-build-planner/main/torn-build-planner.user.js
```

3. Navigate to your Torn gym page
4. The panel appears bottom-left - click to expand
5. Enter your Torn API key when prompted (Limited Access is enough)

## API key

Get your key at **torn.com/preferences.php#tab=api**. Create a key with Limited Access - the script only needs the `battlestats` and `basic` selections. It does not need Full or Custom Access.

The key is stored locally in Tampermonkey and never sent anywhere except the Torn API.

## Auto-refresh

The script re-fetches your stats automatically after each training session. It watches for the gym result appearing in the page and pulls updated stats 4 seconds later to give Torn's server time to commit the gain. You can also hit the ↻ button in the panel header to refresh manually at any time.

## Related scripts

- [Foreign Stock Itinerary](https://github.com/mat-mcc-uk/torn-stock-itinerary) - ranks foreign shop items by profit and predicts restock times
- [Torn Target Tracker](https://github.com/mat-mcc-uk/torn-target-tracker) - FFScouter-powered target finder and mugging overlay
- [Torn Fight HP Tracker](https://github.com/mat-mcc-uk/torn-fight-hp) - shows opponent HP percentage during fights

## License

MIT
