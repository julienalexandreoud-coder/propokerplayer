// background.js

let lastCaptureResult = null;
let lastCaptureTime = 0;
let localHUD = {}; // { "PlayerName": { hands:0, vpip:0, pfr:0, lastSeen: Date } }

// Load HUD from storage on start
chrome.storage.local.get(['localHUD'], (res) => {
    if (res.localHUD) localHUD = res.localHUD;
});

async function getThrottledCapture(windowId) {
    const now = Date.now();
    // 300ms throttle - if we captured very recently, reuse the image
    if (lastCaptureResult && (now - lastCaptureTime < 300)) {
        return lastCaptureResult;
    }

    return new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (!dataUrl) {
                reject(new Error('Failed to capture screen (DataURL empty)'));
            } else {
                lastCaptureResult = dataUrl;
                lastCaptureTime = Date.now();
                resolve(dataUrl);
            }
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_SCREEN') {
        const windowId = sender.tab ? sender.tab.windowId : null;
        getThrottledCapture(windowId)
            .then(dataUrl => sendResponse({ dataUrl }))
            .catch(err => sendResponse({ error: err.message }));
        return true;
    }

    if (message.type === 'PERFORM_ANALYSIS') {
        handleVisionAnalysis(sender.tab, message.localMetadata, message.cleanDataUrl);
        return true;
    }
});

async function handleVisionAnalysis(tab, localMetadata = "", cleanDataUrl = null) {
    const tabId = tab.id;
    const windowId = tab.windowId;

    try {
        console.log('Processing analysis request...');
        let dataUrl = cleanDataUrl;

        // If content script didn't provide a clean screenshot, capture one now
        if (!dataUrl) {
            console.log('Capturing for Gemini (background fallback)...');
            dataUrl = await getThrottledCapture(windowId);
        } else {
            console.log('Using clean screenshot from content script.');
        }

        const result = await analyzeWithGemini(dataUrl, localMetadata);

        // Update HUD stats if opponents are detected
        if (result.detected_state && result.detected_state.opponents) {
            updateHUD(result.detected_state.opponents, result.detected_state.street);
        }

        chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_DECISION',
            recommendation: result.recommendation,
            reasoning: result.reasoning,
            state: result.detected_state,
            hud: localHUD // Pass HUD back to UI
        });
    } catch (error) {
        console.error('Analysis failed:', error);
        chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_DECISION',
            recommendation: 'Error',
            reasoning: `Analysis failed: ${error.message}. Check your API Key and internet connection.`
        });
    }
}

async function analyzeWithGemini(imageBase64, localMetadata = "") {
    const data = await chrome.storage.local.get(['apiKey', 'currentStrategy', 'customPrompt', 'bigBlind']);
    const key = data.apiKey;
    const strategy = data.currentStrategy || 'gto';
    const customPrompt = data.customPrompt || '';
    const BB = data.bigBlind || 'Unknown';
    if (!key) throw new Error('API Key missing in storage');

    const cleanBase64 = imageBase64.split(',')[1];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;

    // Define strategy-specific logic
    const strategyConfigs = {
        gemini: {
            title: "Gemini's Elite Pro Strategy",
            goal: "Dominate the table using a hybrid GTO-Exploitative approach.",
            rules: `
                ### 1. MATHEMATICAL FOUNDATION (GTO)
                - **Pot Odds vs Equity**: Mandatory break-even check. If equity < cost_to_call, FOLD unless semi-bluffing.
                - **Range Balancing**: Ensure a balanced mix of Value Bets and Bluffs. Never be predictable.
                - **MDF (Minimum Defense Frequency)**: On the river, defense % = 1 / (Opponent Bet Size + 1).
                - **Blockers**: Factor in how your hole cards block opponent's Nut Flush/Straight combos.
                - **SPR Awareness**: Commit early with strong draws if SPR < 3. Play cautiously if SPR > 15.

                ### 2. EXPLOITATIVE ANALYSIS
                - **Frequency Analysis**: Identify if opponents are "Whales" (VPIP > 50) or "Nits" (VPIP < 10).
                - **Bet Sizing Tells**: Scrutinize if large bets correlate with strength or desperation.
                - **Timing Tells**: Assume quick checks are weak. Long tanks on dry boards indicate marginal decisions.
                - **Fold-to-Stat**: Attack players who fold to C-Bets > 60% of the time.

                ### 3. CONTEXTUAL & DEEP ANALYSIS
                - **Positional Advantage**: Open wider from BTN/CO. Be extremely tight from UTG.
                - **ICM & Bubble (Tourney)**: Prioritize survival near pay jumps. Attack short stacks as a big stack.
                - **Multi-way Dynamics**: In 3+ player pots, tighten ranges significantly. Equity requirements increase.
                - **Information Hiding**: Occasionally use 'Mixed Strategies' (Call with AA to trap, Raise with 76s to balance).
            `
        },
        nl2: {
            title: "Micro-Stakes & Winamax Specialist",
            goal: "Euro-Pool Explosion: Exploit weak, loose, and passive players while beating high rake.",
            rules: `
                - **3-Bet or Fold**: Due to high rake, avoid 'flat calling' pre-flop unless in the Big Blind. Either 3-Bet to take the pot now or Fold.
                - **Value is King**: Micro-Stakes players hate folding. Never bluff 'calling stations'. Only bet if you have a strong hand or 8+ outs.
                - **The €0.02 Exploitation**: If an opponent limps, raise 4x BB + 1 BB per limper. Isolate the fish.
                - **Respect River Aggression**: If a passive player raises on the Turn or River, they have the nuts. FOLD unless you have an elite hand.
                - **Overbet for Value**: On safe boards, use 1.2x pot bets to extract maximum value from stubborn recreational players.
            `
        },
        nit: {
            title: "Nit (Ultra-Conservative)",
            goal: "Minimize risk. Survival is everything.",
            rules: `
                - Fold the bottom 90% of hands pre-flop. Only play Premimums (AA, KK, QQ, JJ, AK).
                - Post-flop: Only bet if you have better than 2 pair. Fold everything else.
                - Never bluff.
            `
        },
        tag: {
            title: "TAG (Tight-Aggressive)",
            goal: "Steady profit with low variance.",
            rules: `
                - Play top 15-20% of hands. Fold marginal draws.
                - When you have a hand, bet it strongly. No passive calling.
                - Bluff only with high equity (Semi-bluffs).
            `
        },
        lag: {
            title: "LAG (Loose-Aggressive)",
            goal: "Maximize pressure and steal pots.",
            rules: `
                - Play top 35% of hands. High frequency of 3-bets and steals.
                - Be extremely aggressive post-flop. Triple barrel bluffs are encouraged if you detect weakness.
                - Use 'Overbets' to force folds.
            `
        },
        tournament: {
            title: "Tournament Master",
            goal: "Navigate ICM and preserve tourney life.",
            rules: `
                - Adjust ranges based on stack depth (BB). 
                - Risk-averse near the bubble. Highly aggressive when short-stacked (<15 BB).
                - Factor in the risk of elimination vs. chip gain.
            `
        },
        spin: {
            title: "Spin & Go Specialist",
            goal: "Elite 3-Max performance.",
            rules: `
                - Be extremely aggressive pre-flop. 3-Max is won by the aggressor.
                - Wider ranges for all-in shoves when <= 10 BB.
                - Punish limpers relentlessly.
            `
        },
        cash: {
            title: "Cash Game Grinder",
            goal: "Steady, deep-stack profit consolidation.",
            rules: `
                - Play very tight pre-flop against early position raises.
                - Maximize value on later streets (Turn/River).
                - Don't force big bluffs unless you have a serious read on the board texture.
            `
        }
    };

    const config = strategyConfigs[strategy] || strategyConfigs.gto;

    const prompt = `
        Act as a ${config.title}. Objective: ${config.goal}
        
        ### GROUND TRUTH (LOCAL VISION ENGINE):
        These values are extracted locally and are 100% ACCURATE. Use them to override any visual uncertainty:
        ${localMetadata}

        ### POSITIONAL & STRATEGIC MANDATE:
        - **Position Calculation**: Using the "Dealer Button" seat (e.g., P3) and the total "Active Opponents", determine your relative position (BTN, SB, BB, UTG, HJ, CO). 
        - **Hero Identification**: You are the "Hero". If "Hero Active: YES", it is your turn and you are currently looking at your own hole cards.
        - **Street-Awareness**: If the metadata says "Street: FLOP", identify the 3 cards. If it says "Street: RIVER", identify all 5.
        - **Board Analysis (CRITICAL)**: Use the BOARD_CARD_LOCATION hints in the metadata to find the board cards. You MUST identify the rank and suit of every card in those specified [x, y, w, h] regions.
        - **Dynamic Ranges**: Adjust your aggression based on "Active Opponents". In a 9-handed game, be tighter from early positions. In a 3-handed game, be much more aggressive.
        
        ### CUSTOM STRATEGY INSTRUCTIONS (HIGH PRIORITY):
        ${customPrompt}

        ### NUMERIC & VISUAL SANITY:
        - **Currency**: Identify if values are in Dollars, Euros, or tournament Chips.
        - **Pot vs Stack**: Ensure the 'cost_to_call' is mathematically consistent with the 'pot' and 'my_stack'.
        - **Button Scrutiny**: Look at the text on action buttons (Fold, Check, Call, Raise, All-In).

        ### OUTPUT FORMAT:
        Return ONLY a JSON object.
        {
            "detected_state": {
                "my_cards": ["card1", "card2"],
                "board": ["board_cards"],
                "pot": "extracted_total_pot",
                "my_stack": "extracted_stack_value",
                "cost_to_call": "extracted_numeric_value_from_call_button",
                "detected_big_blind": "inferred_big_blind_value",
                "street": "match_metadata_street",
                "my_position": "BTN/SB/BB/UTG/etc",
                "active_opponents": "count_from_metadata",
                "equity_estimate": "0-100",
                "opponents": [
                    {"name": "extracted_name", "seat": "P1", "action": "Fold/Call/Raise/Active/Unknown"}
                ]
            },
            "recommendation": "Fold/Call/Raise/Check/All-In",
            "reasoning": "Explain as a ${config.title}. 1) Position & Context: Mention your seat relative to the Button and the number of active players. 2) Math: Calculate EXACT Pot Odds (e.g. 'I need 25% equity to call 100 into a 400 pot') and compare to your estimated equity. 3) HUD Analysis: If you recognize a name from previous hands (mention it!), use their tendencies (e.g. 'PlayerX is a whale') to justify an exploit. 4) Strategy: Why this action fits your specific goal."
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/png", data: cleanBase64 } }
                ]
            }],
            generationConfig: { response_mime_type: "application/json" }
        })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API Error: ${errData.error?.message || response.statusText}`);
    }

    const result = await response.json();

    try {
        const text = result.candidates[0].content.parts[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : text;
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Failed to parse Gemini response', e, result);
        throw new Error('AI returned an invalid format. Check the image quality.');
    }
}

let lastHandTimestamp = Date.now();
setInterval(() => { lastHandTimestamp = Date.now(); }, 60000);

function updateHUD(opponents, street) {
    opponents.forEach(opp => {
        if (!opp.name || opp.name === 'Unknown') return;

        // Sanitize name
        const cleanName = opp.name.trim();
        if (!cleanName) return;

        if (!localHUD[cleanName]) {
            localHUD[cleanName] = { hands: 0, vpip: 0, pfr: 0, lastSeen: Date.now() };
        }

        const stats = localHUD[cleanName];
        stats.lastSeen = Date.now();

        if (!stats.lastHandId || stats.lastHandId !== lastHandTimestamp) {
            stats.hands = (stats.hands || 0) + 1;
            stats.lastHandId = lastHandTimestamp;
            stats.hasActedInHand = false;
        }

        if ((opp.action === 'Raise' || opp.action === 'Call') && !stats.hasActedInHand) {
            stats.vpip = (stats.vpip || 0) + 1;
            stats.hasActedInHand = true;
            if (street === 'PREFLOP' && opp.action === 'Raise') {
                stats.pfr = (stats.pfr || 0) + 1;
            }
        }
    });
    chrome.storage.local.set({ localHUD });
}
