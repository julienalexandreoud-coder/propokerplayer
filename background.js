// background.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_SCREEN') {
        const windowId = sender.tab ? sender.tab.windowId : null;
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ dataUrl });
            }
        });
        return true;
    }

    if (message.type === 'PERFORM_ANALYSIS') {
        handleVisionAnalysis(sender.tab.id);
        return true;
    }
});

async function handleVisionAnalysis(tabId) {
    try {
        console.log('Capturing for Gemini...');
        const dataUrl = await new Promise(resolve => {
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, resolve);
        });

        if (!dataUrl) throw new Error('Failed to capture screen');

        const result = await analyzeWithGemini(dataUrl);

        // Combine detected state with reasoning for the user
        const stateInfo = result.detected_state ?
            `Seen: ${result.detected_state.my_cards.join(',')} | Pot: ${result.detected_state.pot} | Call: ${result.detected_state.cost_to_call}\n\n` : '';

        chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_DECISION',
            recommendation: result.recommendation,
            reasoning: stateInfo + result.reasoning,
            state: result.detected_state // Pass state to help content script handle redirects
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

async function analyzeWithGemini(imageBase64) {
    const data = await chrome.storage.local.get(['apiKey', 'currentStrategy', 'customPrompt']);
    const key = data.apiKey;
    const strategy = data.currentStrategy || 'gto';
    const customPrompt = data.customPrompt || '';
    if (!key) throw new Error('API Key missing in storage');

    const cleanBase64 = imageBase64.split(',')[1];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;

    // Define strategy-specific logic
    const strategyConfigs = {
        gto: {
            title: "High-Stakes GTO Solver",
            goal: "Maximize EV (Expected Value) at all costs.",
            rules: `
                - Adhere to strict 6-Max TAG ranges pre-flop (Fold bottom 80%).
                - Use GTO frequencies post-flop. Balance Value Bets with Bluffs.
                - If the opponent is short-stacked, increase 'All-in' pressure.
            `
        },
        nl2: {
            title: "Micro-Stakes Specialist (NL2)",
            goal: "Exploit weak, loose, and passive players in €0.01/€0.02 games.",
            rules: `
                - **Value is King**: Do not bluff 'calling stations'. Only bet if you have a strong hand.
                - **Tight Pre-flop**: Avoid marginal hands due to high rake. Stick to premium/strong holdings.
                - **Respect Raises**: At NL2, a raise usually means the nuts. Fold to aggression unless you have an elite hand.
                - **Isolation**: Raise larger when in position to isolate fishy players.
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
        Analyze the provided screenshot with surgical precision.

        ### STACK PRESERVATION RULES:
        - **10% Rule**: Never treat 10% of your stack as "small" or "negligible." It is a significant investment. 
        - **Risk vs. Equity**: Any call or raise exceeding 5% of your total stack requires a clear mathematical rationale (Pot Odds + Hand Equity).
        - **Commitment Threshold**: If an action requires 30% or more of your stack, only proceed if you have a top-tier hand or a very high-equity draw.
        - **Stack Awareness**: Always compare the 'cost_to_call' to your 'my_stack'. If you are getting short-stacked (<20 BB), shift to an 'All-in or Fold' strategy.

        ### STRATEGY RULES:
        ${config.rules}
        ${customPrompt ? `### USER CUSTOM RULES (PRIORITY):\n${customPrompt}` : ''}
        - If the pot is multi-way (3+ players), play more conservatively.
        - **STRICT TECHNICAL RULE**: If the 'cost_to_call' is 0, or if you detect a "Check" or "Pass" button, you MUST recommend "Check" (or "Pass"). Many poker websites disable the "Fold" button when a free "Check" is available. To ensure the bot doesn't get stuck, you must never recommend "Fold" if it is free to stay in the hand.

        ### EXTRACTION RULES:
        1. Identify cards, stacks, pot, and dealer button precisely. 
        2. **SCRUTINIZE BUTTONS**: Look at the text on every button. 
        3. If cards are unclear, use suits and shapes for best-effort inference.

        ### OUTPUT FORMAT:
        Return ONLY a JSON object. Extract the REAL numbers from the image.
        {
            "detected_state": {
                "my_cards": ["card1", "card2"],
                "board": ["board_cards"],
                "pot": "extracted_pot_value",
                "my_stack": "extracted_stack_value",
                "cost_to_call": "extracted_button_text_value",
                "position": "extracted_position",
                "effective_stack": "calculated_value"
            },
            "recommendation": "Fold/Call/Raise/Check",
            "reasoning": "Explain the decision as a ${config.title}. Mention how the specific strategy rules applied to this hand."
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
